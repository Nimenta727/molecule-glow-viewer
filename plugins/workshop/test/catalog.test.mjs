import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadCatalog, queryCatalog, allTags, relatedResources, worksUsing, fetchWorkBytes, fetchResource, workshopBase, WorkshopError, WORKSHOP_BASE } from '../catalog.mjs';
import { sha256Hex, ResourceError } from '../../../packages/schema/resource.mjs';

const root = new URL('../../../workshop/', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
// A fetch that serves the repository's own workshop folder, so the tests read the real catalogues.
const localFetch = (overrides = {}) => async (url) => {
  const path = String(url).replace('https://example.test/workshop/', '');
  if (path in overrides) { const body = overrides[path]; return body === null ? { ok: false, status: 404 } : { ok: true, headers: new Headers(), arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body) : body).buffer.slice(0) }; }
  try { const bytes = read(path); return { ok: true, headers: new Headers({ 'content-length': String(bytes.length) }), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }; }
  catch { return { ok: false, status: 404 }; }
};
const base = 'https://example.test/workshop/';

test('the real catalogues load: works and resources of the official source, with a missing community source reported, not thrown', async () => {
  const catalog = await loadCatalog({ base, fetch: localFetch() });
  assert.equal(catalog.templates.filter((e) => e.source === 'official').length, 13, 'official static works: one per pack that is not only an animation demo');
  assert.deepEqual(catalog.templates.filter((e) => e.source === 'community').map((e) => e.title), ['血红蛋白：四个亚基与四个血红素'], 'the hemoglobin work made with the Studio (a static work: no tool)');
  assert.equal(catalog.works.length, 11, 'works: the animated versions (all official)');
  assert.ok(catalog.templates.every((entry) => entry.zone === 'template' && entry.tools.length === 0), 'a template needs no tool');
  assert.ok(catalog.works.every((entry) => entry.zone === 'work' && entry.tools.length > 0), 'a work names the tools it needs');
  assert.deepEqual([...new Set([...catalog.templates, ...catalog.works].map((entry) => entry.topic))].sort(), ['cell', 'local-system', 'mechanism', 'protein'], 'the four subjects');
  assert.equal(catalog.resources.length, 29, '11 first, then every structure the official works use, and the maltose-binding protein and Bacillus PS3 ATP synthase of the presets');
  assert.ok([...catalog.templates, ...catalog.works].every((work) => work.kind === 'work' && ['official', 'community'].includes(work.source) && /^[a-f0-9]{64}$/.test(work.sha256)));
  assert.ok(catalog.resources.every((entry) => entry.kind === 'resource' && entry.delivery === 'reference' && entry.record.attribution.license === 'CC0-1.0'));
  assert.deepEqual(catalog.errors.map(({ source, zone }) => `${source}/${zone}`), ['community/resources', 'community/plugins'], 'the community source has a static work but no resource or plugin catalogue');
  assert.ok(Object.isFrozen(catalog.works[0]) && Object.isFrozen(catalog.templates[0]) && Object.isFrozen(catalog.resources[0].record));
});

test('the plugin zone lists every packaged plugin with its manifest, and a plugin that adds nothing a user can reach is refused', async () => {
  const catalog = await loadCatalog({ base, fetch: localFetch() });
  assert.equal(catalog.plugins.length, 17);
  assert.ok(catalog.plugins.every((entry) => entry.kind === 'plugin' && entry.source === 'official' && /^[a-f0-9]{64}$/.test(entry.sha256) && entry.manifest.status.limits.length >= 1 && Object.isFrozen(entry)));
  assert.deepEqual(queryCatalog(catalog, { zone: 'plugins', text: 'smoluchowski' }).map(({ id }) => id), ['org.glow.plugin.binding'], 'the search reads the list of added functions');
  assert.equal(queryCatalog(catalog, { zone: 'plugins', tag: '过程模拟' }).length, 5, 'the category is a tag: binding, filament, motor, reaction networks, transporter');
  assert.ok(allTags(catalog, 'plugins').includes('渲染与规模'));
  const raw = JSON.parse(read('official/plugins/index.json').toString()), broken = structuredClone(raw);
  broken.plugins[0].manifest.provides = broken.plugins[0].manifest.provides.filter((p) => p.type === 'module' || p.type === 'cli');
  const bad = await loadCatalog({ base, fetch: localFetch({ 'official/plugins/index.json': JSON.stringify(broken) }), sources: ['official'] });
  assert.equal(bad.plugins.length, 16); assert.match(bad.errors.find(({ zone }) => zone === 'plugins').message, /没有任何用户能直接用的入口/);
});

test('queries match titles, tags, ids and accessions, by zone, source and tag', async () => {
  const catalog = await loadCatalog({ base, fetch: localFetch() });
  const atp = queryCatalog(catalog, { zone: 'templates', text: 'ATP' }).map(({ id }) => id);
  assert.ok(atp.includes('official.atp-synthase') && atp.includes('official.respiratory-chain'), 'ATP appears in titles and descriptions');
  assert.ok(!atp.includes('official.kcsa') && !atp.includes('official.spike'));
  assert.deepEqual(queryCatalog(catalog, { zone: 'templates', text: 'atp 合酶' }).map(({ id }) => id).includes('official.kcsa'), false, 'every word must match');
  assert.deepEqual(queryCatalog(catalog, { zone: 'templates', text: '6zpo' }).map(({ id }) => id).sort(), ['official.atp-synthase', 'official.respiratory-chain'], 'by the structure a template uses');
  assert.deepEqual(queryCatalog(catalog, { zone: 'resources', text: 'kcsa' }).map(({ id }) => id).sort(), ['res.rcsb.1K4C', 'res.rcsb.2HVK', 'res.rcsb.2ITD', 'res.rcsb.5VK6', 'res.rcsb.5VKE']);
  assert.deepEqual(queryCatalog(catalog, { zone: 'resources', text: 'escherichia' }).map(({ id }) => id).sort(), ['res.rcsb.1AKE', 'res.rcsb.1ANF', 'res.rcsb.1AON', 'res.rcsb.1OMP', 'res.rcsb.4AKE', 'res.rcsb.4V6F'], 'by species');
  assert.deepEqual(queryCatalog(catalog, { zone: 'resources', tag: '阻断剂' }).map(({ id }) => id), ['res.rcsb.2HVK', 'res.rcsb.2ITD']);
  assert.equal(queryCatalog(catalog, { zone: 'works', source: 'community' }).length, 0);
  assert.deepEqual(queryCatalog(catalog, { zone: 'templates', topic: 'cell' }).map(({ id }) => id), ['official.whole-cell'], 'by subject');
  assert.deepEqual(queryCatalog(catalog, { zone: 'templates', topic: 'protein', source: 'official' }).map(({ id }) => id).sort(), ['official.groel', 'official.nucleosome', 'official.proteasome-20s', 'official.spike']);
  assert.deepEqual(queryCatalog(catalog, { zone: 'works', topic: 'local-system' }).map(({ id }) => id), ['official.cell-corner.work']);
  assert.equal(queryCatalog(catalog, { zone: 'works', text: 'no-such-thing' }).length, 0);
  assert.equal(queryCatalog(catalog, { zone: 'templates', text: '  ' }).length, 14, 'blank text matches everything');
  assert.ok(allTags(catalog, 'resources').includes('钾通道'));
});

test('a work shows the resources it is built from, and a resource shows the works that use it', async () => {
  const catalog = await loadCatalog({ base, fetch: localFetch() });
  const adk = catalog.works.find(({ id }) => id === 'official.adenylate-kinase.work');
  assert.deepEqual(relatedResources(catalog, adk).found.map(({ id }) => id), ['res.rcsb.4AKE', 'res.rcsb.1AKE']);
  assert.deepEqual(adk.tools, ['org.glow.tool.conformation-pair']);
  const spike = catalog.templates.find(({ id }) => id === 'official.spike');
  assert.deepEqual(relatedResources(catalog, { ...spike, resources: ['res.rcsb.6VXX', 'res.rcsb.9ZZZ'] }).missing, ['res.rcsb.9ZZZ'], 'an id the catalogue does not hold is reported missing');
  assert.deepEqual(relatedResources(catalog, spike).found.map(({ id }) => id), ['res.rcsb.6VXX'], 'the spike template is built from its registered resource');
  const atpResource = catalog.resources.find(({ id }) => id === 'res.rcsb.6ZPO');
  assert.deepEqual(worksUsing(catalog, atpResource).map(({ id }) => id).sort(), ['official.atp-synthase', 'official.atp-synthase.work', 'official.respiratory-chain', 'official.respiratory-chain.work']);
});

test('a broken catalogue entry is dropped with a note and the rest still loads; a bad format or 404 is an error entry', async () => {
  const good = JSON.parse(read('official/resources/index.json'));
  const bad = structuredClone(good);
  bad.resources[0].record.attribution = {};            // invalid record
  bad.resources[1].delivery = 'embed';                  // not supported
  const catalog = await loadCatalog({ base, fetch: localFetch({ 'official/resources/index.json': JSON.stringify(bad) }), sources: ['official'] });
  assert.equal(catalog.resources.length, good.resources.length - 2);
  assert.equal(catalog.errors.filter(({ zone }) => zone === 'resources').length, 2);
  assert.match(catalog.errors.map(({ message }) => message).join('|'), /仅引用/);
  const wrong = await loadCatalog({ base, fetch: localFetch({ 'official/index.json': '{"format":"other","version":1}', 'official/resources/index.json': null }), sources: ['official'] });
  assert.deepEqual(wrong.errors.map(({ zone, message }) => [zone, /目录格式不对|HTTP 404/.test(message)]), [['works', true], ['resources', true]]);
  assert.equal(wrong.works.length + wrong.templates.length + wrong.resources.length, 0);
  const strayWork = JSON.parse(read('official/index.json'));
  strayWork.packs[0].file = '../../etc/passwd';
  const guarded = await loadCatalog({ base, fetch: localFetch({ 'official/index.json': JSON.stringify(strayWork) }), sources: ['official'] });
  assert.equal(guarded.works.length + guarded.templates.length, 23, 'an entry whose file path escapes packs/ is ignored');
  await assert.rejects(loadCatalog({ base: 3, fetch: localFetch() }), TypeError);
});

test('a work is only handed over when its bytes match the catalogue\'s hash', async () => {
  const catalog = await loadCatalog({ base, fetch: localFetch(), sources: ['official'] });
  const entry = catalog.templates.find(({ id }) => id === 'official.atp-synthase');
  const bytes = await fetchWorkBytes(catalog, entry, { fetch: localFetch() });
  assert.equal(await sha256Hex(bytes), entry.sha256);
  await assert.rejects(fetchWorkBytes(catalog, entry, { fetch: localFetch({ [`official/${entry.file}`]: 'tampered' }) }), (error) => error instanceof WorkshopError && error.code === 'work-hash-mismatch');
  await assert.rejects(fetchWorkBytes(catalog, entry, { fetch: localFetch({ [`official/${entry.file}`]: null }) }), (error) => error.code === 'http');
});

test('a reference resource is only used when what RCSB returns matches the recorded size and hash', async () => {
  const catalog = await loadCatalog({ base, fetch: localFetch(), sources: ['official'] });
  const entry = catalog.resources.find(({ id }) => id === 'res.rcsb.1K4C'), [file] = entry.record.files;
  const exact = new Uint8Array(file.bytes);   // the right length but not the right content
  const same = new TextEncoder().encode('data_same');
  const make = (bytes) => ({ load: async (accession) => { assert.equal(accession, '1K4C'); return { bytes }; } });
  await assert.rejects(fetchResource(entry, make(exact)), (error) => error instanceof ResourceError && error.code === 'res-hash-mismatch' && /已在上游更新|与工坊记录不符/.test(error.message));
  await assert.rejects(fetchResource(entry, make(same)), (error) => error.code === 'res-hash-mismatch');
  // an entry whose record describes exactly these bytes is accepted, and carries the RCSB provenance
  const fake = { ...entry, record: { ...entry.record, files: [{ ...file, bytes: same.length, sha256: await sha256Hex(same) }] } };
  const input = await fetchResource(fake, make(same));
  assert.deepEqual([input.name, input.source, input.mediaType], ['1K4C.cif', { provider: 'RCSB PDB', accession: '1K4C' }, 'chemical/x-mmcif']);
  await assert.rejects(fetchResource({ ...entry, record: { ...entry.record, source: { ...entry.record.source, provider: 'elsewhere' } } }, make(same)), (error) => error.code === 'provider');
});

test('the catalogue location: local checkout, GitHub otherwise, same-origin override only', () => {
  const at = (href, hostname) => workshopBase({ href, hostname });
  assert.equal(at('http://127.0.0.1:8765/apps/viewer-web/index.html', '127.0.0.1'), 'http://127.0.0.1:8765/workshop/');
  assert.equal(at('http://localhost:8000/apps/studio-web/index.html', 'localhost'), 'http://localhost:8000/workshop/');
  assert.equal(at('https://nimenta727.github.io/molecule-glow-viewer/apps/viewer-web/', 'nimenta727.github.io'), WORKSHOP_BASE);
  assert.equal(at('app://glow/apps/viewer-web/index.html', 'glow'), WORKSHOP_BASE);
  assert.equal(at('http://127.0.0.1:8765/apps/viewer-web/index.html?workshop=../../elsewhere', '127.0.0.1'), 'http://127.0.0.1:8765/elsewhere/');
  assert.equal(at('https://example.org/apps/viewer-web/index.html?workshop=https://evil.example/ws/', 'example.org'), WORKSHOP_BASE, 'an absolute URL from the address bar is ignored');
  assert.equal(at('https://example.org/apps/viewer-web/index.html?workshop=//evil.example/ws/', 'example.org'), WORKSHOP_BASE, 'so is a protocol-relative one');
});

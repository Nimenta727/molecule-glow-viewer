import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadCatalog } from '../catalog.mjs';
import { derivativeLicenses, checkDerivation, describeEntry, diagnose, lineage, hasNewerRevision, licenseTerms } from '../diagnose.mjs';

const root = new URL('../../../workshop/', import.meta.url), base = 'https://example.test/workshop/';
const fetchLocal = async (url) => { try { const bytes = readFileSync(new URL(String(url).replace(base, ''), root)); return { ok: true, headers: new Headers(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }; } catch { return { ok: false, status: 404 }; } };
const work = (over = {}) => ({ kind: 'work', id: 'a.work', title: 'A', zone: 'work', topic: 'protein', source: 'community', license: 'CC-BY-4.0', revision: 1, author: { name: 'Ann' }, tools: [], pdb: [], resources: [], ...over });
const catalogOf = (works = [], resources = []) => ({ templates: [], works, resources, errors: [] });

test('derivative licences follow the parents: share-alike forces share-alike, attribution allows BY or BY-SA, public domain allows all, unknown allows nothing', () => {
  assert.deepEqual(derivativeLicenses(['CC-BY-SA-4.0']).allowed, ['CC-BY-SA-4.0']);
  assert.deepEqual(derivativeLicenses(['CC-BY-4.0']).allowed, ['CC-BY-4.0', 'CC-BY-SA-4.0']);
  assert.deepEqual(derivativeLicenses(['CC0-1.0']).allowed, ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0']);
  assert.deepEqual(derivativeLicenses(['CC0-1.0', 'CC-BY-4.0']).allowed, ['CC-BY-4.0', 'CC-BY-SA-4.0'], 'the strictest parent wins');
  assert.deepEqual(derivativeLicenses(['CC-BY-4.0', 'CC-BY-SA-4.0']).allowed, ['CC-BY-SA-4.0']);
  const unknown = derivativeLicenses(['CC0-1.0', 'All-Rights-Reserved']); assert.deepEqual(unknown.allowed, []); assert.match(unknown.reason, /All-Rights-Reserved/);
  assert.equal(licenseTerms('CC-BY-4.0').attribution, true); assert.equal(licenseTerms('nope'), null);
});

test('a derivation must name an existing work, a revision that exists, an allowed licence, and not loop', () => {
  const parent = work({ id: 'p.work', license: 'CC-BY-SA-4.0', revision: 3 }), byId = (...entries) => new Map(entries.map((entry) => [entry.id, entry]));
  const child = (over) => work({ id: 'c.work', license: 'CC-BY-SA-4.0', derivedFrom: { id: 'p.work', revision: 3 }, ...over });
  assert.deepEqual(checkDerivation(child(), byId(parent)), []);
  assert.deepEqual(checkDerivation(work(), byId()), [], 'no record, nothing to check');
  assert.match(checkDerivation(child({ derivedFrom: { id: 'gone.work' } }), byId(parent))[0], /不在工坊目录/);
  assert.match(checkDerivation(child({ derivedFrom: { id: 'p.work', revision: 4 } }), byId(parent))[0], /只有第 3 版/);
  assert.match(checkDerivation(child({ license: 'CC-BY-4.0' }), byId(parent))[0], /不能用于派生/);
  assert.match(checkDerivation(child({ derivedFrom: { id: 'c.work' } }), byId(parent))[0], /自己派生/);
  const a = work({ id: 'a.work', license: 'CC-BY-4.0', derivedFrom: { id: 'b.work' } }), b = work({ id: 'b.work', license: 'CC-BY-4.0', derivedFrom: { id: 'a.work' } });
  assert.ok(checkDerivation(a, byId(a, b)).some((text) => /循环/.test(text)));
});

test('the details of a work: author, licence terms, revision, lineage both ways, tools by name', () => {
  const parent = work({ id: 'p.work', title: 'Parent', revision: 2, tools: ['org.glow.tool.x'] }), kid = work({ id: 'k.work', title: 'Kid', derivedFrom: { id: 'p.work', revision: 1 }, author: { name: 'Bo', url: 'https://example.org/bo' }, tools: ['org.glow.tool.x'] });
  const catalog = catalogOf([parent, kid]);
  const d = describeEntry(catalog, kid, { toolTitle: (id) => `T:${id}` });
  assert.deepEqual(d.author, { name: 'Bo', url: 'https://example.org/bo' }); assert.equal(d.license.attributionRequired, true); assert.equal(d.license.shareAlike, false);
  assert.deepEqual(d.ancestors, [{ id: 'p.work', title: 'Parent', revision: 1, currentRevision: 2 }]); assert.deepEqual(d.tools, [{ id: 'org.glow.tool.x', title: 'T:org.glow.tool.x' }]);
  assert.deepEqual(describeEntry(catalog, parent).derived, [{ id: 'k.work', title: 'Kid' }]);
  assert.equal(describeEntry(catalogOf([work({ author: { name: 'x', url: 'javascript:alert(1)' } })]), work({ author: { name: 'x', url: 'javascript:alert(1)' } })).author.url, null, 'only https links are offered');
  assert.deepEqual(lineage(catalogOf([kid]), kid).missing, 'p.work');
});

test('diagnosis: a missing tool is an error, a missing resource and an unregistered structure are warnings, attribution is information', () => {
  const entry = work({ tools: ['org.glow.tool.gone', 'org.glow.tool.here'], resources: ['res.rcsb.1ABC'], pdb: ['1ABC', '2XYZ'] });
  const items = diagnose(catalogOf([entry]), entry, { toolAvailable: (id) => id.endsWith('here') });
  const by = (code) => items.filter((item) => item.code === code);
  assert.equal(by('tool-missing').length, 1); assert.equal(by('tool-missing')[0].level, 'error'); assert.match(by('tool-missing')[0].message, /org\.glow\.tool\.gone/);
  assert.equal(by('resource-missing')[0].level, 'warning'); assert.match(by('structure-unregistered')[0].message, /2XYZ/); assert.ok(!/1ABC/.test(by('structure-unregistered')[0].message));
  assert.equal(by('attribution')[0].level, 'info');
  assert.deepEqual(diagnose(catalogOf([work({ license: 'CC0-1.0' })]), work({ license: 'CC0-1.0' })).map((item) => item.code), [], 'a public-domain work with nothing missing has nothing to say');
});

test('diagnosis: share-alike resources, forbidden embedding, unknown licences, vanished or newer sources', () => {
  const resource = (id, license, extra = {}) => ({ kind: 'resource', id, title: id, source: 'official', delivery: 'reference', record: { version: '1', source: { provider: 'rcsb', accession: 'X' }, attribution: { license, ...extra }, files: [{ path: 'x', bytes: 1, sha256: 'a'.repeat(64) }] } });
  const sa = resource('res.sa', 'CC-BY-SA-4.0'), noEmbed = resource('res.ne', 'CC0-1.0', { embedAllowed: false }), odd = resource('res.odd', 'Proprietary');
  const entry = work({ license: 'CC-BY-4.0', resources: ['res.sa', 'res.ne', 'res.odd'], pdb: ['X'] });
  const codes = diagnose(catalogOf([entry], [sa, noEmbed, odd]), entry).map((item) => `${item.level}:${item.code}`);
  for (const expected of ['error:license-conflict', 'warning:embed-forbidden', 'warning:license-unknown']) assert.ok(codes.includes(expected), expected);
  const fine = work({ license: 'CC-BY-SA-4.0', resources: ['res.sa'] });
  assert.ok(!diagnose(catalogOf([fine], [sa]), fine).some((item) => item.code === 'license-conflict'));
  const orphan = work({ derivedFrom: { id: 'gone.work' } });
  assert.ok(diagnose(catalogOf([orphan]), orphan).some((item) => item.code === 'derived-missing' && item.level === 'error'));
  const parent = work({ id: 'p.work', revision: 5 }), kid = work({ id: 'k.work', derivedFrom: { id: 'p.work', revision: 2 } });
  assert.ok(diagnose(catalogOf([parent, kid]), kid).some((item) => item.code === 'source-updated'));
  assert.deepEqual(diagnose(catalogOf([], [sa, noEmbed]), noEmbed).map((item) => item.code), ['embed-forbidden', 'reference-only']);
  assert.equal(hasNewerRevision(work({ revision: 3 }), 2), true); assert.equal(hasNewerRevision(work({ revision: 3 }), 3), false); assert.equal(hasNewerRevision(work({ revision: 3 }), undefined), false);
});

test('on the real catalogue every official work and template has details and no error-level diagnosis when its tools exist', async () => {
  const catalog = await loadCatalog({ base, fetch: fetchLocal }), entries = [...catalog.templates, ...catalog.works];
  assert.ok(entries.length >= 24);
  for (const entry of entries) {
    const d = describeEntry(catalog, entry); assert.ok(d.author.name, entry.id); assert.ok(d.revision >= 1); assert.ok(d.license.name);
    const errors = diagnose(catalog, entry).filter((item) => item.level === 'error'); assert.deepEqual(errors, [], entry.id);
  }
  for (const resource of catalog.resources) { const d = describeEntry(catalog, resource); assert.equal(d.license.embedAllowed !== undefined, true); assert.ok(d.usedBy.length >= 0); }
  assert.ok(diagnose(catalog, catalog.works[0], { toolAvailable: () => false }).some((item) => item.code === 'tool-missing'), 'a work whose tools are unavailable is flagged');
});

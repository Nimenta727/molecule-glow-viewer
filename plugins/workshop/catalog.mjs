import { validateResource, sha256Hex, ResourceError } from '../../packages/schema/resource.mjs';
import { validatePluginManifest, CATEGORIES } from '../../packages/plugin-host/plugin-manifest.mjs';

/**
 * The workshop client: reads the two catalogues of a source (works and resources), answers queries, and fetches the bytes
 * of a work or a resource after checking them against the hash the catalogue records. It runs in the browser and in Node
 * (the `fetch` function is injected). The catalogues are data: every entry is validated and a bad one is dropped with a note.
 *   <base>/<source>/index.json              works     (format "glow-index")
 *   <base>/<source>/resources/index.json    resources (format "glow-resources"; a record without bytes, delivery "reference")
 */
export const WORKSHOP_BASE = 'https://raw.githubusercontent.com/Nimenta727/molecule-glow-viewer/main/workshop/';
export const WORKSHOP_SOURCES = Object.freeze(['official', 'community']);
const MAX_INDEX = 4 * 1024 * 1024;
const MAX_WORK = 32 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_NAMES = { official: '官方', community: '社区' };

export class WorkshopError extends Error {
  constructor(code, message) { super(message); this.name = 'WorkshopError'; this.code = code; }
}

/**
 * Where the catalogues are: the same origin's workshop folder when the page runs from a local checkout, otherwise the project's
 * GitHub folder. `?workshop=<relative path>` may point to another folder of the same origin (for testing); an absolute URL
 * from the address bar is ignored, so a link cannot make the app read someone else's catalogue.
 */
export function workshopBase({ href = 'http://localhost/apps/viewer-web/index.html', hostname = '' } = {}) {
  const page = new URL(href);
  const wanted = page.searchParams.get('workshop');
  if (wanted) {
    const resolved = new URL(wanted, page);
    if (resolved.origin === page.origin && !/^[a-z][a-z0-9+.-]*:/i.test(wanted)) return resolved.href.endsWith('/') ? resolved.href : `${resolved.href}/`;
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname || page.hostname)) return new URL('../../workshop/', page).href;
  return WORKSHOP_BASE;
}

async function fetchBytes(fetchImpl, url, limit, label) {
  const response = await fetchImpl(url, { cache: 'no-cache' });
  if (!response?.ok) throw new WorkshopError('http', `${label}：下载失败（HTTP ${response?.status ?? '?'}）`);
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new WorkshopError('too-large', `${label}：文件超过 ${Math.round(limit / 1048576)} MiB`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new WorkshopError('too-large', `${label}：文件超过 ${Math.round(limit / 1048576)} MiB`);
  return bytes;
}

async function fetchIndex(fetchImpl, url, format, label) {
  const bytes = await fetchBytes(fetchImpl, url, MAX_INDEX, label);
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (data?.format !== format || data.version !== 1) throw new WorkshopError('format', `${label}：目录格式不对`);
  return data;
}

const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const list = (value, max = 32) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, max) : [];

/** The four subjects a template or a work is about: mechanism, protein, local system, cell. */
export const TOPICS = Object.freeze({ mechanism: '机理', protein: '蛋白质', 'local-system': '局部系统', cell: '细胞' });

const WORK_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
function derivedFrom(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !WORK_ID.test(value.id)) return undefined;
  const revision = Number.isInteger(value.revision) && value.revision >= 1 ? value.revision : undefined;
  return Object.freeze({ id: value.id, ...(revision ? { revision } : {}) });
}
function workEntry(raw, source) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.file !== 'string' || !SHA256.test(raw.sha256 ?? '') || !/^packs\/[A-Za-z0-9._-]+\.glow$/.test(raw.file)) return null;
  return Object.freeze({
    kind: 'work', zone: raw.zone === 'template' ? 'template' : 'work', topic: Object.hasOwn(TOPICS, raw.topic) ? raw.topic : 'protein', source, id: raw.id, title: text(raw.title, 120) || raw.id, description: text(raw.description, 400), category: text(raw.category, 20), tags: list(raw.tags, 8),
    license: text(raw.license, 40), file: raw.file, sha256: raw.sha256, size: Number.isFinite(raw.size) ? raw.size : 0, updated: text(raw.updated, 20),
    pdb: list(raw.pdb), resources: list(raw.resources), tools: list(raw.tools), animation: text(raw.animation, 10),
    revision: Number.isInteger(raw.revision) && raw.revision >= 1 ? raw.revision : 1,
    author: Object.freeze({ name: text(raw.author?.name, 80), ...(typeof raw.author?.url === 'string' && /^https:\/\/\S+$/.test(raw.author.url) ? { url: raw.author.url.slice(0, 300) } : {}) }),
    ...(derivedFrom(raw.derivedFrom) ? { derivedFrom: derivedFrom(raw.derivedFrom) } : {}),
  });
}

/** A plugin of the plugin zone: the manifest (validated) and the hash of its file. Plugins carry no code here; see plugin-gate.mjs. */
function pluginEntry(raw, source) {
  if (!SHA256.test(raw?.sha256 ?? '')) throw new WorkshopError('format', `${text(raw?.id, 60) || '（无编号）'}：缺少清单哈希`);
  const manifest = validatePluginManifest(raw.manifest);
  return Object.freeze({ kind: 'plugin', source, id: manifest.id, title: manifest.name, description: manifest.summary, tags: Object.freeze([CATEGORIES[manifest.category], ...manifest.tags]), sha256: raw.sha256, manifest });
}

function resourceEntry(raw, source) {
  const record = validateResource(raw?.record);   // throws on an invalid record
  if (raw.delivery !== 'reference') throw new WorkshopError('delivery', `${record.id}：目前只支持“仅引用”的资源`);
  return Object.freeze({ kind: 'resource', source, id: record.id, title: text(raw.title, 120) || record.id, description: text(raw.description, 400), tags: list(raw.tags, 8),
    delivery: 'reference', updated: text(raw.updated, 20), record: Object.freeze(record) });
}

/** Loads both catalogues of every requested source. A missing or invalid catalogue becomes an entry of `errors`, never an exception. */
/**
 * The sources that ship inside the application: in the packaged app (the page is served from app://) the official catalogue — the basic protein works, the plugin list, the resources — is a folder of the
 * application itself (`app/workshop/official/`, copied by desktop/scripts/package-platform.cjs), so it always matches the plugin code that ships with it and works offline. The community source is still read
 * from `workshopBase`. Anywhere else (a browser, a local checkout) nothing is bundled and everything comes from `workshopBase`.
 */
export function bundledSources({ href = 'http://localhost/apps/viewer-web/index.html' } = {}) {
  const page = new URL(href);
  return page.protocol === 'app:' ? { official: new URL('../../workshop/', page).href } : {};
}

export async function loadCatalog({ base, bundled = {}, fetch: fetchImpl = globalThis.fetch, sources = WORKSHOP_SOURCES } = {}) {
  if (typeof base !== 'string' || typeof fetchImpl !== 'function') throw new TypeError('loadCatalog needs a base URL and a fetch function');
  const works = [], templates = [], resources = [], plugins = [], errors = [];
  for (const source of sources) {
    try {
      const index = await fetchIndex(fetchImpl, `${bundled[source] ?? base}${source}/index.json`, 'glow-index', `${SOURCE_NAMES[source] ?? source}作品区`);
      for (const raw of index.packs ?? []) {
        const entry = workEntry(raw, source);
        if (entry) (entry.zone === 'template' ? templates : works).push(entry); else errors.push({ source, zone: 'works', message: `${text(raw?.id, 60) || '（无编号）'}：目录项不完整，已忽略` });
      }
    } catch (error) { errors.push({ source, zone: 'works', message: error.message }); }
    try {
      const index = await fetchIndex(fetchImpl, `${bundled[source] ?? base}${source}/resources/index.json`, 'glow-resources', `${SOURCE_NAMES[source] ?? source}资源区`);
      for (const raw of index.resources ?? []) {
        try { resources.push(resourceEntry(raw, source)); }
        catch (error) { errors.push({ source, zone: 'resources', message: `${text(raw?.record?.id, 60) || '（无编号）'}：${error.message}` }); }
      }
    } catch (error) { errors.push({ source, zone: 'resources', message: error.message }); }
    try {
      const index = await fetchIndex(fetchImpl, `${bundled[source] ?? base}${source}/plugins/index.json`, 'glow-plugins', `${SOURCE_NAMES[source] ?? source}插件区`);
      for (const raw of index.plugins ?? []) {
        try { plugins.push(pluginEntry(raw, source)); }
        catch (error) { errors.push({ source, zone: 'plugins', message: `${text(raw?.id, 60) || '（无编号）'}：${error.message}` }); }
      }
    } catch (error) { errors.push({ source, zone: 'plugins', message: error.message }); }
  }
  return Object.freeze({ base, bundled: Object.freeze({ ...bundled }), templates: Object.freeze(templates), works: Object.freeze(works), resources: Object.freeze(resources), plugins: Object.freeze(plugins), errors: Object.freeze(errors) });
}

const norm = (value) => String(value ?? '').toLowerCase();

/** Entries of one zone ('works' or 'resources'), optionally of one source, matching a text (title, description, tags, ids, accessions) and a tag. */
export function queryCatalog(catalog, { zone = 'works', source, text: query = '', tag, topic } = {}) {
  const entries = zone === 'plugins' ? catalog.plugins : zone === 'resources' ? catalog.resources : zone === 'templates' ? catalog.templates : catalog.works;
  const words = norm(query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (source && entry.source !== source) return false;
    if (tag && !entry.tags.includes(tag)) return false;
    if (topic && entry.topic !== topic) return false;
    const haystack = norm([entry.id, entry.title, entry.description, entry.tags.join(' '), entry.pdb?.join(' '), entry.record?.source.accession, entry.record?.card?.species, entry.license, entry.manifest?.adds.join(' '), entry.manifest?.provides.map((p) => p.name ?? p.preset ?? '').join(' ')].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

export const allTags = (catalog, zone) => [...new Set((zone === 'plugins' ? catalog.plugins : zone === 'resources' ? catalog.resources : zone === 'templates' ? catalog.templates : catalog.works).flatMap((entry) => entry.tags))].sort((a, b) => a.localeCompare(b, 'zh'));

/** The resource entries a work is built from, and the ids it names that this catalogue does not hold. */
export function relatedResources(catalog, work) {
  const byId = new Map(catalog.resources.map((entry) => [entry.id, entry]));
  return { found: work.resources.map((id) => byId.get(id)).filter(Boolean), missing: work.resources.filter((id) => !byId.has(id)) };
}

/** The works and templates that use a resource. */
export const worksUsing = (catalog, resource) => [...catalog.works, ...catalog.templates].filter((work) => work.resources.includes(resource.id));

/** Downloads a work's pack and checks it against the catalogue's hash. */
export async function fetchWorkBytes(catalog, entry, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const bytes = await fetchBytes(fetchImpl, `${catalog.bundled?.[entry.source] ?? catalog.base}${entry.source}/${entry.file}`, MAX_WORK, entry.title);
  if (await sha256Hex(bytes) !== entry.sha256) throw new WorkshopError('work-hash-mismatch', `${entry.title}：下载内容与目录记录的哈希不符，已拒绝打开。`);
  return bytes;
}

/**
 * Brings the bytes of a reference resource: `load(accession, { signal })` fetches the structure (RCSB source of the app); the result must
 * match the size and sha256 of the catalogue's record, otherwise the resource has changed upstream and the work would not be reproducible.
 * Returns the structure input the importers take, with the RCSB provenance.
 */
export async function fetchResource(entry, { load, signal }) {
  const { record } = entry, [file] = record.files;
  if (record.source.provider !== 'rcsb') throw new WorkshopError('provider', `${record.id}：暂不支持从 ${record.source.provider} 取回`);
  const structure = await load(record.source.accession, { signal });
  const actual = await sha256Hex(structure.bytes);
  if (structure.bytes.byteLength !== file.bytes || actual !== file.sha256) {
    throw new ResourceError('res-hash-mismatch', `${record.id}：从 ${record.source.provider.toUpperCase()} 取回的内容与工坊记录不符（记录 ${file.sha256.slice(0, 8)}…，实际 ${actual.slice(0, 8)}…）。该条目可能已在上游更新，为保证作品可复现，已拒绝使用。`);
  }
  return { name: `${record.source.accession}.cif`, bytes: structure.bytes, mediaType: file.mediaType, source: { provider: 'RCSB PDB', accession: record.source.accession } };
}

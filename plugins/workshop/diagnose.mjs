/**
 * What a workshop entry needs and what it allows, as plain data (4.5.1): attribution and licence terms, revision, where it was derived from and what was derived from it, and a diagnosis of its
 * dependencies (resources the catalogue does not hold, tools this application does not have, structures not registered as resources, resources that forbid embedding). Pure functions over
 * the loaded catalogue; the dialog and the validators use the same ones, so what a person sees is what CI enforces.
 */
export const LICENSES = Object.freeze({
  'CC0-1.0': { name: 'CC0 1.0（公共领域贡献）', attribution: false, shareAlike: false },
  'CC-BY-4.0': { name: 'CC BY 4.0（署名）', attribution: true, shareAlike: false },
  'CC-BY-SA-4.0': { name: 'CC BY-SA 4.0（署名-相同方式共享）', attribution: true, shareAlike: true },
});
export const licenseTerms = (id) => LICENSES[id] ?? null;

/**
 * The licences a derived work may carry, given the licences of everything it is derived from. A share-alike parent forces share-alike; a plain attribution parent allows BY or BY-SA;
 * public-domain parents allow all three. An unknown licence on any parent means nothing can be promised: `allowed` is empty and `reason` says why.
 */
export function derivativeLicenses(parentLicenses) {
  const parents = [...new Set(parentLicenses)];
  if (!parents.length) return { allowed: Object.keys(LICENSES), reason: null };
  const unknown = parents.find((id) => !LICENSES[id]);
  if (unknown) return { allowed: [], reason: `来源的授权“${unknown || '未标注'}”不在工坊认可的授权里，无法确定派生作品可用的授权。` };
  if (parents.some((id) => LICENSES[id].shareAlike)) return { allowed: ['CC-BY-SA-4.0'], reason: '来源含 CC BY-SA：派生作品必须同样以 CC BY-SA 4.0 共享。' };
  if (parents.some((id) => LICENSES[id].attribution)) return { allowed: ['CC-BY-4.0', 'CC-BY-SA-4.0'], reason: '来源要求署名：派生作品须保留署名，可用 CC BY 或 CC BY-SA。' };
  return { allowed: Object.keys(LICENSES), reason: null };
}

/** Checks the derivation record of one work against the works of a catalogue: it must name an existing work, not a later revision than exists, not itself, and an allowed licence. */
export function checkDerivation(work, byId) {
  const problems = [], from = work.derivedFrom;
  if (!from) return problems;
  if (from.id === work.id) { problems.push(`${work.id}：不能从自己派生`); return problems; }
  const parent = byId.get(from.id);
  if (!parent) { problems.push(`${work.id}：派生来源 ${from.id} 不在工坊目录里`); return problems; }
  if (from.revision != null && from.revision > (parent.revision ?? 1)) problems.push(`${work.id}：派生自 ${from.id} 的第 ${from.revision} 版，但目录里只有第 ${parent.revision ?? 1} 版`);
  const { allowed, reason } = derivativeLicenses([parent.license]);
  if (!allowed.includes(work.license)) problems.push(`${work.id}：授权 ${work.license || '（未标注）'} 不能用于派生自 ${parent.id}（${parent.license || '未标注'}）的作品。${reason ?? ''}`.trim());
  // a chain that loops back is a mistake even when each link is fine
  const seen = new Set([work.id]);
  for (let at = parent; at?.derivedFrom; at = byId.get(at.derivedFrom.id)) {
    if (seen.has(at.id)) { problems.push(`${work.id}：派生链出现循环（经过 ${at.id}）`); break; }
    seen.add(at.id);
  }
  return problems;
}

const all = (catalog) => [...catalog.templates, ...catalog.works];
const httpsUrl = (url) => (typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url) ? url : null);

/** The works and templates a work was derived from (the chain, nearest first) and the ones derived from it (direct). */
export function lineage(catalog, work) {
  const byId = new Map(all(catalog).map((entry) => [entry.id, entry]));
  const ancestors = [], seen = new Set([work.id]);
  for (let from = work.derivedFrom; from && byId.has(from.id) && !seen.has(from.id); from = byId.get(from.id).derivedFrom) { seen.add(from.id); ancestors.push({ entry: byId.get(from.id), revision: from.revision ?? null }); }
  const missing = work.derivedFrom && !byId.has(work.derivedFrom.id) ? work.derivedFrom.id : null;
  return { ancestors, missing, derived: all(catalog).filter((entry) => entry.derivedFrom?.id === work.id) };
}

/**
 * Details for a work or resource entry: who made it, under what terms, which revision, what it is built from. `toolTitle` names tools for display.
 */
export function describeEntry(catalog, entry, { toolTitle = (id) => id } = {}) {
  if (entry.kind === 'resource') {
    const { record } = entry, terms = licenseTerms(record.attribution.license);
    return { kind: 'resource', id: entry.id, title: entry.title, source: entry.source, version: record.version,
      origin: { provider: record.source.provider, accession: record.source.accession, retrievedAt: record.source.retrievedAt ?? null, url: httpsUrl(record.source.url) },
      license: { id: record.attribution.license, name: terms?.name ?? record.attribution.license, attributionRequired: terms?.attribution ?? true, shareAlike: terms?.shareAlike ?? false,
        credit: record.attribution.credit ?? null, url: httpsUrl(record.attribution.url), embedAllowed: record.attribution.embedAllowed !== false },
      files: record.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })), usedBy: all(catalog).filter((work) => work.resources.includes(entry.id)).map(({ id, title, zone }) => ({ id, title, zone })) };
  }
  const terms = licenseTerms(entry.license), { ancestors, missing, derived } = lineage(catalog, entry);
  return { kind: 'work', id: entry.id, title: entry.title, zone: entry.zone, topic: entry.topic, source: entry.source, revision: entry.revision ?? 1, updated: entry.updated || null,
    author: { name: entry.author?.name || null, url: httpsUrl(entry.author?.url) },
    license: { id: entry.license, name: terms?.name ?? (entry.license || '未标注'), attributionRequired: terms?.attribution ?? true, shareAlike: terms?.shareAlike ?? false },
    derivative: derivativeLicenses([entry.license]),
    derivedFrom: entry.derivedFrom ? { id: entry.derivedFrom.id, revision: entry.derivedFrom.revision ?? null, missing: missing === entry.derivedFrom.id } : null,
    ancestors: ancestors.map(({ entry: parent, revision }) => ({ id: parent.id, title: parent.title, revision, currentRevision: parent.revision ?? 1 })),
    derived: derived.map(({ id, title }) => ({ id, title })),
    tools: entry.tools.map((id) => ({ id, title: toolTitle(id) })), structures: entry.pdb, resources: entry.resources };
}

/**
 * Diagnoses what an entry depends on. Each item is { level: 'error' | 'warning' | 'info', code, message }.
 *   errors   the work cannot be opened as published (a tool this application does not have; a source it was derived from that has gone)
 *   warnings it opens but not as reproducible/offline as it could (a structure that is not a registered resource; a resource missing from the catalogue; an older revision of its source)
 *   info     things to know (attribution required; a resource that is fetched on demand)
 * `toolAvailable(id)` says whether this application has the tool (default: every tool is available).
 */
export function diagnose(catalog, entry, { toolAvailable = () => true } = {}) {
  const out = [], add = (level, code, message) => out.push({ level, code, message });
  if (entry.kind === 'resource') {
    const { record } = entry, terms = licenseTerms(record.attribution.license);
    if (!terms) add('warning', 'license-unknown', `授权“${record.attribution.license}”不在工坊认可的授权里。`);
    else if (terms.attribution) add('info', 'attribution', `使用须署名：${record.attribution.credit ?? record.source.provider.toUpperCase() + ' ' + record.source.accession}。`);
    if (record.attribution.embedAllowed === false) add('warning', 'embed-forbidden', '该资源不允许嵌入作品；离线副本需要使用者自己从来源取回。');
    if (entry.delivery === 'reference') add('info', 'reference-only', '仅引用：需要时从来源取回，并按记录的哈希核对。');
    return out;
  }
  const byId = new Map(catalog.resources.map((resource) => [resource.id, resource]));
  for (const id of entry.tools) if (!toolAvailable(id)) add('error', 'tool-missing', `需要的工具 ${id} 在这个应用里不可用；作品不能按发布时的样子运行（可改用模板区的静态版本）。`);
  for (const id of entry.resources) {
    const resource = byId.get(id);
    if (!resource) { add('warning', 'resource-missing', `资源 ${id} 不在本目录里，无法核对其哈希与授权。`); continue; }
    if (resource.record.attribution.embedAllowed === false) add('warning', 'embed-forbidden', `资源 ${id} 不允许嵌入作品，离线打开需要自行取回。`);
    const terms = licenseTerms(resource.record.attribution.license);
    if (!terms) add('warning', 'license-unknown', `资源 ${id} 的授权“${resource.record.attribution.license}”不在工坊认可的授权里。`);
    else if (terms.shareAlike && entry.license !== 'CC-BY-SA-4.0') add('error', 'license-conflict', `资源 ${id} 为 CC BY-SA，使用它的作品必须以 CC BY-SA 4.0 共享（现为 ${entry.license || '未标注'}）。`);
  }
  const unregistered = entry.pdb.filter((id) => !entry.resources.includes(`res.rcsb.${id}`));
  if (unregistered.length && entry.pdb.length) add('warning', 'structure-unregistered', `结构 ${unregistered.join('、')} 尚未登记为资源：来源与哈希没有被工坊记录。`);
  const { missing, ancestors } = lineage(catalog, entry);
  if (missing) add('error', 'derived-missing', `派生来源 ${missing} 已不在目录里。`);
  for (const { entry: parent, revision } of ancestors.slice(0, 1)) if (revision != null && (parent.revision ?? 1) > revision) add('info', 'source-updated', `派生来源 ${parent.id} 已更新到第 ${parent.revision} 版（本作品基于第 ${revision} 版）。`);
  const terms = licenseTerms(entry.license);
  if (!terms) add('warning', 'license-unknown', `授权“${entry.license || '未标注'}”不在工坊认可的授权里。`);
  else if (terms.attribution) add('info', 'attribution', `使用须署名${entry.author?.name ? `：${entry.author.name}` : ''}。`);
  return out;
}

/** Whether a catalogue holds a newer revision of a work than the one a person has (for "update available"). */
export const hasNewerRevision = (entry, knownRevision) => Number.isInteger(knownRevision) && (entry.revision ?? 1) > knownRevision;

import { LICENSES, checkDerivation, derivativeLicenses, licenseTerms } from './diagnose.mjs';

/**
 * The publish check (4.5.2): can this scene be offered to the workshop as a work, and what would stop it. Pure: it reads a scene document (v2/v3 with its `publication` block),
 * the loaded catalogue (to see whether the id already exists, what it was derived from, which resources are known), and whether this application has each tool. The Studio shows the
 * result before it exports the package, and the workshop validators run the same function over submitted packages, so what Studio says is what CI enforces.
 * Problems are { level: 'error' | 'warning' | 'info', code, message }; `ok` means no error. `entry` is the catalogue entry the package would get.
 */
export const WORK_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export const TOPIC_IDS = Object.freeze(['mechanism', 'protein', 'local-system', 'cell']);

/**
 * Whether `id` can be the work's number in the workshop (what the file is named after, and what other works name when they derive from it): lower-case letters, digits, dots, underscores and hyphens,
 * 3–64 characters; community works cannot take the `official.` / `example.` prefixes; and not one of the other scenes of the same project (`taken`). Returns { ok, message }.
 */
export function validateWorkId(id, { taken = [], source = 'community' } = {}) {
  const value = String(id ?? '').trim();
  if (!value) return { ok: false, message: '请输入作品编号。' };
  if (!WORK_ID.test(value)) return { ok: false, message: '编号只能用小写字母、数字、点、下划线、连字符，长度 3–64，并以字母或数字开头。' };
  if (source === 'community' && /^(official|example)\./.test(value)) return { ok: false, message: '社区作品的编号不能以 official. 或 example. 开头。' };
  if (taken.includes(value)) return { ok: false, message: `这个项目里已经有编号为 ${value} 的场景。` };
  return { ok: true, message: '' };
}

export function checkPublication(scene, catalog, { toolAvailable = () => true, source = 'community' } = {}) {
  const problems = [], add = (level, code, message) => problems.push({ level, code, message });
  const publication = scene.publication;
  if (!publication) {
    add('error', 'publication-missing', '还没有填写发布信息（作者、授权、主题）。');
    return { ok: false, problems, entry: null };
  }
  const id = scene.id, title = (scene.title ?? '').trim();
  if (!WORK_ID.test(id)) add('error', 'id-invalid', `场景编号“${id}”不能用作工坊编号：小写字母、数字、点、下划线、连字符，3–64 个字符。`);
  if (source === 'community' && /^(official|example)\./.test(id)) add('error', 'id-reserved', '社区作品的编号不能以 official. 或 example. 开头。');
  if (!title || title.length > 80) add('error', 'title-invalid', '标题不能为空，且不超过 80 字。');
  const terms = licenseTerms(publication.license);
  if (!terms) add('error', 'license-unknown', `授权“${publication.license}”不被工坊认可；请用 ${Object.keys(LICENSES).join('、')}。`);
  if (!publication.topic) add('error', 'topic-missing', '请选择主题（机理 / 蛋白质 / 局部系统 / 细胞）。');
  if (!publication.updated) add('warning', 'updated-missing', '没有更新日期（YYYY-MM-DD）：工坊目录里会显示为空。');
  if (!publication.description) add('warning', 'description-missing', '没有简介：工坊卡片上会是空的。');
  if (!scene.evidence?.length) add('warning', 'evidence-missing', '场景没有证据说明；读者看不到哪些内容是实验、推导、建模或示意。');

  const existing = new Map([...catalog.templates, ...catalog.works].map((entry) => [entry.id, entry]));
  const same = existing.get(id);
  const revision = publication.revision ?? 1;
  if (same) {
    if ((same.author?.name ?? '') !== publication.author.name) add('error', 'id-taken', `编号 ${id} 已被“${same.author?.name || '未署名'}”的作品使用；换一个编号，或在“派生自”里写明来源。`);
    else {
      if (publication.revision == null || revision <= (same.revision ?? 1)) add('error', 'revision-not-newer', `工坊里已有第 ${same.revision ?? 1} 版；升级请把版本设为 ${(same.revision ?? 1) + 1} 或更大。`);
      if (licenseTerms(same.license)?.shareAlike && !terms?.shareAlike) add('error', 'license-relaxed', `第 ${same.revision ?? 1} 版是 ${same.license}（相同方式共享），新版不能放宽授权。`);
    }
  } else if (publication.revision == null) add('info', 'revision-default', '没有写版本：按第 1 版发布。');

  const toolIds = [...new Set((scene.tools ?? []).map((entry) => entry.tool.id))];
  for (const toolId of toolIds) if (!toolAvailable(toolId)) add('error', 'tool-missing', `作品用到的工具 ${toolId} 在这个应用里不可用，读者无法运行它。`);

  const records = scene.resources ?? [], known = new Map(catalog.resources.map((entry) => [entry.id, entry]));
  for (const record of records) {
    const inCatalogue = known.get(record.id), attribution = record.attribution ?? {}, recordTerms = licenseTerms(attribution.license);
    const embedded = scene.assets.some((asset) => asset.kind === 'file' && asset.resource?.id === record.id);
    if (embedded && attribution.embedAllowed === false) add('error', 'embed-forbidden', `资源 ${record.id} 不允许嵌入作品，但场景包会携带它的文件。`);
    if (!recordTerms) add('warning', 'resource-license-unknown', `资源 ${record.id} 的授权“${attribution.license ?? '未标注'}”不被工坊认可。`);
    else if (recordTerms.shareAlike && !terms?.shareAlike) add('error', 'license-conflict', `资源 ${record.id} 为 CC BY-SA，作品必须以 CC BY-SA 4.0 共享（现为 ${publication.license}）。`);
    if (record.kind === 'predicted-structure' && !(scene.evidence ?? []).some((item) => item.type === 'modelled' && item.resourceId === record.id)) {
      add('error', 'prediction-unlabelled', `资源 ${record.id} 是预测结构，作品必须有一条“建模”类证据（resourceId 指向它）说明它不是实验测定的。`);
    }
    if (!inCatalogue) add('info', 'resource-unlisted', `资源 ${record.id} 不在工坊资源区；作品包会自带它。`);
  }

  const entry = { kind: 'work', zone: 'work', source, id, title, topic: publication.topic ?? null, license: publication.license, revision, author: { ...publication.author },
    description: publication.description ?? '', updated: publication.updated ?? '', tags: [...(publication.tags ?? [])], tools: toolIds, resources: records.map(({ id: resourceId }) => resourceId),
    ...(publication.derivedFrom ? { derivedFrom: { ...publication.derivedFrom } } : {}) };
  if (publication.derivedFrom) {
    const byId = new Map(existing); byId.set(id, entry);
    for (const message of checkDerivation(entry, byId)) add('error', 'derivation', message);
  }
  return { ok: !problems.some((item) => item.level === 'error'), problems, entry };
}

/** The publication block for a new version of an existing work: same author and licence, the next revision. */
export const nextRevision = (work) => ({ license: work.license, author: { ...work.author }, revision: (work.revision ?? 1) + 1, ...(work.topic ? { topic: work.topic } : {}), ...(work.description ? { description: work.description } : {}), ...(work.tags?.length ? { tags: [...work.tags] } : {}),
  ...(work.derivedFrom ? { derivedFrom: { ...work.derivedFrom } } : {}) });

/** The publication block for a work derived from `parent` (a catalogue entry) by `author`: the licence defaults to the most permissive one the parent allows. */
export function deriveFrom(parent, author, { license } = {}) {
  const { allowed, reason } = derivativeLicenses([parent.license]);
  if (!allowed.length) throw new Error(reason);
  const chosen = license ?? allowed[0];
  if (!allowed.includes(chosen)) throw new Error(`授权 ${chosen} 不能用于派生自 ${parent.id}（${parent.license}）的作品。${reason ?? ''}`.trim());
  return { license: chosen, author: { ...author }, revision: 1, ...(parent.topic ? { topic: parent.topic } : {}), derivedFrom: { id: parent.id, revision: parent.revision ?? 1 } };
}

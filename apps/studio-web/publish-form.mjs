import { derivativeLicenses, LICENSES } from '../../plugins/workshop/diagnose.mjs';
import { TOPICS } from '../../plugins/workshop/catalog.mjs';

/**
 * The model behind Studio's publish tab: the form's text fields <-> the scene's `publication` block. Pure functions (the DOM wiring is in main.mjs), so the rules are tested without a page.
 * `readForm` turns what a person typed into a publication block or says what is wrong with it; `fillForm` goes the other way; `licenseChoices` says which licences a derived work may take.
 */
export const EMPTY_FORM = Object.freeze({ license: 'CC-BY-4.0', authorName: '', authorUrl: '', topic: '', description: '', tags: '', revision: '', updated: '', derivedId: '', derivedRevision: '' });

export class FormError extends Error { constructor(message) { super(message); this.name = 'FormError'; } }

const splitTags = (text) => [...new Set(String(text ?? '').split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean))];

/** Returns the publication block for the form values (empty optional fields are left out). Throws FormError with a reason a person can act on. */
export function readForm(values) {
  const v = { ...EMPTY_FORM, ...values };
  const name = v.authorName.trim();
  if (!name) throw new FormError('请填写作者名。');
  if (name.length > 80) throw new FormError('作者名不超过 80 字。');
  const url = v.authorUrl.trim();
  if (url && !/^https:\/\/\S+$/.test(url)) throw new FormError('作者链接必须以 https:// 开头。');
  if (!Object.hasOwn(LICENSES, v.license)) throw new FormError(`授权请选 ${Object.keys(LICENSES).join('、')}。`);
  const publication = { license: v.license, author: { name, ...(url ? { url } : {}) } };
  if (v.topic) { if (!Object.hasOwn(TOPICS, v.topic)) throw new FormError('主题无效。'); publication.topic = v.topic; }
  const description = v.description.trim();
  if (description.length > 400) throw new FormError('简介不超过 400 字。');
  if (description) publication.description = description;
  const tags = splitTags(v.tags);
  if (tags.length > 8) throw new FormError('标签最多 8 个。');
  if (tags.some((tag) => tag.length > 20)) throw new FormError('每个标签不超过 20 字。');
  if (tags.length) publication.tags = tags;
  if (String(v.revision).trim() !== '') {
    const revision = Number(v.revision);
    if (!Number.isInteger(revision) || revision < 1) throw new FormError('版本应为从 1 开始的整数。');
    publication.revision = revision;
  }
  if (v.updated.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.updated.trim())) throw new FormError('更新日期写成 YYYY-MM-DD。');
    publication.updated = v.updated.trim();
  }
  if (v.derivedId.trim()) {
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(v.derivedId.trim())) throw new FormError('派生来源的编号无效。');
    const revision = String(v.derivedRevision).trim() === '' ? undefined : Number(v.derivedRevision);
    if (revision !== undefined && !(Number.isInteger(revision) && revision >= 1)) throw new FormError('派生来源的版本应为正整数。');
    publication.derivedFrom = { id: v.derivedId.trim(), ...(revision ? { revision } : {}) };
  }
  return publication;
}

export function fillForm(publication) {
  if (!publication) return { ...EMPTY_FORM };
  return { license: publication.license, authorName: publication.author.name, authorUrl: publication.author.url ?? '', topic: publication.topic ?? '', description: publication.description ?? '',
    tags: (publication.tags ?? []).join('、'), revision: publication.revision == null ? '' : String(publication.revision), updated: publication.updated ?? '',
    derivedId: publication.derivedFrom?.id ?? '', derivedRevision: publication.derivedFrom?.revision == null ? '' : String(publication.derivedFrom.revision) };
}

/** Every licence with whether a work derived from `parent` (a catalogue entry, or none) may take it, and why not. */
export function licenseChoices(parent) {
  const { allowed, reason } = derivativeLicenses(parent ? [parent.license] : []);
  return Object.entries(LICENSES).map(([id, terms]) => ({ id, name: terms.name, allowed: allowed.includes(id), ...(allowed.includes(id) ? {} : { reason }) }));
}

/** The hint under the revision field: what the catalogue already holds under this id, and the revision that would be a valid upgrade. */
export function revisionHint(catalog, id, author) {
  const same = [...(catalog?.templates ?? []), ...(catalog?.works ?? [])].find((entry) => entry.id === id);
  if (!same) return { exists: false, text: '工坊里还没有这个编号：按第 1 版发布。' };
  if ((same.author?.name ?? '') !== author) return { exists: true, mine: false, text: `编号 ${id} 已被“${same.author?.name || '未署名'}”的作品使用，需要换编号。` };
  return { exists: true, mine: true, next: (same.revision ?? 1) + 1, text: `工坊里已有你的第 ${same.revision ?? 1} 版；升级请把版本设为 ${(same.revision ?? 1) + 1} 或更大。` };
}

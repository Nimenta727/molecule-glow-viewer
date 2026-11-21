import { describeStructureAsset, validateResource, sha256Hex } from '../../packages/schema/resource.mjs';
import { extractStructureCard, cardStrings, CardError } from './structure-card.mjs';

/**
 * The protein template library: the FIRST layer of the platform. A template is an original structure file, left exactly as it was (never edited, never animated), with what is known about it: where it
 * came from, under what licence, the scientific basics read from the file (structure-card.mjs) and the person's own notes. Works are made on top of templates; a template is the same
 * whether it came from the PDB or from the person's own disk, so the two are listed together.
 *
 * Kept in an injected store (the apps use IndexedDB; tests use a Map): index under one key, each file's bytes under its own key, verified by SHA-256 on the way out. A template's resource
 * record is fixed at import (its id is the file's hash for local files); only the title and notes can be edited. A store that fails (full disk, private window) is reported, not thrown.
 */
export const LICENSES = Object.freeze({
  'CC0-1.0': { name: 'CC0（公有领域）', open: true, creditRequired: false },
  'CC-BY-4.0': { name: 'CC BY 4.0（须署名）', open: true, creditRequired: true },
  'CC-BY-SA-4.0': { name: 'CC BY-SA 4.0（须署名，改编须同样共享）', open: true, creditRequired: true },
  private: { name: '仅自己使用（不公开、不嵌入作品）', open: false, creditRequired: false },
  unknown: { name: '不清楚（按“仅自己使用”处理）', open: false, creditRequired: false },
});
export const MAX_TEMPLATE_BYTES = 64 * 1024 * 1024;
const INDEX_KEY = 'glow-templates', BYTES_KEY = (sha) => `glow-template-bytes:${sha}`;
const ACCESSION = /^[0-9][A-Za-z0-9]{3}$/;

export class TemplateError extends Error { constructor(code, message) { super(message); this.name = 'TemplateError'; this.code = code; } }

const mediaTypeOf = (name) => (/\.m?cif$/i.test(name) ? 'chemical/x-mmcif' : /\.(pdb|ent)$/i.test(name) ? 'chemical/x-pdb' : null);
const safeName = (name) => String(name ?? '').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function createTemplateLibrary({ store, now = () => Date.now() } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function' || typeof store.delete !== 'function') throw new TypeError('the template library needs a store with get, set and delete');
  async function read() { try { const v = await store.get(INDEX_KEY); return Array.isArray(v) ? v.filter((e) => e && typeof e.id === 'string' && /^[a-f0-9]{64}$/.test(e.sha256 ?? '')) : []; } catch { return []; } }
  async function write(index) { try { await store.set(INDEX_KEY, index); return null; } catch (error) { return error.message || 'store-failed'; } }

  /** The shared tail of every way in: validate, describe, store. `origin` says where the bytes came from. */
  async function add({ name, bytes, mediaType, attribution, source, title, notes, origin, species, claim }) {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new TemplateError('empty', '文件是空的。');
    if (bytes.byteLength > MAX_TEMPLATE_BYTES) throw new TemplateError('too-large', `文件超过 ${MAX_TEMPLATE_BYTES / 1048576} MB，不能作为模板。`);
    let info; try { info = extractStructureCard(new TextDecoder('utf-8', { fatal: false }).decode(bytes), { format: mediaType === 'chemical/x-mmcif' ? 'mmcif' : 'pdb' }); }
    catch (error) { if (error instanceof CardError) throw new TemplateError('not-a-structure', error.message); throw error; }
    const sha256 = await sha256Hex(bytes), asset = { path: name, sha256, mediaType, provenance: { source } };
    const { id, version, record: base } = describeStructureAsset(asset, bytes);
    const strings = cardStrings(info); if (species) strings.species = species; if (claim) strings.claimedSource = claim;
    const record = validateResource({ ...base, attribution: attribution, card: strings });
    const index = await read();
    const existing = index.find((e) => e.id === id && e.version === version);
    if (existing) return { template: existing, added: false };
    const entry = { id, version, sha256, name, bytes: bytes.byteLength, mediaType, record, info, title: title || info.title || name, notes: notes ?? '', origin, addedAt: now() };
    try { await store.set(BYTES_KEY(sha256), new Uint8Array(bytes)); } catch (error) { throw new TemplateError('store-failed', `无法保存到本机（${error.message || '存储失败'}）：可能磁盘已满，或浏览器处于无痕模式。`); }
    const failed = await write([entry, ...index]);
    if (failed) { try { await store.delete(BYTES_KEY(sha256)); } catch { /* nothing more to undo */ } throw new TemplateError('store-failed', `无法保存到本机（${failed}）。`); }
    return { template: entry, added: true };
  }

  return {
    /**
     * A file from the person's own disk. The licence must be chosen (there is no default): a file the person cannot say anything about is "unknown", which keeps it out of every published package.
     * An open licence that asks for credit needs the credit line.
     */
    async importFile({ name, bytes, license, credit, url, title, notes, species } = {}) {
      const fileName = safeName(name), mediaType = mediaTypeOf(fileName);
      if (!fileName || !mediaType) throw new TemplateError('format', '只支持 .cif / .mmcif / .pdb / .ent 结构文件。');
      if (!Object.hasOwn(LICENSES, license)) throw new TemplateError('license', `请选择授权方式：${Object.keys(LICENSES).join(' / ')}。`);
      const lic = LICENSES[license], creditLine = text(credit, 200);
      if (lic.creditRequired && !creditLine) throw new TemplateError('credit', `${license} 要求署名：请写明作者或来源。`);
      return add({ name: fileName, bytes, mediaType, species: text(species, 120), title: text(title, 120), notes: text(notes, 2000), origin: 'local',
        source: { provider: 'local', accession: fileName },
        attribution: { license, ...(creditLine ? { credit: creditLine } : {}), ...(/^https:\/\/\S+$/.test(url ?? '') ? { url: url.slice(0, 300) } : {}), embedAllowed: lic.open } });
    },
    /** A PDB entry by its four-character code: `load(accession)` returns { bytes, name } (the RCSB source of the app). It becomes the same resource record the workshop's resource zone uses (CC0, from RCSB). */
    async addFromRcsb({ accession, load, title, notes } = {}) {
      const code = String(accession ?? '').trim().toUpperCase();
      if (!ACCESSION.test(code)) throw new TemplateError('accession', 'PDB 编号应为 4 位（如 4AKE）。');
      if (typeof load !== 'function') throw new TypeError('addFromRcsb needs a load function');
      const loaded = await load(code); if (!loaded?.bytes) throw new TemplateError('download', `没有取回 ${code}。`);
      return add({ name: `${code}.cif`, bytes: new Uint8Array(loaded.bytes), mediaType: 'chemical/x-mmcif', title: text(title, 120), notes: text(notes, 2000), origin: 'rcsb',
        source: { provider: 'RCSB PDB', accession: code }, attribution: { license: 'CC0-1.0', credit: 'RCSB Protein Data Bank / wwPDB', url: 'https://www.rcsb.org/', embedAllowed: true } });
    },
    /**
     * A template package from someone else (or a backup). The licence and source it states are the sender's word: the record is rebuilt as a LOCAL file (it is never "from the PDB" because a package says so),
     * the card is read again from the bytes, and the claimed source is kept in the card as a claim.
     */
    async importPackage(packageBytes) {
      const { readTemplatePackage } = await import('./package.mjs'), pkg = await readTemplatePackage(packageBytes);
      const stated = pkg.record.attribution, license = Object.hasOwn(LICENSES, stated.license) ? stated.license : 'unknown', lic = LICENSES[license];
      const claim = pkg.record.source.provider === 'local' ? '' : `模板包自称来源：${pkg.record.source.provider} ${pkg.record.source.accession}（未核对）`;
      const result = await add({ name: safeName(pkg.name), bytes: pkg.bytes, mediaType: pkg.record.files[0].mediaType, title: pkg.title, notes: pkg.notes, origin: 'package', claim,
        source: { provider: 'local', accession: safeName(pkg.name) },
        attribution: { license, ...(stated.credit ? { credit: text(stated.credit, 200) } : {}), ...(/^https:\/\/\S+$/.test(stated.url ?? '') ? { url: stated.url.slice(0, 300) } : {}), embedAllowed: lic.open && stated.embedAllowed !== false } });
      return result;
    },
    /** The template as a package: its record and its original bytes. */
    async exportPackage(id) { const { writeTemplatePackage } = await import('./package.mjs'); return writeTemplatePackage(await this.get(id) ?? (() => { throw new TemplateError('missing', `没有这个模板：${id}。`); })(), await this.bytes(id)); },
    /** Every template, newest first (without bytes). */
    async list() { return (await read()).map(({ id, version, sha256, name, bytes, mediaType, record, info, title, notes, origin, addedAt }) => ({ id, version, sha256, name, bytes, mediaType, record, info, title, notes, origin, addedAt })); },
    async get(id) { return (await read()).find((e) => e.id === id) ?? null; },
    /** The file's bytes, checked against the hash in its record; a damaged copy is refused, never opened. */
    async bytes(id) {
      const entry = await this.get(id); if (!entry) throw new TemplateError('missing', `没有这个模板：${id}。`);
      let data; try { data = await store.get(BYTES_KEY(entry.sha256)); } catch { data = null; }
      if (!(data instanceof Uint8Array)) throw new TemplateError('missing-bytes', `${entry.title}：本机没有找到文件内容，请重新导入。`);
      if (await sha256Hex(data) !== entry.sha256) throw new TemplateError('hash-mismatch', `${entry.title}：本机保存的文件已损坏（哈希不符），已拒绝打开。请删除后重新导入。`);
      return new Uint8Array(data);
    },
    /** Only the title and notes can change: the record (source, licence, hash) is what scenes refer to. */
    async update(id, { title, notes } = {}) {
      const index = await read(), entry = index.find((e) => e.id === id); if (!entry) throw new TemplateError('missing', `没有这个模板：${id}。`);
      if (title != null) entry.title = text(title, 120) || entry.title; if (notes != null) entry.notes = text(notes, 2000);
      const failed = await write(index); if (failed) throw new TemplateError('store-failed', `无法保存（${failed}）。`); return entry;
    },
    async remove(id) {
      const index = await read(), entry = index.find((e) => e.id === id); if (!entry) return false;
      const failed = await write(index.filter((e) => e !== entry)); if (failed) throw new TemplateError('store-failed', `无法保存（${failed}）。`);
      if (!index.some((e) => e !== entry && e.sha256 === entry.sha256)) { try { await store.delete(BYTES_KEY(entry.sha256)); } catch { /* the bytes are orphaned, the index is right */ } }
      return true;
    },
  };
}

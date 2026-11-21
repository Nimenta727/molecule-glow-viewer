import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { validateResource, sha256Hex } from '../../packages/schema/resource.mjs';
import { MAX_TEMPLATE_BYTES, TemplateError } from './library.mjs';

/**
 * A template package (.glowtpl): one original file plus its record, so a template can be handed to someone else or kept as a backup. A zip with `template.json` and `file/<name>`. Reading is strict:
 * a size limit before anything is decompressed into memory, no path tricks, and the file must match the hash its record states. What the package SAYS about itself (source, licence) is taken as the
 * sender's statement, not as verified: a package never makes a file "from the PDB".
 */
const FORMAT = 'glow-template', MAX_JSON = 1024 * 1024, encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });

export async function writeTemplatePackage(entry, bytes) {
  const file = `file/${entry.name}`, meta = { format: FORMAT, schemaVersion: 1, record: entry.record, title: entry.title, notes: entry.notes ?? '', origin: entry.origin, name: entry.name, file };
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 6 });
  await writer.add('template.json', new Uint8ArrayReader(encoder.encode(JSON.stringify(meta))));
  await writer.add(file, new Uint8ArrayReader(bytes));
  return writer.close();
}

export async function readTemplatePackage(input) {
  if (!(input instanceof Uint8Array) || input[0] !== 0x50 || input[1] !== 0x4b) throw new TemplateError('package', '这不是模板包（.glowtpl）。');
  if (input.byteLength > MAX_TEMPLATE_BYTES + MAX_JSON) throw new TemplateError('too-large', '模板包太大。');
  const reader = new ZipReader(new Uint8ArrayReader(input));
  try {
    const entries = await reader.getEntries();
    if (entries.length !== 2) throw new TemplateError('package', '模板包里应该正好有两个文件：template.json 和原文件。');
    const metaEntry = entries.find((e) => e.filename === 'template.json'), fileEntry = entries.find((e) => /^file\/[A-Za-z0-9._-]{1,80}$/.test(e.filename));
    if (!metaEntry || !fileEntry) throw new TemplateError('package', '模板包的内容不符合格式（路径不合法或缺少 template.json）。');
    if (metaEntry.uncompressedSize > MAX_JSON || fileEntry.uncompressedSize > MAX_TEMPLATE_BYTES) throw new TemplateError('too-large', '模板包里的文件超过限制。');
    let meta; try { meta = JSON.parse(decoder.decode(await metaEntry.getData(new Uint8ArrayWriter()))); } catch { throw new TemplateError('package', 'template.json 不是有效的 JSON。'); }
    if (meta?.format !== FORMAT || meta.schemaVersion !== 1) throw new TemplateError('package', '模板包的格式或版本不对。');
    const record = validateResource(meta.record), bytes = await fileEntry.getData(new Uint8ArrayWriter()), [stated] = record.files;
    if (record.kind !== 'structure' || fileEntry.filename !== `file/${stated.path}` || bytes.byteLength !== stated.bytes || await sha256Hex(bytes) !== stated.sha256) throw new TemplateError('hash-mismatch', '模板包里的文件与记录不符（大小或哈希不一致），已拒绝。');
    return { record, bytes, name: stated.path, title: typeof meta.title === 'string' ? meta.title.slice(0, 120) : '', notes: typeof meta.notes === 'string' ? meta.notes.slice(0, 2000) : '', claimedOrigin: String(meta.origin ?? '').slice(0, 20) };
  } finally { await reader.close(); }
}

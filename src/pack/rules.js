//! ES module AND build fragment (see src/README.md). Scene-pack (.glow) format and validation: sanitizePack is the ONE
//! rule set; the viewer runs it and the workshop tools import this file (workshop/tools/glow-lib.mjs), so they cannot disagree.
//! Free name: PROCESSES (the built-in process table, src/sim/processes/); in Node the tools put a name-only table on globalThis.
import { PRESETS } from '../data/presets.js';
/* =============================================================================
   v17: SCENE PACKS (.glow), DATA-ONLY ANIMATION, WORKSHOP
   A scene pack is one JSON file ("glow-scene" v1): metadata + `scene` (the same keys as a preset) + optional `animation`
   (pure data: compartments, pools, flows, reactions) that the built-in engine below plays with the v16 motion kit.
   Packs never carry code: `process` may only name a built-in process; community strings are HTML-escaped; regex keys
   are compiled defensively. Spec: workshop/SCHEMA.md in the repo.
   ============================================================================= */
export const GLOW_FORMAT = 'glow-scene', GLOW_VERSION = 1, ANIM_VERSION = 1;
export const WS_BASE = 'https://raw.githubusercontent.com/Nimenta727/molecule-glow-viewer/main/workshop/';
export const WS_REPO = 'https://github.com/Nimenta727/molecule-glow-viewer';
export const WS_SRC = { official: { name: '官方', url: WS_BASE + 'official/' }, community: { name: '社区', url: WS_BASE + 'community/' } };
export const SCENE_KEYS = new Set([...Object.values(PRESETS).flatMap(p => Object.keys(p)), 'caption', 'structure', 'animation', 'mechanism', 'memY', 'states', 'chains', 'assembly', 'auto', 'axis', 'evidence', 'seed', 'reps']);
SCENE_KEYS.delete('key'); SCENE_KEYS.delete('tier');   /* preset metadata, not scene fields */
export const PACK_CATS = { cell: '细胞', system: '局部系统', single: '单个蛋白', mechanism: '分子机理' };
export const PDB_ID = /^[0-9][A-Za-z0-9]{3}$/;
export class PackError extends Error { constructor(m, path = null) { super(m); this.path = path; } }   /* path: where in the pack ("scene.animation.flows[2].rate") */

/* ---- defensive copy of untrusted JSON: plain data only, bounded, HTML-escaped strings, regex keys that compile */
export function cleanData(v, trusted, depth = 0, path = '') {
  if (depth > 14) throw new PackError('嵌套太深', path);
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new PackError('数字无效', path); return v; }
  if (typeof v === 'string') return cleanStr(v, trusted);
  if (Array.isArray(v)) { if (v.length > 5000) throw new PackError('数组太长', path); return v.map((x, i) => cleanData(x, trusted, depth + 1, `${path}[${i}]`)); }
  if (typeof v === 'object') {
    const o = {}; let n = 0;
    for (const [k, x] of Object.entries(v)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; if (++n > 2000) throw new PackError('字段太多', path);
      o[cleanStr(k, trusted)] = cleanData(x, trusted, depth + 1, path ? path + '.' + k : k); }
    return o;
  }
  throw new PackError('不支持的数据类型', path);
}
export function cleanStr(s, trusted) {
  if (s.length > 40000) s = s.slice(0, 40000);
  if (!trusted) s = s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (s.length > 2 && s[0] === '/' && s.lastIndexOf('/') > 0) {   /* a regex key ('/subunit a$/'): must compile, short, sane flags */
    const i = s.lastIndexOf('/'), body = s.slice(1, i), fl = s.slice(i + 1);
    let ok = body.length <= 200 && /^[imsu]*$/.test(fl); try { if (ok) new RegExp(body, fl || 'i'); } catch (e) { ok = false; }
    if (!ok) return s.replace(/\//g, '');
  }
  return s;
}
/* validate + clean a parsed pack. trusted = the official source (may use HTML in notes); throws PackError with a reason */
export function sanitizePack(raw, trusted = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PackError('不是场景包');
  if (raw.format !== GLOW_FORMAT) throw new PackError('不是 .glow 场景包（format 应为 glow-scene）', 'format');
  if (!(raw.version >= 1)) throw new PackError('缺少版本号', 'version');
  if (raw.version > GLOW_VERSION) throw new PackError(`这个场景包是 v${raw.version} 格式，请更新查看器`);
  const P = cleanData(raw, trusted);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(P.id || '')) throw new PackError('id 只能用小写字母、数字、. _ -（3–64 个字符）', 'id');
  if (typeof P.title !== 'string' || !P.title.trim()) throw new PackError('缺少标题', 'title');
  P.title = P.title.slice(0, 80); P.revision = Math.max(1, Math.floor(+P.revision || 1));
  if (!PACK_CATS[P.category]) P.category = 'single';
  P.tags = Array.isArray(P.tags) ? P.tags.filter(t => typeof t === 'string').slice(0, 8).map(t => t.slice(0, 20)) : [];
  if (P.author && typeof P.author === 'object') { if (P.author.url && !/^https:\/\//.test(P.author.url)) delete P.author.url; } else P.author = { name: '匿名' };
  if (P.cover && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(P.cover)) delete P.cover;
  if (P.cover && P.cover.length > 600000) delete P.cover;
  const S = P.scene; if (!S || typeof S !== 'object') throw new PackError('缺少 scene', 'scene');
  for (const k of Object.keys(S)) if (!SCENE_KEYS.has(k)) delete S[k];
  if (S.structure) {
    if (typeof S.structure.text !== 'string' || !/\.(cif|mmcif|pdb|ent)$/i.test(S.structure.name || '')) throw new PackError('structure 需要 name（.cif / .pdb）和 text', 'scene.structure');
    if (S.structure.text.length > 30e6) throw new PackError('内嵌结构太大（上限 30 MB）', 'scene.structure.text');
    S.structure.text = raw.scene.structure.text;   /* coordinates are parsed, never shown: keep them byte-exact */
  } else if (!PDB_ID.test(S.id || '')) throw new PackError('scene.id 应是 4 位 PDB 编号（或内嵌 structure）', 'scene.id');
  if (S.states && !(Array.isArray(S.states) && S.states.length === 2 && S.states.every(x => PDB_ID.test(x)))) delete S.states;
  if (S.components) { if (!Array.isArray(S.components) || S.components.length > 16) throw new PackError('components 最多 16 个', 'scene.components');
    S.components = S.components.filter(c => c && PDB_ID.test(c.id || '')); }
  if (S.process && !(S.process in PROCESSES)) throw new PackError(`未知的内置过程 “${S.process}”（社区场景请用 animation 描述动画）`, 'scene.process');
  if (S.process === 'dataAnim') delete S.process;
  if (S.animation) checkAnimation(S.animation);
  return P;
}
export function checkAnimation(A) {
  const fail = (m, at = '') => { throw new PackError('animation：' + m, 'scene.animation' + (at ? (at[0] === '[' ? at : '.' + at) : '')); };
  if ((A.version || 1) > ANIM_VERSION) fail(`v${A.version} 需要更新查看器`, 'version');
  const comps = A.compartments || { '溶液': {} };
  if (Object.keys(comps).length > 6) fail('compartments 最多 6 个', 'compartments');
  for (const [k, c] of Object.entries(comps)) if (c.side && !['above', 'below'].includes(c.side)) fail(`隔室 ${k} 的 side 只能是 above / below`, `compartments.${k}.side`);
  const inComp = (k, what, at) => { if (k != null && !(k in comps)) fail(`${what} 用到了未定义的隔室 “${k}”`, at); };
  if ((A.species && Object.keys(A.species).length > 24)) fail('species 最多 24 种', 'species');
  if ((A.pools || []).length > 24) fail('pools 最多 24 个', 'pools');
  (A.pools || []).forEach((p, i) => { inComp(p.in, 'pool', `pools[${i}].in`); if (!(p.n >= 0 && p.n <= 40)) fail('pool 的 n 应在 0–40', `pools[${i}].n`); });
  if ((A.flows || []).length > 16) fail('flows 最多 16 条', 'flows');
  (A.flows || []).forEach((f, i) => { const at = `flows[${i}]`; inComp(f.from, 'flow', at + '.from'); inComp(f.to, 'flow', at + '.to'); if (!f.species) fail('flow 缺少 species', at);
    if (!Array.isArray(f.via) || !f.via.length || f.via.length > 40) fail('flow.via 应有 1–40 个锚点', at + '.via');
    if (!(f.rate > 0 && f.rate <= 30)) fail('flow.rate 应在 0–30 次 / 秒', at + '.rate'); });
  if ((A.reactions || []).length > 16) fail('reactions 最多 16 个', 'reactions');
  (A.reactions || []).forEach((r, i) => { const at = `reactions[${i}]`; if (!r.site) fail('reaction 缺少 site', at); if (!(r.rate > 0 && r.rate <= 30)) fail('reaction.rate 应在 0–30', at + '.rate');
    for (const [side, L] of [['in', r.in || []], ['out', r.out || []]]) L.forEach((x, j) => { if (!x.species) fail('reaction 的 in / out 要写 species', `${at}.${side}[${j}]`); inComp(x.from ?? x.to, 'reaction', `${at}.${side}[${j}]`); });
    if ((r.in || []).length + (r.out || []).length > 8) fail('一个 reaction 最多 8 个分子', at); });
}

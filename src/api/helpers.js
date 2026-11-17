const resLabel = (a) => `${a.ach || String(a.asym).split('_')[0]}:${a.na ? a.resn : (AA1[a.resn] || a.resn || '?')}${a.aseq !== '' && a.aseq != null ? a.aseq : a.seq}${a.ins || ''}`;
function selSummary(S) {
  return { expr: glowSel.expr, count: S.r.length + S.l.length, residues: S.r.length, ligands: S.l.length,
    chains: [...new Set(S.r.map(a => a.ach || String(a.asym).split('_')[0]))].slice(0, 50), sample: S.r.slice(0, 12).map(resLabel),
    ligandSample: S.l.slice(0, 12).map(x => `${String(x.asym || '').split('_')[0]}:${x.comp}`) };
}
let ringTex = {};
function ringTexture(col) {   /* a thin ink circle with a small gap, drawn once per colour */
  if (ringTex[col]) return ringTex[col];
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.strokeStyle = col; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.arc(64, 64, 56, -1.35, 4.5); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return ringTex[col] = t;
}
function showSel(S) {   /* the same visuals as a click (applySelection: the rest dims, residues get gold markers) + markers on selected ligands */
  if (focus) clearFocus();
  clearSelection(); $('infoCard').style.display = 'none';
  for (const a of S.r) sel.ids.add(`residue:${a.asym}:${a.seq}`);
  sel.source = 'api'; applySelection();
  if (S.l.length) {
    const tex = ringTexture(illustrative() ? '#1c2233' : '#f0c040');
    for (const x of S.l) { const r = Math.max(3, ...x.atoms.map(y => y.p.distanceTo(x.centre))) * Math.min(1.6, +$('ligScale').value * 0.6) * 1.25;
      const mk = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      mk.scale.set(2 * r, 2 * r, 1); mk.position.copy(x.centre); mk.renderOrder = 7; mk.userData.selMarker = true; world.add(mk); sel.markers.push(mk); }
  }
}
function selOrLast(expr) {
  if (expr == null || expr === '' || expr === 'sele') return { r: glowSel.r, l: glowSel.l };
  return evalSel(parseSel(expr));
}
function worldPointsOf(S) {
  const gOf = new Map(); for (const g of groups) for (const a of g.atoms) gOf.set(a, g);
  const P = [];
  for (const a of S.r) { const g = gOf.get(a); if (g?.mesh) { g.mesh.updateMatrixWorld(); P.push(g.mesh.localToWorld(morphed(a))); } }
  world.updateMatrixWorld(); for (const x of S.l) P.push(world.localToWorld(x.centre.clone()));
  return P;
}
function sceneSummary() {
  const chains = new Set(); groups.forEach(g => g.atoms.forEach(a => chains.add(a.asym)));
  return { title: $('tName').textContent || current?.name || null, key: PRESETS[current?.name]?.key || null, tier: PRESETS[current?.name]?.tier || null, seed: randSeed, pdb: current?.id || null, entities: groups.length, chains: chains.size,
    residues: groups.reduce((n, g) => n + g.atoms.length, 0), ligands: ligGroups.length, ligandMolecules: (model?.ligands || []).filter(x => !x.hidden).length,
    process: current?.process || null, pack: current?._pack ? { id: current._pack.id, revision: current._pack.revision } : null,
    paused: $('pause').checked, timeScale, selection: { expr: glowSel.expr || null, count: (glowSel.r?.length || 0) + (glowSel.l?.length || 0) },
    evidence: current ? evidenceOf(current, { id: current.id }) : null };
}
const cssColour = (c) => typeof c === 'string' && (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) || Object.hasOwn(THREE.Color.NAMES, c.toLowerCase()));
const onOff = (v) => v === true || v === 'on' || v === 'true' || v === 1;
const needModel = () => { if (!model || !groups.length) throw new CmdError('还没有打开任何场景（先 load）'); };
function packFromApiScene(spec) {
  const S = spec.scene; if (!S || typeof S !== 'object') throw new CmdError('scene 应是对象');
  return { format: GLOW_FORMAT, version: GLOW_VERSION, id: 'api.scene', title: typeof spec.title === 'string' && spec.title.trim() ? spec.title : (S.id || '场景'), category: spec.category || 'single', scene: S };
}
/* validation report for an editor: the first hard error (sanitizePack stops there) + warnings about what was dropped or changed */
/* where JSON.parse gave up (newer engines do not say): a strict scanner that returns the offset of the first bad character */
function jsonErrorAt(t) {
  let i = 0; const ws = () => { while (i < t.length && ' \t\r\n'.includes(t[i])) i++; }, bad = () => { throw i; };
  const lit = (w) => { if (t.startsWith(w, i)) i += w.length; else bad(); };
  const str = () => { i++; while (i < t.length && t[i] !== '"') { if (t[i] === '\\') i++; else if (t[i] < ' ') bad(); i++; } if (i >= t.length) bad(); i++; };
  const num = () => { const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i, i + 400)); if (!m || !m[0]) bad(); i += m[0].length; };
  const val = () => { ws(); const c = t[i];
    if (c === '{') { i++; ws(); if (t[i] === '}') { i++; return; } for (;;) { ws(); if (t[i] !== '"') bad(); str(); ws(); if (t[i] !== ':') bad(); i++; val(); ws(); if (t[i] === ',') { i++; continue; } if (t[i] === '}') { i++; return; } bad(); } }
    if (c === '[') { i++; ws(); if (t[i] === ']') { i++; return; } for (;;) { val(); ws(); if (t[i] === ',') { i++; continue; } if (t[i] === ']') { i++; return; } bad(); } }
    if (c === '"') return str(); if (c === 't') return lit('true'); if (c === 'f') return lit('false'); if (c === 'n') return lit('null'); return num(); };
  try { val(); ws(); return i < t.length ? i : null; } catch (k) { return typeof k === 'number' ? Math.min(k, t.length) : null; }
}
function validatePackReport(x) {
  const errors = [], warnings = []; let raw = x;
  if (typeof x === 'string') { try { raw = JSON.parse(x); } catch (e) {
    const m = /line (\d+)/.exec(e.message), pos = /position (\d+)/.exec(e.message), at = pos ? +pos[1] : jsonErrorAt(x), line = m ? +m[1] : at != null ? x.slice(0, at).split('\n').length : null;
    return { ok: false, errors: ['不是有效的 JSON：' + e.message], errorPaths: [null], line, warnings, pack: null }; } }
  let P = null; const errorPaths = [];
  try { P = sanitizePack(raw, false); } catch (e) { errors.push(e instanceof PackError ? e.message + (e.path ? `（位置：${e.path}）` : '') : '无法读取：' + e.message); errorPaths.push(e.path || null); }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const TOP = new Set(['format', 'version', 'id', 'revision', 'title', 'category', 'tags', 'author', 'license', 'description', 'citations', 'cover', 'created', 'updated', 'scene', 'viewer']);
    const extra = Object.keys(raw).filter(k => !TOP.has(k)); if (extra.length) warnings.push(`顶层字段 ${extra.join('、')} 查看器不认识，会被忽略`);
    let html = 0, where = ''; const walk = (v, path, d = 0) => { if (d > 16) return; if (typeof v === 'string') { if (/[<>]/.test(v) && !/scene\.structure\.text$/.test(path)) { html++; where ||= path; } }
      else if (v && typeof v === 'object') for (const [k, y] of Object.entries(v)) walk(y, path + (Array.isArray(v) ? `[${k}]` : '.' + k), d + 1); };
    walk(raw, 'pack');
    if (html) warnings.push(`${html} 处文字含 < 或 >（第一处：${where.replace(/^pack\./, '')}），已转义成普通文字：社区场景不能插入 HTML`);
    const S = raw.scene;
    if (S && typeof S === 'object') {
      const unk = Object.keys(S).filter(k => !SCENE_KEYS.has(k)); if (unk.length) warnings.push(`scene 里的 ${unk.join('、')} 不是场景字段，会被忽略`);
      if (S.states && P && !P.scene.states) warnings.push('states 应是两个 PDB 编号，如 ["4AKE", "1AKE"]，已忽略');
      if (Array.isArray(S.components) && P && P.scene.components && P.scene.components.length < S.components.length) warnings.push(`${S.components.length - P.scene.components.length} 个 components 没有有效的 PDB 编号，已去掉`);
      if (S.process && S.animation) warnings.push('同时写了 process 和 animation：会播放内置过程，animation 不会用到');
      if (S.process === 'dataAnim') warnings.push('process 不用写 dataAnim：有 animation 时自动使用');
    }
    if (raw.category != null && !PACK_CATS[raw.category]) warnings.push(`category “${raw.category}” 无效，按 single（单个蛋白）处理；可选 cell / system / single / mechanism`);
    if (!raw.author?.name) warnings.push('社区作品必须写 author.name');
    if (raw.author?.url && !/^https:\/\//.test(raw.author.url)) warnings.push('author.url 只接受 https 链接，已去掉');
    if (!['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0'].includes(raw.license)) warnings.push('社区作品的 license 要选 CC-BY-4.0、CC-BY-SA-4.0 或 CC0-1.0');
    if (!raw.description) warnings.push('建议写 description（工坊卡片上的一两句介绍）');
    if (!Array.isArray(raw.citations) || !raw.citations.length) warnings.push('建议写 citations（结构来源文献）');
    if (raw.revision == null) warnings.push('没写 revision，按 1 处理；每次更新请加 1');
    if (typeof raw.title === 'string' && raw.title.length > 80) warnings.push('标题超过 80 字，已截断');
    if (Array.isArray(raw.tags) && raw.tags.length > 8) warnings.push('tags 最多 8 个，多出的已去掉');
    if (raw.cover && P && !P.cover) warnings.push('cover 不是有效的 data:image（jpeg / png / webp）或超过约 450 KB，已去掉');
  }
  return { ok: !errors.length, errors, errorPaths, warnings, pack: P };
}

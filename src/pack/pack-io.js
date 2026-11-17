/* a pack -> loadScene config */
function packToScene(P, src) {
  const cfg = { ...P.scene, name: P.title, _pack: { id: P.id, src, revision: P.revision, category: P.category, title: P.title }, _packObj: P };
  if (P.scene.structure) cfg.local = entryFromFile(P.scene.structure.name, P.scene.structure.text);
  if (P.scene.animation && !cfg.process) cfg.process = 'dataAnim';
  if (!cfg.caption && P.description) cfg.caption = P.description;
  return cfg;
}
async function openPack(P, src = 'local') {
  setMode(P.category);
  $('pdb').value = P.scene.id || '';
  await loadScene(packToScene(P, src));
}

/* ---- snapshot of what is on screen -> pack */
function cameraNow() {
  if (!model) return undefined;
  const vh = THREE.MathUtils.degToRad(camera.fov / 2), half = Math.min(vh, Math.atan(Math.tan(vh) * safeAspect()));
  const R = model.focus.radius + 6, off = camera.position.clone().sub(controls.target), L = off.length();
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return { az: r3(Math.atan2(off.x, off.z)), el: r3(Math.asin(THREE.MathUtils.clamp(off.y / L, -1, 1))), dist: r3(L / (R / Math.sin(half))) };
}
function coverNow(w = 480) {
  composer.render();
  const src = renderer.domElement, h = Math.round(w * src.height / src.width), c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.78);
}
const slugOf = (s) => (s || 'scene').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'scene';
function packFromCurrent(meta = {}) {
  if (!current) throw new PackError('还没有打开任何场景');
  const S = {};
  for (const [k, v] of Object.entries(current)) if (SCENE_KEYS.has(k) && k !== 'name') S[k] = v;
  if (current.local && !current.structure) throw new PackError('这个本地结构没有保存原文，请重新导入文件后再导出');
  if (S.auto) delete S.caption;   /* regenerated on load */
  S.camera = cameraNow(); S.cut = +$('cut').value; S.cutWhat = $('cutWhat').value;
  const pk = current._pack, id = pk?.id || ('my.' + slugOf(current.name || current.id) + '-' + Date.now().toString(36));
  const title = current.name || current.id;
  const P = { format: GLOW_FORMAT, version: GLOW_VERSION, id, revision: (pk?.revision || 0) + 1, title: meta.title || title,
    category: pk?.category || (PRESETS[current.name] ? presetCat(current.name) : 'single'), tags: meta.tags || [],
    author: meta.author || { name: '' }, license: meta.license || 'CC-BY-4.0',
    description: current.caption || '', created: new Date().toISOString().slice(0, 10), viewer: 17,
    citations: [...new Set([S.id, ...(S.states || []), ...(S.components || []).map(c => c.id)].filter(Boolean))].map(pdb => ({ pdb })),
    cover: coverNow(), scene: JSON.parse(JSON.stringify(S)) };
  return P;
}
function downloadPack(P) {
  const blob = new Blob([JSON.stringify(P, null, 1)], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = (P.id.replace(/^my\./, '') || 'scene') + '.glow'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function importPackText(text, name = '') {
  let raw; try { raw = JSON.parse(text); } catch (e) { throw new PackError(`${name} 不是有效的 JSON`); }
  const P = sanitizePack(raw, false); await openPack(P, 'local'); return P;
}


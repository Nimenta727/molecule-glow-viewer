/* ----------------------------------------------------------------------------- 3D text tags (H⁺, ATP, EF-Tu·GTP ...)
   makeTag(text, {obj | p}) -> tag; the tag follows obj (any Object3D) or the procRoot-local point p every frame */
let procTags = [], tagFilter = null;   /* tagFilter(tag) -> false hides it (whole cell: only the tags of the current zoom level) */
function makeTag(text, o = {}) {
  const el = document.createElement('div'); el.className = 'ptag' + (o.cls ? ' ' + o.cls : ''); el.innerHTML = text; $('procLabs').appendChild(el);
  const t = { el, obj: o.obj || null, p: o.p ? o.p.clone() : null, dy: o.dy ?? 0, on: true, set(html) { if (html !== this._h) { this._h = html; el.innerHTML = html; } return this; },
    remove() { el.remove(); procTags = procTags.filter(x => x !== t); } };
  procTags.push(t); return t;
}
const _tg = new THREE.Vector3();
function updateTags() {
  $('procLabs').style.display = kit ? 'none' : '';
  let gone = null;
  for (const t of procTags) {
    if (t.auto && !t.obj?.parent) { (gone ||= []).push(t); continue; }
    let vis = t.on && (procRoot.visible || t.auto) && (!tagFilter || tagFilter(t));
    if (t.obj) { let o = t.obj; while (vis && o) { vis = o.visible; o = o.parent; } if (vis && !t.obj.parent) vis = false; if (vis) t.obj.getWorldPosition(_tg); }
    else if (t.p) _tg.copy(t.p).applyMatrix4(procRoot.matrixWorld);
    else vis = false;
    if (vis) { _tg.y += t.dy; _tg.project(camera); vis = _tg.z < 1 && Math.abs(_tg.x) < 1.1 && Math.abs(_tg.y) < 1.1; }
    t.el.style.display = vis ? '' : 'none';
    if (vis) { t.sx = (_tg.x * 0.5 + 0.5) * innerWidth; t.sy = (-_tg.y * 0.5 + 0.5) * innerHeight; t.el.style.left = t.sx + 'px'; t.el.style.top = t.sy + 'px'; }
    t.vis = vis;
  }
  if (gone) for (const t of gone) t.remove();
  /* declutter: highlighted / warning tags first, then normal, then small ones; a tag that would overlap one already placed
     (or a UI panel) is faded out instead of piling up. Sizes are cached (text rarely changes size much). */
  const rank = (t) => /\b(hl|warn|ev)\b/.test(t.el.className) ? 0 : /\bpl\b/.test(t.el.className) ? 3 : /\bsmall\b/.test(t.el.className) ? 2 : 1, placed = [];
  for (const id of ['panel', 'cellHud', 'energy', 'caption', 'infoCard']) { const e = $(id); if (!e || getComputedStyle(e).display === 'none' || e.classList.contains('hidden')) continue;
    const r = e.getBoundingClientRect(); if (r.width && r.height) placed.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }); }
  const vt = procTags.filter(t => t.vis).sort((a, b) => rank(a) - rank(b));
  for (const t of vt) {
    if (t.w == null || t._wh !== t._h) { t._wh = t._h; t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; }
    const box = { x: t.sx, y: t.sy - 0.8 * t.h, w: t.w, h: t.h };
    const hit = placed.some(o => Math.abs(o.x - box.x) < (o.w + box.w) / 2 + 2 && Math.abs(o.y - box.y) < (o.h + box.h) / 2 + 1);
    t.el.style.opacity = hit ? '0' : ''; if (!hit) placed.push(box);
  }
}
function clearTags() { for (const t of procTags) t.el.remove(); procTags = []; }


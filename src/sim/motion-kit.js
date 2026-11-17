/* ============================================================================= MOTION KIT (v16)
   Nothing pops in, flashes or shrinks away. Free molecules (H⁺, ADP, Pi, ATP, NADH, O₂, K⁺ ...) wander in POOLS in the bulk
   solution of their own compartment (Brownian, never inside protein); a reaction TAKES the nearest one and it diffuses to its
   site along a Brownian bridge that keeps clear of protein atoms (brownPath); products diffuse back and are GIVEN to the pool
   of the compartment they end up in. Every moving particle carries a name tag; chemical events are named (eventTag) instead
   of flashed. Pools live in the main scene (hidden behind protein like everything else); a particle doing something (taken
   from a pool) moves to the overlay so it stays visible inside channels. */
const V3n = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(6.283185 * rand());
const gaussV = () => Math.sqrt(-2 * Math.log(1 - randVis())) * Math.cos(6.283185 * randVis());
const bulkRoot = new THREE.Group();   /* added to world once the scene exists (see below) */
let scenePools = new Map();
/* spatial hash of all atoms of the current model (model frame = world- / procRoot-local), cell 5 A; built lazily per model */
function occOf() {
  if (!model?.allAtoms) return null; if (model._occ) return model._occ;
  const c = 5, m = new Map(), fl = Math.floor, K = (x, y, z) => ((x + 4096) * 8192 + y + 4096) * 8192 + z + 4096;
  for (const a of model.allAtoms) { const k = K(fl(a.p.x / c), fl(a.p.y / c), fl(a.p.z / c)); let L = m.get(k); if (!L) m.set(k, L = []); L.push(a.p); }
  return model._occ = { c, m, K };
}
const _push = new THREE.Vector3();
/* distance to the nearest atom closer than R (Infinity if none); _push = summed direction away from those atoms */
function atomClear(p, R) {
  const O = occOf(); if (!O) return Infinity;
  const c = O.c, fl = Math.floor, r = Math.ceil(R / c), x0 = fl(p.x / c), y0 = fl(p.y / c), z0 = fl(p.z / c), R2 = R * R;
  let best = R2; _push.set(0, 0, 0);
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
    const L = O.m.get(O.K(x0 + dx, y0 + dy, z0 + dz)); if (!L) continue;
    for (const q of L) { const ex = p.x - q.x, ey = p.y - q.y, ez = p.z - q.z, d2 = ex * ex + ey * ey + ez * ez; if (d2 >= R2) continue;
      if (d2 < best) best = d2; const d = Math.sqrt(d2) + 1e-3, w = (R - d) / d; _push.x += ex * w; _push.y += ey * w; _push.z += ez * w; } }
  return best < R2 ? Math.sqrt(best) : Infinity;
}
/* any atom closer than R? (early exit; used every frame by the pools) */
function occBusy(p, R) {
  const O = occOf(); if (!O) return false;
  const c = O.c, fl = Math.floor, r = Math.ceil(R / c), x0 = fl(p.x / c), y0 = fl(p.y / c), z0 = fl(p.z / c), R2 = R * R;
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
    const L = O.m.get(O.K(x0 + dx, y0 + dy, z0 + dz)); if (!L) continue;
    for (const q of L) { const ex = p.x - q.x, ey = p.y - q.y, ez = p.z - q.z; if (ex * ex + ey * ey + ez * ez < R2) return true; } }
  return false;
}
function pushClear(p, R, it = 6) {
  for (let i = 0; i < it; i++) { const d = atomClear(p, R); if (d >= R) return true;
    if (_push.lengthSq() < 1e-8) _push.set(gauss(), gauss(), gauss()); p.addScaledVector(_push.normalize(), Math.min(R - d + 0.6, 4)); }
  return atomClear(p, R) >= R * 0.8;
}
/* Brownian bridge A -> B: a random walk pinned at both ends, smoothed, pushed out of protein (except within free0 of A and
   free1 of B, where the molecule binds / leaves its site); keep(p) may project points into a compartment */
function brownPath(A, B, o = {}) {
  const n = o.n || 22, L = Math.max(1, A.distanceTo(B)), sig = (o.wander ?? 0.3) * L / Math.sqrt(n), R = o.clear ?? 8.5;   /* the atom list holds one atom per residue (CA / P): ~8 A clears the residue blobs */
  const W = [V3n()]; for (let i = 1; i <= n; i++) W.push(W[i - 1].clone().add(V3n(gauss(), gauss(), gauss()).multiplyScalar(sig)));
  const P = W.map((w, i) => { const t = i / n; return A.clone().lerp(B, t).add(w).addScaledVector(W[n], -t); });
  for (let s = 0; s < 2; s++) for (let i = 1; i < n; i++) P[i].lerp(P[i - 1].clone().add(P[i + 1]).multiplyScalar(0.5), 0.35);
  for (let s = 0; s < 2; s++) for (let i = 1; i < n; i++) {
    if (P[i].distanceTo(B) < (o.free1 ?? 9) || P[i].distanceTo(A) < (o.free0 ?? 0)) continue;
    o.keep?.(P[i]); if (R > 0) pushClear(P[i], R); o.keep?.(P[i]); }
  return P;
}
/* alpha of a particle / molecule (all its materials) */
function setAlpha(o, a) {
  o.traverse(x => { const m = x.material; if (!m || x.userData.noFade) return; m.transparent = true; m.opacity = a; m.depthWrite = a > 0.6; });
  o.visible = a > 0.02; o.userData.alpha = a;
}
/* move obj along points P in dur seconds; fadeIn / fadeOut = fractions of the trip; remove = take it away at the end */
function travel(obj, P, dur, o = {}) {
  const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal'), a0 = obj.userData.alpha ?? 1;
  return new Promise((res, rej) => anim(obj, Math.max(0.05, dur), (u) => {
    curve.getPoint(o.ease ? ease(u) : u, obj.position);
    if (o.fadeIn || o.fadeOut) setAlpha(obj, Math.min(o.fadeIn ? Math.min(1, a0 + (1 - a0) * u / o.fadeIn) : 1, o.fadeOut ? Math.min(1, (1 - u) / o.fadeOut) : 1));
    if (o.tumble) obj.rotation.x += 0.03, obj.rotation.y += 0.02;
  }, () => { if (o.remove) obj.parent?.remove(obj); res(obj); }, rej));
}
/* a name tag that follows a particle and disappears with it */
function labelObj(obj, text, col) {
  const t = makeTag(text, { obj, cls: 'small pl' }); t.auto = true; obj.userData.tag = t;
  if (col != null) t.el.style.borderColor = '#' + new THREE.Color(col).getHexString(); return t;
}
/* a named chemical / physical event at a point (replaces the old flashes): rises, holds, fades */
function eventTag(text, p, dur = 2.4) {
  eventLog.push({ t: +U.uTime.value.toFixed(3), text: String(text).replace(/<[^>]*>/g, '') }); if (eventLog.length > 500) eventLog.shift();
  const t = makeTag(text, { p, cls: 'ev' }); t.el.style.animationDuration = dur + 's';
  anim(null, dur, () => {}, () => t.remove()); return t;
}
/* ---- regions of bulk solution */
function boxRegion(B, y0, y1) {   /* a cell-sim compartment: u along B.d, v along B.n, y0 < y < y1 */
  const at = (u, v, y) => V3n(B.c.x, y, B.c.z).addScaledVector(B.d, u).addScaledVector(B.n, v), _q = V3n();
  const uv = (p) => { _q.set(p.x - B.c.x, 0, p.z - B.c.z); return [_q.dot(B.d), _q.dot(B.n)]; };
  const far = y1 > y0 && Math.abs(y1 - (B.ym ?? 0)) > Math.abs(y0 - (B.ym ?? 0)) ? 1 : -1;   /* which y face is away from the membrane */
  return {
    inside(p) { const [u, v] = uv(p); return u > B.ulo && u < B.uhi && v > B.vlo && v < B.vhi && p.y > y0 + 2 && p.y < y1 - 2; },
    depth(p) { const [u, v] = uv(p); return Math.min(u - B.ulo, B.uhi - u, v - B.vlo, B.vhi - v, far > 0 ? y1 - p.y : p.y - y0); },
    sample(edge) { for (let k = 0; k < 40; k++) {
      let u = THREE.MathUtils.lerp(B.ulo + 3, B.uhi - 3, randVis()), v = THREE.MathUtils.lerp(B.vlo + 3, B.vhi - 3, randVis()), y = y0 + 4 + randVis() * (y1 - y0 - 8);
      if (edge) { const f = Math.floor(randVis() * 5); if (f === 0) u = B.ulo + 4; else if (f === 1) u = B.uhi - 4; else if (f === 2) v = B.vlo + 4; else if (f === 3) v = B.vhi - 4; else y = far > 0 ? y1 - 5 : y0 + 5; }
      const p = at(u, v, y); if (!occBusy(p, 6)) return p; } return null; },
  };
}
function shellRegion(c, r0, r1, ok = () => true) {   /* a shell around a machine, limited to one compartment by ok(p) */
  return {
    inside(p) { const d = p.distanceTo(c); return d > r0 && d < r1 && ok(p); },
    depth(p) { return r1 - p.distanceTo(c); },
    sample(edge) { for (let k = 0; k < 60; k++) {
      const d = V3n(gaussV(), gaussV(), gaussV()).normalize(), p = c.clone().addScaledVector(d, edge ? r1 - 4 : THREE.MathUtils.lerp(r0 + 4, r1 - 4, Math.cbrt(randVis())));
      if (ok(p) && !occBusy(p, 6)) return p; } return null; },
  };
}
/* ---- a pool of one kind of free molecule */
class MolPool {
  constructor(o) { Object.assign(this, { n: 0, clear: 7.5, kick: 16, maxTags: 2, items: [] }, o); }
  add(p, mode, a) {
    const obj = this.make(); bulkRoot.add(obj); obj.position.copy(p); if (this.tumble) obj.rotation.set(randVis() * 6, randVis() * 6, 0);
    if (obj.isMesh && illustrative()) { obj.material.dispose(); obj.material = new THREE.MeshBasicMaterial({ color: this.col }); }
    if (this.label) labelObj(obj, this.label, this.col); setAlpha(obj, a);
    const it = { obj, v: V3n(), mode, a }; this.items.push(it); this.retag(); return it;
  }
  fill() { for (let i = 0; i < Math.round(this.n); i++) { const p = this.region.sample(false); if (p) this.add(p, 'free', 1); } }
  retag() { let k = 0; for (const it of this.items) { const t = it.obj.userData.tag; if (t) t.on = it.mode !== 'out' && k++ < this.maxTags; } }
  /* the nearest free one goes to work (moved to the overlay); none free -> one drifts in from the edge of the bulk */
  take(near) {
    let best = null, bd = Infinity;
    for (const it of this.items) if (it.mode === 'free' || it.mode === 'in') { const d = it.obj.position.distanceToSquared(near); if (d < bd) { bd = d; best = it; } }
    if (!best) best = this.add(this.region.sample(true) || near.clone(), 'in', 0.05);
    this.items = this.items.filter(x => x !== best); this.retag();
    const obj = best.obj; procRoot.add(obj); obj.userData.alpha = best.a; if (obj.userData.tag) obj.userData.tag.on = true; return obj;
  }
  give(obj) { bulkRoot.add(obj); setAlpha(obj, 1); this.items.push({ obj, v: V3n(), mode: 'free', a: 1 }); this.retag(); }
  update(dt) {
    const R = this.region, live = this.items.filter(i => i.mode !== 'out').length, want = Math.round(this.n);
    if (live < want && rand() < dt * 6) { const p = R.sample(true); if (p) this.add(p, 'in', 0); }
    if (live > want && rand() < dt * 6) {   /* the extra one nearest the edge of the bulk drifts out */
      let w = null; for (const it of this.items) if (it.mode === 'free' && (!w || R.depth(it.obj.position) < R.depth(w.obj.position))) w = it;
      if (w) { w.mode = 'out'; this.retag(); } }
    for (let i = this.items.length - 1; i >= 0; i--) { const it = this.items[i], p = it.obj.position;
      it.v.multiplyScalar(Math.exp(-dt * 1.5)).add(_push.set(gauss(), gauss(), gauss()).multiplyScalar(this.kick * Math.sqrt(dt)));
      const nx = p.x + it.v.x * dt, ny = p.y + it.v.y * dt, nz = p.z + it.v.z * dt; _cv.set(nx, ny, nz);
      if ((!R.inside(_cv) && it.mode !== 'out') || occBusy(_cv, this.clear)) it.v.multiplyScalar(-0.6); else p.copy(_cv);
      if (this.tumble) { it.obj.rotation.x += dt * 0.7; it.obj.rotation.y += dt * 0.5; }
      if (it.mode === 'in') { it.a = Math.min(1, it.a + dt / 1.2); setAlpha(it.obj, it.a); if (it.a >= 1) it.mode = 'free'; }
      else if (it.mode === 'out') { it.a -= dt / 1.6; if (it.a <= 0) { it.obj.parent?.remove(it.obj); this.items.splice(i, 1); } else setAlpha(it.obj, it.a); }
    }
  }
}
/* scene pool by key; spec: { label, col, r | make(), region, n, tumble }. A cell sim's dots are pools too (same keys:
   label + '@' + comp), so a process that asks for 'H⁺@top' gets the very H⁺ the compartment model is showing. */
function scenePool(key, spec) {
  let p = scenePools.get(key); if (p) return p;
  const make = spec.make || (() => { const m = makeParticle(spec.col, spec.r || 2.2, null, spec.name || spec.label || null); return m; });
  p = new MolPool({ ...spec, make, key }); scenePools.set(key, p); if (spec.n) p.fill(); return p;
}
function updatePools(dt) { for (const p of scenePools.values()) p.update(dt); }
function clearPools() { scenePools = new Map(); while (bulkRoot.children.length) { const o = bulkRoot.children[0]; bulkRoot.remove(o); o.traverse(x => { if (x.material) x.material.dispose(); }); } }
/* the standard little molecules, one look everywhere (colour, size, name) */
const SPECIES = {
  'H⁺': { col: 0xfff27a, r: 2.2 }, 'e⁻': { col: 0x6ff4ff, r: 2.6 }, 'K⁺': { col: 0xb98cff, r: 2.0 }, 'Na⁺': { col: 0x4fc3f7, r: 1.7 },
  'O₂': { col: 0x7ab8ff, r: 3.2 }, 'H₂O': { col: 0xdfe8f5, r: 2.4 }, 'NADH': { col: 0xff6fa8, r: 3.6 }, 'NAD⁺': { col: 0xffb3cf, r: 3.4 },
  'NADPH': { col: 0xff6fa8, r: 3.6 }, 'NADP⁺': { col: 0xffb3cf, r: 3.4 }, 'ATP': { col: 0xff9a2e, r: 3.4 }, 'ADP': { col: 0x46c8ff, r: 3.2 },
  'Pi': { col: 0xc9a2ff, r: 2.4 }, 'PQH₂': { col: 0xffe08a, r: 3.4 }, 'QH₂': { col: 0xffe08a, r: 3.4 }, '光子 hν': { col: 0xff5a5a, r: 2.2 },
  '激发能': { col: 0x9dff6a, r: 2.2 }, 'CO₂': { col: 0xb0b8c8, r: 2.6 },
};
/* a labelled particle of a standard species (in the overlay) */
let sceneSpecies = {};   /* species a scene defines (data animations); cleared with the scene */
const spOf = (name) => sceneSpecies[name] || SPECIES[name] || { col: 0xffffff, r: 2.4 };
function mkSp(name, label = name) { const s = spOf(name); return makeParticle(s.col, s.r, label); }
/* pool of a standard species in a compartment of the scene (cell-sim box if there is one, else the given region) */
function spPool(name, comp, region, n = 0) {
  const key = name + '@' + comp; if (scenePools.has(key)) return scenePools.get(key);
  const s = spOf(name);
  return scenePool(key, { label: name, col: s.col, r: s.r, region: (cellSim?.regions?.[comp]) || region, n });
}
/* time scale: 'slow' = every molecular event shown in detail; 'fast' = streams of particles show where the flux goes */
let timeScale = 'slow';
const fastMode = () => timeScale === 'fast';
/* ---- particle streams (fast mode). def: { label, col, r, paths: [[Vector3...]...], per: particles per cycle, v: A/s }.
   One InstancedMesh per stream in the overlay; particles enter at the start of a path (growing in from nothing far out in the
   bulk), follow it with a little lateral scatter and leave at the end. Rate = per x cycles/s. */
class FlowLayer {
  constructor(defs) {
    this.S = defs.filter(d => d.paths?.length).map(d => {
      const curves = d.paths.map(P => { const c = new THREE.CatmullRomCurve3(P, false, 'centripetal'); return { c, L: c.getLength() }; });
      const max = d.max || 400, mat = new THREE.MeshStandardMaterial({ color: d.col, emissive: d.col, emissiveIntensity: 1.1, roughness: 0.35 });
      const mesh = new THREE.InstancedMesh(PARTICLE_GEO, mat, max); mesh.count = 0; mesh.frustumCulled = false; mesh.userData.name = d.name || d.label; procRoot.add(mesh);
      const mid = curves[0].c.getPoint(0.5), tag = makeTag(d.label, { p: mid, cls: 'small flow' }); tag.el.style.borderColor = '#' + new THREE.Color(d.col).getHexString();
      return { d, curves, mesh, max, parts: [], acc: 0, tag };
    });
  }
  set visible(v) { for (const s of this.S) { s.mesh.visible = v; s.tag.on = v; } }
  update(dt, cps) {
    for (const s of this.S) {
      s.acc += dt * cps * s.d.per; while (s.acc >= 1 && s.parts.length < s.max) { s.acc -= 1; const k = Math.floor(randVis() * s.curves.length);
        s.parts.push({ k, u: 0, off: V3n(gaussV(), gaussV(), gaussV()).multiplyScalar(s.d.spread ?? 1.8), sp: (s.d.v || 60) * (0.8 + 0.4 * randVis()) / s.curves[k].L }); }
      if (s.acc > 1) s.acc = 1;
      let n = 0;
      for (let i = s.parts.length - 1; i >= 0; i--) { const q = s.parts[i]; q.u += q.sp * dt; if (q.u >= 1) { s.parts.splice(i, 1); continue; } }
      for (const q of s.parts) { s.curves[q.k].c.getPoint(q.u, _tp); _tp.add(q.off);
        const sc = 1.3 * (s.d.r || 2.2) * Math.min(1, q.u / 0.06, (1 - q.u) / 0.06); _tm4.compose(_tp, _tq0, _tsv.setScalar(Math.max(0.01, sc))); s.mesh.setMatrixAt(n++, _tm4); }
      s.mesh.count = n; s.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  dispose() { for (const s of this.S) { s.mesh.parent?.remove(s.mesh); s.mesh.material.dispose(); s.tag.remove(); } }
}
/* shared H+ path helpers for the membrane machines: bulk pool -> channel mouth -> (through the channel) -> other mouth -> bulk */
async function protonAcross(pIn, pOut, chan, o = {}) {
  /* pIn / pOut: pools on the entry / exit side; chan: points through the protein (first = entry mouth, last = exit mouth) */
  const k = o.pace ? o.pace() : 1, h = pIn.take(chan[0]);
  if (o.count) o.count();
  await travel(h, brownPath(h.position.clone(), chan[0], { free1: 6, keep: o.keepIn }), (o.tIn ?? 1.6) / k, { fadeIn: (h.userData.alpha ?? 1) < 1 ? 0.3 : 0 });
  if (o.label) h.userData.tag?.set(o.label);
  await travel(h, chan, (o.tChan ?? 1.0) / k, { ease: true });
  h.userData.tag?.set('H⁺');
  if (!pOut) { h.parent?.remove(h); return; }
  const dest = pOut.region.sample(false) || chan[chan.length - 1].clone();
  const exitP = brownPath(chan[chan.length - 1].clone(), dest.clone().lerp(chan[chan.length - 1], 0.45), { free0: 6, free1: 0, keep: o.keepOut });
  await travel(h, exitP, (o.tOut ?? 1.4) / k);
  pOut.give(h);
}
/* ADP + Pi from the bulk -> F1 head -> ATP back into the bulk (respiratory chain / chloroplast ATP synthase) */
async function atpFromPools(pl, at, ctx) {
  const k = ctx.pace(), a = pl('ADP').take(at), p = pl('Pi').take(at), fi = (o) => ({ fadeIn: (o.userData.alpha ?? 1) < 1 ? 0.3 : 0, tumble: true });
  await Promise.all([travel(a, brownPath(a.position.clone(), at, { free1: 10 }), 2.4 / k, fi(a)), travel(p, brownPath(p.position.clone(), at.clone().add(V3n(3, -2, 0)), { free1: 10 }), 2.4 / k, fi(p))]);
  a.parent?.remove(a); p.parent?.remove(p);
  eventTag('ADP + Pi → ATP（F1 头部）', at.clone().add(V3n(0, 8, 0)), 2.0); if ('ATP' in ctx.counters) ctx.counters.ATP++;
  const m = mkSp('ATP'), pool = pl('ATP'); m.position.copy(at);
  await travel(m, brownPath(at.clone(), pool.region.sample(false) || at.clone().add(V3n(0, 60, 0)), { free0: 10, free1: 0 }), 2.6 / k);
  pool.give(m);
}
world.add(bulkRoot);


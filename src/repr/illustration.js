/* ----------------------------------------------------------------------------- journal-style schematic ("示意图")
   The way mechanism figures draw complexes (e.g. ATP synthase: alpha/beta = elongated lobes around the head, gamma = a rod
   with a foot, c-ring = ONE drum, a = a bean beside it, b/d/F6/e/g = thin curved tubes, OSCP = a cap). Rules, all fitted
   to the real coordinates so position, orientation, size, path and stoichiometry stay correct:
   - RING: a part with >= 5 chains whose centres sit on a closed circle around the main axis -> one drum (annulus if the
     hole is wider than 40 A), radial extent = 10-90th percentile, height = 5-95th percentile of the residues.
   - TUBE: a chain whose smoothed CA path does not fold back on itself (< 35 % of path points within 11 A of a point
     > 25 residues away) and is not compact -> a 4.5 A tube along that path (long helices, extended linkers).
   - LOBE: everything else -> an ellipsoid on the PCA axes, semi-axes = 85th percentile of |projection| + 2.5 A, tapered
     into an egg/petal by the third moment. Chains > 650 residues are first split into domains (k-means, ~330 res each). */
const LOBE_GEO = new THREE.SphereGeometry(1, 40, 28);
function lobeGeo(taper) {
  const g = LOBE_GEO.clone(), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const y = P.getY(i), k = 1 + taper * y; P.setX(i, P.getX(i) * k); P.setZ(i, P.getZ(i) * k); }
  g.computeVertexNormals(); return g;
}
function fitLobe(P) {
  const { centre, axes } = pca(P), ax = [axes[1], axes[2], axes[0]];   // local x = mid, y = long, z = short
  /* semi-axis of a uniform solid ellipsoid with the same second moment: sqrt(5) x SD (+1.5 A for the residue radius) */
  const ext = ax.map(a => { let s2 = 0; for (const p of P) { const t = p.clone().sub(centre).dot(a); s2 += t * t; } return Math.sqrt(5 * s2 / P.length) + 1.5; });
  let sk = 0, sd = 0; for (const p of P) { const t = p.clone().sub(centre).dot(ax[1]); sk += t * t * t; sd += t * t; }
  sd = Math.sqrt(sd / P.length) || 1; sk /= P.length * sd * sd * sd;
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax[0], ax[1], new THREE.Vector3().crossVectors(ax[0], ax[1])));
  /* keep the axis RATIOS from the moments but set the SIZE from the residue count: V = n x 136 A^3 (mean residue volume)
     x 1.35 (smooth envelope), so a small elongated domain is not drawn bigger than a large compact one */
  const f = Math.cbrt(P.length * 136 * 1.35 / (4 / 3 * Math.PI * ext[0] * ext[1] * ext[2]));
  return { centre, q, scale: new THREE.Vector3(Math.max(4, ext[0] * f), Math.max(4, ext[1] * f), Math.max(4, ext[2] * f)), taper: THREE.MathUtils.clamp(-sk * 0.25, -0.35, 0.35) };
}
function smoothPath(P, win = 4) {
  return P.map((_, k) => { const c = new THREE.Vector3(); let m = 0; for (let j = Math.max(0, k - win); j <= Math.min(P.length - 1, k + win); j++) { c.add(P[j]); m++; } return c.multiplyScalar(1 / m); });
}
function isTube(P) {
  if (P.length < 18) return false;
  const S = smoothPath(P, 6); let self = 0;
  for (let k = 0; k < S.length; k += 2) for (let j = 0; j < S.length; j += 2) if (Math.abs(j - k) > 25 && S[j].distanceToSquared(S[k]) < 121) { self++; break; }
  const len = S.reduce((s, p, k) => k ? s + p.distanceTo(S[k - 1]) : 0, 0);
  return self / Math.ceil(S.length / 2) < 0.35 && len > 45;
}
function ringOf(g) {
  const chains = [...new Set(g.atoms.map(a => a.asym))]; if (chains.length < 5) return null;
  const C = chains.map(k => { const at = g.atoms.filter(a => a.asym === k); return at.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / at.length); });
  const cen = C.reduce((s, c) => s.add(c), new THREE.Vector3()).multiplyScalar(1 / C.length);
  const rad = C.map(c => Math.hypot(c.x - cen.x, c.z - cen.z)), rm = rad.reduce((s, r) => s + r, 0) / rad.length;
  if (rm < 8 || rad.some(r => Math.abs(r - rm) > 0.2 * rm) || C.some(c => Math.abs(c.y - cen.y) > 0.35 * rm + 10)) return null;
  const ang = C.map(c => Math.atan2(c.z - cen.z, c.x - cen.x)).sort((a, b) => a - b);
  let gap = 2 * Math.PI - (ang[ang.length - 1] - ang[0]); for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
  if (gap * rm > 3 * 2 * Math.PI * rm / chains.length) return null;   // not closed
  const r = g.atoms.map(a => Math.hypot(a.p.x - cen.x, a.p.z - cen.z)).sort((x, y) => x - y), ys = g.atoms.map(a => a.p.y).sort((x, y) => x - y), q = (v, f) => v[Math.floor(v.length * f)];
  let ri = q(r, 0.1) - 2.5, ro = q(r, 0.9) + 3.5; if (ri < 6) ri = 0;   // keep the real central cavity (c-ring, C-ring)
  return { cen: new THREE.Vector3(cen.x, 0, cen.z), ri, ro, y0: q(ys, 0.05) - 3, y1: q(ys, 0.95) + 3, n: chains.length };
}
/* one ring subunit = one rounded wedge of the drum (journal figures keep subunit identity inside rings), with a gap */
function ringProfile(R) {
  const H = R.y1 - R.y0, rr = Math.min(H * 0.3, (R.ro - R.ri) * 0.3, 8), pts = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 5; i++) { const a = a0 + (a1 - a0) * i / 5; pts.push(new THREE.Vector2(cx + rr * Math.cos(a), cy + rr * Math.sin(a))); } };
  if (R.ri > 0) arc(R.ri + rr, R.y0 + rr, Math.PI, 1.5 * Math.PI); else pts.push(new THREE.Vector2(0.01, R.y0));
  arc(R.ro - rr, R.y0 + rr, 1.5 * Math.PI, 2 * Math.PI); arc(R.ro - rr, R.y1 - rr, 0, 0.5 * Math.PI);
  if (R.ri > 0) { arc(R.ri + rr, R.y1 - rr, 0.5 * Math.PI, Math.PI); pts.push(pts[0].clone()); } else pts.push(new THREE.Vector2(0.01, R.y1));
  return pts;
}
function ringSegGeo(R, phi, n) {
  const pts = ringProfile(R), rm = (R.ri + R.ro) / 2, gap = Math.min(0.5 * 2 * Math.PI / n, 3 / Math.max(rm, 10));
  const len = 2 * Math.PI / n - gap, p0 = phi - len / 2;
  const side = new THREE.LatheGeometry(pts, Math.max(4, Math.round(64 / n)), p0, len);
  const cap = (ph) => {   // flat end face: fan from the profile centroid
    const c = pts.reduce((s, p) => s.add(p), new THREE.Vector2()).multiplyScalar(1 / pts.length), v = [], idx = [];
    const at = (p) => v.push(Math.sin(ph) * p.x, p.y, Math.cos(ph) * p.x);
    at(c); pts.forEach(at); for (let i = 1; i < pts.length; i++) idx.push(0, i, i + 1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); return g;
  };
  const geo = mergeGeos([side, cap(p0), cap(p0 + len)]);
  geo.translate(R.cen.x, 0, R.cen.z); geo.computeVertexNormals(); return geo;
}
/* a domain = its own low-resolution density (molmap-like) at a size-dependent resolution, contoured at its real volume
   (136 A^3 / residue) and shrunk 1.5 A toward its centre so neighbouring domains show a seam (Mol* / ChimeraX blobs) */
function domainBlobGeo(P) {
  const N = P.length, res = THREE.MathUtils.clamp(10 + 0.025 * N, 12, 18);
  const { geo } = lowpassSurface(P, P.map(() => 1), res);
  const c = P.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / N);
  const k = Math.max(0.8, 1 - 1.5 / Math.cbrt(3 * 136 * N / (4 * Math.PI))), A = geo.attributes.position;
  for (let i = 0; i < A.count; i++) A.setXYZ(i, c.x + (A.getX(i) - c.x) * k, c.y + (A.getY(i) - c.y) * k, c.z + (A.getZ(i) - c.z) * k);
  geo.computeVertexNormals(); return geo;
}
/* rigid placement of a domain blob built at rest coordinates onto moved coordinates (Kabsch) */
function placeLobe(x, pts) {
  if (!x.userData.rest) { const f = fitLobe(pts); x.position.copy(f.centre); x.quaternion.copy(f.q); x.scale.copy(f.scale); return; }
  const f = superpose(pts, x.userData.rest);
  x.quaternion.copy(f.q); x.position.copy(f.ca).sub(f.cb.clone().applyQuaternion(f.q));
}
function drumGeo(R) {
  const H = R.y1 - R.y0, rr = Math.min(H * 0.35, (R.ro - R.ri) * 0.35, 12), pts = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 6; i++) { const a = a0 + (a1 - a0) * i / 6; pts.push(new THREE.Vector2(cx + rr * Math.cos(a), cy + rr * Math.sin(a))); } };
  if (R.ri > 0) { arc(R.ri + rr, R.y0 + rr, Math.PI, 1.5 * Math.PI); } else pts.push(new THREE.Vector2(0.01, R.y0));
  arc(R.ro - rr, R.y0 + rr, 1.5 * Math.PI, 2 * Math.PI); arc(R.ro - rr, R.y1 - rr, 0, 0.5 * Math.PI);
  if (R.ri > 0) { arc(R.ri + rr, R.y1 - rr, 0.5 * Math.PI, Math.PI); pts.push(pts[0].clone()); } else pts.push(new THREE.Vector2(0.01, R.y1));
  const geo = new THREE.LatheGeometry(pts, 96); geo.translate(R.cen.x, 0, R.cen.z); geo.computeVertexNormals(); return geo;
}
function tubeGeo(P, r = 4.5) {
  const S = smoothPath(P, 6), curve = new THREE.CatmullRomCurve3(S.filter((_, k) => k % 4 === 0 || k === S.length - 1), false, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, Math.max(12, S.length), r, 16, false);
  const caps = [curve.getPoint(0), curve.getPoint(1)].map(c => new THREE.SphereGeometry(r, 16, 12).translate(c.x, c.y, c.z));
  const merged = mergeGeos([geo, ...caps]); merged.computeVertexNormals(); return merged;
}
function mergeGeos(list) {
  let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni); let ov = 0, oi = 0;
  for (const g of list) { pos.set(g.attributes.position.array, ov * 3); const I = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()]; for (let i = 0; i < I.length; i++) idx[oi++] = I[i] + ov; ov += g.attributes.position.count; }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setIndex(new THREE.BufferAttribute(idx, 1)); return m;
}
function paint(geo, color) { const n = geo.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; } geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo; }
function domainSplit(at, posOf, per = 330) {
  if (at.length <= (per < 100 ? 100 : 2 * per)) return [at];
  const k = Math.round(at.length / per), P = at.map(posOf);
  const C = []; for (let j = 0; j < k; j++) { const s0 = Math.floor(j * P.length / k), s1 = Math.floor((j + 1) * P.length / k); C.push(P.slice(s0, s1).reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / (s1 - s0))); }
  let lab = [];
  for (let it = 0; it < 8; it++) {
    lab = P.map(p => { let b = 0, bd = 1e18; C.forEach((c, j) => { const d = c.distanceToSquared(p); if (d < bd) { bd = d; b = j; } }); return b; });
    C.forEach((c, j) => { const m = P.filter((_, t) => lab[t] === j); if (m.length) c.copy(m.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / m.length)); });
  }
  return C.map((_, j) => at.filter((_, t) => lab[t] === j)).filter(x => x.length >= 8);
}
function buildSchematic(g, colorOf, posOf = (a) => a.p) {
  const grp = new THREE.Group(), mat = surfaceMaterial('schem'), out = illustrative() ? null : outlineMaterial(), col = new THREE.Color();
  if (g.faded) { mat.transparent = true; mat.opacity = 0.42; mat.depthWrite = false;   // (3) scaffold: ghosted, functional parts show through
    mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.SrcAlphaFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor; mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor; }   // keep the ink tag (alpha) of what lies behind
  const add = (geo, centre, extra = {}) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.userData = { surface: true, schem: true, centre, ...extra };
    if (g.faded) mesh.renderOrder = 2;
    if (out && !g.faded) { const o = new THREE.Mesh(geo, out); o.frustumCulled = false; o.userData = { outline: true }; mesh.userData.outline = o; mesh.add(o); }
    grp.add(mesh); return mesh;
  };
  const ring = ringOf(g), fade = (c) => { if (g.faded) c.lerp(FADE_TO(), illustrative() ? 0.5 : 0.55); return c; };
  const blobCache = new Map(), moving = !!(g.confKeys || g.atoms.some(a => a.p2 || a.alts));
  /* functional-core residues are drawn atomically elsewhere: leave them OUT of the shapes so the detail sits in an open
     pocket instead of being buried (a ring with core residues is drawn as per-subunit density shapes, not wedges) */
  const coreSet = new Set((g.coreIdx || []).map(k => g.atoms[k]));
  if (ring && !coreSet.size) {
    for (const asym of [...new Set(g.atoms.map(a => a.asym))]) {
      const at = g.atoms.filter(a => a.asym === asym), c = at.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / at.length);
      fade(col.set(colorOf ? colorOf(at[at.length >> 1]) : g.color));
      add(paint(ringSegGeo(ring, Math.atan2(c.x - ring.cen.x, c.z - ring.cen.z), ring.n), col), c);
    }
  } else for (const asym of [...new Set(g.atoms.map(a => a.asym))]) {
    let at = g.atoms.filter(a => a.asym === asym); if (at.length < 4) continue;
    let P = at.map(posOf);
    /* globular core = residues with >= 3 non-local neighbours (|i-j| > 4) within 10 A; flexible tails (histone tails)
       and lone helices have none. Mostly-core chains become lobes built from the core only. */
    const forced = !at[0].na && current?.lobes?.some(k => kwMatch(g.name, k));
    if (forced) {   // fit to residues packed against anything else (intra- or inter-chain): drops flexible tails
      const all = groups.flatMap(h => h.atoms.filter(b => !b.na));
      const core = at.filter(a => { const pa = posOf(a); let c = 0; for (const b of all) { if (b === a || b.asym === a.asym && Math.abs(b.seq - a.seq) <= 12) continue; if (pa.distanceToSquared(posOf(b)) < 100 && ++c >= 3) return true; } return false; });
      if (core.length >= 12) { at = core; P = at.map(posOf); }
    }
    else if (at[0].na && P.length >= 6) {
      /* double helix = ONE tube along the duplex axis (textbook convention). The mean of one strand's phosphates over a
         helical turn (~10.4 bp) lies on the axis; the midpoint with the partner strand's turn-mean removes end bias.
         The strand whose chain id sorts first draws the duplex; its partner draws nothing. */
      const mine = smoothPath(P, 5);
      let partner = null, best = 0;
      for (const h of groups) for (const k of [...new Set(h.atoms.filter(b => b.na).map(b => b.asym))]) {
        if (k === asym && h === g) continue;
        const Q = h.atoms.filter(b => b.na && b.asym === k).map(b => h === g ? posOf(b) : b.p);
        const hit = P.filter(p => Q.some(q => p.distanceToSquared(q) < 484)).length / P.length;
        if (hit > 0.5 && hit > best) { best = hit; partner = { k, Q }; }
      }
      if (partner && partner.k < asym) continue;
      let axis = mine;
      if (partner) { const T = smoothPath(partner.Q, 5); axis = mine.map(p => { let b = T[0], bd = 1e18; for (const t of T) { const d = p.distanceToSquared(t); if (d < bd) { bd = d; b = t; } } return p.clone().add(b).multiplyScalar(0.5); }); }
      fade(col.set(colorOf ? colorOf(at[at.length >> 1]) : g.color));
      add(paint(tubeGeo(axis, partner ? 10 : 6), col), axis.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / axis.length));
      continue;
    }
    else if (!at[0].na && isTube(P)) {
      fade(col.set(colorOf ? colorOf(at[at.length >> 1]) : g.color));
      const geo = paint(tubeGeo(P, 4.5), col);
      add(geo, P.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / P.length));
      continue;
    }
    /* lobes are fitted to the globular CORE only: residues with >= 3 neighbours within 10 A that are > 12 residues away
       in sequence (flexible tails such as histone tails, and single helices, have none) */
    const full = at;
    if (!at[0].na && !forced) {
      const core = at.filter((a, i) => { let n = 0; for (let j = 0; j < P.length && n < 3; j++) if (Math.abs(i - j) > 12 && P[i].distanceToSquared(P[j]) < 100) n++; return n >= 3; });
      if (core.length >= 12) { at = core; P = at.map(posOf); }
    }
    /* preset-declared domains (literature residue ranges) win over the geometric k-means split */
    const doms = current?.domains && !at[0].na
      ? current.domains.map(([, rs]) => full.filter(a => rs.some(([u, v]) => a.seq >= u && a.seq <= v))).filter(d => d.length >= 8)
      : domainSplit(at, posOf, groups.length <= 2 ? 50 : moving ? 150 : 220);   // moving parts: finer domains so their motion shows
    for (let dom of doms) {
      const open = dom.filter(a => !coreSet.has(a)); if (open.length >= 8) dom = open;
      const R = dom.map(posOf), key = dom.length + '|' + dom[0].seq + '|' + dom[dom.length - 1].seq;
      let geo = null; const tpl = blobCache.get(key);
      if (tpl) {   // symmetric copy of a domain already meshed: move the template instead of re-meshing (capsids, rings)
        const f = superpose(R, tpl.rest); let e = 0; tpl.rest.forEach((p, i) => e += f(p).distanceToSquared(R[i]));
        if (e / R.length < 6.25) geo = tpl.geo.clone().applyMatrix4(new THREE.Matrix4().compose(f.ca.clone().sub(f.cb.clone().applyQuaternion(f.q)), f.q, new THREE.Vector3(1, 1, 1)));
      }
      if (!geo) { geo = domainBlobGeo(R); if (!tpl) blobCache.set(key, { geo, rest: R }); }
      fade(col.set(colorOf ? colorOf(dom[dom.length >> 1]) : g.color));
      add(paint(geo.clone(), col), R.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / R.length), { lobe: dom, rest: R.map(p => p.clone()), asym });
    }
  }
  /* PORE: >= 3 subunits around an axis whose functional core lines the axis (ion channels): the subunit facing the camera
     is ghosted each frame so the pore, the filter and the ions stay visible ("front subunit removed for clarity") */
  const asyms = [...new Set(g.atoms.map(a => a.asym))];
  if (asyms.length >= 3 && coreSet.size) {
    const C = asyms.map(k => { const at = g.atoms.filter(a => a.asym === k); return at.reduce((s, a) => s.add(posOf(a)), new THREE.Vector3()).multiplyScalar(1 / at.length); });
    const cen = C.reduce((s, c) => s.add(c), new THREE.Vector3()).multiplyScalar(1 / C.length), rxz = (p) => Math.hypot(p.x - cen.x, p.z - cen.z);
    const rC = C.reduce((s, c) => s + rxz(c), 0) / C.length, core = [...coreSet], rCore = core.reduce((s, a) => s + rxz(posOf(a)), 0) / core.length;
    if (rC > 8 && rCore < 0.5 * rC) {
      const ghost = surfaceMaterial('schem'); ghost.transparent = true; ghost.opacity = 0.13; ghost.depthWrite = false;
      grp.userData.pore = { cen, ang: new Map(asyms.map((k, i) => [k, Math.atan2(C[i].x - cen.x, C[i].z - cen.z)])), mat, ghost, front: null };
    }
  }
  grp.userData.simple = true;
  return grp;
}
function updatePore(g) {
  const P = g.mesh.userData.pore; if (!P) return;
  const v = g.mesh.worldToLocal(camera.position.clone()), a = Math.atan2(v.x - P.cen.x, v.z - P.cen.z);
  let front = null, bd = 9; for (const [k, t] of P.ang) { const d = Math.abs(Math.atan2(Math.sin(t - a), Math.cos(t - a))); if (d < bd) { bd = d; front = k; } }
  if (front === P.front) return; P.front = front;
  for (const x of g.mesh.children) {
    if (x.userData.surface) { const f = x.userData.asym === front; x.material = f ? P.ghost : P.mat; if (x.userData.outline) x.userData.outline.visible = !f; }
    else if (x.userData.core && x.userData.asym) x.visible = x.userData.asym !== front;
  }
}
/* lobes follow conformational changes (process blends, two-state morphs): refit position / orientation / size */
function refitLobes(g, posOf) {
  for (const x of g.mesh.children) if (x.userData.lobe) placeLobe(x, x.userData.lobe.map(posOf));
}

/* re-surface a chain whose coordinates changed (process conformations, two-state morph); throttled by key */
function resurface(g, x, posOf, key) {
  if (x.userData.key === key) return;
  x.userData.key = key;
  const { at, P, W } = chainPoints(g, x.userData.asym, posOf);
  const { geo, nearOf } = lowpassSurface(P, W, +$('simpRes').value);
  const old = x.geometry, oc = old.attributes.color, cols = new Float32Array(nearOf.length * 3), col = new THREE.Color();
  const cf = g._colorOf;
  nearOf.forEach((n, v) => { col.set(cf ? cf(at[Math.max(0, n)]) : g.color); cols[v * 3] = col.r; cols[v * 3 + 1] = col.g; cols[v * 3 + 2] = col.b; });
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  x.geometry = geo; if (x.userData.outline) x.userData.outline.geometry = geo;
  old.dispose();
}

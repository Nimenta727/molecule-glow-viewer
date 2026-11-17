/* ----------------------------------------------------------------------------- pocket surface (Web Worker)
   Gaussian molecular surface (the Mol* / NGL "gaussian surface" idea): each atom adds exp(-2 d^2 / R^2), R = vdW radius;
   the iso-level exp(-2) puts an isolated atom's surface at its vdW radius, neighbours blend into a smooth skin.
   Iso-surface by surface nets on a 0.5 A grid; quads farther than `cut` from the ligand centre are dropped. */
function pocketSurfaceJob(J) {
  const { pos, rad, cls, centre, cut } = J, n = rad.length, h = 0.5, lvl = Math.exp(-2);
  let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
  for (let i = 0; i < n; i++) { const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2]; if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z; if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z; }
  mnx -= 4; mny -= 4; mnz -= 4; mxx += 4; mxy += 4; mxz += 4;
  const nx = Math.ceil((mxx - mnx) / h) + 1, ny = Math.ceil((mxy - mny) / h) + 1, nz = Math.ceil((mxz - mnz) / h) + 1;
  if (nx * ny * nz > 6e6) return { pos: new Float32Array(0), idx: new Uint32Array(0), cls: new Uint8Array(0) };
  const D = new Float32Array(nx * ny * nz), best = new Float32Array(nx * ny * nz), near = new Int32Array(nx * ny * nz).fill(-1);
  const id = (i, j, k) => i + nx * (j + ny * k);
  for (let a = 0; a < n; a++) {
    const px = pos[3 * a], py = pos[3 * a + 1], pz = pos[3 * a + 2], R = rad[a], inv = 2 / (R * R), rc = Math.ceil(2 * R / h), cut2 = 4 * R * R;
    const ci = Math.round((px - mnx) / h), cj = Math.round((py - mny) / h), ck = Math.round((pz - mnz) / h);
    for (let k = Math.max(0, ck - rc); k <= Math.min(nz - 1, ck + rc); k++) { const dz = mnz + k * h - pz;
      for (let j = Math.max(0, cj - rc); j <= Math.min(ny - 1, cj + rc); j++) { const dy = mny + j * h - py;
        for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) { const dx = mnx + i * h - px, r2 = dx * dx + dy * dy + dz * dz;
          if (r2 > cut2) continue; const v = Math.exp(-r2 * inv), q = id(i, j, k); D[q] += v; if (v > best[q]) { best[q] = v; near[q] = a; } } } }
  }
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k), vIdx = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const P = [], C = [], keep = [], cv = new Float32Array(8), cx = centre[0], cy = centre[1], cz = centre[2], cut2 = cut * cut;
  const corner = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]], edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0; for (let c = 0; c < 8; c++) { cv[c] = D[id(i + corner[c][0], j + corner[c][1], k + corner[c][2])] - lvl; if (cv[c] > 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of edges) { if ((cv[a] > 0) === (cv[b] > 0)) continue; const t = cv[a] / (cv[a] - cv[b]);
      sx += corner[a][0] + t * (corner[b][0] - corner[a][0]); sy += corner[a][1] + t * (corner[b][1] - corner[a][1]); sz += corner[a][2] + t * (corner[b][2] - corner[a][2]); m++; }
    const x = mnx + (i + sx / m) * h, y = mny + (j + sy / m) * h, z = mnz + (k + sz / m) * h;
    vIdx[cid(i, j, k)] = P.length / 3; P.push(x, y, z);
    keep.push((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < cut2);
    let nb = -1, bv = -1; for (let c = 0; c < 8; c++) { const q = id(i + corner[c][0], j + corner[c][1], k + corner[c][2]); if (near[q] >= 0 && best[q] > bv) { bv = best[q]; nb = near[q]; } }
    C.push(nb >= 0 ? cls[nb] : 255);
  }
  const I = [], quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0 || !(keep[a] && keep[b] && keep[c] && keep[d])) return; flip ? I.push(a, c, b, a, d, c) : I.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = D[id(i, j, k)] > lvl, b = D[id(i + 1, j, k)] > lvl; if (a !== b) quad(vIdx[cid(i, j - 1, k - 1)], vIdx[cid(i, j, k - 1)], vIdx[cid(i, j, k)], vIdx[cid(i, j - 1, k)], b); }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const a = D[id(i, j, k)] > lvl, b = D[id(i, j + 1, k)] > lvl; if (a !== b) quad(vIdx[cid(i - 1, j, k - 1)], vIdx[cid(i - 1, j, k)], vIdx[cid(i, j, k)], vIdx[cid(i, j, k - 1)], b); }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const a = D[id(i, j, k)] > lvl, b = D[id(i, j, k + 1)] > lvl; if (a !== b) quad(vIdx[cid(i - 1, j - 1, k)], vIdx[cid(i, j - 1, k)], vIdx[cid(i, j, k)], vIdx[cid(i - 1, j, k)], b); }
  return { pos: new Float32Array(P), idx: new Uint32Array(I), cls: new Uint8Array(C) };
}
let pocketWorker = null, pocketSeq = 0;
const pocketWaiting = new Map();
function runPocketJob(job) {
  try {
    if (!pocketWorker) {
      const src = `const pocketSurfaceJob = ${pocketSurfaceJob.toString()};\nself.onmessage = (e) => { const r = pocketSurfaceJob(e.data.job); self.postMessage({ id: e.data.id, r }, [r.pos.buffer, r.idx.buffer, r.cls.buffer]); };`;
      pocketWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      pocketWorker.onmessage = (e) => { const f = pocketWaiting.get(e.data.id); pocketWaiting.delete(e.data.id); f && f(e.data.r); };
      pocketWorker.onerror = () => { pocketWorker = 'none'; for (const [, f] of pocketWaiting) f(null); pocketWaiting.clear(); };
    }
    if (pocketWorker !== 'none') return new Promise((ok) => { const id = ++pocketSeq; pocketWaiting.set(id, (r) => ok(r || pocketSurfaceJob(job))); pocketWorker.postMessage({ id, job }); });
  } catch (e) { pocketWorker = 'none'; }
  return new Promise((ok) => setTimeout(() => ok(pocketSurfaceJob(job)), 0));   // no worker (file:// policy etc.): same code on the main thread
}
const _fv = new THREE.Vector3();
function updateFocusLabels() {
  if (!focus) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const l of focus.labs) { _fv.copy(l.p).applyMatrix4(world.matrixWorld).project(camera);
    if (_fv.z > 1) { l.el.style.display = 'none'; continue; } l.el.style.display = ''; l.el.style.left = (_fv.x + 1) / 2 * w + 'px'; l.el.style.top = (1 - _fv.y) / 2 * h + 'px'; }
}

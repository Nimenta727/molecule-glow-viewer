/* ----------------------------------------------------------------------------- tunnel / pore search
   Path of maximal clearance through a coarse-grained structure (one point per residue: CA, or P for RNA):
   clearance(cell) = distance to the nearest residue point; Dijkstra on an h-A grid, step cost len * (1 + (12 / clearance)^4);
   cells with clearance < minClear are walls; opts.allowed(p) restricts the search (e.g. away from the small subunit);
   stops at the first cell at least minLen from the start whose clearance >= openClear (= outside, in solvent). */
function findChannel(points, start, opts = {}) {
  const h = opts.h || 2, R = opts.radius || 120, minClear = opts.minClear ?? 4.5, openClear = opts.openClear ?? 14, minLen = opts.minLen ?? 60;
  const n = Math.ceil(2 * R / h), N = n * n * n, o = start.clone().subScalar(n * h / 2);
  const cell = 8, hash = new Map(), K = (x, y, z) => x + ',' + y + ',' + z;
  for (const p of points) { if (p.distanceTo(start) > R * 1.8 + 30) continue; const k = K(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell)); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(p); }
  const clear = new Float32Array(N), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    q.set(o.x + i * h, o.y + j * h, o.z + k * h); let best = 16 * 16;   // clearance capped at 16 A (enough to tell "open")
    const cx = Math.floor(q.x / cell), cy = Math.floor(q.y / cell), cz = Math.floor(q.z / cell);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) { const L = hash.get(K(cx + dx, cy + dy, cz + dz)); if (L) for (const p of L) { const d = p.distanceToSquared(q); if (d < best) best = d; } }
    clear[(i * n + j) * n + k] = Math.sqrt(best);
  }
  const idx = (i, j, k) => (i * n + j) * n + k, s0 = Math.floor(n / 2), si = idx(s0, s0, s0);
  const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1); dist[si] = 0;
  const heap = [];
  const push = (d, c) => { heap.push([d, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  push(0, si);
  const nb = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) nb.push([dx, dy, dz, Math.hypot(dx, dy, dz) * h]);
  let goal = -1;
  while (heap.length) {
    const [d, c] = pop(); if (d > dist[c]) continue;
    const i = Math.floor(c / (n * n)), j = Math.floor(c / n) % n, k = c % n;
    q.set(o.x + i * h, o.y + j * h, o.z + k * h);
    if (opts.goal ? opts.goal(q, clear[c]) : clear[c] >= openClear && q.distanceTo(start) >= minLen) { goal = c; break; }   /* opts.goal(point, clearance): custom exit test */
    for (const [dx, dy, dz, L] of nb) {
      const a = i + dx, b = j + dy, e = k + dz; if (a < 0 || b < 0 || e < 0 || a >= n || b >= n || e >= n) continue;
      const c2 = idx(a, b, e), cl = clear[c2]; if (cl < minClear) continue;
      if (opts.allowed && !opts.allowed(q.set(o.x + a * h, o.y + b * h, o.z + e * h))) continue;
      const nd = d + L * (1 + Math.pow(12 / Math.max(cl, 0.5), 4));
      if (nd < dist[c2]) { dist[c2] = nd; prev[c2] = c; push(nd, c2); }
    }
  }
  if (goal < 0) return null;
  const path = []; for (let c = goal; c >= 0; c = prev[c]) { const i = Math.floor(c / (n * n)), j = Math.floor(c / n) % n, k = c % n; path.push({ p: new THREE.Vector3(o.x + i * h, o.y + j * h, o.z + k * h), r: clear[c] }); }
  path.reverse();
  return path.map((x, i) => { if (i === 0 || i === path.length - 1) return x; const w = path.slice(Math.max(0, i - 3), i + 4); return { p: w.reduce((s, y) => s.add(y.p), new THREE.Vector3()).multiplyScalar(1 / w.length), r: x.r }; });
}
/* point at arc length s along a polyline of {p} or Vector3 (beyond the end it continues straight) */
function alongPath(P, s, out = new THREE.Vector3()) {
  const g = (i) => P[i].p || P[i];
  if (s <= 0) return out.copy(g(0));
  let acc = 0;
  for (let i = 1; i < P.length; i++) { const a = g(i - 1), b = g(i), L = a.distanceTo(b); if (acc + L >= s) return out.copy(a).lerp(b, L ? (s - acc) / L : 0); acc += L; }
  const a = g(P.length - 2), b = g(P.length - 1);
  return out.copy(b).addScaledVector(b.clone().sub(a).normalize(), s - acc);
}
const pathLength = (P) => { let s = 0; for (let i = 1; i < P.length; i++) s += (P[i].p || P[i]).distanceTo(P[i - 1].p || P[i - 1]); return s; };


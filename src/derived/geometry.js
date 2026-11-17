/* ----------------------------------------------------------------------------- geometry helpers */
function jacobi(A) {   // symmetric n x n -> {values, vectors (columns)}
  const n = A.length, a = A.map(r => r.slice()), v = A.map((r, i) => r.map((_, j) => +(i === j)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-14) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: v };
}
function pca(points) {
  const c = new THREE.Vector3(); for (const p of points) c.add(p); c.multiplyScalar(1 / points.length);
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j]; }
  const { values, vectors } = jacobi(M);
  const order = [0, 1, 2].sort((i, j) => values[i] - values[j]);
  return { centre: c, values: order.map(i => values[i]), axes: order.map(i => new THREE.Vector3(vectors[0][i], vectors[1][i], vectors[2][i]).normalize()) };
}
/* returns a function that maps raw coordinates into the viewer frame (chosen axis -> +Y, centre -> origin) */
function orientTransform(points, mode) {
  const { centre, values, axes } = pca(points);
  if (mode === 'native') return { q: new THREE.Quaternion(), centre };
  let axis = mode === 'short' ? axes[0] : axes[2];
  if (mode === 'sym') {   // symmetry axis = the eigenvalue that differs most from the other two
    const d0 = Math.abs(values[0] - (values[1] + values[2]) / 2) / values[2], d2 = Math.abs(values[2] - (values[0] + values[1]) / 2) / values[2];
    axis = d0 > d2 ? axes[0] : axes[2];
  }
  return { q: new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0)), centre };
}
function applyTf(entry, tf) {
  const f = (p) => p.sub(tf.centre).applyQuaternion(tf.q);
  for (const a of entry.atoms) { f(a.p); if (a.p2) f(a.p2); }
  for (const L of entry.ligands) for (const x of L.atoms) f(x.p);
}
/* Horn quaternion superposition: rotation+translation that best maps B onto A */
function superpose(A, B) {
  const ca = new THREE.Vector3(), cb = new THREE.Vector3();
  A.forEach(p => ca.add(p)); B.forEach(p => cb.add(p)); ca.multiplyScalar(1 / A.length); cb.multiplyScalar(1 / B.length);
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i].clone().sub(ca), b = B[i].clone().sub(cb);
    Sxx += b.x * a.x; Sxy += b.x * a.y; Sxz += b.x * a.z; Syx += b.y * a.x; Syy += b.y * a.y; Syz += b.y * a.z; Szx += b.z * a.x; Szy += b.z * a.y; Szz += b.z * a.z;
  }
  const N = [[Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx], [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
             [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy], [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
  const { values, vectors } = jacobi(N);
  const i = values.indexOf(Math.max(...values));
  const q = new THREE.Quaternion(vectors[1][i], vectors[2][i], vectors[3][i], vectors[0][i]).normalize();
  const f = (p) => p.clone().sub(cb).applyQuaternion(q).add(ca);
  f.q = q; f.ca = ca; f.cb = cb;   // exposed for fitPose
  return f;
}
const polar = (r, phi, y) => new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
const ease = (t) => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);


/* ----------------------------------------------------------------------------- simplified representation ("简")
   The convention of structural-biology figures: a LOW-RESOLUTION MOLECULAR SURFACE per chain (ChimeraX "molmap"),
   drawn in illustrative style (flat colour + outline, cf. Goodsell's Illustrate / Mol* illustrative). It removes atomic
   bumps but keeps the real shape: domains, grooves, cavities, how subunits pack. Nothing is replaced by an invented primitive.
   Density: every residue (CA) / nucleotide (P) = a Gaussian, sigma = 0.225 x resolution (molmap's sigma factor 1/(pi*sqrt2)).
   Contour level: chosen so the enclosed volume = 136 A^3 per residue (1.35 g/cm^3 protein density; x3 per nucleotide),
   i.e. the surface has the correct molecular volume at any resolution. Iso-surface: surface nets on a grid of res/4 A. */
function lowpassSurface(P, W, res) {
  const sig = 0.225 * res, h = Math.max(1.2, res / 4), cut = 3 * sig, pad = cut + 2 * h;
  const mn = new THREE.Vector3(1e9, 1e9, 1e9), mx = new THREE.Vector3(-1e9, -1e9, -1e9);
  for (const p of P) { mn.min(p); mx.max(p); }
  mn.subScalar(pad); mx.addScalar(pad);
  const nx = Math.ceil((mx.x - mn.x) / h) + 1, ny = Math.ceil((mx.y - mn.y) / h) + 1, nz = Math.ceil((mx.z - mn.z) / h) + 1;
  const D = new Float32Array(nx * ny * nz), near = new Int32Array(nx * ny * nz).fill(-1), best = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k), inv = 1 / (2 * sig * sig), rc = Math.ceil(cut / h);
  P.forEach((p, a) => {
    const ci = Math.round((p.x - mn.x) / h), cj = Math.round((p.y - mn.y) / h), ck = Math.round((p.z - mn.z) / h), w = W[a];
    for (let k = Math.max(0, ck - rc); k <= Math.min(nz - 1, ck + rc); k++) { const dz = mn.z + k * h - p.z;
      for (let j = Math.max(0, cj - rc); j <= Math.min(ny - 1, cj + rc); j++) { const dy = mn.y + j * h - p.y;
        for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) { const dx = mn.x + i * h - p.x, r2 = dx * dx + dy * dy + dz * dz;
          if (r2 > cut * cut) continue; const v = w * Math.exp(-r2 * inv), q = id(i, j, k); D[q] += v; if (v > best[q]) { best[q] = v; near[q] = a; } } } }
  });
  // contour level from the target volume
  const target = W.reduce((s, w) => s + w, 0) * 136, nCells = Math.max(1, Math.round(target / (h * h * h)));
  const vals = D.filter(v => v > 1e-4).sort(); const level = vals.length > nCells ? vals[vals.length - nCells] : (vals[0] || 0.5) * 0.5;
  // surface nets: one vertex per cell that straddles the level, one quad per straddling grid edge
  const vIdx = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), pos = [], nearOf = [];
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const corner = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) { cv[c] = D[id(i + corner[c][0], j + corner[c][1], k + corner[c][2])] - level; if (cv[c] > 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of edges) { if ((cv[a] > 0) === (cv[b] > 0)) continue; const t = cv[a] / (cv[a] - cv[b]);
      sx += corner[a][0] + t * (corner[b][0] - corner[a][0]); sy += corner[a][1] + t * (corner[b][1] - corner[a][1]); sz += corner[a][2] + t * (corner[b][2] - corner[a][2]); m++; }
    vIdx[cid(i, j, k)] = pos.length / 3;
    pos.push(mn.x + (i + sx / m) * h, mn.y + (j + sy / m) * h, mn.z + (k + sz / m) * h);
    let nb = -1, bv = -1; for (let c = 0; c < 8; c++) { const q = id(i + corner[c][0], j + corner[c][1], k + corner[c][2]); if (near[q] >= 0 && best[q] > bv) { bv = best[q]; nb = near[q]; } }
    nearOf.push(nb);
  }
  const idx = [], quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; flip ? idx.push(a, c, b, a, d, c) : idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {   // x edges
    const a = D[id(i, j, k)] > level, b = D[id(i + 1, j, k)] > level; if (a === b) continue;
    quad(vIdx[cid(i, j - 1, k - 1)], vIdx[cid(i, j, k - 1)], vIdx[cid(i, j, k)], vIdx[cid(i, j - 1, k)], b);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {   // y edges
    const a = D[id(i, j, k)] > level, b = D[id(i, j + 1, k)] > level; if (a === b) continue;
    quad(vIdx[cid(i - 1, j, k - 1)], vIdx[cid(i - 1, j, k)], vIdx[cid(i, j, k)], vIdx[cid(i, j, k - 1)], b);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {   // z edges
    const a = D[id(i, j, k)] > level, b = D[id(i, j, k + 1)] > level; if (a === b) continue;
    quad(vIdx[cid(i - 1, j - 1, k)], vIdx[cid(i, j - 1, k)], vIdx[cid(i, j, k)], vIdx[cid(i - 1, j, k)], b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  return { geo, nearOf };
}
function surfaceMaterial(style) {
  const illus = style === 'illus' || style === 'schem';
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: illus ? 0.85 : 0.32, metalness: 0, clearcoat: illus ? 0 : 1, clearcoatRoughness: 0.2 });
  m.customProgramCacheKey = () => 'surf-' + style;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRim, uGlow; uniform vec3 uUpView;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 baseC = vColor.rgb;
        float fres = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.6);
        float up = saturate(dot(normal, uUpView) * 0.5 + 0.5);
        ${illus ? 'totalEmissiveRadiance += baseC * (0.62 + 0.12 * up); diffuseColor.rgb *= 0.2;   // flat, poster-like colour (Mol* "ignore light"-like); AO still gives soft shadows'
                : 'totalEmissiveRadiance += baseC * (uGlow * up + uRim * fres * (0.25 + 1.1 * up));'}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        ${illus ? `{ /* illustration shading: mostly flat colour + a soft key light from the upper left + darkened edges,
             so overlapping shapes (DNA gyres, touching lobes) stay readable (Goodsell / Mol* illustrative) */
             vec3 L = normalize(vec3(-0.45, 0.65, 0.6)); float lam = saturate(dot(normal, L));
             float edge = 1.0 - 0.32 * pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.0);
             gl_FragColor.rgb = baseC * (0.66 + 0.30 * lam + 0.08 * up) * edge; }` : ''}`);
  };
  return m;
}
/* outline = inverted hull: back faces pushed out along the normal, dark (the classic illustration silhouette) */
function outlineMaterial(opts = {}) {   // opts.blob: instanced residue blobs (aDelta morph + wedge cutaway)
  const m = new THREE.MeshBasicMaterial({ color: 0x0b0c14, side: THREE.BackSide });
  m.customProgramCacheKey = () => 'outline-' + (opts.blob ? 'b' : '') + (opts.cutaway ? 'c' : '') + (opts.k || '');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uCutOn: { value: opts.cutaway ? 1 : 0 } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uMorph, uCutOn; uniform vec4 uCutA, uCutB; ${opts.blob ? 'attribute vec3 aDelta;' : ''}`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0); vec3 nn = normal;
        #ifdef USE_INSTANCING
          ${opts.blob ? 'mvPosition.xyz = (instanceMatrix * mvPosition).xyz + aDelta * uMorph; mvPosition.w = 1.0;' : 'mvPosition = instanceMatrix * mvPosition;'}
          nn = mat3(instanceMatrix) * nn;
          vec3 cw0 = (modelMatrix * instanceMatrix * vec4(0,0,0,1)).xyz;
          if (uCutOn > 0.5 && dot(uCutA.xyz, cw0) + uCutA.w > 0.0 && dot(uCutB.xyz, cw0) + uCutB.w > 0.0) mvPosition = vec4(0.0, 0.0, 0.0, 1.0);
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        mvPosition.xyz += normalize(normalMatrix * nn) * (-mvPosition.z) * ${opts.k || (opts.blob ? '0.0018' : '0.0026')};   // ~constant on-screen line width
        gl_Position = projectionMatrix * mvPosition;
        gl_Position.z += 0.0015 * gl_Position.w;   // keep the hull behind the front surface (no creases on concave ribbons)`);
  };
  return m;
}
/* outline twin of any mesh (shares geometry and, for instanced meshes, the instance matrices) */
function outlineOf(mesh, opts) {
  if (illustrative()) { const e = new THREE.Group(); e.userData = { outline: true }; return e; }   // illustration: silhouettes come from the screen-space ink pass
  const o = mesh.isInstancedMesh ? new THREE.InstancedMesh(mesh.geometry, outlineMaterial(opts), mesh.count) : new THREE.Mesh(mesh.geometry, outlineMaterial(opts));
  if (mesh.isInstancedMesh) { o.instanceMatrix = mesh.instanceMatrix; o.count = mesh.count; }
  if (mesh.morphTargetInfluences) o.morphTargetInfluences = mesh.morphTargetInfluences;   // same array -> follows morphs
  o.frustumCulled = false; o.userData = { outline: true }; return o;
}
const illustrative = () => $('bgMode').value === 'light';
function chainPoints(g, asym, posOf) {
  const at = g.atoms.filter(a => a.asym === asym);
  return { at, P: at.map(posOf), W: at.map(a => a.na ? 2.4 : 1) };   // nucleotide ~330 Da at 1.7 g/cm3 ~ 320 A^3 = 2.4 residues
}
function buildSurfaces(g, colorOf, posOf = (a) => a.p) {
  const res = +$('simpRes').value, style = $('simpStyle').value, grp = new THREE.Group();
  const mat = surfaceMaterial(style), out = null,   // illustration silhouettes: InkPass
    col = new THREE.Color();
  for (const asym of [...new Set(g.atoms.map(a => a.asym))]) {
    const { at, P, W } = chainPoints(g, asym, posOf); if (at.length < 3) continue;
    const { geo, nearOf } = lowpassSurface(P, W, res);
    const cols = new Float32Array(nearOf.length * 3);
    nearOf.forEach((n, v) => { col.set(colorOf ? colorOf(at[Math.max(0, n)]) : g.color); cols[v * 3] = col.r; cols[v * 3 + 1] = col.g; cols[v * 3 + 2] = col.b; });
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
    const c = P.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / P.length);
    mesh.userData = { surface: true, asym, centre: c, key: '' };
    grp.add(mesh);
    if (out) { const o = new THREE.Mesh(geo, out); o.frustumCulled = false; o.userData = { outline: true, asym }; mesh.userData.outline = o; mesh.add(o); }
  }
  grp.userData.simple = true;
  return grp;
}

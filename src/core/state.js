/* ----------------------------------------------------------------------------- scene state */
const world = new THREE.Group(); scene.add(world);
const procRoot = new THREE.Group(); overlay.add(procRoot);   // follows world's transform every frame
let groups = [];          // protein parts: {name, color, fixed, atoms, spin, visible, ghost, mesh}
let ligGroups = [];       // static small molecules per chemical component: {comp, name, mols, visible, objs, state}
let membraneObjs = [];
let model = null, current = null, proc = null;
let theta = 0;            // rotor angle (rad)

function sphereGeo(n) {
  const q = $('quality').value;
  const d = q === 'low' ? 0 : q === 'medium' ? (n > 60000 ? 0 : 1) : (n > 600000 ? 0 : n > 150000 ? 1 : 2);
  return new THREE.IcosahedronGeometry(1, d);
}
let userQuality = null, autoQ = false, inkPR = 1;   /* inkPR: last-resort pixel ratio for the ink style on machines without a GPU (0.75 only below 8 fps) */   /* W1: the level the user chose; autoQ = the current level was set by the frame-rate guard */
function applyQuality(rebuild = true) {
  const q = $('quality').value;
  if (userQuality == null) userQuality = q;
  /* the illustration style draws ink outlines in screen space: below pixel ratio 1 they turn thick and blurry, so low keeps 1 there */
  const pr = q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'medium' ? 1 : $('bgMode').value === 'light' ? inkPR : 0.6;
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
  if (aoPass) aoPass.enabled = q !== 'low' && $('ao').checked;
  bokeh.enabled = q !== 'low' && $('dof').checked;
  if (rebuild && groups.length) { rebuildMeshes(); rebuildMembranes(); applyCut(); }
}

/* one InstancedMesh of residue blobs. scaleMul > 1 + shell = outline shell of the schematic mode */
function blobInstances(g, colorOf, material, scaleMul = 1, detail) {
  const atoms = g.atoms, n = atoms.length;
  const hot = new Float32Array(n), delta = new Float32Array(n * 3);
  atoms.forEach((a, i) => { hot[i] = a.hot || 0; if (a.p2) { delta[i * 3] = a.p2.x - a.p.x; delta[i * 3 + 1] = a.p2.y - a.p.y; delta[i * 3 + 2] = a.p2.z - a.p.z; } });
  const geo = detail === undefined ? sphereGeo(n) : new THREE.IcosahedronGeometry(1, detail);
  const mesh = new THREE.InstancedMesh(withAttrs(geo, n, hot, delta), material, n);
  const r = +$('blob').value * scaleMul;
  const scaleOf = (a) => r * (a.rf ??= 0.85 + 0.3 * randVis()) * (a.na ? 1.25 : 1);   // a.rf: fixed random size per residue
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), col = new THREE.Color();
  atoms.forEach((a, i) => {
    m.compose(a.p, q, s.setScalar(scaleOf(a))); mesh.setMatrixAt(i, m);
    col.set(colorOf ? colorOf(a) : g.color); col.offsetHSL(0, 0, ((a.rf - 1) / 0.3) * 0.06);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false;
  mesh.userData.scaleOf = scaleOf;   // used by applyBlends (per-chain conformational change)
  return mesh;
}
function buildGroup(g, colorOf) {
  const mat = blobMaterial({ cutaway: g.ghost });
  mat.clippingPlanes = planesFor(g);
  const grp = new THREE.Group(), mesh = blobInstances(g, colorOf, mat); grp.add(mesh);
  if (illustrative()) grp.add(outlineOf(mesh, { blob: true, cutaway: g.ghost }));
  return grp;
}


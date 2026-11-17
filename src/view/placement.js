/* ----------------------------------------------------------------------------- component placement */
function placeComponent(comp, atoms, ligands) {
  const ys = atoms.map(a => a.p.y), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const ak = comp.anchor ? Object.keys(model.entityStats).find(k => kwMatch(k, comp.anchor)) : null;
  const anc = ak && model.entityStats[ak];
  let dy = comp.dy || 0;
  if (anc) {
    if (comp.side === 'below') dy += anc.min - ymax - (comp.gap || 0);
    else if (comp.side === 'above') dy += anc.max - ymin + (comp.gap || 0);
    else dy += anc.mean - (ymin + ymax) / 2;
  }
  const arr = comp.arrange || { kind: 'single' };
  const copies = arr.kind === 'ring' ? arr.n : arr.kind === 'helix' ? arr.n : 1;
  const tf = (k) => {
    if (arr.kind === 'ring') { const ang = 2 * Math.PI * k / arr.n, c = Math.cos(ang), s = Math.sin(ang);
      return (p) => { const x = p.x + arr.radius; return new THREE.Vector3(x * c - p.z * s, p.y + dy, x * s + p.z * c); }; }
    if (arr.kind === 'helix') { const ang = THREE.MathUtils.degToRad(arr.twist * k), c = Math.cos(ang), s = Math.sin(ang);
      return (p) => new THREE.Vector3(p.x * c - p.z * s, p.y + arr.rise * k + dy, p.x * s + p.z * c); }
    return (p) => p.clone().add(new THREE.Vector3(0, dy, 0));
  };
  const outA = [], outL = [];
  for (let k = 0; k < copies; k++) { const f = tf(k);
    for (const a of atoms) outA.push({ ...a, asym: a.asym + '_' + k, p: f(a.p) });
    for (const L of ligands) outL.push({ ...L, atoms: L.atoms.map(x => ({ ...x, p: f(x.p) })) }); }
  return { atoms: outA, ligands: outL };
}
function nativeZtoY(entry) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
  for (const a of entry.atoms) a.p.applyQuaternion(q);
  for (const L of entry.ligands) for (const x of L.atoms) x.p.applyQuaternion(q);
}


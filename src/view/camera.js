/* ----------------------------------------------------------------------------- camera */
function resetCamera(cam) {
  if (!model) return;
  let c = cam || current?.camera || { az: -0.9, el: 0.25, dist: 1.2 };
  if (c.broadside && model.allAtoms?.length) {   // look across the long horizontal axis of the whole scene (a row of complexes in a membrane)
    const P = model.allAtoms.filter((_, i) => i % 7 === 0).map(a => new THREE.Vector3(a.p.x, 0, a.p.z)), e = pca(P).axes[2];
    c = { ...c, az: Math.atan2(-e.z, e.x) + (c.flipSide ? Math.PI : 0) };
  }
  /* fit the narrower of the two field-of-view axes (portrait / phone screens) and pad for blob / lobe size */
  const vh = THREE.MathUtils.degToRad(camera.fov / 2), half = Math.min(vh, Math.atan(Math.tan(vh) * safeAspect()));
  const R = model.focus.radius + 6, d = R / Math.sin(half) * (c.dist || 1);
  const t = model.focus.centre.clone().applyMatrix4(world.matrixWorld);
  t.y -= 0.16 * R * (c.dist || 1);   // frame the molecule in the upper ~75 % (the caption sits at the bottom)
  controls.target.copy(t);
  camera.position.set(t.x + Math.sin(c.az) * Math.cos(c.el) * d, t.y + Math.sin(c.el) * d, t.z + Math.cos(c.az) * Math.cos(c.el) * d);
  camera.near = d / 200; camera.far = d * 20; camera.updateProjectionMatrix();
  controls.update();
  if (current?.frameAll) applyCut();
}


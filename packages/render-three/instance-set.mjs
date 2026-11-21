import { planLevels, buildLevels } from './lod.mjs';

/**
 * Many copies of one prototype drawn as a few instanced meshes, one per level of detail (docs/PLUGIN_ROADMAP.md, B1). three.js is passed in (this file imports nothing), the plan is
 * packages/render-three/lod.mjs, and the viewport only has to call `update(camera, size)` before it draws and `dispose()` when the set goes.
 *
 *   spec.geometries   triangle soups (flat xyz, counter-clockwise), most detailed first (see buildLevels in lod.mjs); the colours (per vertex, rgb 0-1) are optional: spec.colors[level]
 *   spec.matrices     Float32Array(16 * n), column-major world matrices of the instances (as three.js stores them)
 *   spec.radius       bounding radius of one instance (before its own scale) in the same units as the matrices' translation; spec.scales (optional) one uniform scale per instance
 *   spec.budget       triangles per frame (Infinity = none)
 *   spec.instanceColors  optional array of '#rrggbb' per instance (tints the vertex colours)
 */
export function createInstanceSet(THREE, spec) {
  const n = spec.matrices.length / 16, group = new THREE.Group(), levels = spec.geometries.length, triangles = spec.geometries.map((g) => g.length / 9);
  const centers = new Float32Array(3 * n), radii = new Float32Array(n);
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) centers[3 * i + k] = spec.matrices[16 * i + 12 + k]; radii[i] = spec.radius * (spec.scales?.[i] ?? 1); }
  const tint = spec.instanceColors ? spec.instanceColors.map((hex) => new THREE.Color(hex)) : null;
  const meshes = spec.geometries.map((soup, level) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(soup, 3));
    if (spec.colors?.[level]) geometry.setAttribute('color', new THREE.BufferAttribute(spec.colors[level], 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ roughness: 0.65, vertexColors: Boolean(spec.colors?.[level]), color: spec.colors?.[level] ? '#ffffff' : (spec.color ?? '#8fa8c9') });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, n));
    mesh.count = 0; mesh.frustumCulled = false; mesh.userData.selectionMarker = true; mesh.userData.instanceLevel = level;
    if (tint) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * Math.max(1, n)), 3);
    group.add(mesh);
    return mesh;
  });
  let previous = null, last = null, lastKey = '';
  const color = new THREE.Color();
  return {
    group, levels, count: n, triangles,
    /** Re-plans for the camera and fills the level meshes; cheap when neither the camera nor the budget changed. Returns the plan (counts per level, drawn triangles, culled, demoted). */
    update(camera, height, budget = spec.budget ?? Infinity) {
      const position = camera.getWorldPosition(new THREE.Vector3()), direction = camera.getWorldDirection(new THREE.Vector3());
      const key = `${position.x},${position.y},${position.z}|${direction.x},${direction.y},${direction.z}|${camera.fov}|${camera.aspect}|${height}|${budget}`;
      if (key === lastKey && last) return last;
      lastKey = key;
      const plan = planLevels({ centers, radii, camera: { position: position.toArray(), direction: direction.toArray(), fov: THREE.MathUtils.degToRad(camera.fov), aspect: camera.aspect, height }, triangles, budget, previous });
      previous = plan.level;
      const fill = new Array(levels).fill(0);
      for (let i = 0; i < n; i++) {
        const level = plan.level[i]; if (level < 0) continue;
        const mesh = meshes[level], at = fill[level]++;
        mesh.instanceMatrix.array.set(spec.matrices.subarray(16 * i, 16 * i + 16), 16 * at);
        if (tint) { color.copy(tint[i]); mesh.instanceColor.array[3 * at] = color.r; mesh.instanceColor.array[3 * at + 1] = color.g; mesh.instanceColor.array[3 * at + 2] = color.b; }
      }
      meshes.forEach((mesh, level) => { mesh.count = fill[level]; mesh.instanceMatrix.needsUpdate = true; if (tint) mesh.instanceColor.needsUpdate = true; });
      last = { counts: plan.counts, culled: plan.culled, triangles: plan.triangles, demoted: plan.demoted, overBudget: plan.overBudget, instances: n };
      return last;
    },
    dispose() { for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); } group.removeFromParent(); },
  };
}

export { buildLevels };

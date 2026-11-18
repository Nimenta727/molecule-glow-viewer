import * as THREE from 'three';

const EDGES = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];

function visibleBounds(group, bounds, scratch) {
  bounds.makeEmpty();
  for (let ancestor = group; ancestor; ancestor = ancestor.parent) {
    if (!ancestor.visible) return bounds;
  }
  group.traverseVisible((object) => {
    if (!object.geometry) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    bounds.union(scratch.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));
  });
  return bounds;
}

export function createPresentationOverlay(capacity) {
  const positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({ color: '#12634e', depthTest: false });
  const object = new THREE.LineSegments(geometry, material);
  object.frustumCulled = false;
  object.renderOrder = 2;
  const bounds = new THREE.Box3();
  const scratch = new THREE.Box3();

  return {
    object,
    update(groups, highlightedIds, connections) {
      let count = 0;
      const line = (a, b) => {
        positions.setXYZ(count++, a.x, a.y, a.z);
        positions.setXYZ(count++, b.x, b.y, b.z);
      };
      const center = (id) => {
        visibleBounds(groups.get(id), bounds, scratch);
        return bounds.isEmpty() ? null : bounds.getCenter(new THREE.Vector3());
      };
      for (const { from, to } of connections) {
        const source = center(from);
        const target = center(to);
        if (!source || !target) continue;
        const direction = target.clone().sub(source);
        const length = direction.length();
        if (length < 1e-6) continue;
        direction.divideScalar(length);
        const start = source.clone().addScaledVector(direction, length * 0.18);
        const end = target.clone().addScaledVector(direction, -length * 0.18);
        const side = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
        if (side.lengthSq() < 1e-6) side.crossVectors(direction, new THREE.Vector3(1, 0, 0));
        side.setLength(length * 0.07);
        const base = end.clone().addScaledVector(direction, -length * 0.12);
        line(start, end);
        line(end, base.clone().add(side));
        line(end, base.sub(side));
      }
      for (const id of highlightedIds) {
        visibleBounds(groups.get(id), bounds, scratch);
        if (bounds.isEmpty()) continue;
        bounds.expandByScalar(bounds.getSize(new THREE.Vector3()).length() * 0.05);
        const corners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(
          (i & 1 ? bounds.max : bounds.min).x,
          (i & 2 ? bounds.max : bounds.min).y,
          (i & 4 ? bounds.max : bounds.min).z,
        ));
        for (const [a, b] of EDGES) line(corners[a], corners[b]);
      }
      geometry.setDrawRange(0, count);
      positions.needsUpdate = count > 0;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPresentationOverlay } from './presentation-overlay.mjs';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CORE_INK, createInkRenderer } from './ink-style.mjs';
import { createGlowRenderer } from './glow-style.mjs';
import { createInstanceSet } from './instance-set.mjs';
import { icosphereTriangles } from './lod.mjs';

function applyTransform(object, transform) {
  object.position.set(...transform.position);
  object.quaternion.set(...transform.rotation);
  object.scale.set(...transform.scale);
}

function isVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

function* renderables(asset, layers) {
  if (asset.kind === 'primitive') {
    const geometry = asset.shape === 'sphere' ? new THREE.SphereGeometry(0.5, 32, 20) : new THREE.BoxGeometry(1, 1, 1);
    yield new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: asset.color }));
    return;
  }
  if (!layers) throw new Error(`Missing geometry: ${asset.id}`);
  for (const { mode, positions, color: given, pointSize, pointTargets, radius, radii, ink, conformations, role, faded } of layers) {
    const color = typeof given === 'string' && /^[0-9a-f]{6}$/i.test(given) ? `#${given}` : given;   // a colour written without the leading # (the element tints of the sticks) is still a colour
    if (mode === 'spheres') {
      const geometry = new THREE.SphereGeometry(1, 12, 8);
      const surface = new THREE.InstancedMesh(geometry,
        new THREE.MeshStandardMaterial({ color, roughness: 0.84, depthTest: role !== 'functional-core' }), positions.length / 3);
      const ink = new THREE.InstancedMesh(geometry.clone(),
        new THREE.MeshBasicMaterial({ color: '#344151', side: THREE.BackSide, depthTest: role !== 'functional-core' }), positions.length / 3);
      if (role === 'functional-core') { surface.renderOrder = 10; ink.renderOrder = 9; }
      const transform = new THREE.Matrix4();
      const strokeScale = new THREE.Vector3(1.05, 1.05, 1.05);
      for (let i = 0; i < positions.length; i += 3) {
        const size = radii?.[i / 3] ?? radius;
        transform.makeScale(size, size, size).setPosition(positions[i], positions[i + 1], positions[i + 2]);
        surface.setMatrixAt(i / 3, transform);
        transform.scale(strokeScale);
        ink.setMatrixAt(i / 3, transform);
      }
      ink.userData.outlineShell = true;   // the dark shell behind a sphere layer is part of the ink style; a glow look hides it
      yield surface;
      yield ink;
      if (conformations) {
        for (const mesh of [surface, ink]) mesh.userData.conformation = {
          positions, states: conformations, radius, radii, outline: mesh === ink,
        };
      }
      continue;
    }
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (mode === 'lines') {
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
      if (conformations) lines.userData.conformation = { states: conformations };
      yield lines;
    } else if (mode === 'points') {
      const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: pointSize ?? 0.08 }));
      points.userData.pointTargets = pointTargets;
      if (conformations) points.userData.conformation = { states: conformations };
      yield points;
    } else {
      let morphStates = conformations;
      if (ink) {
        const joined = mergeVertices(geometry);
        if (conformations) {
          const sourceIndices = new Map();
          const raw = geometry.getAttribute('position');
          for (let i = 0; i < raw.count; i++) sourceIndices.set(
            [raw.getX(i), raw.getY(i), raw.getZ(i)].map((value) => Math.round(value * 1e4)).join(','), i);
          const target = joined.getAttribute('position');
          morphStates = conformations.map((state) => {
            const coordinates = [];
            for (let i = 0; i < target.count; i++) {
              const key = [target.getX(i), target.getY(i), target.getZ(i)].map((value) => Math.round(value * 1e4)).join(',');
              const source = sourceIndices.get(key) * 3;
              coordinates.push(state[source], state[source + 1], state[source + 2]);
            }
            return coordinates;
          });
        }
        geometry.dispose();
        geometry = joined;
      }
      geometry.computeVertexNormals();
      const surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
      if (faded) surface.material.color.lerp(new THREE.Color('#d6d9e0'), 0.7);
      if (morphStates) surface.userData.conformation = { states: morphStates, normals: true };
      yield surface;
      if (ink) {
        const hull = geometry.clone();
        const position = hull.getAttribute('position'), normal = hull.getAttribute('normal');
        for (let i = 0; i < position.count; i++) {
          position.setXYZ(i, position.getX(i) + normal.getX(i) * 0.012,
            position.getY(i) + normal.getY(i) * 0.012, position.getZ(i) + normal.getZ(i) * 0.012);
        }
        const outline = new THREE.Mesh(hull, new THREE.MeshBasicMaterial({ color: '#344151', side: THREE.BackSide }));
        outline.userData.outlineShell = true;
        if (morphStates) outline.userData.conformation = { states: morphStates, normals: true, outline: true };
        yield outline;
      }
    }
  }
}

export function createViewport(container, { onSelect, selectOnTap = false, TransformControls, onTransform, background = CORE_INK.background, style = 'ink' } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  camera.position.set(4, 3, 5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.localClippingEnabled = true;   // per-material clipping planes (setClipping)
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1), false);
  container.appendChild(renderer.domElement);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x697785, 2);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 7, 5);
  scene.add(key);
  const controls = new OrbitControls(camera, renderer.domElement);
  const gizmo = TransformControls ? new TransformControls(camera, renderer.domElement) : null;
  if (gizmo) {
    gizmo.setSize(0.8);
    scene.add(gizmo);
    gizmo.addEventListener('change', invalidate);
    gizmo.addEventListener('dragging-changed', ({ value }) => { controls.enabled = !value; });
    gizmo.addEventListener('mouseUp', () => {
      const object = gizmo.object;
      if (!object) return;
      onTransform?.(object.userData.nodeId, {
        position: object.position.toArray(),
        rotation: object.quaternion.toArray(),
        scale: object.scale.toArray(),
      });
    });
  }
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 0.04;
  raycaster.params.Points.threshold = 0.08;
  const pointer = new THREE.Vector2();
  let active = null;
  let ink = null;
  let disposed = false;
  let frameId;
  let transition;
  let responsiveFraming = false;
  let pointSelection;

  function setPointSelection(target) {
    pointSelection?.removeFromParent();
    if (target && active) {
      for (const mesh of active.meshes) {
        const index = mesh.userData.pointTargets?.indexOf(target) ?? -1;
        if (index < 0 || !isVisible(mesh)) continue;
        pointSelection ??= new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8),
          new THREE.MeshBasicMaterial({ color: '#e5a529', depthTest: false, wireframe: true }));
        pointSelection.renderOrder = 10;
        pointSelection.userData.pointIndex = index;
        pointSelection.scale.setScalar(Math.max(mesh.material.size * 0.7, 0.04));
        pointSelection.position.fromBufferAttribute(mesh.geometry.getAttribute('position'), index);
        mesh.add(pointSelection);
        break;
      }
    }
    invalidate();
    return Boolean(pointSelection?.parent);
  }

  /** Marks every point whose target belongs to `targets` (a Set) with a wireframe ring: the multi-object counterpart of setPointSelection. */
  let setMarkers = [];
  function setPointSelections(targets, { dim = false, markers = true } = {}) {
    restoreDimming();
    const keepNodes = new Set();
    for (const marker of setMarkers) { marker.removeFromParent(); marker.geometry.dispose(); marker.material.dispose(); }
    setMarkers = [];
    let count = 0;
    if (targets?.size && active) {
      for (const mesh of active.meshes) {
        const indices = [];
        (mesh.userData.pointTargets ?? []).forEach((target, index) => { if (target && targets.has(target)) indices.push(index); });
        if (!indices.length || !isVisible(mesh)) continue;
        if (!markers) { keepNodes.add(mesh.userData.nodeId); count += indices.length; continue; }
        const marker = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6),
          new THREE.MeshBasicMaterial({ color: '#e5a529', depthTest: false, wireframe: true }), indices.length);
        marker.renderOrder = 10;
        marker.userData.selectionMarker = true;
        marker.frustumCulled = false;
        const position = mesh.geometry.getAttribute('position'), matrix = new THREE.Matrix4(), radius = Math.max(mesh.material.size * 0.7, 0.04);
        indices.forEach((index, slot) => {
          matrix.makeScale(radius, radius, radius).setPosition(position.getX(index), position.getY(index), position.getZ(index));
          marker.setMatrixAt(slot, matrix);
        });
        mesh.add(marker);
        setMarkers.push(marker);
        keepNodes.add(mesh.userData.nodeId);
        count += indices.length;
      }
    }
    if (dim && keepNodes.size) dimOtherNodes(keepNodes);
    invalidate();
    return count;
  }

  /**
   * Ghosts every part (node) that holds none of the selected objects, as the classic viewer did: translucent, no depth writes (so no ink
   * outline), outline hulls hidden. Materials shared with a kept part stay as they are. Undone by restoreDimming().
   */
  let dimmed = [];
  function restoreDimming() {
    for (const entry of dimmed) {
      if (entry.hidden) { entry.object.visible = true; continue; }
      Object.assign(entry.material, { transparent: entry.transparent, opacity: entry.opacity, depthWrite: entry.depthWrite });
      entry.material.needsUpdate = true;
    }
    dimmed = [];
  }
  function dimOtherNodes(keepNodes) {
    if (!active) return 0;
    const visibleNodes = [...active.groups].filter(([, group]) => isVisible(group));
    if (visibleNodes.length < 2 || visibleNodes.every(([id]) => keepNodes.has(id))) return 0;
    const keepMaterials = new Set(), seen = new Set();
    for (const [id, group] of active.groups) if (keepNodes.has(id)) group.traverse((object) => { if (object.material) keepMaterials.add(object.material); });
    let count = 0;
    for (const [id, group] of visibleNodes) {
      if (keepNodes.has(id)) continue;
      count++;
      group.traverse((object) => {
        const material = object.material;
        if (!material || Array.isArray(material) || object.userData.selectionMarker) return;
        if (material.side === THREE.BackSide) { if (object.visible) { object.visible = false; dimmed.push({ object, hidden: true }); } return; }
        if (keepMaterials.has(material) || seen.has(material)) return;
        seen.add(material);
        dimmed.push({ material, transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite });
        material.transparent = true;
        material.opacity = Math.min(material.opacity, 0.14);
        material.depthWrite = false;
        material.needsUpdate = true;
      });
    }
    return count;
  }


  /**
   * Temporary placement of nodes on top of whatever pose is applied, without touching the document: an offset (translation, viewport units, in the parent's
   * space) and/or a spin (a rotation by `angle` radians about the axis { point, direction } given in the same space). The pose a node had is remembered, so
   * clearing the extras puts it back exactly. setNodeOffsets / setNodeSpins each replace their own kind of extra for every node.
   */
  const spinQuaternion = new THREE.Quaternion(), spinAxis = new THREE.Vector3(), spinPivot = new THREE.Vector3();
  function placeGroup(group) {
    const extras = group.userData.extras;
    if (!extras?.offset && !extras?.spin) {
      if (group.userData.base) { group.position.copy(group.userData.base.position); group.quaternion.copy(group.userData.base.quaternion); group.userData.base = undefined; }
      group.userData.extras = undefined;
      return;
    }
    group.userData.base ??= { position: group.position.clone(), quaternion: group.quaternion.clone() };
    const { position, quaternion } = group.userData.base;
    group.position.copy(position);
    group.quaternion.copy(quaternion);
    if (extras.spin) {
      const { axis, angle } = extras.spin;
      spinPivot.fromArray(axis.point);
      spinQuaternion.setFromAxisAngle(spinAxis.fromArray(axis.direction).normalize(), angle);
      group.position.sub(spinPivot).applyQuaternion(spinQuaternion).add(spinPivot);   // rotate the node's place about the pivot ...
      group.quaternion.premultiply(spinQuaternion);                                    // ... and its orientation with it
    }
    if (extras.offset) group.position.add(spinPivot.fromArray(extras.offset));
  }
  function setExtra(kind, values) {
    if (!active) return;
    for (const [id, group] of active.groups) {
      const next = values?.get(id), extras = group.userData.extras ?? {};
      const empty = !next || (kind === 'offset' && next.every((v) => v === 0)) || (kind === 'spin' && !next.angle);
      if (empty) delete extras[kind]; else extras[kind] = next;
      group.userData.extras = extras;
      placeGroup(group);
    }
    updateLinks();
    updatePresentationOverlay();
    invalidate();
  }
  const setNodeOffsets = (offsets) => setExtra('offset', offsets);
  /** `spins`: Map(nodeId -> { axis: { point, direction }, angle }). */
  const setNodeSpins = (spins) => setExtra('spin', spins);

  /**
   * Lines between pairs of picked points ({ a, b } are point targets of the structure); they follow the nodes when these move.
   * A pair may carry `aOffset`/`bOffset` (a vector in the point's node space, viewport units: an atom next to its residue point) and its own `color`.
   */
  let linkObject, links = [];
  function locate(target, offset) {
    for (const mesh of active?.meshes ?? []) {
      const index = mesh.userData.pointTargets?.indexOf(target) ?? -1;
      if (index >= 0) return { mesh, index, offset };
    }
    return null;
  }
  function setLinks(pairs = [], { color = '#e5a529' } = {}) {
    if (linkObject) { linkObject.removeFromParent(); linkObject.geometry.dispose(); linkObject.material.dispose(); linkObject = undefined; }
    links = [];
    if (active) {
      for (const pair of pairs) {
        const a = locate(pair.a, pair.aOffset), b = locate(pair.b, pair.bOffset);
        if (a && b) links.push({ a, b, color: pair.color ?? color });
      }
    }
    if (links.length) {
      const geometry = new THREE.BufferGeometry(), shade = new THREE.Color(), colors = new Float32Array(links.length * 6);
      links.forEach(({ color: c }, i) => { shade.set(c); colors.set([shade.r, shade.g, shade.b, shade.r, shade.g, shade.b], i * 6); });
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(links.length * 6), 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      linkObject = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }));
      linkObject.renderOrder = 11;
      linkObject.frustumCulled = false;
      linkObject.userData.selectionMarker = true;
      scene.add(linkObject);
      updateLinks();
    }
    invalidate();
    return links.length;
  }
  const linkPoint = new THREE.Vector3();
  function updateLinks() {
    if (!linkObject) return;
    const position = linkObject.geometry.getAttribute('position');
    links.forEach(({ a, b }, i) => {
      for (const [slot, end] of [[0, a], [1, b]]) {
        end.mesh.updateWorldMatrix(true, false);
        linkPoint.fromBufferAttribute(end.mesh.geometry.getAttribute('position'), end.index);
        if (end.offset) linkPoint.add(new THREE.Vector3(...end.offset));
        linkPoint.applyMatrix4(end.mesh.matrixWorld);
        position.setXYZ(i * 2 + slot, linkPoint.x, linkPoint.y, linkPoint.z);
      }
    });
    position.needsUpdate = true;
  }

  /**
   * Clipping (see clipping.mjs). `slab` (a plane) is removed from every part; `wedge` ({ planes: [two], nodeIds }) from the listed parts only, where
   * both planes clip. A part with a wedge uses it instead of the slab. Markers and links are not clipped. setClipping() removes everything.
   */
  const toPlane = ({ normal, constant }) => new THREE.Plane(new THREE.Vector3(...normal), constant);
  let slabNow = null;   // the slab planes now in force: a surface drawn after the cut is made is cut too
  function setClipping({ slab = null, wedge = null } = {}) {
    if (!active) return;
    const slabPlanes = slab ? [toPlane(slab)] : null; slabNow = slabPlanes;
    const wedgePlanes = wedge ? wedge.planes.map(toPlane) : null;
    for (const [id, group] of active.groups) {
      const planes = wedgePlanes && wedge.nodeIds.has(id) ? wedgePlanes : slabPlanes, intersection = planes === wedgePlanes && Boolean(planes);
      group.traverse((object) => {
        const material = object.material;
        if (!material || Array.isArray(material) || object.userData.selectionMarker) return;
        const before = `${material.clippingPlanes?.length ?? 0}|${material.clipIntersection}|${material.side}`;
        material.clippingPlanes = planes;
        material.clipIntersection = intersection;
        // a cut-open solid shows its inside in its own colour, not the dark outline shell behind it
        if (material.isMeshStandardMaterial) {
          if (planes && material.side === THREE.FrontSide) { material.userData.sideBeforeClip = THREE.FrontSide; material.side = THREE.DoubleSide; }
          else if (!planes && material.userData.sideBeforeClip !== undefined) { material.side = material.userData.sideBeforeClip; material.userData.sideBeforeClip = undefined; }
        }
        if (before !== `${planes?.length ?? 0}|${intersection}|${material.side}`) material.needsUpdate = true;
      });
    }
    for (const object of overlays.values()) {   // solid surfaces (overlay meshes) are cut by the slab too; a cut-open solid shows its inside
      const material = object.material; if (!material || Array.isArray(material) || !material.isMeshStandardMaterial) continue;
      material.clippingPlanes = slabPlanes; material.clipIntersection = false;
      if (slabPlanes && material.side === THREE.FrontSide) { material.userData.sideBeforeClip = THREE.FrontSide; material.side = THREE.DoubleSide; }
      else if (!slabPlanes && material.userData.sideBeforeClip !== undefined) { material.side = material.userData.sideBeforeClip; material.userData.sideBeforeClip = undefined; }
      material.needsUpdate = true;
    }
    invalidate();
  }
  /** Is this object's point removed by its material's clipping planes (a clipped residue cannot be picked)? */
  function clippedAt(object, point) {
    const planes = object.material?.clippingPlanes;
    if (!planes?.length) return false;
    const outside = planes.map((plane) => plane.distanceToPoint(point) < 0);
    return object.material.clipIntersection ? outside.every(Boolean) : outside.some(Boolean);
  }
  /** What the clipping UI needs to place planes: the model's centre and radius in viewport units, and the direction towards the camera. */
  function clipFrame() {
    if (!active) return null;
    return { center: active.center.toArray(), radius: active.radius, toViewer: camera.position.clone().sub(controls.target).toArray() };
  }

  /**
   * Small molecules drawn as ball-and-stick. An item is { geometry, target } (placed at a ligand point target) or { geometry, nodeId, position }
   * (placed at `position`, in the node's own viewport coordinates); `geometry` comes from molecule-geometry.mjs (relative to that place). They ride on
   * the node, so they follow take-apart offsets. Items belong to a `tag` (default 'default'); setMolecules([], { tag }) removes that set.
   * showMolecules(tag, visible) hides or shows a set without rebuilding it.
   */
  let molecules = [];   // [{ group, tag }]
  const sphereGeometry = new THREE.SphereGeometry(1, 12, 8), stickGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  function setMolecules(items = [], { tag = 'default' } = {}) {
    for (const entry of molecules.filter((m) => m.tag === tag)) {
      entry.group.removeFromParent();
      entry.group.traverse((object) => { if (object.isInstancedMesh) { object.material.dispose(); object.dispose(); } });
    }
    molecules = molecules.filter((m) => m.tag !== tag);
    let drawn = 0;
    for (const { target, geometry, nodeId, position } of active ? items : []) {
      const group = new THREE.Group();
      let parent;
      if (target) {
        const end = locate(target);
        if (!end) continue;
        group.position.fromBufferAttribute(end.mesh.geometry.getAttribute('position'), end.index);
        parent = end.mesh;
      } else {
        parent = active.groups.get(nodeId);
        if (!parent || !Array.isArray(position)) continue;
        group.position.fromArray(position);
      }
      const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), size = new THREE.Vector3(), color = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      const instanced = (shape, count) => {
        const mesh = new THREE.InstancedMesh(shape, new THREE.MeshStandardMaterial({ roughness: 0.6 }), Math.max(1, count));
        mesh.count = count;
        mesh.frustumCulled = false;
        mesh.userData.selectionMarker = true;   // not dimmed or clipped with the parts
        group.add(mesh);
        return mesh;
      };
      const balls = instanced(sphereGeometry, geometry.balls.length);
      geometry.balls.forEach((ball, i) => {
        matrix.compose(new THREE.Vector3(...ball.position), rotation.identity(), size.setScalar(ball.radius));
        balls.setMatrixAt(i, matrix);
        balls.setColorAt(i, color.set(ball.color));
      });
      const halves = [];
      for (const stick of geometry.sticks) {
        const a = new THREE.Vector3(...stick.a), b = new THREE.Vector3(...stick.b), mid = a.clone().add(b).multiplyScalar(0.5);
        for (const [from, colorHex] of [[a, stick.colorA], [b, stick.colorB]]) halves.push({ from, mid, radius: stick.radius, colorHex });
      }
      const sticks = instanced(stickGeometry, halves.length);
      halves.forEach(({ from, mid, radius, colorHex }, i) => {
        const direction = mid.clone().sub(from), length = direction.length();
        rotation.setFromUnitVectors(up, direction.normalize());
        matrix.compose(from.clone().add(mid).multiplyScalar(0.5), rotation, size.set(radius, length, radius));
        sticks.setMatrixAt(i, matrix);
        sticks.setColorAt(i, color.set(colorHex));
      });
      const dashes = instanced(stickGeometry, geometry.dashes.length);
      geometry.dashes.forEach((dash, i) => {
        const a = new THREE.Vector3(...dash.a), b = new THREE.Vector3(...dash.b), direction = b.clone().sub(a);
        rotation.setFromUnitVectors(up, direction.clone().normalize());
        matrix.compose(a.clone().add(b).multiplyScalar(0.5), rotation, size.set(dash.radius, direction.length(), dash.radius));
        dashes.setMatrixAt(i, matrix);
        dashes.setColorAt(i, color.set('#c9d0de'));
      });
      for (const mesh of [balls, sticks, dashes]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      parent.add(group);
      molecules.push({ group, tag });
      drawn++;
    }
    invalidate();
    return drawn;
  }
  function showMolecules(tag, visible) {
    for (const entry of molecules) if (entry.tag === tag) entry.group.visible = visible;
    invalidate();
  }

  /**
   * Free particles (solution molecules and flow streams, plugins/motion/particles.mjs). `setParticleCloud(tag, items)` replaces the set `tag` with
   * items { position, radius, color, alpha?, label? } in viewport coordinates; every item is a sphere (one instanced mesh per set) and an item with a
   * `label` also shows its name beside it. A particle that is fading in or out shrinks with its alpha. The sets are part of the picture only: not
   * dimmed or clipped with the parts, and dropped when the scene is cleared. `setParticleCloud(tag, [])` removes a set. `{ overlay: true }` draws the set over the protein (the classic
   * overlay: a particle at work stays visible inside channels); otherwise the set is hidden behind protein like everything else.
   */
  const overlays = new Map();   // tag -> Object3D hung on the active root (dashed line sets, translucent surfaces); gone with the scene
  function removeOverlay(tag) {
    const object = overlays.get(tag);
    if (!object) return;
    object.removeFromParent(); object.geometry?.dispose(); object.material?.dispose(); overlays.delete(tag);
  }
  /** Dashed lines between points of the structure (root units): segments = [{ a: [x,y,z], b: [x,y,z], color }]; an empty list removes the set. */
  function setOverlayLines(tag, segments = [], { dash = 0.012, gap = 0.009 } = {}) {
    removeOverlay(tag);
    if (!active || !segments.length) { invalidate(); return 0; }
    const geometry = new THREE.BufferGeometry(), position = new Float32Array(segments.length * 6), color = new Float32Array(segments.length * 6), shade = new THREE.Color();
    segments.forEach((segment, i) => { position.set([...segment.a, ...segment.b], i * 6); shade.set(segment.color ?? '#2f9bff'); color.set([shade.r, shade.g, shade.b, shade.r, shade.g, shade.b], i * 6); });
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    const object = new THREE.LineSegments(geometry, new THREE.LineDashedMaterial({ vertexColors: true, dashSize: dash, gapSize: gap, depthTest: false, transparent: true, opacity: 0.95 }));
    object.computeLineDistances(); object.renderOrder = 12; object.frustumCulled = false; object.userData.selectionMarker = true;
    active.root.add(object); overlays.set(tag, object); invalidate();
    return segments.length;
  }
  /** A translucent triangle surface (root units): { pos: Float32Array xyz, idx: Uint32Array, colors?: Float32Array rgb per vertex }; null removes it. */
  function setOverlayMesh(tag, surface, { opacity = 0.3, visible = true } = {}) {
    removeOverlay(tag);
    if (!active || !surface?.idx?.length) { invalidate(); return 0; }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(surface.pos, 3)); geometry.setIndex(new THREE.BufferAttribute(surface.idx, 1)); geometry.computeVertexNormals();
    if (surface.colors) geometry.setAttribute('color', new THREE.BufferAttribute(surface.colors, 3));
    const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: Boolean(surface.colors), color: surface.colors ? '#ffffff' : '#d8d1b8', transparent: opacity < 0.999, opacity, side: opacity >= 0.999 ? THREE.FrontSide : THREE.DoubleSide, depthWrite: opacity >= 0.999, roughness: 0.55 }));   // opacity 1 = a solid surface that is in the depth buffer (what a glow look needs for occlusion and depth of field)
    object.renderOrder = opacity >= 0.999 ? 0 : 4;
    if (slabNow) { object.material.clippingPlanes = slabNow; object.material.clipIntersection = false; if (object.material.side === THREE.FrontSide) { object.material.userData.sideBeforeClip = THREE.FrontSide; object.material.side = THREE.DoubleSide; } } object.visible = visible; object.frustumCulled = false; object.userData.selectionMarker = true;
    active.root.add(object); overlays.set(tag, object); invalidate();
    return surface.idx.length / 3;
  }
  function setOverlayVisible(tag, visible) { const object = overlays.get(tag); if (object) { object.visible = Boolean(visible); invalidate(); } }
  const clouds = new Map();   // tag -> { mesh, capacity, material, labels: Sprite[] }
  const cloudLabelTextures = new Map();   // "name|color" -> { texture, material }
  const cloudGeometry = new THREE.SphereGeometry(1, 10, 8);
  function cloudLabel(name, color) {
    const key = `${name}|${color}`;
    let entry = cloudLabelTextures.get(key);
    if (!entry) {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 48;
      drawParticleLabel(canvas, name, color);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      entry = { texture, material: new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }) };
      cloudLabelTextures.set(key, entry);
    }
    return entry.material;
  }
  function removeCloud(tag) {
    const cloud = clouds.get(tag);
    if (!cloud) return;
    cloud.mesh.removeFromParent(); cloud.mesh.dispose(); cloud.material.dispose();
    for (const sprite of cloud.labels) sprite.removeFromParent();
    clouds.delete(tag);
  }
  function setParticleCloud(tag, items = [], { overlay = false } = {}) {
    if (!active || !items.length) { removeCloud(tag); invalidate(); return 0; }
    let cloud = clouds.get(tag);
    if (cloud && (cloud.parent !== active.root || cloud.capacity < items.length)) { removeCloud(tag); cloud = undefined; }
    if (!cloud) {
      const capacity = Math.max(64, items.length * 2), material = new THREE.MeshBasicMaterial({ depthTest: !overlay });
      const mesh = new THREE.InstancedMesh(cloudGeometry, material, capacity);
      mesh.frustumCulled = false; mesh.userData.selectionMarker = true; mesh.userData.particleCloud = tag; mesh.renderOrder = overlay ? 20 : 5;
      active.root.add(mesh);
      cloud = { mesh, capacity, material, labels: [], parent: active.root, overlay, names: [] };
      clouds.set(tag, cloud);
    }
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), size = new THREE.Vector3(), color = new THREE.Color(), at = new THREE.Vector3();
    items.forEach((item, i) => {
      const scale = item.radius * Math.max(0.01, Math.min(1, item.alpha ?? 1));
      matrix.compose(at.fromArray(item.position), rotation, size.setScalar(scale));
      cloud.mesh.setMatrixAt(i, matrix);
      cloud.mesh.setColorAt(i, color.set(item.color));
    });
    cloud.mesh.count = items.length;
    cloud.names = items.map((item) => item.name ?? item.label ?? null);
    cloud.mesh.boundingSphere = null;   // the instances moved: let the ray test measure them again
    cloud.mesh.instanceMatrix.needsUpdate = true;
    if (cloud.mesh.instanceColor) cloud.mesh.instanceColor.needsUpdate = true;
    const labelled = items.filter((item) => item.label);
    while (cloud.labels.length > labelled.length) cloud.labels.pop().removeFromParent();
    labelled.forEach((item, i) => {
      let sprite = cloud.labels[i];
      if (!sprite) { sprite = new THREE.Sprite(); sprite.renderOrder = 21; sprite.scale.set(0.7, 0.27, 1); active.root.add(sprite); cloud.labels.push(sprite); }
      sprite.material = cloudLabel(item.label, '#2c3440');   // dark lettering: the species colour (a pale yellow for H⁺) does not read on the paper background
      sprite.position.fromArray(item.position); sprite.position.y += item.radius + 0.18;
    });
    invalidate();
    return items.length;
  }
  /**
   * The particle under a pointer event: { tag, index, name, point } or null. A set drawn behind protein (not an overlay) cannot be hit through it; an overlay
   * set (flows) can. Used for the hover / tap name card.
   */
  function pickParticle(event) {
    if (!active || disposed || !clouds.size) return null;
    const rect = renderer.domElement.getBoundingClientRect(), ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld(); active.root.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, camera);
    const bodies = raycaster.intersectObjects(active.meshes, false).filter(({ object, point }) => isVisible(object) && !clippedAt(object, point ?? new THREE.Vector3()));
    const wall = bodies.length ? bodies[0].distance : Infinity;
    for (const [tag, cloud] of clouds) {
      if (!cloud.mesh.visible) continue;
      const hit = raycaster.intersectObject(cloud.mesh, false)[0];
      if (!hit || !Number.isInteger(hit.instanceId) || !cloud.names[hit.instanceId]) continue;
      if (!cloud.overlay && hit.distance > wall) continue;
      return { tag, index: hit.instanceId, name: cloud.names[hit.instanceId], point: hit.point.toArray(), distance: hit.distance };
    }
    return null;
  }
  /**
   * Named events at a point (classic eventTag): `setEventTags(items)` shows [{ text, position, age, dur }] in viewport coordinates; each tag rises a little
   * and fades in and out over its `dur` seconds. Call it again with the current list every frame; [] removes them all.
   */
  const eventTextures = new Map(), eventSprites = [];
  function eventTexture(text) {
    let entry = eventTextures.get(text);
    if (!entry) {
      const measure = document.createElement('canvas').getContext('2d');
      measure.font = 'bold 26px sans-serif';
      const width = Math.max(64, Math.min(1024, Math.ceil(measure.measureText(text).width) + 28)), canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = 48;
      const context = canvas.getContext('2d');
      context.font = 'bold 26px sans-serif'; context.textAlign = 'center'; context.lineJoin = 'round';
      context.lineWidth = 7; context.strokeStyle = 'rgba(247, 247, 244, 0.95)'; context.strokeText(text, width / 2, 33);
      context.fillStyle = '#2c3440'; context.fillText(text, width / 2, 33);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      entry = { texture, aspect: width / 48 };
      eventTextures.set(text, entry);
    }
    return entry;
  }
  function setEventTags(items = []) {
    if (!active) items = [];
    while (eventSprites.length > items.length) { const sprite = eventSprites.pop(); sprite.removeFromParent(); sprite.material.dispose(); }
    items.forEach((item, i) => {
      let sprite = eventSprites[i];
      if (!sprite) { sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true })); sprite.renderOrder = 22; eventSprites.push(sprite); }
      if (sprite.parent !== active.root) active.root.add(sprite);
      const { texture, aspect } = eventTexture(item.text), u = Math.max(0, Math.min(1, item.age / item.dur));
      sprite.material.map = texture; sprite.material.needsUpdate = true;
      sprite.material.opacity = Math.min(1, u / 0.1, (1 - u) / 0.3);
      sprite.scale.set(0.26 * aspect, 0.26, 1);
      sprite.position.fromArray(item.position); sprite.position.y += 0.1 + 0.2 * u;
    });
    invalidate();
  }
  function clearEventTags() {
    setEventTags([]);
    for (const { texture } of eventTextures.values()) texture.dispose();
    eventTextures.clear();
  }

  /**
   * Many copies of one prototype at several levels of detail (instance-set.mjs, lod.mjs): `setInstanceSet(tag, spec)` replaces the set `tag`; the plan is redone for the camera before every draw.
   * The set hangs on the active root and is part of the picture only (not picked, dimmed or clipped with the parts). Returns { instances, levels, triangles: [per level], plan } or null when
   * nothing is loaded; `setInstanceSet(tag, null)` removes it. `instanceSetInfo(tag)` is the latest plan (counts per level, drawn triangles, culled, demoted).
   */
  const instanceSets = new Map();   // tag -> { set, budget }
  function removeInstanceSet(tag) {
    const entry = instanceSets.get(tag); if (!entry) return;
    entry.set.dispose(); instanceSets.delete(tag);
  }
  function setInstanceSet(tag, spec) {
    removeInstanceSet(tag);
    if (!active || !spec) { invalidate(); return null; }
    const set = createInstanceSet(THREE, spec);
    active.root.add(set.group); instanceSets.set(tag, { set, budget: spec.budget ?? Infinity });
    const plan = set.update(camera, container.clientHeight || 1, spec.budget ?? Infinity);
    invalidate();
    return { instances: set.count, levels: set.levels, triangles: set.triangles, plan };
  }
  const instanceSetInfo = (tag) => { const entry = instanceSets.get(tag); return entry ? entry.set.update(camera, container.clientHeight || 1, entry.budget) : null; };
  function updateInstanceSets() { for (const { set, budget } of instanceSets.values()) set.update(camera, container.clientHeight || 1, budget); }

  /**
   * The triangles of the structure as drawn now (the chosen representation, in viewport coordinates): { positions: Float32Array xyz, colors: Float32Array rgb per vertex, triangles }.
   * Instance sets, particles and other marker objects are not part of it. Used to make an instance set from what is on screen.
   */
  function collectTriangles({ maxTriangles = 400000 } = {}) {
    if (!active) return { positions: new Float32Array(0), colors: new Float32Array(0), triangles: 0 };
    active.root.updateMatrixWorld(true);
    const parts = [], spheres = []; let total = 0; const point = new THREE.Vector3(), world = new THREE.Matrix4(), one = new THREE.Matrix4(), shade = new THREE.Color();
    active.root.traverse((object) => {
      if (object.userData.selectionMarker || !object.visible) return;
      for (let parent = object.parent; parent; parent = parent.parent) if (parent.visible === false) return;
      if (object.material?.side === THREE.BackSide) return;   // the ink outline shells (a slightly larger copy facing inwards) are style, not structure
      if (object.isInstancedMesh) { if (object.geometry.type === 'SphereGeometry' && object.count) spheres.push(object); return; }   // blobs are instanced spheres: re-made below at a chosen detail
      if (!object.isMesh) return;
      const geometry = object.geometry, position = geometry.getAttribute('position'); if (!position) return;
      const index = geometry.index, count = index ? index.count : position.count, tint = geometry.getAttribute('color'), flat = new THREE.Color(object.material?.color ?? '#9aa7bd');
      const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) {
        const v = index ? index.getX(k) : k;
        point.fromBufferAttribute(position, v).applyMatrix4(object.matrixWorld); positions.set([point.x, point.y, point.z], 3 * k);
        if (tint) colors.set([tint.getX(v), tint.getY(v), tint.getZ(v)], 3 * k); else colors.set([flat.r, flat.g, flat.b], 3 * k);
      }
      parts.push({ positions, colors }); total += count;
    });
    // spheres: the finest icosphere whose total fits the budget (what is left after the ordinary meshes)
    const sphereCount = spheres.reduce((n, mesh) => n + mesh.count, 0);
    if (sphereCount) {
      let subdivisions = 0;
      for (const candidate of [2, 1]) if (sphereCount * 20 * 4 ** candidate * 3 + total <= maxTriangles * 3) { subdivisions = candidate; break; }
      const unit = icosphereTriangles(subdivisions), vertices = unit.length / 3;
      for (const mesh of spheres) {
        const positions = new Float32Array(mesh.count * unit.length), colors = new Float32Array(mesh.count * unit.length), tint = mesh.instanceColor, flat = new THREE.Color(mesh.material?.color ?? '#9aa7bd');
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, one); world.multiplyMatrices(mesh.matrixWorld, one);
          if (tint) shade.fromBufferAttribute(tint, i); else shade.copy(flat);
          for (let k = 0; k < vertices; k++) { point.set(unit[3 * k], unit[3 * k + 1], unit[3 * k + 2]).applyMatrix4(world); const at = (i * vertices + k) * 3; positions.set([point.x, point.y, point.z], at); colors.set([shade.r, shade.g, shade.b], at); }
        }
        parts.push({ positions, colors }); total += mesh.count * vertices;
      }
    }
    const positions = new Float32Array(total * 3), colors = new Float32Array(total * 3); let at = 0;
    for (const part of parts) { positions.set(part.positions, at); colors.set(part.colors, at); at += part.positions.length; }
    return { positions, colors, triangles: Math.floor(total / 3) };
  }

  /**
   * Draws the scene for `ms` milliseconds while turning the camera slowly about its target and records how long each frame took; the page's own frame rate (capped by the display's refresh rate) is
   * what is measured. Returns { rendererName (the GPU string WebGL reports, or the software rasteriser's), frames: [ms per frame] }. Used by the benchmark command (budget.mjs does the reading).
   */
  async function benchmark({ ms = 3000 } = {}) {
    const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info'), rendererName = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), frames = [], axis = new THREE.Vector3(0, 1, 0);
    const home = camera.position.clone(); let last = performance.now(); const start = last;
    await new Promise((resolve) => {
      const step = (now) => {
        frames.push(now - last); last = now;
        const offset = camera.position.clone().sub(controls.target).applyAxisAngle(axis, 0.01); camera.position.copy(controls.target).add(offset); controls.update(); camera.updateMatrixWorld(); draw();
        if (now - start < ms) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    camera.position.copy(home); controls.update(); invalidate();
    frames.shift();   // the first interval includes the wait for the first frame
    return { rendererName, frames };
  }

  function clearParticleClouds() {
    clearEventTags();
    for (const tag of [...instanceSets.keys()]) removeInstanceSet(tag);
    for (const tag of [...overlays.keys()]) removeOverlay(tag);
    for (const tag of [...clouds.keys()]) removeCloud(tag);
    for (const { texture, material } of cloudLabelTextures.values()) { texture.dispose(); material.dispose(); }
    cloudLabelTextures.clear();
  }

  /** Moves the camera to look at a point target from the current direction, close enough for something `extent` (viewport units) across. */
  function focusPoint(target, extent = 0.5) {
    const end = locate(target);
    if (!end) return false;
    end.mesh.updateWorldMatrix(true, false);
    const point = new THREE.Vector3().fromBufferAttribute(end.mesh.geometry.getAttribute('position'), end.index).applyMatrix4(end.mesh.matrixWorld);
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = Math.max(extent * 2.4, 0.3);
    setCamera({ position: point.clone().addScaledVector(direction, distance).toArray(), target: point.toArray() });
    return true;
  }

  function setNodeVisibility(ids, visible) {
    for (const id of ids) {
      const group = active?.groups.get(id);
      if (group) group.visible = visible;
    }
    updatePresentationOverlay();
    invalidate();
  }

  function invalidate() {
    if (disposed || frameId !== undefined) return;
    frameId = requestAnimationFrame((now) => {
      frameId = undefined;
      if (transition) {
        const { from, to, direction, rotation, start, duration } = transition;
        const progress = THREE.MathUtils.clamp((now - start) / duration, 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        const target = from.target.clone().lerp(to.target, eased);
        const distance = THREE.MathUtils.lerp(from.position.distanceTo(from.target), to.position.distanceTo(to.target), eased);
        const position = direction.clone().applyQuaternion(new THREE.Quaternion().slerp(rotation, eased))
          .multiplyScalar(distance).add(target);
        if (progress === 1) applyCamera(to.position, to.target);
        else applyCamera(position, target);
        if (progress === 1) transition = undefined;
        else invalidate();
      }
      draw();
    });
  }
  function draw() {
    updateInstanceSets();
    if (glow) glow.render();
    else if (ink) ink.render();
    else renderer.render(scene, camera);
  }
  controls.addEventListener('change', invalidate);
  controls.addEventListener('start', cancelCameraTransition);

  function fitAngle(aspect = camera.aspect) {
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    return Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
  }

  function resize() {
    if (disposed) return;
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const aspect = width / height;
    if (responsiveFraming && aspect !== camera.aspect) {
      const pose = transition?.to ?? { position: camera.position, target: controls.target };
      const multiplier = Math.sin(fitAngle()) / Math.sin(fitAngle(aspect));
      const position = pose.position.clone().sub(pose.target).multiplyScalar(multiplier).add(pose.target);
      cancelCameraTransition();
      applyCamera(position, pose.target);
    }
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    ink?.setSize(width, height);
    glow?.setSize(width, height);
    invalidate();
  }
  // A look (see plugins/structure/look-packs.mjs): { kind: 'glow', background, fog, ao, rim, dof, vignette, exposure, saturation, lights } replaces the ink style until setLook(null).
  let glow = null, look = null, outlines = true;
  const lightDefaults = { hemisphere: hemisphere.intensity, key: key.intensity };
  function applyOutlines() {
    if (!active) return;
    active.root.traverse((object) => { if (object.userData.outlineShell) object.visible = outlines; });
  }
  function setLook(next) {
    if (next === null || next === undefined) {
      glow?.dispose(); glow = null; look = null; outlines = true;
      hemisphere.intensity = lightDefaults.hemisphere; key.intensity = lightDefaults.key;
      scene.background = new THREE.Color(ink ? ink.style.background : background); applyOutlines(); invalidate(); return null;
    }
    if (next.kind !== 'glow') throw new Error(`Unknown look kind: ${String(next.kind)}`);
    if (!glow) {
      glow = createGlowRenderer({ renderer, scene, camera, look: next, getFocus: () => ({ distance: Math.max(camera.position.distanceTo(controls.target), 1e-3), radius: active?.radius ?? 0 }) });
      if (!glow) throw new Error('这个显卡/环境不支持景深所需的深度纹理。');
    } else glow.setStyle(next);
    look = next; outlines = false;
    const lights = { ...lightDefaults, ...next.lights }; hemisphere.intensity = lights.hemisphere; key.intensity = lights.key;
    applyOutlines(); invalidate(); return glow.style;
  }
  if (style === 'ink') {
    ink = createInkRenderer({ renderer, scene, camera,
      getFocus: () => ({ distance: Math.max(camera.position.distanceTo(controls.target), 1e-3), radius: active?.radius ?? 0 }) });
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  resize();

  function pick(event) {
    if (!active || disposed || event.button !== 0 || gizmo?.axis) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    active.root.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(active.meshes, false).filter(({ object, index, point }) =>
      isVisible(object) && !clippedAt(object, point ?? new THREE.Vector3()));
    const hit = hits.find(({ object, index }) => object.userData.pointTargets?.[index]) ?? hits[0];
    const target = hit?.object.userData.pointTargets?.[hit.index];
    const point = target && new THREE.Vector3()
      .fromBufferAttribute(hit.object.geometry.getAttribute('position'), hit.index)
      .applyMatrix4(hit.object.matrixWorld).toArray();
    onSelect?.(hit?.object.userData.nodeId ?? null, target, point);
  }
  let pressed;
  function pointerDown(event) {
    if (!selectOnTap) return pick(event);
    pressed = event.isPrimary && event.button === 0
      ? { id: event.pointerId, x: event.clientX, y: event.clientY }
      : undefined;
  }
  function movedBeyondTap(event) {
    return Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5;
  }
  function pointerMove(event) {
    if (pressed?.id === event.pointerId && movedBeyondTap(event)) cancelPick();
  }
  function pointerUp(event) {
    if (pressed?.id !== event.pointerId) return;
    const tap = !movedBeyondTap(event);
    cancelPick();
    if (tap) pick(event);
  }
  function cancelPick() { pressed = undefined; }
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  if (selectOnTap) {
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', cancelPick);
  }

  function disposeHandle(handle) {
    if (handle.disposed) return;
    handle.disposed = true;
    if (handle.meshes.includes(pointSelection?.parent)) pointSelection.removeFromParent();
    handle.root.removeFromParent();
    handle.overlay?.dispose();
    if (active === handle) active = null;
    const geometries = new Set(), materials = new Set();
    for (const mesh of handle.meshes) {
      if (mesh.isInstancedMesh) mesh.dispose();
      geometries.add(mesh.geometry);
      materials.add(mesh.material);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    handle.particleGeometry?.dispose();
    handle.moleculeGeometry?.dispose();
    for (const mesh of handle.moleculeMeshes ?? []) { mesh.dispose(); mesh.material.dispose(); }
    for (const geometry of handle.bondGeometries ?? []) geometry.dispose();
    for (const geometry of handle.membraneGeometries ?? []) geometry.dispose();
    for (const material of handle.particleMaterials ?? []) material.dispose();
    for (const texture of handle.particleTextures ?? []) texture.dispose();
    invalidate();
  }

  function prepare(document, geometryLayers = new Map(), { overlayCapacity = 0, particles = [], particleParentId, membrane } = {}) {
    if (disposed) throw new Error('Viewport is disposed');
    const root = new THREE.Group();
    const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
    const templates = new Map();
    const groups = new Map();
    const meshes = [];
    const handle = { root, meshes, particleTextures: [], particleMaterials: [], disposed: false, dispose: () => disposeHandle(handle) };
    try {
      for (const node of document.nodes) {
        const group = new THREE.Group();
        group.name = node.name || node.id;
        group.userData.nodeId = node.id;
        group.visible = node.visible !== false;
        applyTransform(group, node.transform);
        groups.set(node.id, group);
        if (node.assetId) {
          const asset = assets.get(node.assetId);
          if (!asset) throw new Error(`Missing asset: ${node.assetId}`);
          const shared = templates.get(asset.id);
          const objects = shared ? shared.map((mesh) => {
            const copy = mesh.clone(false);
            copy.userData.pointTargets = mesh.userData.pointTargets;
            return copy;
          }) : [...renderables(asset, geometryLayers.get(asset.id))];
          if (!shared) templates.set(asset.id, objects);
          for (const mesh of objects) {
            mesh.userData.nodeId = node.id;
            group.add(mesh);
            meshes.push(mesh);
          }
        }
      }
      for (const node of document.nodes) {
        const parent = node.parentId == null ? root : groups.get(node.parentId);
        if (!parent) throw new Error(`Missing parent: ${node.parentId}`);
        parent.add(groups.get(node.id));
      }
      handle.pose = new Map(document.nodes.map((node) => [node.id, node.transform]));
      const bounds = new THREE.Box3().setFromObject(root);
      if (!bounds.isEmpty()) {
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        handle.center = center;
        handle.radius = Math.max(size.length() * 0.55, 0.5);
      } else {
        handle.center = new THREE.Vector3();
        handle.radius = 2;
      }
      handle.groups = groups;
      if (particles.length) prepareParticles(handle, particles, particleParentId, membrane);
      if (overlayCapacity) {
        handle.overlay = createPresentationOverlay(overlayCapacity);
        handle.root.add(handle.overlay.object);
      }
      return handle;
    } catch (error) {
      disposeHandle(handle);
      throw error;
    }
  }

  function commit(prepared) {
    if (disposed) throw new Error('Viewport is disposed');
    if (!prepared || prepared.disposed) throw new Error('Prepared scene is disposed');
    if (active === prepared) return;
    const previous = active;
    cancelPick();
    cancelCameraTransition();
    responsiveFraming = false;
    gizmo?.detach();
    scene.add(prepared.root);
    active = prepared;
    applyOutlines();
    clearParticleClouds();   // the sets hung on the previous scene's root; the Viewer puts its particles back after a rebuild
    fitCamera(prepared);
    if (previous) disposeHandle(previous);
    invalidate();
  }

  function fitCamera(handle = active, { direction = [1, 0.72, 1], distanceScale = 1 } = {}) {
    if (!handle) return;
    const axis = new THREE.Vector3(...direction).normalize();
    if (!axis.lengthSq()) axis.set(1, 0.72, 1).normalize();
    const multiplier = Number.isFinite(distanceScale) && distanceScale > 0 ? distanceScale : 1;
    const distance = Math.max(multiplier * handle.radius / Math.sin(fitAngle()), 1);
    const position = handle.center.clone().addScaledVector(axis, distance);
    setCamera({ position: position.toArray(), target: handle.center.toArray() });
  }

  function applyPose(pose) {
    if (!active) return;
    for (const [id, group] of active.groups) {
      applyTransform(group, pose?.get(id) ?? active.pose.get(id));
      group.userData.base = undefined;   // the pose was just reset: the extras go on top of it again
      if (group.userData.extras) placeGroup(group);
    }
    updateLinks();
    updatePresentationOverlay();
    invalidate();
  }

  /**
   * Moves every layer that carries `conformations` (states) to `phase`: { from, to, fraction } between two states, or { weights } for a blend of
   * several. Used by the mechanism players and by the generic conformation morph (setConformation).
   */
  function applyConformation(phase) {
    if (!active || !phase) return;
    for (const mesh of active.meshes) {
      const morph = mesh.userData.conformation;
      if (!morph) continue;
      const a = phase.weights ? Float32Array.from(morph.states[0], (_, i) =>
        phase.weights.reduce((sum, weight, state) => sum + weight * morph.states[state][i], 0)) : morph.states[phase.from];
      const b = phase.weights ? a : morph.states[phase.to ?? (phase.from + 1) % 3];
      const fraction = phase.weights ? 0 : phase.fraction;
      if (mesh.isInstancedMesh) {
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < a.length; i += 3) {
          const radius = (morph.radii?.[i / 3] ?? morph.radius) * (morph.outline ? 1.05 : 1);
          matrix.makeScale(radius, radius, radius).setPosition(
            a[i] + (b[i] - a[i]) * fraction,
            a[i + 1] + (b[i + 1] - a[i + 1]) * fraction,
            a[i + 2] + (b[i + 2] - a[i + 2]) * fraction);
          mesh.setMatrixAt(i / 3, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      } else {
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < a.length; i++) position.array[i] = a[i] + (b[i] - a[i]) * fraction;
        position.needsUpdate = true;
        if (morph.normals) mesh.geometry.computeVertexNormals();
        if (morph.outline) {
          const normal = mesh.geometry.getAttribute('normal');
          for (let i = 0; i < position.count; i++) position.setXYZ(i,
            position.getX(i) + normal.getX(i) * 0.012, position.getY(i) + normal.getY(i) * 0.012,
            position.getZ(i) + normal.getZ(i) * 0.012);
        }
      }
      mesh.frustumCulled = false;
    }
  }
  /** Between the first two states of every layer that has them: 0 = the structure as loaded, 1 = the second conformation. */
  function setConformation(fraction) {
    applyConformation({ from: 0, to: 1, fraction: Math.min(1, Math.max(0, fraction)) });
    invalidate();
  }

  function setMechanism(snapshot) {
    if (!active) return;
    applyPose(snapshot?.transforms);
    const highlighted = new Set(snapshot?.highlightedIds);
    for (const mesh of active.meshes) if (mesh.material.emissive) {
      mesh.material.emissive.set(highlighted.has(mesh.userData.nodeId) ? '#5a3d0d' : '#000000');
      mesh.material.emissiveIntensity = 0.35;
    }
    applyConformation(snapshot?.conformation);
    if (pointSelection?.parent && Number.isSafeInteger(pointSelection.userData.pointIndex)) {
      pointSelection.position.fromBufferAttribute(pointSelection.parent.geometry.getAttribute('position'), pointSelection.userData.pointIndex);
    }
    if (active.particles) {
      for (const [index, marker] of active.particles.entries()) {
        const particle = snapshot?.particles[index];
        marker.visible = Boolean(particle) && particle.visible !== false;
        if (particle) {
          marker.position.fromArray(particle.position);
          if (marker.userData.name !== particle.name) {
            marker.userData.name = particle.name;
            marker.material.color.set(particle.color);
            const { canvas, texture } = marker.userData;
            drawParticleLabel(canvas, particle.name, particle.color);
            texture.needsUpdate = true;
            updateParticleMolecule(marker, particle);
          }
        }
      }
    }
    invalidate();
  }

  function drawParticleLabel(canvas, name, color) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 128, 48);
    // Lettering with a paper-coloured halo instead of an opaque box, so the label reads on any background without a frame.
    context.font = 'bold 28px sans-serif'; context.textAlign = 'center'; context.lineJoin = 'round';
    context.lineWidth = 7; context.strokeStyle = 'rgba(247, 247, 244, 0.95)'; context.strokeText(name, 64, 34);
    context.fillStyle = color; context.fillText(name, 64, 34);
  }

  function updateParticleMolecule(marker, particle) {
    const atoms = particle.molecule ?? [];
    const { body, bonds } = marker.userData;
    body.count = Math.min(atoms.length, 64);
    marker.material.visible = !atoms.length;
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    const elementColors = { O: '#dc5663', N: '#5c78c3', P: '#d49b38', S: '#b5a73b' };
    for (let i = 0; i < body.count; i++) {
      matrix.makeScale(0.04, 0.04, 0.04).setPosition(...atoms[i].position);
      body.setMatrixAt(i, matrix);
      body.setColorAt(i, color.set(elementColors[atoms[i].element] ?? particle.color));
    }
    body.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    const positions = bonds.geometry.getAttribute('position');
    let offset = 0;
    for (let i = 0; i < body.count; i++) for (let j = i + 1; j < body.count; j++) {
      const a = atoms[i].position, b = atoms[j].position;
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (distance < 0.02 || distance > 0.095 || offset + 6 > positions.array.length) continue;
      positions.array.set(a, offset); positions.array.set(b, offset + 3); offset += 6;
    }
    positions.needsUpdate = true;
    bonds.geometry.setDrawRange(0, offset / 3);
  }

  function prepareParticles(handle, particles, parentId, membrane) {
    const parent = handle.groups.get(parentId) ?? handle.root;
    const geometry = new THREE.SphereGeometry(0.07, 12, 8);
    handle.moleculeGeometry = new THREE.SphereGeometry(1, 8, 6);
    handle.moleculeMeshes = [];
    handle.bondGeometries = [];
    handle.particles = particles.map((particle) => {
      const { name, position, color } = particle;
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const marker = new THREE.Mesh(geometry, material);
      marker.renderOrder = 20;
      marker.position.fromArray(position);
      parent.add(marker);
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 48;
      drawParticleLabel(canvas, name, color);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      // depthWrite off: a label must not enter the depth buffer, or the ink pass draws its quad as a framed box.
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }));
      label.renderOrder = 21;
      label.scale.set(0.42, 0.16, 1); label.position.y = 0.16;
      marker.add(label);
      marker.userData = { name, canvas, texture };
      const body = new THREE.InstancedMesh(handle.moleculeGeometry,
        new THREE.MeshBasicMaterial({ depthTest: false }), 64);
      body.renderOrder = 20; body.frustumCulled = false;
      const bondGeometry = new THREE.BufferGeometry();
      bondGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1536), 3));
      const bondMaterial = new THREE.LineBasicMaterial({ color: '#67727f', depthTest: false });
      const bonds = new THREE.LineSegments(bondGeometry, bondMaterial);
      bonds.renderOrder = 19; bonds.frustumCulled = false;
      marker.add(body, bonds);
      Object.assign(marker.userData, { body, bonds });
      handle.moleculeMeshes.push(body); handle.bondGeometries.push(bondGeometry);
      handle.particleMaterials.push(bondMaterial);
      updateParticleMolecule(marker, particle);
      handle.particleTextures.push(texture);
      handle.particleMaterials.push(material, label.material);
      return marker;
    });
    handle.particleGeometry = geometry;
    if (membrane) {
      const normal = new THREE.Vector3(...membrane.axis).normalize();
      for (const side of [-1, 1]) {
        const geometry = new THREE.RingGeometry(membrane.radius * 0.47, membrane.radius, 64);
        const material = new THREE.MeshBasicMaterial({ color: '#c7d9cf', transparent: true, opacity: 0.35,
          side: THREE.DoubleSide, depthWrite: false });
        const sheet = new THREE.Mesh(geometry, material);
        sheet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        sheet.position.fromArray(membrane.center).addScaledVector(normal, side * 0.65);
        parent.add(sheet);
        handle.particleMaterials.push(material);
        handle.membraneGeometries ??= [];
        handle.membraneGeometries.push(geometry);
      }
    }
  }

  function updatePresentationOverlay() {
    const presentation = active?.presentation;
    if (!presentation) return;
    active.root.updateMatrixWorld(true);
    active.overlay?.update(active.groups, presentation.highlightedIds, presentation.connections);
  }

  function setPresentation({ rootId, highlightedIds = [], connections = [] }) {
    if (!active?.overlay) return;
    const root = active.groups.get(rootId);
    const visible = new Set([rootId, ...highlightedIds, ...connections.flatMap(({ from, to }) => [from, to])]);
    for (const mesh of active.meshes) {
      mesh.visible = !root;
      for (let group = mesh.parent; !mesh.visible && group && group !== active.root; group = group.parent) {
        if (visible.has(group.userData.nodeId)) mesh.visible = true;
      }
    }
    active.presentation = { highlightedIds, connections };
    updatePresentationOverlay();
    invalidate();
  }

  function clear() {
    setLinks([]);
    for (const tag of new Set(molecules.map((m) => m.tag))) setMolecules([], { tag });
    clearParticleClouds();
    cancelPick();
    cancelCameraTransition();
    responsiveFraming = false;
    gizmo?.detach();
    if (active) disposeHandle(active);
    controls.target.set(0, 0, 0);
    camera.position.set(4, 3, 5);
    controls.update();
    invalidate();
  }

  function resetCamera(options) { fitCamera(active, options); }
  function getCamera({ destination = false } = {}) {
    const pose = (destination && transition?.to) || { position: camera.position, target: controls.target };
    return {
      position: pose.position.toArray(), target: pose.target.toArray(),
      ...(destination ? { aspect: camera.aspect } : {}),
    };
  }

  function cancelCameraTransition() { transition = undefined; }

  function applyCamera(position, target) {
    camera.position.copy(position);
    controls.target.copy(target);
    const distance = camera.position.distanceTo(controls.target);
    camera.near = Math.max(distance / 1000, 0.001);
    camera.far = Math.max(distance * 100, 100);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function setCamera({ position, target, aspect }, { duration = 0, responsive = false } = {}) {
    cancelCameraTransition();
    responsiveFraming = responsive;
    const to = { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) };
    if (responsive && aspect > 0 && aspect !== camera.aspect) {
      to.position.sub(to.target).multiplyScalar(Math.sin(fitAngle(aspect)) / Math.sin(fitAngle())).add(to.target);
    }
    if (duration > 0) {
      const from = { position: camera.position.clone(), target: controls.target.clone() };
      const direction = from.position.clone().sub(from.target).normalize();
      const endDirection = to.position.clone().sub(to.target).normalize();
      transition = {
        from, to, direction, rotation: new THREE.Quaternion().setFromUnitVectors(direction, endDirection),
        start: performance.now(), duration,
      };
    } else applyCamera(to.position, to.target);
    invalidate();
  }

  // `minRadiusFraction` keeps context in view: the frame is never tighter than that fraction of the whole scene's radius.
  function focusNode(id, { bookmark, duration = 0, includeIds = [], minRadiusFraction = 0 } = {}) {
    const object = active?.groups.get(id);
    if (!object) return false;
    object.updateWorldMatrix(true, false);
    const bounds = new THREE.Box3().setFromObject(object);
    const extra = new THREE.Box3();
    for (const nodeId of includeIds) {
      const related = active.groups.get(nodeId);
      if (!related) continue;
      related.updateWorldMatrix(true, false);
      bounds.union(extra.setFromObject(related));
    }
    const sphere = bounds.isEmpty()
      ? new THREE.Sphere(object.getWorldPosition(new THREE.Vector3()), 0.25)
      : bounds.getBoundingSphere(new THREE.Sphere());
    const target = bookmark ? new THREE.Vector3(...bookmark.target) : sphere.center;
    const offset = bookmark
      ? new THREE.Vector3(...bookmark.position).sub(target)
      : camera.position.clone().sub(controls.target);
    if (offset.lengthSq() === 0) offset.set(1, 0.72, 1);
    const radius = Math.max(0.25, sphere.radius + sphere.center.distanceTo(target), (active?.radius ?? 0) * minRadiusFraction);
    const distance = Math.max(bookmark ? offset.length() : 0, radius / Math.sin(fitAngle()) * 1.06);
    const position = offset.setLength(distance).add(target);
    setCamera({ position: position.toArray(), target: target.toArray() }, { duration, responsive: true });
    return true;
  }

  function orbitBy(angle, { duration = 0 } = {}) {
    const pose = getCamera({ destination: true });
    const target = new THREE.Vector3(...pose.target);
    const position = new THREE.Vector3(...pose.position).sub(target)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(target);
    setCamera({ ...pose, position: position.toArray() }, { duration, responsive: responsiveFraming });
  }

  function setSelection(id) {
    if (!gizmo) return;
    const object = active?.groups.get(id);
    if (object) gizmo.attach(object);
    else gizmo.detach();
    invalidate();
  }

  function setGizmoMode(mode) {
    gizmo?.setMode(mode);
    invalidate();
  }

  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointerdown', pointerDown);
    renderer.domElement.removeEventListener('dblclick', recentreOnDoubleClick);
    renderer.domElement.removeEventListener('pointermove', pointerMove);
    renderer.domElement.removeEventListener('pointerup', pointerUp);
    renderer.domElement.removeEventListener('pointercancel', cancelPick);
    controls.removeEventListener('change', invalidate);
    controls.removeEventListener('start', cancelCameraTransition);
    gizmo?.dispose();
    pointSelection?.geometry.dispose();
    pointSelection?.material.dispose();
    controls.dispose();
    ink?.dispose();
    glow?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  function snapshot(width, { clean = false } = {}) {
    if (disposed) throw new Error('视口已关闭。');
    const helpers = clean && gizmo ? gizmo.visible : undefined;   // `clean`: the transform gizmo is not part of a figure
    if (clean && gizmo) gizmo.visible = false;
    try { draw(); } finally { if (clean && gizmo) gizmo.visible = helpers; }
    const source = renderer.domElement;
    if (width == null || width === source.width) return source.toDataURL('image/png');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(width * source.height / source.width));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  // ---- free navigation: what the left button does, buttons that move the view, standard views, and re-centring on a point (double click) ----
  controls.screenSpacePanning = true;   // panning slides the view in the screen plane, not along the ground
  controls.zoomToCursor = true;         // the wheel zooms toward the point under the pointer, so the centre can be steered while zooming
  const NAVIGATION = { rotate: THREE.MOUSE.ROTATE, pan: THREE.MOUSE.PAN, zoom: THREE.MOUSE.DOLLY };
  let navigationMode = 'rotate';
  function setNavigationMode(mode) {
    if (!Object.hasOwn(NAVIGATION, mode)) throw new RangeError('mode must be rotate, pan or zoom');
    navigationMode = mode; controls.mouseButtons.LEFT = NAVIGATION[mode];
    controls.touches.ONE = mode === 'pan' ? THREE.TOUCH.PAN : mode === 'zoom' ? THREE.TOUCH.DOLLY_PAN : THREE.TOUCH.ROTATE;
    return navigationMode;
  }
  const frameOf = () => { const pose = getCamera({ destination: true }), position = new THREE.Vector3(...pose.position), target = new THREE.Vector3(...pose.target), back = position.clone().sub(target), distance = Math.max(back.length(), 1e-6), forward = back.clone().negate().normalize(), right = new THREE.Vector3().crossVectors(forward, camera.up).normalize(), up = new THREE.Vector3().crossVectors(right, forward).normalize(); return { pose, position, target, distance, forward, right, up }; };
  /** Slides the view in the screen plane; dx and dy are fractions of the view height (positive: the scene moves right / up). */
  function panBy(dx, dy, { duration = 0 } = {}) {
    const f = frameOf(), height = 2 * f.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), move = f.right.clone().multiplyScalar(-dx * height).add(f.up.clone().multiplyScalar(-dy * height));
    setCamera({ ...f.pose, position: f.position.clone().add(move).toArray(), target: f.target.clone().add(move).toArray() }, { duration });
  }
  /** Turns the view around the rotation centre by azimuth (around the up axis) and elevation (up and down), in radians. */
  function rotateBy(azimuth, elevation = 0, { duration = 0 } = {}) {
    const f = frameOf(); let back = f.position.clone().sub(f.target).applyAxisAngle(camera.up, -azimuth);
    const right = new THREE.Vector3().crossVectors(camera.up, back).normalize(); back = back.applyAxisAngle(right, -elevation);
    if (Math.abs(back.clone().normalize().dot(camera.up)) > 0.995) return;   // never flip over the pole
    setCamera({ ...f.pose, position: f.target.clone().add(back).toArray() }, { duration });
  }
  function zoomBy(factor, { duration = 0 } = {}) {
    if (!(factor > 0)) throw new RangeError('factor must be positive');
    const f = frameOf(); setCamera({ ...f.pose, position: f.target.clone().add(f.position.clone().sub(f.target).multiplyScalar(factor)).toArray() }, { duration });
  }
  /** Makes `point` the rotation centre without changing the distance or the viewing direction. */
  function recentre(point, { duration = 250 } = {}) {
    const f = frameOf(), to = new THREE.Vector3(...point); setCamera({ ...f.pose, position: to.clone().add(f.position.clone().sub(f.target)).toArray(), target: to.toArray() }, { duration });
  }
  const VIEW_DIRECTIONS = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
  function setViewDirection(name, { duration = 300 } = {}) {
    if (!Object.hasOwn(VIEW_DIRECTIONS, name)) throw new RangeError('view must be front, back, left, right, top or bottom');
    const f = frameOf(), direction = new THREE.Vector3(...VIEW_DIRECTIONS[name]).normalize();
    if (Math.abs(direction.dot(camera.up)) > 0.99) direction.add(new THREE.Vector3(0, 0, 1e-3)).normalize();   // looking straight along the up axis needs a tiny tilt
    setCamera({ ...f.pose, position: f.target.clone().add(direction.multiplyScalar(f.distance)).toArray() }, { duration });
  }
  function recentreOnDoubleClick(event) {
    if (!active || disposed || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld(); raycaster.setFromCamera(pointer, camera); active.root.updateMatrixWorld(true);
    const hit = raycaster.intersectObjects(active.meshes, false).find(({ object, point }) => isVisible(object) && !clippedAt(object, point ?? new THREE.Vector3()));
    if (hit?.point) recentre(hit.point.toArray());
  }
  renderer.domElement.addEventListener('dblclick', recentreOnDoubleClick);

  return { prepare, commit, applyPose, setMechanism, setPresentation, resetCamera, getCamera, setCamera, focusNode, snapshot,
    setNavigationMode, getNavigationMode: () => navigationMode, panBy, rotateBy, zoomBy, recentre, setViewDirection,
    setLook, getLook: () => look, orbitBy, setSelection, setPointSelection, setPointSelections, setNodeOffsets, setNodeSpins, setLinks, setMolecules, showMolecules, setParticleCloud, setInstanceSet, instanceSetInfo, collectTriangles, benchmark, pickParticle, setEventTags, setOverlayLines, setOverlayMesh, setOverlayVisible, focusPoint, setConformation, setClipping, clipFrame, setNodeVisibility, setGizmoMode, clear, dispose,
    get renderStyle() { return glow ? 'glow' : ink ? ink.style.id : 'plain'; },
    /** What the renderer holds right now (for leak checks across scene loads): GPU geometries and textures, compiled programs, and the number of objects in the scene graph. */
    stats() {
      // read-only render statistics, for leak checks and for sizing scenes (docs/PLUGIN_ROADMAP.md). The drawn load is counted from the scene (visible objects, instances included):
      // three.js resets its own per-render counters on every pass, and the last pass is a full-screen quad.
      let objects = 0, triangles = 0, points = 0, lines = 0, drawables = 0;
      scene.traverse((object) => {
        objects++;
        if (!object.visible || !object.geometry) return;
        const geometry = object.geometry, count = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0), copies = object.isInstancedMesh ? object.count : 1;
        if (object.isMesh) { triangles += count / 3 * copies; drawables++; } else if (object.isPoints) { points += count * copies; drawables++; } else if (object.isLine) { lines += (object.isLineSegments ? count / 2 : Math.max(0, count - 1)) * copies; drawables++; }
      });
      return { clouds: Object.fromEntries([...clouds].map(([tag, cloud]) => [tag, cloud.mesh.count])), geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0, objects, triangles: Math.round(triangles), points, lines: Math.round(lines), drawables };
    } };
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPresentationOverlay } from './presentation-overlay.mjs';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CORE_INK, createInkRenderer } from './ink-style.mjs';

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
  for (const { mode, positions, color, pointSize, pointTargets, radius, radii, ink, conformations, role, faded } of layers) {
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
  scene.add(new THREE.HemisphereLight(0xffffff, 0x697785, 2));
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
   * Temporary offsets of nodes in their parent's space (viewport units), on top of whatever pose is applied: used to pull parts of a structure
   * apart without touching the document. An empty/absent offset restores the node exactly. Links follow the nodes.
   */
  function setNodeOffsets(offsets) {
    if (!active) return;
    for (const [id, group] of active.groups) {
      const next = offsets?.get(id) ?? [0, 0, 0], moved = next.some((value) => value !== 0);
      // the rest position is remembered, so putting a node back is exact (no accumulated rounding)
      if (moved && !group.userData.rest) group.userData.rest = group.position.clone();
      const rest = group.userData.rest;
      if (rest) group.position.set(rest.x + next[0], rest.y + next[1], rest.z + next[2]);
      if (!moved) { if (rest) group.position.copy(rest); group.userData.rest = undefined; group.userData.offset = undefined; }
      else group.userData.offset = next;
    }
    updateLinks();
    updatePresentationOverlay();
    invalidate();
  }

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
  function setClipping({ slab = null, wedge = null } = {}) {
    if (!active) return;
    const slabPlanes = slab ? [toPlane(slab)] : null, wedgePlanes = wedge ? wedge.planes.map(toPlane) : null;
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
    if (ink) ink.render();
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
    invalidate();
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
      if (group.userData.offset) {
        group.userData.rest = group.position.clone();
        group.position.set(group.position.x + group.userData.offset[0], group.position.y + group.userData.offset[1], group.position.z + group.userData.offset[2]);
      }
    }
    updateLinks();
    updatePresentationOverlay();
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
    const phase = snapshot?.conformation;
    for (const mesh of active.meshes) {
      const morph = mesh.userData.conformation;
      if (!morph || !phase) continue;
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
    renderer.dispose();
    renderer.domElement.remove();
  }

  function snapshot(width) {
    if (disposed) throw new Error('视口已关闭。');
    draw();
    const source = renderer.domElement;
    if (width == null || width === source.width) return source.toDataURL('image/png');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(width * source.height / source.width));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  return { prepare, commit, applyPose, setMechanism, setPresentation, resetCamera, getCamera, setCamera, focusNode, snapshot,
    orbitBy, setSelection, setPointSelection, setPointSelections, setNodeOffsets, setLinks, setClipping, clipFrame, setNodeVisibility, setGizmoMode, clear, dispose,
    get renderStyle() { return ink ? ink.style.id : 'plain'; } };
}

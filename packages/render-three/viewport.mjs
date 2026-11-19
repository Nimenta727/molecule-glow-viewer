import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPresentationOverlay } from './presentation-overlay.mjs';

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
  for (const { mode, positions, color, pointSize, pointTargets, radius, radii } of layers) {
    if (mode === 'spheres') {
      const geometry = new THREE.SphereGeometry(1, 12, 8);
      const surface = new THREE.InstancedMesh(geometry,
        new THREE.MeshStandardMaterial({ color, roughness: 0.84 }), positions.length / 3);
      const ink = new THREE.InstancedMesh(geometry.clone(),
        new THREE.MeshBasicMaterial({ color: '#344151', side: THREE.BackSide }), positions.length / 3);
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
      continue;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (mode === 'lines') {
      yield new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
    } else if (mode === 'points') {
      const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: pointSize ?? 0.08 }));
      points.userData.pointTargets = pointTargets;
      yield points;
    } else {
      geometry.computeVertexNormals();
      yield new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
    }
  }
}

export function createViewport(container, { onSelect, selectOnTap = false, TransformControls, onTransform, background = '#f5f7f8' } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  camera.position.set(4, 3, 5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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
        pointSelection.scale.setScalar(Math.max(mesh.material.size * 0.7, 0.04));
        pointSelection.position.fromBufferAttribute(mesh.geometry.getAttribute('position'), index);
        mesh.add(pointSelection);
        break;
      }
    }
    invalidate();
    return Boolean(pointSelection?.parent);
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
      renderer.render(scene, camera);
    });
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
    invalidate();
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
    const hits = raycaster.intersectObjects(active.meshes, false).filter(({ object }) => isVisible(object));
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
    invalidate();
  }

  function prepare(document, geometryLayers = new Map(), { overlayCapacity = 0 } = {}) {
    if (disposed) throw new Error('Viewport is disposed');
    const root = new THREE.Group();
    const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
    const templates = new Map();
    const groups = new Map();
    const meshes = [];
    const handle = { root, meshes, disposed: false, dispose: () => disposeHandle(handle) };
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
    }
    updatePresentationOverlay();
    invalidate();
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

  function focusNode(id, { bookmark, duration = 0, includeIds = [] } = {}) {
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
    const radius = Math.max(0.25, sphere.radius + sphere.center.distanceTo(target));
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
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { prepare, commit, applyPose, setPresentation, resetCamera, getCamera, setCamera, focusNode,
    orbitBy, setSelection, setPointSelection, setNodeVisibility, setGizmoMode, clear, dispose };
}

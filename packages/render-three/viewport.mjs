import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
  for (const { mode, positions, color, pointSize } of layers) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (mode === 'lines') {
      yield new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
    } else if (mode === 'points') {
      yield new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: pointSize ?? 0.08 }));
    } else {
      geometry.computeVertexNormals();
      yield new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
    }
  }
}

export function createViewport(container, { onSelect, selectOnTap = false, TransformControls, onTransform } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f5f7f8');
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
    const hit = raycaster.intersectObjects(active.meshes, false).find(({ object }) => isVisible(object));
    onSelect?.(hit?.object.userData.nodeId ?? null);
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
    handle.root.removeFromParent();
    if (active === handle) active = null;
    for (const mesh of handle.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    invalidate();
  }

  function prepare(document, geometryLayers = new Map()) {
    if (disposed) throw new Error('Viewport is disposed');
    const root = new THREE.Group();
    const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
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
          for (const mesh of renderables(asset, geometryLayers.get(asset.id))) {
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

  function fitCamera(handle = active) {
    if (!handle) return;
    const distance = Math.max(handle.radius / Math.sin(fitAngle()), 1);
    const position = handle.center.clone().add(new THREE.Vector3(1, 0.72, 1).normalize().multiplyScalar(distance));
    setCamera({ position: position.toArray(), target: handle.center.toArray() });
  }

  function applyPose(pose) {
    if (!active) return;
    for (const [id, group] of active.groups) {
      applyTransform(group, pose?.get(id) ?? active.pose.get(id));
    }
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

  function resetCamera() { fitCamera(); }
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

  function focusNode(id, { bookmark, duration = 0 } = {}) {
    const object = active?.groups.get(id);
    if (!object) return false;
    object.updateWorldMatrix(true, false);
    const bounds = new THREE.Box3().setFromObject(object);
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
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { prepare, commit, applyPose, resetCamera, getCamera, setCamera, focusNode, setSelection, setGizmoMode, clear, dispose };
}

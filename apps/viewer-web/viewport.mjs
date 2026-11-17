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

export function createViewport(container, { onSelect } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f5f7f8');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  camera.position.set(4, 3, 5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
  container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x697785, 2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 7, 5);
  scene.add(key);
  const controls = new OrbitControls(camera, renderer.domElement);
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 0.04;
  raycaster.params.Points.threshold = 0.08;
  const pointer = new THREE.Vector2();
  let active = null;
  let disposed = false;
  let frameId;

  function invalidate() {
    if (disposed || frameId !== undefined) return;
    frameId = requestAnimationFrame(() => {
      frameId = undefined;
      renderer.render(scene, camera);
    });
  }
  controls.addEventListener('change', invalidate);

  function resize() {
    if (disposed) return;
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    invalidate();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  resize();

  function pick(event) {
    if (!active || disposed || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    active.root.updateMatrixWorld(true);
    const hit = raycaster.intersectObjects(active.meshes, false).find(({ object }) => isVisible(object));
    onSelect?.(hit?.object.userData.nodeId ?? null);
  }
  renderer.domElement.addEventListener('pointerdown', pick);

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
    scene.add(prepared.root);
    active = prepared;
    fitCamera(prepared);
    if (previous) disposeHandle(previous);
    invalidate();
  }

  function fitCamera(handle = active) {
    if (!handle) return;
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = Math.max(handle.radius / Math.sin(Math.min(vertical, horizontal)), 1);
    camera.position.copy(handle.center).add(new THREE.Vector3(1, 0.72, 1).normalize().multiplyScalar(distance));
    camera.near = Math.max(distance / 1000, 0.001);
    camera.far = Math.max(distance * 100, 100);
    camera.updateProjectionMatrix();
    controls.target.copy(handle.center);
    controls.update();
    invalidate();
  }

  function applyPose(pose) {
    if (!active) return;
    for (const [id, group] of active.groups) {
      applyTransform(group, pose?.get(id) ?? active.pose.get(id));
    }
    invalidate();
  }

  function clear() {
    if (active) disposeHandle(active);
    controls.target.set(0, 0, 0);
    camera.position.set(4, 3, 5);
    controls.update();
    invalidate();
  }

  function resetCamera() { fitCamera(); }

  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointerdown', pick);
    controls.removeEventListener('change', invalidate);
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { prepare, commit, applyPose, resetCamera, clear, dispose };
}

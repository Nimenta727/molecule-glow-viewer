/**
 * Camera commands in the classic's vocabulary (glow.camera): { orbit: degrees } turns the view about the vertical axis through the target, { az, el, dist } sets it by angles and distance
 * (degrees; az 0 looks along -z, el up from the horizon, dist in scene metres), { focus } moves the target to a point and keeps the viewing direction. Pure arithmetic on
 * { position, target }; the Viewer applies the result with its own camera. Throws on anything out of range instead of clamping it.
 */
const RAD = Math.PI / 180;
export class CameraSpecError extends Error { constructor(message) { super(message); this.name = 'CameraSpecError'; } }
const num = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new CameraSpecError(`${label} 应为 ${min}–${max} 之间的数。`);
  return value;
};
const sub = (a, b) => a.map((v, i) => v - b[i]), add = (a, b) => a.map((v, i) => v + b[i]), len = (a) => Math.hypot(...a);

export function cameraAngles({ position, target }) {
  const d = sub(position, target), dist = len(d);
  if (!(dist > 0)) throw new CameraSpecError('镜头与目标重合。');
  return { az: Math.atan2(d[0], d[2]) / RAD, el: Math.asin(d[1] / dist) / RAD, dist };
}
export function cameraFromAngles(target, { az, el, dist }) {
  const a = az * RAD, e = el * RAD;
  return { position: add(target, [dist * Math.cos(e) * Math.sin(a), dist * Math.sin(e), dist * Math.cos(e) * Math.cos(a)]), target: [...target] };
}

/** `spec` has any of orbit, az, el, dist, focusPoint ([x,y,z] already resolved by the caller) and focusRadius (scene metres, used to pick a distance when only a focus is given). */
export function applyCameraSpec(camera, spec) {
  const known = ['orbit', 'az', 'el', 'dist', 'focusPoint', 'focusRadius'];
  for (const key of Object.keys(spec)) if (!known.includes(key)) throw new CameraSpecError(`未知镜头参数 ${key}。`);
  let target = [...camera.target];
  const was = cameraAngles(camera);
  let { az, el, dist } = was;
  if (spec.focusPoint) {
    if (!Array.isArray(spec.focusPoint) || spec.focusPoint.length !== 3 || !spec.focusPoint.every(Number.isFinite)) throw new CameraSpecError('聚焦点无效。');
    target = [...spec.focusPoint];
    if (spec.dist == null && spec.focusRadius != null) dist = Math.max(0.05, num(spec.focusRadius, 0, 1e6, 'focusRadius') * 3.2);
  }
  if (spec.orbit != null) az += num(spec.orbit, -3600, 3600, 'orbit');
  if (spec.az != null) az = num(spec.az, -3600, 3600, 'az');
  if (spec.el != null) el = num(spec.el, -89, 89, 'el');
  if (spec.dist != null) dist = num(spec.dist, 0.01, 1e5, 'dist');
  return cameraFromAngles(target, { az, el: Math.max(-89, Math.min(89, el)), dist });
}

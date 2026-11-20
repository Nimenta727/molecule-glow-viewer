/**
 * Moving between scales in one scene (classic: the multiscale camera of src/sim/processes/whole-cell.js and src/view/frame-loop.js): from the whole cell (about 2 µm) down to
 * a molecular machine (about 30 nm), all in Å. The camera flies with its distance interpolated in log space, the clip planes and the ink follow the distance, a scale bar says
 * what a length on screen is, and entering a level remembers the view so coming back restores it. Pure functions plus a small view stack; the Viewer owns the camera.
 */
export const LEVELS = Object.freeze([{ id: 'cell', over: 14000, label: '细胞（2 µm）' }, { id: 'region', over: 2600, label: '细胞一角（约 300 nm）' }, { id: 'machine', over: 0, label: '分子机器（约 30 nm）' }]);
const BAR_LENGTHS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];   // Å

/** Which level a camera distance (Å) is at. */
export const levelOf = (dist) => (dist > 14000 ? 'cell' : dist > 2600 ? 'region' : 'machine');
/** Near and far clip planes for a camera distance: 1 nm to 2 µm in one scene. */
export const clipPlanes = (dist) => ({ near: dist / 300, far: dist * 3 + 80000 });
/** Strength of the ink lines: lighter when thousands of molecules are on screen. */
export const inkAmount = (dist, base = 1) => base * Math.min(1, Math.max(0.45, 1.1 - dist / 20000));
/** The ease of a level change: slow, fast, slow (a cubic in-out). */
export const easeInOut = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);

/** The scale bar for a camera distance: the longest of the usual lengths that fits in 150 px; { length (Å), pixels, label }. */
export function scaleBar(dist, fovDegrees, heightPx) {
  const px = heightPx / (2 * dist * Math.tan(fovDegrees * Math.PI / 180 / 2));   // pixels per Å at the target
  let length = 10; for (const L of BAR_LENGTHS) if (L * px <= 150) length = L;
  return { length, pixels: length * px, label: length >= 10000 ? `${length / 10000} µm` : `${length / 10} nm` };
}

/** One camera pose of a flight: target, direction (from target to camera) and distance, at progress k in [0, 1]. */
export function zoomPose(z, k) {
  const e = easeInOut(Math.min(1, Math.max(0, k))), lerp = (a, b) => a.map((v, i) => v + (b[i] - v) * e);
  const target = lerp(z.t0, z.t1), dir = lerp(z.dir0, z.dir1), len = Math.hypot(...dir) || 1;
  return { target, direction: dir.map((v) => v / len), distance: Math.exp(Math.log(z.d0) + (Math.log(z.d1) - Math.log(z.d0)) * e) };
}

/**
 * The views entered so far. `enter(view, label)` remembers the view the user left; `back()` returns it (or null at the top). A view is whatever the host needs to put
 * the scene back: camera, selection, visibility, style, and the time of each running station.
 */
export function createViewStack(limit = 16) {
  const stack = [];
  return {
    enter(view, label = '') { stack.push({ view: structuredClone(view), label }); if (stack.length > limit) stack.shift(); return stack.length; },
    back() { return stack.pop()?.view ?? null; },
    get depth() { return stack.length; },
    trail: () => stack.map((s) => s.label),
    clear() { stack.length = 0; },
  };
}

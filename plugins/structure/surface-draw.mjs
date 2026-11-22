import { buildSurface, validateSurfaces, SurfaceError, MAX_SURFACES } from './molecular-surface.mjs';

/**
 * Puts the surface rules of a work (viewer state `surfaces`) into a viewport as translucent coloured meshes, one overlay per rule. Shared by the Studio and the Viewer, which differ only in how a structure
 * coordinate (Å) becomes a scene coordinate: `convert(point)`. A surface takes a moment to build, so the result is kept per model and rule; drawing the same rules again is free. Returns the problems
 * (a rule that selects nothing in this file, or is too big) so the caller can say so; nothing is drawn for them.
 */
export const surfaceTag = (index) => `structure-surface-${index}`;
const caches = new WeakMap();

export function drawSurfaces(viewport, model, rules = [], convert, { opacity = 0.9 } = {}) {
  const problems = [];
  if (!model) { for (let i = 0; i < MAX_SURFACES; i++) viewport.setOverlayMesh(surfaceTag(i), null); return problems; }
  if (!caches.has(model)) caches.set(model, new Map());
  const cache = caches.get(model);
  for (let i = 0; i < MAX_SURFACES; i++) {
    const rule = rules[i];
    if (!rule) { viewport.setOverlayMesh(surfaceTag(i), null); continue; }
    const key = `${rule.expr}|${rule.scheme}|${rule.color ?? ''}|${rule.inflate ?? 0}`;
    try {
      if (!cache.has(key)) { cache.set(key, buildSurface(model, rule)); while (cache.size > 8) cache.delete(cache.keys().next().value); }
      const built = cache.get(key), pos = new Float32Array(built.pos.length);
      for (let v = 0; v < pos.length; v += 3) pos.set(convert([built.pos[v], built.pos[v + 1], built.pos[v + 2]]), v);
      viewport.setOverlayMesh(surfaceTag(i), { pos, idx: built.idx, colors: built.colors }, { opacity });
    } catch (error) {
      viewport.setOverlayMesh(surfaceTag(i), null);
      problems.push({ index: i, message: error instanceof SurfaceError ? error.message : `表面失败：${error.message}` });
    }
  }
  return problems;
}

export { validateSurfaces };

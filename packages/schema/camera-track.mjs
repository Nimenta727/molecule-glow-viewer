/**
 * A camera track: keyframes of the camera on the timeline. Each key is a time and a saved view (a bookmark: position and target); between two keys the camera moves with an ease-in-out, before the first
 * and after the last it stays on that key. Pure data and one function, so the Studio (preview) and the Viewer (playback) move the camera identically.
 */
export function sortedCameraKeys(presentation) {
  return [...(presentation?.cameraKeys ?? [])].sort((a, b) => a.time - b.time);
}

const ease = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** The camera at `time`: { position, target }, or null when the scene has no usable camera keys. */
export function cameraAt(presentation, time) {
  const marks = new Map((presentation?.bookmarks ?? []).map((b) => [b.id, b]));
  const keys = sortedCameraKeys(presentation).filter((key) => marks.has(key.bookmarkId));
  if (!keys.length) return null;
  const pick = (key) => ({ position: [...marks.get(key.bookmarkId).position], target: [...marks.get(key.bookmarkId).target] });
  if (time <= keys[0].time) return pick(keys[0]);
  const last = keys[keys.length - 1];
  if (time >= last.time) return pick(last);
  const next = keys.findIndex((key) => key.time > time), a = marks.get(keys[next - 1].bookmarkId), b = marks.get(keys[next].bookmarkId);
  const t = ease((time - keys[next - 1].time) / (keys[next].time - keys[next - 1].time));
  return { position: mix(a.position, b.position, t), target: mix(a.target, b.target, t) };
}

export const GEOMETRY_MEDIA_TYPE = 'application/vnd.glow.geometry+json';
const MAX_COORDINATES = 1_500_000;
const COMPONENTS = { points: 3, lines: 6, triangles: 9 };
const COLOR = /^#[0-9a-f]{6}$/i;

function validateLayer(layer) {
  if (!layer || !Object.hasOwn(COMPONENTS, layer.mode) || typeof layer.color !== 'string' || !COLOR.test(layer.color)) {
    throw new TypeError('Invalid geometry layer mode or color');
  }
  const { mode, positions, color, pointSize } = layer;
  if (!Array.isArray(positions) || !positions.length || positions.length % COMPONENTS[mode]) {
    throw new TypeError('Invalid geometry coordinates');
  }
  for (const value of positions) {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new TypeError('Invalid geometry coordinates');
  }
  if (pointSize !== undefined && (mode !== 'points' || !Number.isFinite(pointSize) || pointSize <= 0 || pointSize > 1)) {
    throw new TypeError('Invalid geometry point size');
  }
  return { mode, positions, color, ...(pointSize === undefined ? {} : { pointSize }) };
}

function validateGeometry(document) {
  if (!document || document.format !== 'glow-geometry' || document.version !== 1 ||
      !Array.isArray(document.layers) || !document.layers.length || document.layers.length > 64) {
    throw new TypeError('Invalid Glow geometry');
  }
  let coordinates = 0;
  return document.layers.map((layer) => {
    coordinates += layer?.positions?.length ?? 0;
    if (coordinates > MAX_COORDINATES) throw new RangeError('Geometry coordinates exceed the preview limit');
    return validateLayer(layer);
  });
}

export function encodeGeometry(layers) {
  const document = { format: 'glow-geometry', version: 1, layers };
  return new TextEncoder().encode(JSON.stringify({ ...document, layers: validateGeometry(document) }));
}

export function decodeGeometry(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return validateGeometry(JSON.parse(text));
}

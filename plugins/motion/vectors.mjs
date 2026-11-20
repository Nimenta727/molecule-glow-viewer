// Small 3-vector helpers shared by the motion algorithms (plain arrays, no allocation tricks).
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const normalize = (a) => a.map((v) => v / Math.hypot(...a));
export const distance = (a, b) => Math.hypot(...sub(a, b));
export const lerp = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);

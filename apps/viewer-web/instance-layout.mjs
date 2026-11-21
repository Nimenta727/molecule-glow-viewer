import { mulberry32 } from '../../plugins/motion/particles.mjs';

/**
 * Where the copies of an instance set go (pure; the Viewer's `glow.instances` and, later, the composition planner use it). Layouts are seeded: the same seed gives the same copies.
 *   grid    a cubic lattice, spacing 2.4 x the radius x `spread`
 *   sphere  a fibonacci shell, sized so that neighbours are about 2.4 radii apart (the shell never smaller than 3 radii; the closest pair of a fibonacci shell is about 0.7 of the average spacing, hence the 1.5)
 * Every copy gets its own random orientation (uniform on the rotation group). Returns { matrices: Float32Array(16 n), positions: Float32Array(3 n), extent } with column-major matrices
 * as three.js keeps them; `extent` is the radius of the region the copies fill.
 */
export function layoutCopies({ copies, layout = 'sphere', radius, spread = 1, seed = 1 }) {
  if (!Number.isInteger(copies) || copies < 1) throw new RangeError('copies must be a positive integer');
  if (!(radius > 0)) throw new RangeError('radius must be positive');
  const random = mulberry32(seed >>> 0), positions = new Float32Array(3 * copies), matrices = new Float32Array(16 * copies), gap = 2.4 * radius * spread;
  let extent = 0;
  if (layout === 'grid') {
    const side = Math.ceil(Math.cbrt(copies)), half = (side - 1) / 2;
    for (let i = 0; i < copies; i++) { const x = i % side, y = Math.floor(i / side) % side, z = Math.floor(i / (side * side)); positions.set([(x - half) * gap, (y - half) * gap, (z - half) * gap], 3 * i); }
    extent = half * gap * Math.sqrt(3) + radius;
  } else if (layout === 'sphere') {
    const shell = Math.max(3 * radius, gap * Math.sqrt(copies / (4 * Math.PI)) * 1.5), golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < copies; i++) {
      const y = copies === 1 ? 0 : 1 - 2 * i / (copies - 1), ring = Math.sqrt(Math.max(0, 1 - y * y)), angle = golden * i;
      positions.set([Math.cos(angle) * ring * shell, y * shell, Math.sin(angle) * ring * shell], 3 * i);
    }
    extent = shell + radius;
  } else throw new RangeError(`unknown layout "${layout}"`);
  for (let i = 0; i < copies; i++) {
    // a uniform random rotation (Marsaglia's method for a unit quaternion)
    let a, b, s1, c, d, s2;
    do { a = 2 * random() - 1; b = 2 * random() - 1; s1 = a * a + b * b; } while (s1 >= 1 || s1 === 0);
    do { c = 2 * random() - 1; d = 2 * random() - 1; s2 = c * c + d * d; } while (s2 >= 1 || s2 === 0);
    const k = Math.sqrt((1 - s1) / s2), x = a, y = b, z = c * k, w = d * k;
    const m = matrices.subarray(16 * i, 16 * i + 16);
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w);
    m[4] = 2 * (x * y - z * w); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w);
    m[8] = 2 * (x * z + y * w); m[9] = 2 * (y * z - x * w); m[10] = 1 - 2 * (x * x + y * y);
    m[12] = positions[3 * i]; m[13] = positions[3 * i + 1]; m[14] = positions[3 * i + 2]; m[15] = 1;
  }
  return { matrices, positions, extent };
}

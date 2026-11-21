import { mulberry32 } from '../motion/particles.mjs';

/**
 * Binding in space (docs/PLUGIN_ROADMAP.md, D2): free particles diffuse (Brownian dynamics) in a periodic cubic box and bind a receptor site when they touch it; a bound particle is released again after an
 * exponential waiting time (rate koff). Lengths in nm, times in µs, D in nm^2/µs (1 µm^2/s = 1 nm^2/µs). Seeded and deterministic: the same inputs give the same history.
 *
 * The physics it can be checked against: for a perfectly absorbing sphere of reaction radius R in a bath of concentration c the steady association rate is the Smoluchowski rate 4 pi D R c (per site).
 * Two small errors pull in opposite directions and are not corrected: a finite time step under-counts absorption (by about 1.46 sqrt(D dt) / R for small steps), and a periodic box, whose images of
 * the site also absorb, over-counts (by a few percent for R / L of 0.05). Measured here at R = 3 nm, D = 50 nm^2/us, dt = 0.002 us: 1.02 times the Smoluchowski rate at L = 60 nm, within the noise.
 * A released particle is put on a sphere of radius `releaseFactor` x the reaction radius (default 2), not on the surface: a perfectly absorbing site recaptures a particle released at its
 * surface almost surely (the chance to come back from distance r is R / r), so the dissociation that matters is the part that escapes, koff x (1 - R / r_release). `effectiveKoff` gives it.
 * An occupied site is a hard sphere to the other particles (they are reflected), a free site is absorbing. The sites are fixed spheres; the particles do not interact with each other (a dilute solution). `reinject: true` puts an absorbed particle back at a random place at once, which holds the bath at
 * constant concentration (the situation the Smoluchowski rate describes); otherwise a bound particle stays on the site until released.
 */
export function createBinding({ box, particles, D, sites, dt, koff = 0, seed = 1, reinject = false, releaseFactor = 2 }) {
  if (!(box > 0) || !Number.isInteger(particles) || particles < 1 || !(D > 0) || !(dt > 0)) throw new RangeError('box, particles, D and dt must be positive (particles an integer)');
  if (!Array.isArray(sites) || !sites.length || sites.some((s) => !Array.isArray(s.position) || !(s.radius > 0))) throw new RangeError('sites need a position and a reaction radius');
  if (koff < 0) throw new RangeError('koff must not be negative'); if (!(releaseFactor > 1)) throw new RangeError('releaseFactor must exceed 1');
  const sd = Math.sqrt(2 * D * dt);
  if (sd > Math.min(...sites.map((s) => s.radius)) / 3) throw new RangeError(`the time step is too large: a step of ${sd.toFixed(2)} nm is more than a third of the smallest reaction radius; lower dt`);
  const random = mulberry32(seed >>> 0), gauss = () => { const u = 1 - random(), v = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const x = new Float64Array(3 * particles), bound = new Int32Array(particles).fill(-1), occupant = new Int32Array(sites.length).fill(-1), counts = { bindings: 0, releases: 0, steps: 0 };
  const wrap = (v) => v - box * Math.floor(v / box), minImage = (d) => d - box * Math.round(d / box), place = (i) => { for (let k = 0; k < 3; k++) x[3 * i + k] = random() * box; };
  const clear = (i) => sites.every((s) => Math.hypot(...[0, 1, 2].map((k) => minImage(x[3 * i + k] - s.position[k]))) > s.radius);
  for (let i = 0; i < particles; i++) { do place(i); while (!clear(i)); }
  const releaseProbability = koff > 0 ? 1 - Math.exp(-koff * dt) : 0;
  function step() {
    counts.steps++;
    for (let i = 0; i < particles; i++) {
      if (bound[i] >= 0) {
        if (releaseProbability > 0 && random() < releaseProbability) {   // released just outside the site, in a random direction
          const s = sites[bound[i]], u = random(), v = random(), z = 1 - 2 * u, r = Math.sqrt(1 - z * z), phi = 2 * Math.PI * v, out = s.radius * releaseFactor;
          x[3 * i] = wrap(s.position[0] + out * r * Math.cos(phi)); x[3 * i + 1] = wrap(s.position[1] + out * r * Math.sin(phi)); x[3 * i + 2] = wrap(s.position[2] + out * z);
          occupant[bound[i]] = -1; bound[i] = -1; counts.releases++;
        }
        continue;
      }
      const ox = x[3 * i], oy = x[3 * i + 1], oz = x[3 * i + 2];
      for (let k = 0; k < 3; k++) x[3 * i + k] = wrap(x[3 * i + k] + sd * gauss());
      for (let j = 0; j < sites.length; j++) {
        const s = sites[j];
        if (occupant[j] >= 0) {   // an occupied site is a hard sphere: a step into it is refused
          if (Math.hypot(minImage(x[3 * i] - s.position[0]), minImage(x[3 * i + 1] - s.position[1]), minImage(x[3 * i + 2] - s.position[2])) < s.radius) { x[3 * i] = ox; x[3 * i + 1] = oy; x[3 * i + 2] = oz; }
          continue;
        }
        if (Math.hypot(minImage(x[3 * i] - s.position[0]), minImage(x[3 * i + 1] - s.position[1]), minImage(x[3 * i + 2] - s.position[2])) <= s.radius) {
          counts.bindings++;
          if (reinject) do place(i); while (!clear(i)); else { bound[i] = j; occupant[j] = i; }
          break;
        }
      }
    }
  }
  return {
    step, counts, sd,
    /** Advances `microseconds` of simulated time (whole steps). */
    run(microseconds) { const n = Math.round(microseconds / dt); for (let s = 0; s < n; s++) step(); return counts; },
    get time() { return counts.steps * dt; },
    boundCount: () => occupant.filter((o) => o >= 0).length, free: () => particles - occupant.filter((o) => o >= 0).length,
    positions: () => Float64Array.from(x), boundTo: () => Int32Array.from(bound),
    concentration: () => particles / box ** 3,
  };
}

/** The dissociation rate that is left once geminate rebinding is taken out: koff x (1 - R / r_release), for a site of radius `radius` and particles released at `radius * releaseFactor`. */
export const effectiveKoff = ({ koff, releaseFactor = 2 }) => koff * (1 - 1 / releaseFactor);
/** The Smoluchowski rate for one absorbing site: 4 pi D R c (events per µs) for a concentration c in nm^-3. */
export const smoluchowskiRate = ({ D, radius, concentration }) => 4 * Math.PI * D * radius * concentration;
/** Concentration in nm^-3 from a molar concentration (1 M = 0.6022 nm^-3). */
export const fromMolar = (molar) => molar * 0.6022140857;

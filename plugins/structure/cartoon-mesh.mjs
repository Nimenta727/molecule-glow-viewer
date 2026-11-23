/**
 * The cartoon and backbone of a chain as real 3D geometry (what PyMOL, ChimeraX and Mol* draw): a smooth curve through the Cα (or P) atoms, swept with a cross-section that depends on what the
 * residue is — helices a wide flat ribbon, strands a flat ribbon ending in an arrow, coils and the plain backbone a round tube. Vertex normals come with the triangles, so the shading is smooth.
 *
 *   ribbonLayers(markers, ranges, centered, look, style, { rangeTypeFor, residueGap, colors }) -> layers ({ mode: 'triangles', positions, normals, color, pinned? })
 *
 * markers: [{ raw: [x, y, z] (Å), residue }] in chain order. A residue whose look says 'hidden' (or any style other than cartoon / backbone) breaks the curve; colours come from `look.colorOf`
 * (pinned layers) or from the secondary structure (helix / sheet / default). The sizes are drawing sizes in Å, not physical quantities. Pure geometry: no DOM, no Three.js.
 */
// how finely the curve is swept: a protein gets the smooth sweep; a large complex the coarser one (a third of the triangles); a whole virus (hundreds of thousands of residues) straight
// pieces between neighbouring residues with a five-sided tube, which at that scale looks the same and still fits in memory
const QUALITY = { fine: { samples: 6, sides: 12 }, coarse: { samples: 4, sides: 8 }, minimal: { samples: 1, sides: 5 } };

/** A Float32Array that grows: the geometry of a large complex is tens of millions of numbers, which plain arrays would hold at twice the memory and more. */
class Floats {
  constructor() { this.data = new Float32Array(1024); this.length = 0; }
  push3(x, y, z) { if (this.length + 3 > this.data.length) { const next = new Float32Array(this.data.length * 2); next.set(this.data); this.data = next; } this.data[this.length++] = x; this.data[this.length++] = y; this.data[this.length++] = z; }
  done() { return this.data.slice(0, this.length); }
}
const SECTION = {
  backbone: { w: 0.32, t: 0.32 },
  coil: { w: 0.3, t: 0.3 },
  helix: { w: 1.25, t: 0.28 },
  sheet: { w: 1.1, t: 0.28 },
};
const ARROW = 1.75;   // half-width at the base of a strand's arrow head

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1]; };
const lerp = (a, b, t) => a + (b - a) * t;
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

/** The runs of connected, drawn residues: each run is a list of { raw, residue, style, type, color }. */
function runsOf(markers, ranges, look, defaultStyle, { rangeTypeFor, residueGap }) {
  const runs = []; let run = [];
  const close = () => { if (run.length >= 2) runs.push(run); run = []; };
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i], style = look.styleOf?.(m.residue.atom) ?? defaultStyle;
    if (style !== 'cartoon' && style !== 'backbone') { close(); continue; }
    const previous = run[run.length - 1];
    if (previous && (!residueGap(previous.residue, m.residue) || Math.hypot(...sub(m.raw, previous.raw)) > 10)) close();
    const ss = rangeTypeFor(m.residue.atom, ranges);
    run.push({ raw: m.raw, residue: m.residue, style, type: style === 'backbone' ? 'backbone' : ss === 'helix' || ss === 'sheet' ? ss : 'coil', color: look.colorOf?.(m.residue.atom), nucleotide: m.nucleotide });
  }
  close();
  return runs;
}

/** Guide vectors (where the flat side of a ribbon faces): outward from the local curvature, kept from flipping between neighbours. */
function guides(points) {
  const n = points.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(i - 1, 0)], b = points[i], c = points[Math.min(i + 1, n - 1)];
    out.push(i === 0 || i === n - 1 ? null : unit(sub(scale(b, 2), add(a, c))));
  }
  for (let i = 0; i < n; i++) if (!out[i]) out[i] = out[i === 0 ? 1 : n - 2] ?? [0, 1, 0];
  for (let i = 1; i < n; i++) if (dot(out[i], out[i - 1]) < 0) out[i] = scale(out[i], -1);
  return out;
}

function sectionOf(item) { return item.type === 'backbone' ? SECTION.backbone : item.nucleotide ? { w: 0.45, t: 0.45 } : SECTION[item.type]; }

export function ribbonLayers(markers, ranges, centered, look = {}, defaultStyle = 'cartoon', { rangeTypeFor, residueGap, colors, quality = 'fine' }) {
  const { samples: SAMPLES, sides: SIDES } = QUALITY[quality] ?? QUALITY.fine;
  const bins = new Map();   // colour key -> { positions, normals } (growing Float32Arrays)
  const bin = (key) => { if (!bins.has(key)) bins.set(key, { positions: new Floats(), normals: new Floats() }); return bins.get(key); };
  for (const run of runsOf(markers, ranges, look, defaultStyle, { rangeTypeFor, residueGap })) {
    const P = run.map((r) => r.raw), G = guides(P), n = run.length;
    // samples along the curve: position, tangent, guide, width, thickness, and the residue whose colour the piece takes
    const samples = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, n - 1)];
      const a = sectionOf(run[i]), b = sectionOf(run[i + 1]);
      const arrow = run[i].type === 'sheet' && run[i + 1].type !== 'sheet';   // the last strand residue: the arrow head
      for (let s = 0; s < SAMPLES; s++) {
        const t = s / SAMPLES, at = catmull(p0, p1, p2, p3, t), ahead = catmull(p0, p1, p2, p3, Math.min(t + 0.02, 1)), behind = catmull(p0, p1, p2, p3, Math.max(t - 0.02, 0));
        let w = lerp(a.w, b.w, smooth(t)), th = lerp(a.t, b.t, smooth(t));
        if (arrow) { w = lerp(ARROW, SECTION.coil.w, t); th = lerp(SECTION.sheet.t, SECTION.coil.t, t); }
        else if (run[i].type === 'sheet' && run[i + 1].type === 'sheet') { w = SECTION.sheet.w; th = SECTION.sheet.t; }
        samples.push({ at, tangent: unit(sub(ahead, behind)), guide: unit(add(scale(G[i], 1 - t), scale(G[i + 1], t))), w, th, owner: t < 0.5 ? run[i] : run[i + 1], arrowStart: arrow && s === 0 });
      }
    }
    const last = run[n - 1], lastSection = sectionOf(last);
    samples.push({ at: P[n - 1], tangent: unit(sub(P[n - 1], P[n - 2])), guide: G[n - 1], w: lastSection.w, th: lastSection.t, owner: last });
    // rings: N = guide made perpendicular to the tangent (thickness direction), B = across the ribbon (width direction)
    const rings = samples.map((sample) => {
      let N = sub(sample.guide, scale(sample.tangent, dot(sample.guide, sample.tangent)));
      N = Math.hypot(...N) < 1e-6 ? unit(cross(sample.tangent, [0.3, 1, 0.2])) : unit(N);
      const B = unit(cross(sample.tangent, N)), ring = [];
      for (let k = 0; k < SIDES; k++) {
        const angle = (2 * Math.PI * k) / SIDES, c = Math.cos(angle), s = Math.sin(angle);
        const offset = add(scale(N, c * sample.th), scale(B, s * sample.w));
        ring.push({ p: add(sample.at, offset), n: unit(add(scale(N, c / sample.th), scale(B, s / sample.w))) });
      }
      return ring;
    });
    for (let k = 0; k < rings.length - 1; k++) {
      const owner = samples[k].owner, key = owner.color ? `#${owner.color}` : owner.type === 'backbone' ? 'default' : owner.type === 'coil' ? 'default' : owner.type;
      const target = bin(key), r0 = rings[k], r1 = rings[k + 1];
      const put = (v) => { const q = centered.point(v.p); target.positions.push3(q[0], q[1], q[2]); target.normals.push3(v.n[0], v.n[1], v.n[2]); };
      for (let j = 0; j < SIDES; j++) {
        const a0 = r0[j], a1 = r0[(j + 1) % SIDES], b0 = r1[j], b1 = r1[(j + 1) % SIDES];
        put(a0); put(b0); put(a1); put(a1); put(b0); put(b1);
      }
      if (samples[k + 1].arrowStart) {   // the flat back of an arrow head: close the step from the strand width to the wider base
        const back = rings[k + 1], centre = samples[k + 1].at;
        for (let j = 0; j < SIDES; j++) { const a = back[j], b = back[(j + 1) % SIDES], n = scale(samples[k + 1].tangent, -1); put({ p: centre, n }); put({ p: b.p, n }); put({ p: a.p, n }); }
      }
    }
    for (const [k, ring] of [[0, rings[0]], [rings.length - 1, rings[rings.length - 1]]]) {   // round the two ends with a flat cap
      const owner = samples[k].owner, key = owner.color ? `#${owner.color}` : owner.type === 'helix' || owner.type === 'sheet' ? owner.type : 'default', target = bin(key);
      const n = scale(samples[k].tangent, k === 0 ? -1 : 1), centre = centered.point(samples[k].at);
      for (let j = 0; j < SIDES; j++) {
        const a = centered.point(ring[j].p), b = centered.point(ring[(j + 1) % SIDES].p), tri = k === 0 ? [centre, b, a] : [centre, a, b];
        for (const v of tri) { target.positions.push3(v[0], v[1], v[2]); target.normals.push3(n[0], n[1], n[2]); }
      }
    }
  }
  return [...bins].filter(([, b]) => b.positions.length).map(([key, b]) => (key.startsWith('#')
    ? { mode: 'triangles', positions: b.positions.done(), normals: b.normals.done(), color: key.slice(1), pinned: true, role: 'cartoon' }
    : { mode: 'triangles', positions: b.positions.done(), normals: b.normals.done(), color: colors[key] ?? colors.default, role: 'cartoon' }));
}
function smooth(t) { return t * t * (3 - 2 * t); }

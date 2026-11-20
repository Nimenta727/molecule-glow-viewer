import { superposeFit, rotateVector, centroid } from '../structure/alignment.mjs';

/**
 * The tRNAs and the mRNA moving through a ribosome (classic: `setup`, `mkT`, `fire` and `draw` of src/sim/processes/translation.js; the state changes come from the translation process).
 * Pure maths, no drawing. The structure supplies one atom per residue ({ p: [x, y, z], part, seq, asym }) of a ribosome with its mRNA and its E / P / A tRNAs:
 *   `ribosomeFrame` finds the three site poses (rigid motions of a template tRNA) exactly as the classic setup: the tRNA chains are told apart by where their anticodon (residues 34-36) sits
 *   along the mRNA, 5' to 3' = E, P, A; the template is the P-site tRNA; a pose is `x -> q (x - c) + t`.
 *   `RibosomeMotion` follows the translation process: `sync(state)` is told the discrete state (st, whether E is occupied) and starts the matching move (a tRNA arriving, being accommodated,
 *   going hybrid, translocating, leaving; the mRNA stepping 3 nt), `step(dt)` advances them in real time, `bodies()` says where every residue is.
 * With `factors` (the structures of the other states, superposed on this ribosome by plugins/simulation/entry-alignment.mjs) it also moves the bent A/T tRNA (4V5L), EF-Tu (GTP form 4V5L to GDP form
 * 1TUI), EF-G (intermediate 4V9H to post-translocation 4V5F) and RF1 (4V7P), and marks the antibiotics where they sit. Not here (still the classic's): the nascent chain, the exit tunnel, the close-ups.
 */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Spherical interpolation between unit quaternions [x, y, z, w] (the shorter way round, as THREE.Quaternion.slerp). */
export function slerp(a, b, t) {
  let [bx, by, bz, bw] = b, cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
  if (cos >= 0.9999) { const q = [a[0] + t * (bx - a[0]), a[1] + t * (by - a[1]), a[2] + t * (bz - a[2]), a[3] + t * (bw - a[3])], l = Math.hypot(...q); return q.map((v) => v / l); }
  const sin = Math.sqrt(1 - cos * cos), half = Math.atan2(sin, cos), ra = Math.sin((1 - t) * half) / sin, rb = Math.sin(t * half) / sin;
  return [a[0] * ra + bx * rb, a[1] * ra + by * rb, a[2] * ra + bz * rb, a[3] * ra + bw * rb];
}
const invert = (q) => [-q[0], -q[1], -q[2], q[3]];

/** The sites of a ribosome from its residues (see above). Throws when there is no mRNA or fewer than three tRNAs. */
export function ribosomeFrame(atoms) {
  const mrna = atoms.filter((a) => /^MRNA$/i.test(a.part)).sort((x, y) => x.seq - y.seq);
  const tAt = atoms.filter((a) => /TRNA/i.test(a.part));
  const chains = [...new Set(tAt.map((a) => a.asym))].map((k) => tAt.filter((a) => a.asym === k).sort((x, y) => x.seq - y.seq)).filter((c) => c.length > 60);
  if (mrna.length < 12 || chains.length < 3) throw new Error('该结构里找不到 mRNA 和 3 个 tRNA');
  const res = (c, s) => c.find((a) => a.seq === s) || c[Math.min(c.length - 1, s - 1)];
  const nearM = (p) => { let bi = 0, bd = 1e18; mrna.forEach((m, i) => { const d = d2(m.p, p); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const [sE, sP, sA] = chains.map((c) => ({ c, j: nearM(res(c, 35).p) })).sort((a, b) => a.j - b.j).slice(0, 3);
  const mPts = mrna.map((a) => a.p.slice()), jP = nearM(res(sP.c, 36).p);
  const tpl = sP.c, T0 = tpl.map((a) => a.p.slice()), cT = centroid(T0);
  const accW = (s) => (s <= 7 || s >= 66 ? 1 : s >= 49 ? 0.7 : s >= 44 ? 0.3 : s <= 9 ? 0.8 : s <= 26 ? 0.35 : 0);   // the acceptor arm leads in the hybrid states
  const poseFrom = (chain) => {
    const m = chain instanceof Map ? chain : new Map(chain.map((a) => [a.seq, a.p])), A = [], B = [];   // a chain of residues, or a Map of sequence number to position
    tpl.forEach((a, i) => { const p = m.get(a.seq); if (p) { A.push(p); B.push(T0[i]); } });
    if (A.length < 20) return null;
    const f = superposeFit(A, B);
    return { q: f.quaternion, t: add(rotateVector(sub(cT, f.cb), f.quaternion), f.ca) };
  };
  const sites = { E: poseFrom(sE.c), P: poseFrom(sP.c), A: poseFrom(sA.c) };
  if (!sites.E || !sites.P || !sites.A) throw new Error('tRNA 与模板残基对应太少，无法确定位姿');
  const rib = atoms.filter((a) => !/TRNA|^MRNA$/i.test(a.part)), C0 = centroid(rib.map((a) => a.p));
  return { mPts, jP, T0, cT, acc: tpl.map((a) => accW(a.seq)), n: T0.length, sites, C0, poseOf: poseFrom, tplSeq: tpl.map((a) => a.seq) };
}

/** Where the template residue `x` goes under a pose. */
export const applyPose = (frame, pose, x) => add(rotateVector(sub(x, frame.cT), pose.q), pose.t);

/** The residues of a tRNA moving from pose `pa` to `pb` by `w` (the acceptor arm leads by `hy`: residue i is at max(w, hy·acc[i])). */
/** `sAT` bends it towards `shape` (the A/T tRNA's own shape, in the template's frame); `shift` moves the whole tRNA (arriving from outside). */
export function trnaCoords(frame, { pa, pb, w = 0, hy = 0, sAT = 0, shape = null, shift = null }) {
  return frame.T0.map((x0, i) => {
    const x = sAT && shape ? [0, 1, 2].map((k) => x0[k] + (shape[i][k] - x0[k]) * sAT) : x0;
    const wi = hy ? Math.max(w, hy * frame.acc[i]) : w;
    let q = pa.q, t = pa.t;
    if (pb !== pa && wi > 0) { if (wi >= 1) { q = pb.q; t = pb.t; } else { q = slerp(pa.q, pb.q, wi); t = [0, 1, 2].map((k) => pa.t[k] + (pb.t[k] - pa.t[k]) * wi); } }
    const p = add(rotateVector(sub(x, frame.cT), q), t);
    return shift ? add(p, shift) : p;
  });
}

/**
 * The shape of the A/T tRNA in the template's frame, from its residues (a Map of sequence number to position, already in the ribosome's frame): { pose, shape }. Residues it lacks keep the template's.
 */
export function bentShape(frame, residues) {
  const pose = frame.poseOf(residues); if (!pose) return null;
  const inv = invert(pose.q);
  return { pose, shape: frame.T0.map((x, i) => { const p = residues.get(frame.tplSeq[i]); return p ? add(rotateVector(sub(p, pose.t), inv), frame.cT) : x.slice(); }) };
}

/** The mRNA's beads, moved `offset` nucleotides back along its own path (the mRNA steps 3 nt forward at each translocation; the path is extended straight at its ends). */
export function mrnaCoords(frame, offset = 0) {
  const P = frame.mPts, n = P.length, at = (u) => {
    if (u <= 0) return add(P[0], scale(sub(P[1], P[0]), u));   // beyond the ends: straight on, at the spacing of the last bond
    if (u >= n - 1) return add(P[n - 1], scale(sub(P[n - 1], P[n - 2]), u - (n - 1)));
    const i = Math.floor(u), f = u - i; return [0, 1, 2].map((k) => P[i][k] + (P[i + 1][k] - P[i][k]) * f);
  };
  return P.map((_, i) => at(i + offset));
}

const PALETTE = ['#d6336c', '#ae3ec9', '#e8590c', '#c2255c', '#9c36b5', '#f03e3e'];
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

const FACTOR_COLOURS = { 'EF-Tu': '#2f7fe0', 'EF-G': '#159a52', RF1: '#7c4ddb' };
const DRUG_NAMES = { TAC: '四环素', PAR: '巴龙霉素', CLM: '氯霉素', ERY: '红霉素', KIR: '黄色霉素', FUA: '夫西地酸' };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class RibosomeMotion {
  /**
   * `speed` shortens the moves (the classic: durations shrink at high speed); at 1 or more they snap. `factors` (optional): { at: Map (sequence number -> position) of the A/T tRNA in the ribosome's
   * frame, tu: { ref, gdp? } (EF-Tu GTP form, and its GDP form, one position per residue), g: { ref, post? }, rf: { ref }, drugs: { TAC: [x, y, z], ... } (where each antibiotic sits) }.
   */
  constructor(frame, { speed = 0.02, factors = null } = {}) {
    this.frame = frame; this.speed = speed; this.tw = []; this.tr = { A: null, P: null, E: null }; this.incoming = null; this.mOff = 0; this.mFade = 0;
    this.st = 'init'; this.hasE = false; this.n = 0; this.factors = factors; this.fb = {}; this.drugs = {};
    const s = frame.sites, dir = norm(sub(s.A.t, frame.C0)), side = norm(cross(dir, [0, 1, 0]));
    this.far = { q: s.A.q, t: add(s.A.t, scale(dir, 90)) };   // where an arriving tRNA comes from (outside the A site) when there is no A/T structure
    this.approach = { tc: 0.45, cr: 0.8, gtp: 0.8, kir: 0.8, rel: 0.9 };
    this.AT = factors?.at ? bentShape(frame, factors.at) : null;
    this.off = { 'EF-Tu': add(scale(dir, 150), scale(side, 40)), 'EF-G': add(scale(dir, 170), scale(side, -60)), RF1: add(scale(dir, 140), scale(side, 70)) };
  }
  /** Give the motion the structures of the factors and antibiotics once they have been fetched and aligned (see the constructor). */
  setFactors(factors) { this.factors = factors; this.AT = factors?.at ? bentShape(this.frame, factors.at) : null; }
  #make() { return { id: this.n++, pa: this.frame.sites.P, pb: this.frame.sites.P, w: 0, hy: 0, fade: 1, sAT: 0 }; }
  #tween(o, k, to, dur, done) {
    const d = dur * Math.min(1, 0.02 / Math.max(1e-4, this.speed));
    if (d < 1e-3 || this.speed >= 1) { o[k] = to; done?.(); return; }
    this.tw = this.tw.filter((x) => !(x.o === o && x.k === k));   // a newer move of the same thing replaces the older one
    this.tw.push({ o, k, a: o[k], b: to, t: 0, dur: d, done });
  }
  #leave(tr) { if (tr) this.#tween(tr, 'fade', 0, 0.5, () => { if (this.tr.E === tr) this.tr.E = null; }); if (tr) tr.leaving = true; }
  /** A factor (EF-Tu, EF-G or RF1) comes in from outside: its structure, optionally a second form to change into. */
  #factorIn(kind, spec) {
    if (!spec?.ref) return null;
    const b = { kind, ref: spec.ref, morph: spec.gdp ?? spec.post ?? null, m: 0, w: 0, fade: 0 }; this.fb[kind] = b;
    this.#tween(b, 'fade', 1, 0.3); this.#tween(b, 'w', 1, 1.4); return b;
  }
  #factorOut(kind) { const b = this.fb[kind]; if (!b) return; delete this.fb[kind]; const gone = { ...b }; this.leaving = [...(this.leaving ?? []), gone]; this.#tween(gone, 'w', 0.2, 0.9); this.#tween(gone, 'fade', 0, 0.9, () => { this.leaving = this.leaving.filter((x) => x !== gone); }); }
  /**
   * The process is in discrete state `st` (init post tc cr gtp kir rel acc pre g gpost rf term drop) with the E site occupied or not, and the antibiotics bound (`drugs`: { TAC: true, ... }).
   * A change of state starts the move the classic made for it.
   */
  sync({ st, E = false, drugs = {} }) {
    const prev = this.st, S = this.frame.sites, F = this.factors;
    this.drugs = drugs;
    if (st !== prev) {
      switch (true) {
        case st === 'init' || st === 'drop': for (const k of ['A', 'P', 'E']) { this.#leave(this.tr[k]); this.tr[k] = null; } this.#leave(this.incoming?.tr); this.incoming = null; for (const k of Object.keys(this.fb)) this.#factorOut(k); this.#tween(this, 'mFade', 0, 0.8); break;
        case prev === 'init' && st === 'post': { const t = this.tr.P = this.#make(); t.fade = 0; this.#tween(t, 'fade', 1, 0.6); this.mOff = 6; this.#tween(this, 'mOff', 0, 1.2); this.#tween(this, 'mFade', 1, 0.6); break; }
        case st === 'tc' && prev === 'post': {
          const t = this.#make(), arr = { w: 0 }; t.fade = 0;
          if (this.AT) { t.pa = t.pb = this.AT.pose; t.sAT = 1; t.shape = this.AT.shape; t.off = this.off['EF-Tu']; this.incoming = { tr: t, arr, ef: this.#factorIn('EF-Tu', F.tu) }; this.#tween(arr, 'w', 1, 1.4); }
          else { t.pa = this.far; t.pb = S.A; this.incoming = { tr: t, arr }; this.#tween(t, 'w', this.approach.tc, 1.4); }
          this.#tween(t, 'fade', 1, 0.3); break;
        }
        case st === 'post' && !!this.incoming: this.#leave(this.incoming.tr); if (this.incoming.ef) this.#factorOut('EF-Tu'); this.incoming = null; break;   // the ternary complex left, or the tRNA was thrown out at proofreading
        case st === 'rel' && !!this.incoming && !!this.incoming.ef: { const ef = this.incoming.ef; this.#tween(ef, 'm', 1, 0.8, () => this.#factorOut('EF-Tu')); break; }   // EF-Tu changes to its GDP form and leaves
        case this.approach[st] !== undefined && !!this.incoming && !this.AT: this.#tween(this.incoming.tr, 'w', this.approach[st], 0.5); break;
        case st === 'acc' && !!this.incoming: {
          const t = this.incoming.tr; this.incoming = null; this.tr.A = t;
          if (this.AT) { t.pa = this.AT.pose; t.pb = S.A; t.w = 0; this.#tween(t, 'sAT', 0, 1.1); this.#tween(t, 'w', 1, 1.1, () => { t.pa = t.pb = S.A; t.w = 0; t.shape = null; }); if (this.fb['EF-Tu']) this.#factorOut('EF-Tu'); }
          else this.#tween(t, 'w', 1, 1.1, () => { t.pa = t.pb = S.A; t.w = 0; });
          break;
        }
        case st === 'pre': { const A = this.tr.A, P = this.tr.P; if (P) { P.pa = S.P; P.pb = S.E; this.#tween(P, 'hy', 1, 0.7); } if (A) { A.pa = S.A; A.pb = S.P; this.#tween(A, 'hy', 1, 0.7); } break; }
        case st === 'g': this.#factorIn('EF-G', F?.g); break;
        case st === 'gpost': {
          const { P, A } = this.tr; if (this.tr.E) { this.#leave(this.tr.E); } this.tr.E = P; this.tr.P = A; this.tr.A = null;
          for (const [t, a, b] of [[P, S.P, S.E], [A, S.A, S.P]]) if (t) { t.pa = a; t.pb = b; t.w = 0; this.#tween(t, 'w', 1, 1.4, () => { t.pa = t.pb = b; t.w = 0; t.hy = 0; }); }
          this.mOff = 3; this.#tween(this, 'mOff', 0, 1.4);
          if (this.fb['EF-G']) this.#tween(this.fb['EF-G'], 'm', 1, 1.4); break;
        }
        case st === 'post' && prev === 'gpost': this.#factorOut('EF-G'); break;
        case st === 'rf': this.#factorIn('RF1', F?.rf); break;
        case st === 'term': this.#factorOut('RF1'); break;
        default: break;
      }
      this.st = st;
    }
    if (this.hasE && !E && this.st !== 'gpost' && this.tr.E) { this.#leave(this.tr.E); }
    this.hasE = E;
  }
  /** Advance the moves by `dt` real seconds. */
  step(dt) {
    for (let i = this.tw.length - 1; i >= 0; i--) {
      const x = this.tw[i]; x.t += dt; const u = Math.min(1, x.t / x.dur);
      x.o[x.k] = x.a + (x.b - x.a) * ease(u);
      if (u >= 1) { this.tw.splice(i, 1); x.done?.(); }
    }
  }
  /** Every tRNA in or at the ribosome (colour, fade, position of every residue), the factors that are in, the antibiotics bound, and the mRNA's beads. */
  bodies() {
    const out = [], all = [...Object.values(this.tr), this.incoming?.tr].filter((t) => t && t.fade > 0.01), seen = new Set();
    for (const t of all) {
      if (seen.has(t)) continue; seen.add(t);
      const arriving = this.incoming?.tr === t && this.incoming.arr && t.off ? scale(t.off, 1 - this.incoming.arr.w) : null;
      out.push({ id: t.id, colour: PALETTE[t.id % PALETTE.length], fade: t.fade, positions: trnaCoords(this.frame, { ...t, shift: arriving }) });
    }
    const arrival = (b) => (b.kind === 'EF-Tu' && this.incoming?.arr && this.incoming.ef === b ? this.incoming.arr.w : b.w);
    const factors = [...Object.values(this.fb), ...(this.leaving ?? [])].filter((b) => b.fade > 0.01).map((b) => {
      const shift = scale(this.off[b.kind], 1 - arrival(b));
      return { kind: b.kind, colour: FACTOR_COLOURS[b.kind], fade: b.fade, positions: b.ref.map((p, i) => { const q = b.morph && b.m ? [0, 1, 2].map((k) => p[k] + (b.morph[i][k] - p[k]) * b.m) : p; return add(q, shift); }) };
    });
    const drugs = Object.entries(this.drugs).filter(([, on]) => on).flatMap(([name]) => (this.factors?.drugs?.[name] ? [{ name, label: DRUG_NAMES[name] ?? name, position: this.factors.drugs[name] }] : []));
    return { trna: out, factors, drugs, mrna: { positions: mrnaCoords(this.frame, this.mOff), fade: this.mFade }, sites: Object.fromEntries(['E', 'P', 'A'].map((k) => [k, this.tr[k]?.id ?? null])) };
  }
  get busy() { return this.tw.length > 0; }
}

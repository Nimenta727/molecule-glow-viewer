import { ribosomeFrame, RibosomeMotion, applyPose } from '../../plugins/simulation/ribosome-motion.mjs';
import { selectionSpace } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';
import { kwMatch } from '../../plugins/simulation/structure-frame.mjs';
import { loadAlignedEntry } from '../../plugins/simulation/entry-alignment.mjs';

/**
 * The tRNAs and mRNA of a translating ribosome in the Viewer (classic: the moving tRNA and mRNA bodies of the translation process): the poses come from the structure's own E / P / A tRNAs
 * (plugins/simulation/ribosome-motion.mjs), the state from the translation process (its discrete state `st` and whether the E site is occupied), and every residue is drawn as a bead.
 * The static tRNA and mRNA parts of the structure are hidden while it runs and shown again when it stops. Needs a structure with an mRNA and three tRNAs (4V6F); with anything else it stays off.
 * The factors are fetched from RCSB when the view starts (the structures of the other states, superposed on this ribosome by its 23S rRNA; a failed download only leaves that one out): the bent A/T tRNA
 * and EF-Tu (4V5L, GDP form 1TUI), EF-G (4V9H, post-translocation 4V5F), RF1 (4V7P) and the antibiotics at their crystal sites (4V9A, 4V51, 6ND5, 4V5F). Not drawn here: the nascent chain, the exit
 * tunnel, erythromycin and kirromycin (they need the exit tunnel and CCD templates), the close-ups.
 */
const CLOUD = 'ribosome-trna', FACTOR_CLOUD = 'ribosome-factors', DRUG_CLOUD = 'ribosome-drugs', BEAD = 3.4;
const fetchText = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
const fetchJson = async (query) => (await fetch('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).json();
const fetchers = { fetchText, fetchJson };

/** The factors and antibiotics of the other crystal structures, in the ribosome's frame (the classic's alignEntry calls of the translation setup). Each failed download is left out. */
export async function loadFactors(frame, residues, token) {
  const first = residues.find((r) => /23s/i.test(r.entity) && r.nucleic)?.labelAsym;
  const refAtoms = residues.filter((r) => /23s/i.test(r.entity) && r.nucleic && r.labelAsym === first).map((r) => ({ p: [...r.position], seq: r.labelSeq, aseq: String(r.authSeq) }));
  const ref16 = (() => { const f16 = residues.find((r) => /16s/i.test(r.entity) && r.nucleic)?.labelAsym; return residues.filter((r) => /16s/i.test(r.entity) && r.nucleic && r.labelAsym === f16).map((r) => ({ p: [...r.position], seq: r.labelSeq, aseq: String(r.authSeq) })); })();
  const J = (id, o) => loadAlignedEntry(id, { refAtoms: o.ref === '16S' ? ref16 : refAtoms, ...o }, fetchers).catch(() => null);
  const S = frame.sites, last = frame.n - 1, dec = frame.mPts[Math.min(frame.mPts.length - 1, frame.jP + 4)];
  const aEnd = applyPose(frame, S.A, frame.T0[last]), aAnti = applyPose(frame, S.A, frame.T0[Math.min(frame.n - 1, 34)]);
  const [tu, g1, g2, rf, tac, par, clm] = await Promise.all([
    J('4V5L', { ref: '23S', chains: [['tu', 'ELONGATION FACTOR TU'], ['tr', 'A-SITE TRNA']] }), J('4V9H', { ref: '23S', chains: [['g', 'Elongation factor G']] }),
    J('4V5F', { ref: '23S', chains: [['g', 'ELONGATION FACTOR G']], ligands: ['FUA'] }), J('4V7P', { ref: '23S', chains: [['rf', 'release factor 1']] }),
    J('4V9A', { ref: '16S', ligands: ['TAC'], near: { TAC: aAnti } }), J('4V51', { ref: '16S', ligands: ['PAR'], near: { PAR: dec } }), J('6ND5', { ref: '23S', ligands: ['CLM'], near: { CLM: aEnd } }),
  ]);
  if (token.cancelled) return null;
  const out = { drugs: {} };
  if (tu?.chains.tu && tu.chains.tr) {
    const byA = new Map(), byS = new Map(); for (const a of tu.chains.tr.atoms) { const k = Number.parseInt(a.aseq, 10); if (k) byA.set(k, a.p); byS.set(a.seq, a.p); }
    out.at = byA.size >= 50 ? byA : byS; out.tu = { ref: tu.chains.tu.atoms.map((a) => a.p) };
    try {   // the GDP form (1TUI), fitted on domains 2 and 3 so that domain 1 shows its real swing
      const dom = tu.chains.tu.atoms.filter((a) => (Number.parseInt(a.aseq, 10) || a.seq) > 212).map((a) => ({ p: a.p, seq: a.seq, aseq: String(a.aseq) }));
      const gdp = await loadAlignedEntry('1TUI', { ref: 'ELONGATION FACTOR TU', refAtoms: dom, refNa: false, chains: [['tu', 'ELONGATION FACTOR TU']] }, fetchers);
      const map = new Map(gdp.chains.tu.atoms.map((a) => [String(gdp.key === 'seq' ? a.seq : a.aseq), a.p]));
      out.tu.gdp = tu.chains.tu.atoms.map((a) => map.get(String(gdp.key === 'seq' ? a.seq : a.aseq)) ?? a.p);
    } catch { /* no GDP form: EF-Tu keeps its shape */ }
  }
  const G1 = g1?.chains.g?.atoms ?? g2?.chains.g?.atoms;
  if (G1) {
    out.g = { ref: G1.map((a) => a.p) };
    if (g1?.chains.g && g2?.chains.g) {   // residues matched by whichever numbering puts them closer
      const tryKey = (k) => { const m = new Map(g2.chains.g.atoms.map((a) => [String(a[k]), a.p])); let sum = 0, n = 0; const post = G1.map((a) => { const p = m.get(String(a[k])); if (p) { sum += Math.hypot(...p.map((v, i) => v - a.p[i])); n++; } return p ?? a.p; }); return { post, d: n > 100 ? sum / n : 1e9 }; };
      const a = tryKey('seq'), b = tryKey('aseq'); out.g.post = (a.d <= b.d ? a : b).post;
    }
  }
  if (rf?.chains.rf) out.rf = { ref: rf.chains.rf.atoms.map((a) => a.p) };
  for (const [name, entry, comp] of [['TAC', tac, 'TAC'], ['PAR', par, 'PAR'], ['CLM', clm, 'CLM'], ['FUA', g2, 'FUA']]) { const l = entry?.ligands[comp]; if (l) out.drugs[name] = l.centre; }
  return out;
}

export function createRibosomeView({ viewport, context, process, speed = () => 0.02 }) {
  let motion = null, frameId = null, last = 0, hidden = [], running = false, token = { cancelled: true };

  function build() {
    const model = context.model();
    if (!model) return false;
    const space = selectionSpace(model);
    try { motion = new RibosomeMotion(ribosomeFrame(space.residues.map((r) => ({ p: r.position, part: r.entity, seq: r.labelSeq, asym: r.labelAsym }))), { speed: speed() }); } catch { motion = null; return false; }
    const mine = token = { cancelled: false }, mineMotion = motion;   // the factors arrive later; a stopped or restarted view ignores them
    loadFactors(mineMotion.frame, space.residues, mine).then((factors) => { if (factors && !mine.cancelled && motion === mineMotion) motion.setFactors(factors); }).catch(() => {});
    return true;
  }
  function hideStatic() {
    const ids = [];
    for (const [key, nodes] of context.parts()) { let name = ''; try { name = String(JSON.parse(key)[1] ?? ''); } catch { /* not a part key */ } if (kwMatch(name, '/trna|^mrna$/')) ids.push(...nodes.map(({ id }) => id)); }
    if (ids.length) { viewport.setNodeVisibility(ids, false); hidden = ids; }
  }
  function showStatic() { if (hidden.length) viewport.setNodeVisibility(hidden, true); hidden = []; }

  function draw() {
    const model = context.model();
    if (!motion || !model) { viewport.setParticleCloud(CLOUD, []); viewport.setParticleCloud(FACTOR_CLOUD, []); viewport.setParticleCloud(DRUG_CLOUD, []); return; }
    const centre = displayCenter(model), k = PRESENTATION_METERS_PER_ANGSTROM, b = motion.bodies(), items = [];
    const place = (p) => p.map((v, i) => (v - centre[i]) * k);
    b.trna.forEach((t, n) => t.positions.forEach((p, i) => items.push({ position: place(p), radius: BEAD * k, color: t.colour, alpha: t.fade, name: 'tRNA', ...(i === t.positions.length - 1 && n < 3 ? { label: 'tRNA 受体端' } : {}) })));
    if (b.mrna.fade > 0.01) b.mrna.positions.forEach((p) => items.push({ position: place(p), radius: BEAD * 0.8 * k, color: '#e0a000', alpha: b.mrna.fade, name: 'mRNA' }));
    viewport.setParticleCloud(CLOUD, items, { overlay: false });
    viewport.setParticleCloud(FACTOR_CLOUD, b.factors.flatMap((f) => f.positions.map((p) => ({ position: place(p), radius: 2.6 * k, color: f.colour, alpha: f.fade * 0.85, name: f.kind }))));
    viewport.setParticleCloud(DRUG_CLOUD, b.drugs.map((d) => ({ position: place(d.position), radius: 6 * k, color: '#ff5a5a', name: d.label, label: d.label })), { overlay: true });
  }
  const tick = (now) => {
    if (!running) { frameId = null; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016); last = now;
    const s = process.summary();
    if (s && motion) { motion.speed = speed(); motion.sync({ st: s.vars?.st, E: s.vars?.E === 'on', drugs: Object.fromEntries(['TAC', 'PAR', 'CLM'].map((d) => [d, s.vars?.[`b${d}`] === 'on']).concat([['FUA', s.vars?.fua === 'on']])) }); motion.step(dt); draw(); }
    frameId = requestAnimationFrame(tick);
  };
  return {
    /** The translation process was loaded: build the poses from the structure and start following it. */
    start() { this.stop(); if (!build()) return false; hideStatic(); running = true; last = 0; frameId = requestAnimationFrame(tick); return true; },
    stop() { token.cancelled = true; running = false; if (frameId != null) cancelAnimationFrame(frameId); frameId = null; showStatic(); viewport.setParticleCloud(CLOUD, []); viewport.setParticleCloud(FACTOR_CLOUD, []); viewport.setParticleCloud(DRUG_CLOUD, []); motion = null; },
    /** After the viewport was rebuilt: hide the static parts again and draw. */
    reapply() { if (running && motion) { hideStatic(); draw(); } },
    get active() { return running; },
  };
}

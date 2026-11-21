import { ribosomeFrame, RibosomeMotion, applyPose, polylineLength } from '../../plugins/simulation/ribosome-motion.mjs';
import { selectionSpace } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';
import { kwMatch } from '../../plugins/simulation/structure-frame.mjs';
import { loadAlignedEntry } from '../../plugins/simulation/entry-alignment.mjs';
import { findChannel, alongPath } from '../../plugins/structure/site-analysis.mjs';

/**
 * The tRNAs and mRNA of a translating ribosome in the Viewer (classic: the moving tRNA and mRNA bodies of the translation process): the poses come from the structure's own E / P / A tRNAs
 * (plugins/simulation/ribosome-motion.mjs), the state from the translation process (its discrete state `st` and whether the E site is occupied), and every residue is drawn as a bead.
 * The static tRNA and mRNA parts of the structure are hidden while it runs and shown again when it stops. Needs a structure with an mRNA and three tRNAs (4V6F); with anything else it stays off.
 * The factors are fetched from RCSB when the view starts (the structures of the other states, superposed on this ribosome by its 23S rRNA; a failed download only leaves that one out): the bent A/T tRNA
 * and EF-Tu (4V5L, GDP form 1TUI), EF-G (4V9H, post-translocation 4V5F), RF1 (4V7P) and the antibiotics at their crystal sites (4V9A, 4V51, 6ND5, 4V5F, 6XHX, 4V5P). The exit tunnel is found in the
 * ribosome (maximal-clearance path from the peptidyl transferase centre, as the classic) and carries the nascent chain, one bead per residue coloured by its kind. Not drawn here: the atom-level close-ups.
 */
const CLOUD = 'ribosome-trna', FACTOR_CLOUD = 'ribosome-factors', DRUG_CLOUD = 'ribosome-drugs', BEAD = 3.4;
const fetchText = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
const fetchJson = async (query) => (await fetch('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).json();
const fetchers = { fetchText, fetchJson };

/** The factors and antibiotics of the other crystal structures, in the ribosome's frame (the classic's alignEntry calls of the translation setup). Each failed download is left out. */
export async function loadFactors(frame, residues, token, { tunnelPoint = null } = {}) {
  const first = residues.find((r) => /23s/i.test(r.entity) && r.nucleic)?.labelAsym;
  const refAtoms = residues.filter((r) => /23s/i.test(r.entity) && r.nucleic && r.labelAsym === first).map((r) => ({ p: [...r.position], seq: r.labelSeq, aseq: String(r.authSeq) }));
  const ref16 = (() => { const f16 = residues.find((r) => /16s/i.test(r.entity) && r.nucleic)?.labelAsym; return residues.filter((r) => /16s/i.test(r.entity) && r.nucleic && r.labelAsym === f16).map((r) => ({ p: [...r.position], seq: r.labelSeq, aseq: String(r.authSeq) })); })();
  const J = (id, o) => loadAlignedEntry(id, { refAtoms: o.ref === '16S' ? ref16 : refAtoms, ...o }, fetchers).catch(() => null);
  const S = frame.sites, last = frame.n - 1, dec = frame.mPts[Math.min(frame.mPts.length - 1, frame.jP + 4)];
  const aEnd = applyPose(frame, S.A, frame.T0[last]), aAnti = applyPose(frame, S.A, frame.T0[Math.min(frame.n - 1, 34)]);
  const [tu, g1, g2, rf, tac, par, clm, ery, kir] = await Promise.all([
    J('4V5L', { ref: '23S', chains: [['tu', 'ELONGATION FACTOR TU'], ['tr', 'A-SITE TRNA']] }), J('4V9H', { ref: '23S', chains: [['g', 'Elongation factor G']] }),
    J('4V5F', { ref: '23S', chains: [['g', 'ELONGATION FACTOR G']], ligands: ['FUA'] }), J('4V7P', { ref: '23S', chains: [['rf', 'release factor 1']] }),
    J('4V9A', { ref: '16S', ligands: ['TAC'], near: { TAC: aAnti } }), J('4V51', { ref: '16S', ligands: ['PAR'], near: { PAR: dec } }), J('6ND5', { ref: '23S', ligands: ['CLM'], near: { CLM: aEnd } }),
    tunnelPoint ? J('6XHX', { ref: '23S', ligands: ['ERY'], near: { ERY: tunnelPoint } }) : null, J('4V5P', { ref: '23S', ligands: ['KIR'] }),
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
  for (const [name, entry, comp] of [['TAC', tac, 'TAC'], ['PAR', par, 'PAR'], ['CLM', clm, 'CLM'], ['FUA', g2, 'FUA'], ['ERY', ery, 'ERY'], ['KIR', kir, 'KIR']]) { const l = entry?.ligands[comp]; if (l) out.drugs[name] = l.centre; }
  return out;
}

/** The exit tunnel: the path of maximal clearance from the peptidyl transferase centre out through the large subunit (classic setup), as points; a straight line away from the small subunit when none is found. */
export function exitTunnel(frame, residues) {
  const S = frame.sites, last = frame.n - 1, end = (pose) => applyPose(frame, pose, frame.T0[last]), ptc = end(S.P).map((v, i) => (v + end(S.A)[i]) / 2);
  const centre = (re) => { const list = residues.filter((r) => re.test(r.entity)); return list.reduce((t, r) => t.map((v, i) => v + r.position[i] / list.length), [0, 0, 0]); };
  const c16 = centre(/16s/i), c23 = centre(/23s/i), up = c23.map((v, i) => v - c16[i]), l = Math.hypot(...up) || 1, u = up.map((v) => v / l);
  // the search reaches 90 Å from the start and clearance looks 16 Å around a cell: only residues within 110 Å of the start can matter (the same path, a fraction of the time)
  const near = residues.map((r) => r.position).filter((p) => Math.hypot(p[0] - ptc[0], p[1] - ptc[1], p[2] - ptc[2]) < 110);
  const channel = findChannel(near, ptc, { h: 2, radius: 90, minClear: 4, openClear: 14, minLen: 70, allowed: (p) => (p[0] - ptc[0]) * u[0] + (p[1] - ptc[1]) * u[1] + (p[2] - ptc[2]) * u[2] > -6 });
  return channel ? channel.map((x) => x.p) : [ptc, ptc.map((v, i) => v + u[i] * 100)];
}
const AA_COLOUR = { fM: '#e6c84a', A: '#c9bf99', V: '#c9bf99', L: '#c9bf99', I: '#c9bf99', M: '#c9bf99', P: '#b6a37a', G: '#d9d9d9', F: '#8fa8d8', W: '#8fa8d8', Y: '#8fa8d8', S: '#8fd0a8', T: '#8fd0a8', N: '#8fd0a8', Q: '#8fd0a8', C: '#e8d56a', K: '#5b7fe0', R: '#5b7fe0', H: '#7fa0e8', D: '#e0605a', E: '#e0605a' };
const CHAIN_CLOUD = 'ribosome-nascent-chain';

export function createRibosomeView({ viewport, context, process, speed = () => 0.02, status = () => {} }) {
  let synced = null, motion = null, frameId = null, last = 0, hidden = [], running = false, token = { cancelled: true }, aaSequence = '';

  function build() {
    const model = context.model();
    if (!model) return false;
    const space = selectionSpace(model);
    try { motion = new RibosomeMotion(ribosomeFrame(space.residues.map((r) => ({ p: r.position, part: r.entity, seq: r.labelSeq, asym: r.labelAsym }))), { speed: speed() }); } catch { motion = null; return false; }
    const mine = token = { cancelled: false }, mineMotion = motion;   // the factors arrive later; a stopped or restarted view ignores them
    setTimeout(() => {   // the tunnel search takes a moment: after the first frames; the factors need its point for the erythromycin site
      if (mine.cancelled || motion !== mineMotion) return;
      status('正在计算肽链出口通道（约几秒）…');
      let tunnel = null; try { tunnel = exitTunnel(mineMotion.frame, space.residues); } catch { tunnel = null; }
      status(tunnel ? `肽链出口通道 ${polylineLength(tunnel).toFixed(0)} Å；正在下载 EF-Tu、EF-G、RF1 和抗生素结构…` : '没找到出口通道；正在下载因子结构…');
      if (tunnel) mineMotion.setTunnel(tunnel);
      loadFactors(mineMotion.frame, space.residues, mine, { tunnelPoint: tunnel ? alongPath(tunnel, 14) : null }).then((factors) => { if (factors && !mine.cancelled && motion === mineMotion) { motion.setFactors(factors); status(`因子与抗生素结构就绪（抗生素位点：${Object.keys(factors.drugs).join('、') || '无'}）。`); } }).catch(() => status('因子结构没下载成功：只画 tRNA、mRNA 和肽链。'));
    }, 0);
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
    if (!motion || !model) { viewport.setParticleCloud(CLOUD, []); viewport.setParticleCloud(FACTOR_CLOUD, []); viewport.setParticleCloud(DRUG_CLOUD, []); viewport.setParticleCloud(CHAIN_CLOUD, []); return; }
    const centre = displayCenter(model), k = PRESENTATION_METERS_PER_ANGSTROM, b = motion.bodies(), items = [];
    const place = (p) => p.map((v, i) => (v - centre[i]) * k);
    b.trna.forEach((t, n) => t.positions.forEach((p, i) => items.push({ position: place(p), radius: BEAD * k, color: t.colour, alpha: t.fade, name: 'tRNA', ...(i === t.positions.length - 1 && n < 3 ? { label: 'tRNA 受体端' } : {}) })));
    if (b.mrna.fade > 0.01) b.mrna.positions.forEach((p) => items.push({ position: place(p), radius: BEAD * 0.8 * k, color: '#e0a000', alpha: b.mrna.fade, name: 'mRNA' }));
    viewport.setParticleCloud(CLOUD, items, { overlay: false });
    viewport.setParticleCloud(FACTOR_CLOUD, b.factors.flatMap((f) => f.positions.map((p) => ({ position: place(p), radius: 2.6 * k, color: f.colour, alpha: f.fade * 0.85, name: f.kind }))));
    const bead = (x, scale, fade) => ({ position: place(x.position), radius: 2.5 * scale * k, color: AA_COLOUR[x.aa] ?? '#c9bf99', alpha: fade, name: '新生肽链' });
    viewport.setParticleCloud(CHAIN_CLOUD, [...b.chain.map((x) => bead(x, 1, 1)), ...b.released.flatMap((r) => r.beads.map((x) => bead(x, Math.max(0.2, r.fade), r.fade)))]);
    viewport.setParticleCloud(DRUG_CLOUD, b.drugs.map((d) => ({ position: place(d.position), radius: 6 * k, color: '#ff5a5a', name: d.label, label: d.label })), { overlay: true });
  }
  const tick = (now) => {
    if (!running) { frameId = null; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016); last = now;
    const s = process.summary();
    if (s && motion) {
      motion.speed = speed();
      const asState = (x) => { const L = Number(x.nums?.L) || 0; return { st: x.vars?.st, E: x.vars?.E === 'on', chain: L ? ['fM', ...aaSequence.slice(1, L).split('')] : [], drugs: Object.fromEntries(['TAC', 'PAR', 'CLM', 'ERY'].map((d) => [d, x.vars?.[`b${d}`] === 'on']).concat([['FUA', x.vars?.fua === 'on'], ['KIR', x.vars?.kir === 'on']])) }; };
      // every state since the last frame, in order (the moves follow transitions); after a reset or a jump back, only the present state
      const passed = synced != null && s.time >= synced && process.statesBetween ? process.statesBetween(synced, s.time) : [];
      motion.syncAll([...passed.map(asState), asState(s)]); synced = s.time;
      motion.step(dt); draw();
    }
    frameId = requestAnimationFrame(tick);
  };
  return {
    /** The translation process was loaded: build the poses from the structure and start following it. */
    start(sequence = '') { this.stop(); synced = null; aaSequence = String(sequence); if (!build()) return false; hideStatic(); running = true; last = 0; frameId = requestAnimationFrame(tick); return true; },
    stop() { token.cancelled = true; running = false; if (frameId != null) cancelAnimationFrame(frameId); frameId = null; showStatic(); viewport.setParticleCloud(CLOUD, []); viewport.setParticleCloud(FACTOR_CLOUD, []); viewport.setParticleCloud(DRUG_CLOUD, []); viewport.setParticleCloud(CHAIN_CLOUD, []); motion = null; },
    /** After the viewport was rebuilt: hide the static parts again and draw. */
    reapply() { if (running && motion) { hideStatic(); draw(); } },
    /** Read-only state for checks: whether it follows the process, and how many bodies it would draw now. */
    status() { let b = null; try { b = motion?.bodies(); } catch { b = null; } return { running, built: Boolean(motion), frameQueued: frameId != null, trna: b?.trna.length ?? 0, mrnaFade: b?.mrna?.fade ?? 0, chain: b?.chain.length ?? 0, factors: b?.factors.length ?? 0 }; },
    get active() { return running; },
    /** The sites of the ribosome (for the close-ups), or null when the view is off. */
    get frame() { return running && motion ? motion.frame : null; },
  };
}

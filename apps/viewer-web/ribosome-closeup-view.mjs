import { buildSite, partBonds, partPositions, closeupState, stepFlip, SITE_RADIUS } from '../../plugins/simulation/ribosome-closeup.mjs';
import { loadAlignedEntry, atomsOf, rowOf } from '../../plugins/simulation/entry-alignment.mjs';
import { elementStyle } from '../../plugins/structure/elements.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';

/**
 * The atom-level close-ups of the translation work in the Viewer (classic: the "解码中心" / "肽基转移中心" views): the real atoms around the A-site anticodon and the 3' end of the A-site tRNA, fetched
 * from RCSB's ModelServer and put in the scene by fitting 4V6F's own 16S onto it (1J5E gives the stacked A1492 / A1493). Drawn as balls (element colours) and bonds guessed from distances, the
 * codon-anticodon hydrogen bonds dashed (green), A1492 / A1493 flipping out with the process state. The logic is plugins/simulation/ribosome-closeup.mjs.
 */
const ATOMS = 'ribosome-closeup-atoms', LABELS = 'ribosome-closeup-labels', BONDS = 'ribosome-closeup-bonds', HBONDS = 'ribosome-closeup-hbonds', MODEL_SERVER = (id, q) => `https://models.rcsb.org/v1/${id.toLowerCase()}/${q}`;
const fetchText = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
const fetchJson = async (query) => (await fetch('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).json();

/** The atoms of the two sites in the scene frame (see above). `residues`: the scene's residues ({ position, entity, nucleic, labelSeq, authSeq }). */
export async function loadCloseup(frame, residues) {
  const dec = frame.ids.decoding, loc = residues.filter((r) => /16s/i.test(r.entity) && r.nucleic && Math.hypot(...r.position.map((v, i) => v - dec[i])) < 45).map((r) => ({ p: [...r.position], seq: r.labelSeq, aseq: String(r.authSeq) }));
  const fetchers = { fetchText, fetchJson };
  const [me, apo] = await Promise.all([loadAlignedEntry('4V6F', { ref: '16S', refAtoms: loc }, fetchers), loadAlignedEntry('1J5E', { ref: '16S', refAtoms: loc }, fetchers).catch(() => null)]);
  const meta = (await fetchJson('{ entry(entry_id:"4V6F"){ polymer_entities{ rcsb_polymer_entity{pdbx_description} rcsb_polymer_entity_container_identifiers{asym_ids} } } }')).data.entry, names = {};
  for (const e of meta.polymer_entities ?? []) for (const a of e.rcsb_polymer_entity_container_identifiers.asym_ids ?? []) names[a] = e.rcsb_polymer_entity.pdbx_description ?? '';
  const around = async (seq, radius) => atomsOf(await fetchText(MODEL_SERVER('4V6F', `residueSurroundings?label_asym_id=${frame.ids.asymA}&label_seq_id=${seq}&radius=${radius}&encoding=cif&copy_all_categories=false`))).map(rowOf).map((r) => ({ ...r, p: me.f(r.p) }));
  const [dc, ptc] = await Promise.all([around(frame.ids.seqAC, SITE_RADIUS.dc), around(frame.ids.seqA76, SITE_RADIUS.ptc)]);
  const apoRows = []; if (apo) for (const n of [1492, 1493]) apoRows.push(...atomsOf(await fetchText(MODEL_SERVER('1J5E', `atoms?label_asym_id=${apo.refAsym}&auth_seq_id=${n}&encoding=cif&copy_all_categories=false`))).map(rowOf).map((r) => ({ ...r, p: apo.f(r.p) })));
  const nameOf = (a) => names[a] ?? '', ids = frame.ids;
  return { dc: buildSite(dc, 'dc', ids, nameOf, apoRows), ptc: buildSite(ptc, 'ptc', ids, nameOf, []), apo: Boolean(apo) };
}


export function createRibosomeCloseup({ viewport, elements, context, process, status = () => {} }) {
  let data = null, loading = null, view = null, w = 1, frameId = null, last = 0, lastKey = '', token = { cancelled: true };

  function draw(force = false) {
    const model = context.model(); if (!data || !model || !view) return;
    const s = process.summary(), state = closeupState({ st: s?.vars?.st ?? 'post', cognate: s?.vars?.inc !== 'n' });
    const dt = 0.016; w = stepFlip(w, state.wTarget, dt);
    const site = data[view], showA = state.showA[view], key = JSON.stringify([view, showA, Math.round(w * 50)]);
    if (!force && key === lastKey) return; lastKey = key;
    const k = PRESENTATION_METERS_PER_ANGSTROM, c = displayCenter(model), toRoot = (p) => p.map((v, i) => (v - c[i]) * k), balls = [], bonds = [], tags = [];
    for (const part of site.parts) {
      if (part.kind === 'A' && !showA) continue;
      const pos = partPositions(part, w);
      pos.forEach((p, i) => { const [colour, radius] = elementStyle(part.atoms[i].element); balls.push({ position: toRoot(p), radius: Math.min(radius, 1.2) * 0.35 * k, color: colour, name: part.label }); });
      for (const [a, b] of partBonds(part)) bonds.push({ a: toRoot(pos[a]), b: toRoot(pos[b]), color: part.colour });
      tags.push({ position: toRoot(part.flip ? pos.reduce((q, p) => q.map((v, i) => v + p[i] / pos.length), [0, 0, 0]) : part.centre), radius: 0.15 * k, color: part.colour, alpha: 0.9, name: part.label, ...(part.hot || part.kind !== 'prot' ? { label: part.label } : {}) });
    }
    viewport.setParticleCloud(ATOMS, balls, { overlay: true }); viewport.setParticleCloud(LABELS, tags, { overlay: true });
    viewport.setOverlayLines(BONDS, bonds, { dash: 1, gap: 0 });
    viewport.setOverlayLines(HBONDS, site.bonds.filter((h) => showA && (h.kind === 'wc' || w > 0.9)).map((h) => ({ a: toRoot(h.a), b: toRoot(h.b), color: h.kind === 'wc' ? '#2f9e44' : '#e8590c' })), { dash: 0.35 * k, gap: 0.25 * k });
    elements.info.textContent = view === 'dc' ? state.decoding : state.ptc;
  }
  const tick = () => { if (!view) { frameId = null; return; } draw(); frameId = requestAnimationFrame(tick); };

  function clear() { for (const tag of [ATOMS, LABELS]) viewport.setParticleCloud(tag, []); for (const tag of [BONDS, HBONDS]) viewport.setOverlayLines(tag, []); lastKey = ''; }
  async function open(which, getFrame) {
    const model = context.model(), frame = getFrame(); if (!model || !frame) return;
    if (!loading) { token = { cancelled: false }; status('下载解码中心与肽基转移中心的全原子坐标（4V6F + 1J5E，几秒）…'); loading = loadCloseup(frame, context.residues()).then((d) => { data = d; status(`近景就绪：解码中心 ${d.dc.parts.length} 个残基，肽基转移中心 ${d.ptc.parts.length} 个残基${d.apo ? '' : '（1J5E 没取到：A1492/A1493 不做翻转）'}。`); }).catch((error) => { loading = null; status(`近景下载失败：${error.message}`); throw error; }); }
    try { await loading; } catch { return; }
    view = which; w = 1; lastKey = ''; draw(true);
    const centre = data[which].centre, k = PRESENTATION_METERS_PER_ANGSTROM, c = displayCenter(model), target = centre.map((v, i) => (v - c[i]) * k), distance = (which === 'dc' ? 40 : 52) * k;
    const back = context.cameraDirection?.() ?? [0, 0, 1];
    viewport.setCamera({ position: target.map((v, i) => v + back[i] * distance), target }, { duration: 1.6 });
    if (frameId == null) frameId = requestAnimationFrame(tick);
  }
  return {
    bind(getFrame) { elements.dc.onclick = () => open('dc', getFrame); elements.ptc.onclick = () => open('ptc', getFrame); elements.off.onclick = () => { view = null; clear(); elements.info.textContent = ''; }; },
    show(on) { elements.box.hidden = !on; },
    reset() { view = null; data = null; loading = null; token.cancelled = true; clear(); elements.box.hidden = true; },
  };
}

import { measure, MeasureError } from '../../plugins/structure/measure.mjs';
import { findChannel, describeChannel, cofactorChain } from '../../plugins/structure/site-analysis.mjs';
import { evaluateSelection } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';

/**
 * Measure and channel (classic: glow.measure and the pore search of the automatic mode): the distance between two selections or the angle at the middle of three, drawn as a dashed
 * line and written out; and the path of maximal clearance through the structure from a start (a selection, or the middle of the structure), drawn as a string of balls coloured by how
 * wide the way is, with its length, narrowest point and the residues lining it. The numbers come from plugins/structure/measure.mjs and site-analysis.mjs (equal to the classic).
 */
const LINE = 'measure', PATH = 'channel', CHAIN = 'cofactors', CHAIN_DOTS = 'cofactor-sites';
const colourOf = (clearance) => (clearance < 3 ? '#e5484d' : clearance < 5 ? '#e6a23c' : '#3b9ae6');

export function createAnalysisPanel({ viewport, elements, context }) {
  const toRoot = (model) => { const centre = displayCenter(model); return (p) => p.map((v, i) => (v - centre[i]) * PRESENTATION_METERS_PER_ANGSTROM); };
  const clearMeasure = () => { viewport.setOverlayLines(LINE, []); elements.measureOut.textContent = ''; };
  const clearChannel = () => { viewport.setParticleCloud(PATH, []); elements.channelOut.textContent = ''; };

  elements.measure.addEventListener('click', () => {
    clearMeasure();
    const model = context.model(); if (!model) return;
    try {
      const result = measure(context.space(), [elements.a.value, elements.b.value, elements.c.value]), convert = toRoot(model);
      viewport.setOverlayLines(LINE, result.positions.slice(1).map((p, i) => ({ a: convert(result.positions[i]), b: convert(p), color: '#d9a400' })), { dash: 0.01, gap: 0.006 });
      elements.measureOut.textContent = result.distance != null
        ? `${result.points[0]} — ${result.points[1]}：${result.distance.toFixed(2)} Å`
        : `${result.points[0]} — ${result.points[1]} — ${result.points[2]}：${result.angle.toFixed(1)}°（${result.points[1]} 是顶点）`;
    } catch (error) { elements.measureOut.textContent = error instanceof MeasureError || error.name === 'SelectionError' ? error.message : `测量失败：${error.message}`; }
  });
  elements.measureClear.addEventListener('click', clearMeasure);

  elements.channel.addEventListener('click', () => {
    clearChannel();
    const model = context.model(); if (!model) return;
    const space = context.space(), points = space.residues.map((r) => [...r.position]);
    let start;
    try {
      if (elements.start.value.trim()) {
        const found = evaluateSelection(elements.start.value, space), pos = [...found.residues.map((r) => r.position), ...found.ligands.map((l) => l.atoms.reduce((s, a) => s.map((v, k) => v + a.position[k] / l.atoms.length), [0, 0, 0]))];
        if (!pos.length) { elements.channelOut.textContent = '起点没有选中任何东西。'; return; }
        start = pos.reduce((s, p) => s.map((v, k) => v + p[k] / pos.length), [0, 0, 0]);
      } else start = points.reduce((s, p) => s.map((v, k) => v + p[k] / points.length), [0, 0, 0]);
    } catch (error) { elements.channelOut.textContent = error.message; return; }
    elements.channelOut.textContent = '正在搜索 …';
    setTimeout(() => {
      const minClear = Math.max(1.5, Math.min(8, Number(elements.minClear.value) || 3)), path = findChannel(points, start, { h: 2, radius: 60, minClear, openClear: 12, minLen: 20 }), report = describeChannel(path, space.residues);
      if (!report) { elements.channelOut.textContent = `从这个起点没有找到通到外面的路（要求路径上的净空都不小于 ${minClear} Å，出口处是开阔溶剂）。试试换一个起点，例如孔道中央的残基，或把最窄净空调小。`; return; }
      const convert = toRoot(model), k = PRESENTATION_METERS_PER_ANGSTROM;
      viewport.setParticleCloud(PATH, path.map((x) => ({ position: convert(x.p), radius: Math.min(x.r, 6) * 0.25 * k, color: colourOf(x.r), name: `通道 · 净空半径 ${x.r.toFixed(1)} Å` })), { overlay: true });
      const names = report.lining.map(({ residue: r }) => `${r.resn} ${r.chain}:${r.authSeq}`).join('、');
      elements.channelOut.textContent = `路径长 ${report.length.toFixed(1)} Å，最窄处净空半径 ${report.narrowest.toFixed(2)} Å（红 <3 Å，橙 <5 Å，蓝更宽）；最窄处附近的残基：${names}。净空是到最近 Cα/P 的距离，不是水分子能否通过的判断。`;
    }, 20);
  });
  elements.channelClear.addEventListener('click', clearChannel);

  const clearChain = () => { viewport.setOverlayLines(CHAIN, []); viewport.setParticleCloud(CHAIN_DOTS, []); elements.chainOut.textContent = ''; };
  const centre = (ligand) => ligand.atoms.reduce((t, a) => t.map((v, k) => v + a.position[k] / ligand.atoms.length), [0, 0, 0]);
  elements.chain.addEventListener('click', () => {
    clearChain();
    const model = context.model(); if (!model) return;
    const space = context.space(), comps = elements.chainComps.value.split(/[\s,;、]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const sites = space.ligands.filter((l) => comps.includes(l.comp)).map((l) => ({ comp: l.comp, position: centre(l) }));
    if (sites.length < 2) { elements.chainOut.textContent = `结构里只有 ${sites.length} 个“${comps.join('、')}”辅因子，连不成链。`; return; }
    const point = (expression) => { if (!expression.trim()) return undefined; const f = evaluateSelection(expression, space), list = [...f.residues.map((r) => r.position), ...f.ligands.map(centre)]; if (!list.length) throw new Error(`“${expression}” 没有选中任何东西。`); return list.reduce((t, p) => t.map((v, k) => v + p[k] / list.length), [0, 0, 0]); };
    let chain;
    try { chain = cofactorChain(sites, { from: point(elements.chainFrom.value), to: point(elements.chainTo.value) }); } catch (error) { elements.chainOut.textContent = error.message; return; }
    const convert = toRoot(model), k = PRESENTATION_METERS_PER_ANGSTROM;
    viewport.setOverlayLines(CHAIN, chain.slice(1).map((c, i) => ({ a: convert(chain[i].position), b: convert(c.position), color: '#d9488a' })), { dash: 0.01, gap: 0.006 });
    viewport.setParticleCloud(CHAIN_DOTS, chain.map((c, i) => ({ position: convert(c.position), radius: 1.6 * k, color: '#d9488a', name: `${i + 1}. ${c.comp}` })), { overlay: true });
    const hops = chain.slice(1).map((c, i) => Math.hypot(...c.position.map((v, j) => v - chain[i].position[j])));
    elements.chainOut.textContent = `${chain.length} 个辅因子（${chain.map((c) => c.comp).join(' → ')}），相邻 ${Math.min(...hops).toFixed(1)}–${Math.max(...hops).toFixed(1)} Å，总长 ${hops.reduce((a, b) => a + b, 0).toFixed(1)} Å。规则：跳跃不超过 20 Å，总平方距离最小；两端没有 20 Å 内的通路时只连两端。电子隧穿速率随距离指数下降，这里只是几何路径，不是转移速率。`;
  });
  elements.chainClear.addEventListener('click', clearChain);

  return { reset() { clearMeasure(); clearChannel(); clearChain(); } };
}

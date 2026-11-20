import { placeMembrane, applyPlacement, undoPlacement, loadMembraneInfo } from '../../plugins/structure/membrane-placement.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';

/**
 * "Find the membrane" (classic: the automatic membrane of src/sim/processes/auto.js): reads the transmembrane segments from RCSB when the structure is a PDB entry (OPM, PDBTM or
 * MemProtMD), otherwise scans for a hydrophobic belt, and draws the two faces of the bilayer as translucent planes around the protein, outside blue, inside orange. The structure is
 * not moved: the planes are put where the membrane is in the structure's own frame. What was found, where it came from and how sure the inside/outside call is are written out.
 * The rules are in plugins/structure/membrane-placement.mjs (equal to the classic).
 */
const TAG = 'membrane', HOW = {
  uniprot: 'UniProt 的拓扑注释（胞质 / 胞外区的位置）',
  flank: '正电在内规则：跨膜片段两端的环区里 Lys / Arg 多的一侧是胞质',
  near: '正电在内规则：膜面外 15 Å 内 Lys / Arg 多的一侧是胞质',
};
const SOURCE = { OPM: 'OPM 数据库', PDBTM: 'PDBTM 数据库', MemProtMD: 'MemProtMD 数据库', scan: '疏水带扫描（没有跨膜片段注释，按表面残基的疏水性找一个 30 Å 厚的带）' };

export function createMembraneView({ viewport, button, note, context }) {
  let token = 0, shown = false;

  function hide() { token++; shown = false; viewport.setOverlayMesh(TAG, null); button.textContent = '寻找细胞膜'; }
  function draw(model, found, atoms) {
    const placed = applyPlacement(atoms.map((a) => a.position), found.placement);
    let reach = 0; for (const p of placed) reach = Math.max(reach, Math.abs(p[0]), Math.abs(p[2]));
    reach += 12;
    const corners = (y) => [[-reach, y, -reach], [reach, y, -reach], [reach, y, reach], [-reach, y, reach]];
    const native = undoPlacement([...corners(found.half), ...corners(-found.half)], found.placement), centre = displayCenter(model), k = PRESENTATION_METERS_PER_ANGSTROM;
    const pos = new Float32Array(native.flatMap((p) => p.map((v, i) => (v - centre[i]) * k))), colors = new Float32Array(8 * 3);
    colors.set([...Array(4)].flatMap(() => [0.56, 0.72, 0.91]), 0); colors.set([...Array(4)].flatMap(() => [0.91, 0.73, 0.56]), 12);
    return viewport.setOverlayMesh(TAG, { pos, idx: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]), colors }, { opacity: 0.32 });
  }

  async function show() {
    const mine = ++token, model = context.model();
    if (!model) return;
    const atoms = context.residues();
    let info = { segs: [], segSrc: null, memAnn: true, topo: [] }, warning = '';
    const entry = context.entryId();
    note.textContent = entry ? '正在读取 RCSB 的膜注释 …' : '没有 PDB 编号：用疏水带扫描 …';
    if (entry) {
      try {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
        try { info = (await loadMembraneInfo(entry, { signal: controller.signal, async fetchJson(url, init) { const r = await fetch(url, init); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); } })) ?? info; }
        finally { clearTimeout(timer); }
        if (!info.segs.length && !info.memAnn) { info = { ...info, memAnn: false }; }
      } catch (error) { warning = `（读不到 RCSB 的膜注释：${error.message}，改用疏水带扫描）`; }
    }
    if (mine !== token) return;
    const found = placeMembrane(atoms, info);
    if (!found) { note.textContent = `没有找到膜。${info.segs?.length || info.memAnn ? '' : '这个条目没有膜注释，多半是可溶蛋白。'}${warning}`; return; }
    if (!draw(model, found, atoms)) { note.textContent = '膜已找到，但画不出来（视口里没有结构）。'; return; }
    shown = true; button.textContent = '隐藏细胞膜';
    const side = found.sideSure ? `胞质在下方（橙色面一侧），依据：${HOW[found.how]}（内侧 Lys/Arg ${found.krIn}，外侧 ${found.krOut}）` : `胞质侧不确定（内侧 Lys/Arg ${found.krIn}，外侧 ${found.krOut}），请用文献核对；这里按 ${HOW[found.how]} 暂定`;
    note.textContent = `膜的来源：${SOURCE[found.src]}${found.nSeg ? `，${found.nSeg} 段跨膜片段` : ''}；半厚度 ${found.half.toFixed(1)} Å（估计，取 12–20 Å）。${side}。${found.axes.length ? `${found.axes.length} 个亚基的跨膜中心可作孔道轴。` : ''}${warning}`;
  }

  button.addEventListener('click', () => { if (shown) hide(); else show(); });
  return { reset() { hide(); note.textContent = ''; } };
}

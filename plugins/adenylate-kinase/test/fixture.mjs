// Synthetic 214-residue adenylate-kinase-like pair (open and closed states with a CORE/NMP/LID motion and an AP5 ligand).
export function fixture() {
  const rotate = (p, degrees) => { const a = degrees * Math.PI / 180; return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]]; };
  const atoms = Array.from({ length: 214 }, (_, i) => ({ record: 'ATOM', name: 'CA', element: 'C', residueName: 'ALA',
    modelId: '1', authChainId: 'A', labelChainId: 'A', authSeqId: String(i + 1), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', occupancy: 1,
    position: [i % 17, i * i % 23, i / 10] }));
  const open = { format: 'mmcif', atoms, chainNames: { A: 'ADENYLATE KINASE' } };
  const closed = { ...open, atoms: atoms.map((a, i) => {
    const n = i + 1, angle = n >= 30 && n <= 59 ? 25 : n >= 122 && n <= 159 ? 50 : 0;
    return { ...a, position: rotate(rotate(a.position, angle), 40).map((v, k) => v + [50, 30, -20][k]) };
  }) };
  closed.atoms.push(...['P', 'O', 'C'].map((element, i) => ({ ...atoms[0], record: 'HETATM', name: `${element}${i}`, element, residueName: 'AP5', authSeqId: '215', labelSeqId: '', labelChainId: 'C', position: [50 + i, 30, -20] })));
  const node = { id: 'chain-A', parentId: null, assetId: 'preview', extensions: { 'org.glow.structure': { sourceAssetId: 'primary', partName: 'ADENYLATE KINASE' } } };
  const loaded = { model: open, scene: { assets: [{ id: 'primary', path: 'assets/open.cif', provenance: { parserVersion: '1' } }], nodes: [node] }, resources: new Map() };
  return { open, closed, loaded };
}

// A different protein for the same algorithm: `residues` long, chain B, a BODY (1..70) and a hinged ARM (71..end) that
// closes by 30 degrees, with a ligand called LIG. Nothing here is adenylate kinase.
export function hingeFixture({ residues = 120 } = {}) {
  const rotate = (p, degrees) => { const a = degrees * Math.PI / 180; return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]]; };
  const atoms = Array.from({ length: residues }, (_, i) => ({ record: 'ATOM', name: 'CA', element: 'C', residueName: 'GLY',
    modelId: '1', authChainId: 'B', labelChainId: 'B', authSeqId: String(i + 1), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', occupancy: 1,
    position: [i % 13, i * i % 19, i / 8] }));
  const open = { format: 'mmcif', atoms, chainNames: { B: 'Maltose binding protein-like' } };
  const closed = { ...open, atoms: atoms.map((a, i) => ({ ...a, position: rotate(i + 1 > 70 ? rotate(a.position, 30) : a.position, 15).map((v, k) => v + [8, -4, 2][k]) })) };
  closed.atoms.push(...['C', 'O'].map((element, i) => ({ ...atoms[0], record: 'HETATM', name: `${element}${i}`, element, residueName: 'LIG', authSeqId: '300', labelSeqId: '', labelChainId: 'L', position: [3 + i, 3, 3] })));
  const node = { id: 'chain-B', parentId: null, assetId: 'preview', extensions: { 'org.glow.structure': { sourceAssetId: 'primary', partName: 'Maltose binding protein-like' } } };
  const loaded = { model: open, scene: { assets: [{ id: 'primary', path: 'assets/open.cif', provenance: { parserVersion: '1' } }], nodes: [node] }, resources: new Map() };
  return { open, closed, loaded };
}

export const HINGE_CONFIG = {
  id: 'hinge-demo',
  states: { open: 'OPEN', closed: 'CLOSED' },
  protein: { organism: '合成', chain: 'B', residues: 120, namePattern: 'binding protein' },
  domains: [{ name: 'BODY', ranges: [[1, 70]], color: '#3366aa' }, { name: 'ARM', ranges: [[71, 120]], color: '#aa6633' }],
  fitDomain: 'BODY',
  ligand: { residue: 'LIG', chain: 'B', name: '配体X', color: '#228844' },
  steps: [1, 2, 3, 4].map((n) => ({ title: `步骤${n}`, caption: `第${n}步说明` })),
  navigation: { idPrefix: 'hinge', proteinTitle: '铰链蛋白', mechanismTitle: '铰链闭合' },
  panel: { title: '铰链蛋白', parametersTitle: '构象', speedLabel: '往复倍率', seedLabel: '种子', evidence: '合成数据。' },
  functionalDescription: '蓝色 BODY，橙色 ARM。',
  metricsLegend: '（相对 BODY）',
  evidence: { citation: '铰链演示', note: '仅为软件测试用的合成数据。' },
};

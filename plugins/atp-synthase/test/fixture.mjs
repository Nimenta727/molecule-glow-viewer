// Synthetic ATP-synthase-like complex: a c ring of `ring` subunits and three beta chains. Names are configurable so
// the same player can be exercised with other labelling (tests of work-configuration, not of 6ZPO itself).
export function fixture({ ring = 8, ringName = 'ATP synthase subunit C1', betaName = 'ATP synthase subunit beta', gammaName = 'ATP synthase subunit gamma' } = {}) {
  const names = { C: ringName, G: gammaName };
  const atoms = [];
  for (let i = 0; i < ring; i++) {
    names[`C${i}`] = names.C;
    atoms.push({ name: 'CA', element: 'C', record: 'ATOM', modelId: '1',
      authChainId: `C${i}`, labelChainId: `C${i}`, labelSeqId: String(i + 1), authSeqId: String(i + 1),
      residueName: 'GLY', position: [10 * Math.cos(i * 2 * Math.PI / ring), 0, 10 * Math.sin(i * 2 * Math.PI / ring)] });
  }
  for (let chain = 0; chain < 3; chain++) {
    const id = String(chain);
    names[id] = betaName;
    for (let i = 0; i < 6; i++) atoms.push({ name: 'CA', element: 'C', record: 'ATOM', modelId: '1',
      authChainId: id, labelChainId: id, labelSeqId: String(i + 1), authSeqId: String(i + 1),
      residueName: 'ALA', position: [Math.cos(chain * 2 * Math.PI / 3) * 15 + i,
        35 + i % 2, Math.sin(chain * 2 * Math.PI / 3) * 15 + i * (i > 2 ? chain + 1 : 1)] });
  }
  const scene = { assets: [{ id: 'source', kind: 'file', mediaType: 'chemical/x-mmcif' }],
    nodes: Object.entries(names).map(([id, partName]) => ({
      id, assetId: id, parentId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      extensions: { 'org.glow.structure': { sourceAssetId: 'source', partName, chainId: id } },
    })) };
  return { model: { format: 'mmcif', atoms, chainNames: names }, scene };
}

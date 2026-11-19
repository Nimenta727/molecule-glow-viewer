// Synthetic tetrameric potassium channel (not KcsA coordinates): four chains around the z axis, a selectivity-filter
// segment with four K+ sites and a cavity ion in the "closed" state, wider helices in the "open" state, and blocker
// residues in two more states. `shift` renumbers the residues so the same algorithm can be tried on another channel.
export function kcsaFixture({ shift = 0, partName = 'Potassium channel protein KcsA', ids = ['1K4C', '5VK6', '5VKE', '2HVK', '2ITD'], tba = 'TBA', ba = 'BA' } = {}) {
  const [primary, open, inactivated, tbaState, baState] = ids;
  const chainIds = ['A', 'B', 'C', 'D'];
  const residues = Array.from({ length: 41 }, (_, i) => 50 + shift + i);
  function protein(radiusAt, move = (p) => p) {
    const atoms = [];
    chainIds.forEach((id, c) => residues.forEach((n) => {
      const theta = c * Math.PI / 2, r = radiusAt(n - shift);
      const wobble = c % 2 ? -1 : 1;   // cancels over the four chains so the pore axis is exactly z
      const p = [r * Math.cos(theta) + wobble * ((n % 5) - 2) * 0.3, r * Math.sin(theta) + wobble * ((n % 3) - 1) * 0.3, (n - shift - 60) * 1.5];
      atoms.push({ name: 'CA', element: 'C', record: 'ATOM', modelId: '1', authChainId: id, labelChainId: id,
        labelSeqId: String(n), authSeqId: String(n), residueName: 'GLY', position: move(p) });
    }));
    return atoms;
  }
  const hetero = (element, residueName, position, seq, chain = 'E') => ({ name: element, element, record: 'HETATM', modelId: '1',
    authChainId: chain, labelChainId: chain, labelSeqId: '', authSeqId: String(seq), residueName, position });
  const names = Object.fromEntries(chainIds.map((id) => [id, partName]));
  const model = (atoms) => ({ format: 'mmcif', atoms, chainNames: { ...names } });
  const shiftBy = (d) => (p) => p.map((v, i) => v + d[i]);
  const closed = model([...protein(() => 9),
    ...[30, 26.6, 23.2, 20.2, 12].map((z, i) => hetero('K', 'K', [0.2 * i, -0.1 * i, z], 100 + i))]);
  const openState = model(protein((n) => n >= 60 && n <= 80 ? 10.5 : 9.5, shiftBy([5, -3, 2])));
  const inactivatedState = model(protein((n) => n >= 60 && n <= 80 ? 9.6 : 9, shiftBy([-2, 4, 1])));
  const tbaModel = model([...protein(() => 9, shiftBy([1, 1, -1])),
    ...[[0, 0, 7], [1, 0, 8], [0, 1, 9]].map((p, i) => hetero('C', tba, p.map((v, k) => v + [1, 1, -1][k]), 200, 'F'))]);
  const baModel = model([...protein(() => 9, shiftBy([-1, 2, 0])), hetero('BA', ba, [-1, 2, 21], 300, 'G')]);
  const states = new Map([[primary, closed], [open, openState], [inactivated, inactivatedState], [tbaState, tbaModel], [baState, baModel]]);
  const scene = {
    legacy: { scene: { id: primary } },
    assets: [{ id: 'source', kind: 'file', mediaType: 'chemical/x-mmcif', path: 'assets/source.cif', provenance: { parserVersion: '1.0.0' } },
      ...chainIds.map((id) => ({ id: `preview-${id}`, kind: 'file', path: `assets/preview-${id}.json`, mediaType: 'application/json', provenance: {} }))],
    nodes: chainIds.map((id) => ({ id: `node-${id}`, assetId: `preview-${id}`, parentId: 'root',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      extensions: { 'org.glow.structure': { sourceAssetId: 'source', partName, chainId: id, chainKey: `chain:${encodeURIComponent(`${id}|${id}`)}` } } })),
  };
  return { model: closed, states, scene };
}

export function previewLayers(scene) {
  return new Map(scene.nodes.map((node, n) => [node.assetId, [{ mode: 'points',
    positions: Array.from({ length: 24 }, (_, i) => ((i * 7 + n * 3) % 11) * 0.12 - 0.5) }]]));
}

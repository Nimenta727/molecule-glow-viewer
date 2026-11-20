// A small invented "protein" for the data-animation tests: a ring of residues 40 Å across around the y axis, four K ligands up the axis, one AP5 ligand off to
// the side and a membrane through the middle. The official data packs only name anchors (ligands, membranes); this gives them something to find.
import fs from 'node:fs';

export function makeStructure({ membrane = true } = {}) {
  const points = [];
  for (let layer = -3; layer <= 3; layer++) for (let i = 0; i < 24; i++) points.push([20 * Math.cos(i * Math.PI / 12), layer * 10, 20 * Math.sin(i * Math.PI / 12)]);
  const ligands = [-12, -4, 4, 12].map((y) => ({ comp: 'K', centre: [0, y, 0] })).concat([{ comp: 'AP5', centre: [8, 0, 3] }]);
  return {
    points, ligands, membraneY: membrane ? [0] : [],
    residue: ({ number, part }) => (number === 77 && (!part || /kcsa/i.test(part)) ? [20, 0, 0] : null),
    part: (name) => (/subunit a/i.test(name) ? [20, 0, 0] : null),
  };
}
export const pack = (name) => JSON.parse(fs.readFileSync(new URL(`../../../workshop/official/packs/official.${name}.glow`, import.meta.url), 'utf8')).scene.animation;

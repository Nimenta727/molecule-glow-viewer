import { superpose } from '../structure/alignment.mjs';
import { rotationAngle } from './conformation.mjs';
import { distance, lerp } from './vectors.mjs';
import { centroid } from '../structure/alignment.mjs';

/**
 * Conformation sets (4.4.8): the structure side of a mechanism whose parts take a few known shapes, as two general constructions. The conformation state machine
 * (plugins/motion/conformation-machine.mjs) says *which states the structure is between and how far*; a conformation set says *what those states are*, as residue positions in one common frame,
 * ready for `displaceVertices` (plugins/motion/conformation.mjs) to move a drawing between them.
 *
 *   cyclicStates(chains, opts)      identical subunits that take turns in the same states (the three catalytic subunits of F1: open, loose, tight). Each subunit's shape in every other subunit's
 *                                   state is found by fitting the other subunit onto it over its stable part (the residues below `fraction` of its numbering range), so the three states are the
 *                                   subunit's own coordinates and its two siblings' shapes carried into its place. `rotatedStates` lists them from a given subunit's point of view.
 *   twoStateTargets(open, closed)   one chain in two known states: the closed one is fitted onto the open one over a reference domain (a predicate on the open atoms), giving every residue its
 *                                   position in the closed state in the open frame, the fit's RMSD (refused above a limit), and `domainMotion` measures how far each other domain has rotated and shifted
 *                                   at a fraction of the way (after refitting the reference domain, as the classic measured).
 * Pure; `keyOf(atom)` names a residue, `positionOf(atom)` (default atom.position) gives its coordinates.
 */
const defaultPosition = (atom) => atom.position;

export function cyclicStates(chains, { keyOf, fraction = 0.62, positionOf = defaultPosition } = {}) {
  if (!Array.isArray(chains) || chains.length < 2 || chains.some((c) => !c?.length)) throw new Error('循环对称的构象集至少需要两条相同的链。');
  return chains.map((own) => {
    const numbers = own.map(keyOf).map(Number).filter(Number.isFinite), threshold = Math.min(...numbers) + fraction * (Math.max(...numbers) - Math.min(...numbers));
    return chains.map((other) => {
      const byKey = new Map(other.map((atom) => [keyOf(atom), atom])), shared = own.filter((atom) => Number(keyOf(atom)) < threshold && byKey.has(keyOf(atom)));
      if (shared.length < 3) throw new Error('两条链能叠合的残基不足 3 个。');
      const fit = superpose(shared.map(positionOf), shared.map((atom) => positionOf(byKey.get(keyOf(atom)))));
      return new Map(own.map((atom) => [keyOf(atom), byKey.has(keyOf(atom)) ? fit(positionOf(byKey.get(keyOf(atom)))) : positionOf(atom)]));
    });
  });
}
/** The states of subunit `index` as it passes through the cycle: its own shape, then those of the next subunits in order (n states for n subunits). */
export const rotatedStates = (alternatives, index) => alternatives.map((_, offset) => alternatives[(index + offset) % alternatives.length]);

export function twoStateTargets(open, closed, { keyOf, inReference, maxRmsd = Infinity, positionOf = defaultPosition } = {}) {
  const other = new Map(closed.map((atom) => [keyOf(atom), positionOf(atom)]));
  if (open.some((atom) => !other.has(keyOf(atom)))) throw new Error('两态的残基编号没有完整对应。');
  const core = open.filter(inReference);
  if (core.length < 3) throw new Error('参考域的残基不足 3 个。');
  const fit = superpose(core.map(positionOf), core.map((atom) => other.get(keyOf(atom))));
  const rmsd = Math.sqrt(core.reduce((sum, atom) => sum + distance(positionOf(atom), fit(other.get(keyOf(atom)))) ** 2, 0) / core.length);
  if (rmsd > maxRmsd) throw new Error(`参考域叠合 RMSD ${rmsd.toFixed(3)} Å 超过 ${maxRmsd} Å。`);
  return { targets: new Map(open.map((atom) => [keyOf(atom), fit(other.get(keyOf(atom)))])), rmsd, fit, matched: open.length, core };
}

/** How far each moving domain has rotated (degrees, by `rotationAngle`) and shifted (Å) at `fraction` of the way from the open to the closed state, measured after refitting the reference domain. */
export function domainMotion({ open, targets, core, keyOf, domains, positionOf = defaultPosition }, fraction) {
  const reference = core.map(positionOf), current = core.map((atom) => lerp(positionOf(atom), targets.get(keyOf(atom)), fraction)), coreFit = superpose(reference, current);
  return domains.map(({ name, contains }) => {
    const atoms = open.filter(contains), A = atoms.map(positionOf), B = atoms.map((atom) => coreFit(lerp(positionOf(atom), targets.get(keyOf(atom)), fraction)));
    return { name, angle: rotationAngle(superpose(A, B)), shift: distance(centroid(A), centroid(B)) };
  });
}

import { selectionSpace } from '../structure/selection.mjs';
import { superpose } from '../structure/alignment.mjs';
import { distance } from './vectors.mjs';
import { displaceVerticesGrid } from './conformation.mjs';
import { centerAndScale, selectCoordinateAtoms } from '../structure/representation.mjs';

/**
 * Two conformations of one structure (classic: the "states" morph, src/core/load-scene.js + frame-loop.js). Residues of the two are matched by chain
 * and label sequence number; state B is fitted onto state A over all matched residues; each matched residue then has a target position, and the
 * display moves between the two by linear interpolation. This is an illustration of the two end states, not a real pathway, and the viewer says so.
 * Pure data and geometry; no rendering, no network.
 */
const key = (residue) => `${residue.asym}|${residue.labelSeq}`;
export const MIN_MATCHED = 3;

export class StatePairError extends Error {
  constructor(message) { super(message); this.name = 'StatePairError'; }
}

/** Residue pairs [{ a, b }] present in both models (same asym incl. assembly copy, same label_seq), in the order of A. */
export function matchStates(modelA, modelB) {
  const byKey = new Map(selectionSpace(modelB).residues.map((r) => [key(r), r]));
  const pairs = [];
  for (const a of selectionSpace(modelA).residues) {
    const b = byKey.get(key(a));
    if (b) pairs.push({ a, b });
  }
  return pairs;
}

/**
 * Fits B onto A over all matched residues. Returns { pairs, fit, matched, unmatchedA, unmatchedB, rmsdBefore, rmsdAfter, maxShift, shifts } where `shifts[i]`
 * is the distance (Å) residue i moves between the states in A's frame.
 */
export function fitStates(modelA, modelB) {
  const pairs = matchStates(modelA, modelB);
  if (pairs.length < MIN_MATCHED) throw new StatePairError(`两个构象只匹配到 ${pairs.length} 个残基（至少 ${MIN_MATCHED} 个），无法叠合。`);
  const fit = superpose(pairs.map(({ a }) => a.position), pairs.map(({ b }) => b.position));
  const rms = (list) => Math.sqrt(list.reduce((sum, d) => sum + d * d, 0) / list.length);
  const shifts = pairs.map(({ a, b }) => distance(a.position, fit(b.position)));
  return {
    pairs, fit, matched: pairs.length,
    unmatchedA: selectionSpace(modelA).residues.length - pairs.length, unmatchedB: selectionSpace(modelB).residues.length - pairs.length,
    rmsdBefore: rms(pairs.map(({ a, b }) => distance(a.position, b.position))), rmsdAfter: rms(shifts), maxShift: Math.max(...shifts), shifts,
  };
}

/** Where each matched residue of A ends up in state B, in A's frame: Map(residue of A -> [x, y, z]). */
export function stateTargets({ pairs, fit }) {
  return new Map(pairs.map(({ a, b }) => [a, fit(b.position)]));
}

/** B's small molecules moved into A's frame (they belong to state B and are shown when the morph is near it). */
export function stateLigands(modelB, { fit }) {
  return selectionSpace(modelB).ligands.map((ligand) => ({ ...ligand, atoms: ligand.atoms.map((atom) => ({ ...atom, position: fit(atom.position) })) }));
}

/** A residue's position at `fraction` (0 = A, 1 = B). */
export const interpolate = (from, to, fraction) => from.map((v, i) => v + (to[i] - v) * fraction);

/** Classic smoothstep. */
export const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The automatic back-and-forth: ease-in-out between the states with a short hold at both ends. `t` is the accumulated phase (advance it by dt * 0.35 per
 * second, as the classic loop did). Returns the morph fraction 0..1.
 */
export function pingPong(t) {
  const c = (Math.sin(t) + 1) / 2;
  return ease((c - 0.1) / 0.8);
}

/** Which state's small molecules are drawn: A below 0.4, B above 0.6, none in between (so nothing is half-visible). */
export function visibleState(fraction) {
  return fraction < 0.4 ? 'A' : fraction > 0.6 ? 'B' : null;
}

/* ---- from the fitted pair to what the display needs */

/** The display centre of a model (what its layers are centred on), in Å. */
export const displayCenter = (model) => centerAndScale(selectCoordinateAtoms(model)).center;

/** Displacement anchors, one per matched residue: where it is on screen (`at`), its source coordinates (`from`) and the residue itself (`ref`). */
export function stateAnchors({ pairs }, center, scale) {
  return pairs.map(({ a }) => ({ ref: a, at: a.position.map((v, i) => (v - center[i]) * scale), from: a.position }));
}

/**
 * Gives every layer a second state: the layer's vertices moved as the nearest matched residues move between the conformations (inverse-distance weighted,
 * four anchors). Layers are copied; `conformations` = [as loaded, as in state B]. Layers without positions are returned unchanged.
 */
export function conformationLayers(layers, anchors, targets, scale) {
  return layers.map((layer) => {
    if (!layer.positions?.length) return layer;
    const [end] = displaceVerticesGrid(layer.positions, anchors, [(anchor) => targets.get(anchor.ref)], { scale });
    return { ...layer, conformations: [layer.positions, end] };
  });
}

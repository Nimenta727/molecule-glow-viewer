import { RESPIRATORY_CHAIN_KINETICS, CHLOROPLAST_KINETICS } from './mechanism-kinetics.mjs';

/**
 * The configuration of the classic works that are compartment kinetics around a membrane complex (classic processes `respiratoryChain` and `chloroplast`), as data-animation tool
 * configurations (plugins/simulation/data-tool.mjs): a membrane with a compartment above and one below, the compartment model of the work (concentrations, pH, membrane potential,
 * switches; equal to the classic, see tools/kinetics-parity.mjs), and the orientation of the classic scene (`axisFit`, `up` / `down`). Nothing here names a protein except the part
 * keywords of the classic scenes; the same configuration works for any structure that has such parts.
 *
 *   top = the first compartment of the classic model (matrix / stroma), bot = the second (intermembrane space / thylakoid lumen).
 * Not included (still the classic's own code): the electron paths through the real cofactors, the proton pumping and ATP synthase rotor choreography, and the energy strip.
 */
const COMPARTMENTS = Object.freeze({ top: Object.freeze({ side: 'above', membrane: 0, gap: 30 }), bot: Object.freeze({ side: 'below', membrane: 0, gap: 30 }) });
const WORKS = Object.freeze({
  respiratoryChain: Object.freeze({ kinetics: RESPIRATORY_CHAIN_KINETICS, title: '线粒体呼吸链' }),
  chloroplast: Object.freeze({ kinetics: CHLOROPLAST_KINETICS, title: '叶绿体光反应' }),
});
export const MECHANISM_WORK_PROCESSES = Object.freeze(Object.keys(WORKS));

/**
 * The tool configuration for a classic scene declaration whose `process` is one of the compartment-kinetics works, or undefined. `legacy` is the classic scene object
 * ({ process, axisFit?, axis?, up?, down?, membranes?, seed? }).
 */
export function mechanismWorkConfig(legacy) {
  const work = WORKS[legacy?.process];
  if (!work) return undefined;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);
  return {
    animation: { version: 1, compartments: JSON.parse(JSON.stringify(COMPARTMENTS)), pools: [], flows: [], reactions: [] },
    axis: 'short',
    ...(Array.isArray(legacy.axisFit) ? { axisFit: legacy.axisFit.map(text).filter(Boolean).slice(0, 8) } : {}),
    ...(text(legacy.up) ? { up: text(legacy.up) } : text(legacy.down) ? { down: text(legacy.down) } : {}),
    membranes: Array.isArray(legacy.membranes) && legacy.membranes.length ? legacy.membranes.slice(0, 2).map((m) => ({ at: String(m.at ?? ''), offset: Number(m.offset) || 0 })) : [{ at: '', offset: 0 }],
    seed: Number.isSafeInteger(legacy.seed) ? legacy.seed : 7, scale: 'slow',
    kinetics: JSON.parse(JSON.stringify(work.kinetics)),
  };
}

import { RESPIRATORY_CHAIN_KINETICS, CHLOROPLAST_KINETICS } from './mechanism-kinetics.mjs';
import { MECHANISM_ENERGY } from './mechanism-energy.mjs';

/**
 * The configuration of the classic works that are compartment kinetics around a membrane complex (classic processes `respiratoryChain` and `chloroplast`), as data-animation tool
 * configurations (plugins/simulation/data-tool.mjs): a membrane with a compartment above and one below, the compartment model of the work (concentrations, pH, membrane potential,
 * switches; equal to the classic, see tools/kinetics-parity.mjs), and the orientation of the classic scene (`axisFit`, `up` / `down`). Nothing here names a protein except the part
 * keywords of the classic scenes; the same configuration works for any structure that has such parts.
 *
 *   top = the first compartment of the classic model (matrix / stroma), bot = the second (intermembrane space / thylakoid lumen).
 * The energy strips come from mechanism-energy.mjs. Not included (still the classic's own code): the electron paths through the real cofactors and the proton pumping and ATP synthase rotor choreography.
 */
const COMPARTMENTS = Object.freeze({ top: Object.freeze({ side: 'above', membrane: 0, gap: 30 }), bot: Object.freeze({ side: 'below', membrane: 0, gap: 30 }) });
const WORKS = Object.freeze({
  respiratoryChain: Object.freeze({ kinetics: RESPIRATORY_CHAIN_KINETICS, title: '线粒体呼吸链' }),
  chloroplast: Object.freeze({ kinetics: CHLOROPLAST_KINETICS, title: '叶绿体光反应' }),
});
// The flagellar motor (classic process `flagellarMotor`): H+ from the periplasm flow through the stator channels into the cytoplasm. The classic puts 11 stators on a ring of
// 215 Å, 10 Å above the M ring, and sends a proton through a random one for every 1/44 turn of the rotor. Here the ring is written as 11 flows (each through its own stator channel,
// 22 Å above to 22 Å below the ring), at a steady rate chosen to match a rotor turning about 0.1 turn per second (4.4 H+ per second); the coupling to the rotor angle itself is not
// reproduced (the Viewer's part spin and this animation are separate switches), and the counts are illustrative as in the classic ("measured about 1000 H+ per turn").
const STATORS = 11, STATOR_RADIUS = 215, STATOR_RISE = 10, CHANNEL_HALF = 22;
const flagellarAnimation = () => ({
  version: 1, compartments: JSON.parse(JSON.stringify(COMPARTMENTS)),
  pools: [{ species: 'H⁺', in: 'top', n: 24 }, { species: 'H⁺', in: 'bot', n: 8 }],
  flows: Array.from({ length: STATORS }, (_, k) => {
    const phi = 2 * Math.PI * k / STATORS, x = +(STATOR_RADIUS * Math.cos(phi)).toFixed(3), z = +(STATOR_RADIUS * Math.sin(phi)).toFixed(3);
    return { name: `H⁺ 经定子 ${k + 1}`, species: 'H⁺', from: 'top', to: 'bot', via: [{ part: 'M-ring', offset: [x, STATOR_RISE + CHANNEL_HALF, z] }, { part: 'M-ring', offset: [x, STATOR_RISE - CHANNEL_HALF, z] }],
      labelVia: 'H⁺（经定子 MotA/MotB）', rate: +(4.4 / STATORS).toFixed(4), counter: 'H⁺（示意）' };
  }),
  reactions: [],
});
export const MECHANISM_WORK_PROCESSES = Object.freeze([...Object.keys(WORKS), 'flagellarMotor']);

/**
 * The tool configuration for a classic scene declaration whose `process` is one of the compartment-kinetics works, or undefined. `legacy` is the classic scene object
 * ({ process, axisFit?, axis?, up?, down?, membranes?, seed? }).
 */
export function mechanismWorkConfig(legacy) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);
  if (legacy?.process === 'flagellarMotor') {
    return { animation: flagellarAnimation(), axis: ['sym', 'long', 'short', 'native'].includes(legacy.axis) ? legacy.axis : 'long', ...(text(legacy.up) ? { up: text(legacy.up) } : text(legacy.down) ? { down: text(legacy.down) } : {}),
      membranes: Array.isArray(legacy.membranes) && legacy.membranes.length ? legacy.membranes.slice(0, 2).map((m) => ({ at: String(m.at ?? ''), offset: Number(m.offset) || 0 })) : [{ at: 'M-ring', offset: 18 }], seed: Number.isSafeInteger(legacy.seed) ? legacy.seed : 7, scale: 'slow', energy: structuredClone(MECHANISM_ENERGY.flagellarMotor) };
  }
  const work = WORKS[legacy?.process];
  if (!work) return undefined;
  return {
    animation: { version: 1, compartments: JSON.parse(JSON.stringify(COMPARTMENTS)), pools: [], flows: [], reactions: [] },
    axis: 'short',
    ...(Array.isArray(legacy.axisFit) ? { axisFit: legacy.axisFit.map(text).filter(Boolean).slice(0, 8) } : {}),
    ...(text(legacy.up) ? { up: text(legacy.up) } : text(legacy.down) ? { down: text(legacy.down) } : {}),
    membranes: Array.isArray(legacy.membranes) && legacy.membranes.length ? legacy.membranes.slice(0, 2).map((m) => ({ at: String(m.at ?? ''), offset: Number(m.offset) || 0 })) : [{ at: '', offset: 0 }],
    seed: Number.isSafeInteger(legacy.seed) ? legacy.seed : 7, scale: 'slow',
    kinetics: JSON.parse(JSON.stringify(work.kinetics)), energy: structuredClone(MECHANISM_ENERGY[legacy.process]),
  };
}

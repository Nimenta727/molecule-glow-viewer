import { RESPIRATORY_CHAIN_KINETICS, CHLOROPLAST_KINETICS } from './mechanism-kinetics.mjs';
import { MECHANISM_ENERGY } from './mechanism-energy.mjs';
import { CHLOROPLAST_ANCHORS, CHLOROPLAST_RELAY, CHLOROPLAST_ATP_FLOWS, chloroplastRotor } from './chloroplast-relay.mjs';
import { RESPIRATORY_ANCHORS, RESPIRATORY_RELAY, ATP_SYNTHASE_ANCHORS, ATP_SYNTHASE_FLOWS, RESPIRATORY_LEDGER, respiratoryRotor } from './respiratory-relay.mjs';

/**
 * The configuration of the classic works that are compartment kinetics around a membrane complex (classic processes `respiratoryChain` and `chloroplast`), as data-animation tool
 * configurations (plugins/simulation/data-tool.mjs): a membrane with a compartment above and one below, the compartment model of the work (concentrations, pH, membrane potential,
 * switches; equal to the classic, see tools/kinetics-parity.mjs), and the orientation of the classic scene (`axisFit`, `up` / `down`). Nothing here names a protein except the part
 * keywords of the classic scenes; the same configuration works for any structure that has such parts.
 *
 *   top = the first compartment of the classic model (matrix / stroma), bot = the second (intermembrane space / thylakoid lumen).
 * The energy strips come from mechanism-energy.mjs. The electron and proton choreography of the respiratory chain and the light reactions are relays (respiratory-relay.mjs, chloroplast-relay.mjs); the ATP synthase and
 * flagellar rotors turn with the animation clock.
 */
const COMPARTMENTS = Object.freeze({ top: Object.freeze({ side: 'above', membrane: 0, gap: 30 }), bot: Object.freeze({ side: 'below', membrane: 0, gap: 30 }) });
const WORKS = Object.freeze({
  respiratoryChain: Object.freeze({ kinetics: RESPIRATORY_CHAIN_KINETICS, title: '线粒体呼吸链', relay: Object.freeze({ species: { 'cyt c': { col: '#ff7040', r: 3.4 } }, pools: [{ species: 'O₂', in: 'top', n: 3 }], anchors: { ...RESPIRATORY_ANCHORS, ...ATP_SYNTHASE_ANCHORS }, relays: [RESPIRATORY_RELAY], flows: ATP_SYNTHASE_FLOWS, derived: RESPIRATORY_LEDGER }), rotor: respiratoryRotor }),
  chloroplast: Object.freeze({ kinetics: CHLOROPLAST_KINETICS, title: '叶绿体光反应', relay: Object.freeze({ species: { PC: { col: '#4ad6ff', r: 3.4 }, Fd: { col: '#ff8a5a', r: 3.4 } }, pools: [{ species: 'H₂O', in: 'bot', n: 6 }, { species: 'NADP⁺', in: 'top', n: 3 }], anchors: CHLOROPLAST_ANCHORS, relays: [CHLOROPLAST_RELAY], flows: CHLOROPLAST_ATP_FLOWS }), rotor: chloroplastRotor }),
});
// The flagellar motor (classic process `flagellarMotor`): H+ from the periplasm flow through the stator channels into the cytoplasm. The classic puts 11 stators on a ring of
// 215 Å, 10 Å above the M ring, and sends a proton through a random one for every 1/44 turn of the rotor. Here the ring is written as 11 flows (each through its own stator channel,
// 22 Å above to 22 Å below the ring) and the rotor is the parts the scene names in `spin`, turning with the animation clock (0.1 turn per second): every 1/44 turn the next stator in
// turn passes one proton (each stator 4 per turn), so the protons are tied to the rotor's angle, and the counts are illustrative as in the classic ("measured about 1000 H+ per turn").
const STATORS = 11, STATOR_RADIUS = 215, STATOR_RISE = 10, CHANNEL_HALF = 22;
const flagellarAnimation = (legacy) => ({
  version: 1, compartments: JSON.parse(JSON.stringify(COMPARTMENTS)),
  pools: [{ species: 'H⁺', in: 'top', n: 24 }, { species: 'H⁺', in: 'bot', n: 8 }],
  flows: Array.from({ length: STATORS }, (_, k) => {
    const phi = 2 * Math.PI * k / STATORS, x = +(STATOR_RADIUS * Math.cos(phi)).toFixed(3), z = +(STATOR_RADIUS * Math.sin(phi)).toFixed(3);
    return { name: `H⁺ 经定子 ${k + 1}`, species: 'H⁺', from: 'top', to: 'bot', via: [{ part: 'M-ring', offset: [x, STATOR_RISE + CHANNEL_HALF, z] }, { part: 'M-ring', offset: [x, STATOR_RISE - CHANNEL_HALF, z] }],
      labelVia: 'H⁺（经定子 MotA/MotB）', perTurn: 4, phase: +(k / (4 * STATORS)).toFixed(6), counter: 'H⁺（示意）' };
  }),
  reactions: [],
  ...(Array.isArray(legacy?.spin) && legacy.spin.length ? { rotor: { parts: legacy.spin.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 12), mode: 'long', turnsPerSecond: 0.1 } } : {}),
});
export const MECHANISM_WORK_PROCESSES = Object.freeze([...Object.keys(WORKS), 'flagellarMotor']);

/**
 * The tool configuration for a classic scene declaration whose `process` is one of the compartment-kinetics works, or undefined. `legacy` is the classic scene object
 * ({ process, axisFit?, axis?, up?, down?, membranes?, seed? }).
 */
export function mechanismWorkConfig(legacy) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);
  if (legacy?.process === 'flagellarMotor') {
    return { animation: flagellarAnimation(legacy), axis: ['sym', 'long', 'short', 'native'].includes(legacy.axis) ? legacy.axis : 'long', ...(text(legacy.up) ? { up: text(legacy.up) } : text(legacy.down) ? { down: text(legacy.down) } : {}),
      membranes: Array.isArray(legacy.membranes) && legacy.membranes.length ? legacy.membranes.slice(0, 2).map((m) => ({ at: String(m.at ?? ''), offset: Number(m.offset) || 0 })) : [{ at: 'M-ring', offset: 18 }], seed: Number.isSafeInteger(legacy.seed) ? legacy.seed : 7, scale: 'slow', energy: structuredClone(MECHANISM_ENERGY.flagellarMotor) };
  }
  const work = WORKS[legacy?.process];
  if (!work) return undefined;
  return {
    animation: { version: 1, compartments: JSON.parse(JSON.stringify(COMPARTMENTS)), pools: [], flows: [], reactions: [], ...(work.relay ? JSON.parse(JSON.stringify(work.relay)) : {}),
      ...(work.rotor && Array.isArray(legacy.spin) && legacy.spin.length ? { rotor: work.rotor(legacy.spin.map(text).filter(Boolean).slice(0, 12)) } : {}) },
    axis: 'short',
    ...(Array.isArray(legacy.axisFit) ? { axisFit: legacy.axisFit.map(text).filter(Boolean).slice(0, 8) } : {}),
    ...(text(legacy.up) ? { up: text(legacy.up) } : text(legacy.down) ? { down: text(legacy.down) } : {}),
    membranes: Array.isArray(legacy.membranes) && legacy.membranes.length ? legacy.membranes.slice(0, 2).map((m) => ({ at: String(m.at ?? ''), offset: Number(m.offset) || 0 })) : [{ at: '', offset: 0 }],
    seed: Number.isSafeInteger(legacy.seed) ? legacy.seed : 7, scale: 'slow',
    kinetics: JSON.parse(JSON.stringify(work.kinetics)), energy: structuredClone(MECHANISM_ENERGY[legacy.process]),
  };
}

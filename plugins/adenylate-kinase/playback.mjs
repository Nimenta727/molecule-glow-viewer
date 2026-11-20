import { createMachine, normalizeMachine } from '../motion/conformation-machine.mjs';

/**
 * The time side of the adenylate kinase player: a back-and-forth swing between the open and the closed shape, as a conformation state machine of the oscillating kind
 * (plugins/motion/conformation-machine.mjs): the oscillator rate 0.35 rad/s per speed unit, both ends held (fraction = ease(((sin φ + 1) / 2 − 0.1) / 0.8)), a manual closure that hands back to the
 * swing without a jump, a flag for the reference ligand, five-line schedule entries { time, phase, speed, auto, morph, ap5 }. Everything here is the classic frame loop's, now declared as data.
 */
export const PARAMETERS = {
  morph: { label: '构象闭合程度（0=张开，1=闭合）', control: 'range', min: 0, max: 1, step: 0.01, value: 0 },
  auto: { label: '自动往复（0=手动，1=自动）', min: 0, max: 1, step: 1, value: 1 },
  ap5: { label: '显示闭合态 Ap5A 参考（0/1）', min: 0, max: 1, step: 1, value: 1 },
};
export const ADK_MACHINE = normalizeMachine({
  kind: 'oscillating', parameters: PARAMETERS, manual: 'morph', auto: 'auto', steps: 4, counters: { percent: '闭合程度（%）' }, eventLabel: '构象展示参数变更',
  speed: { min: 0.05, max: 3, default: 1, label: '往复倍率' },
}, 'AdK 播放器');
const { validateParameters, fractionAtPhase } = createMachine(ADK_MACHINE, {}, { label: 'AdK 播放器' });
export { validateParameters, fractionAtPhase };

/** `machine`: the swing's constants from the work configuration ({ rate, lo, span, stages }); omitted = the classic's. */
export function createAdkPlayback(state = {}, machine = null) {
  const spec = machine ? normalizeMachine({ ...ADK_MACHINE, ...machine }, 'AdK 播放器') : ADK_MACHINE;
  const engine = createMachine(spec, state, { label: 'AdK 播放器' });
  return {
    duration: engine.duration, validateParameters,
    snapshot() { return { ...engine.snapshot(), transforms: new Map() }; },
    setParameters: engine.setParameters, setMorph: engine.setMorph, setSpeed: engine.setSpeed, setPlaybackRate: engine.setPlaybackRate, stepTime: engine.stepTime,
    seek(value) { engine.seek(value); }, advance(dt) { engine.advance(dt); }, play: engine.play, pause: engine.pause, save: engine.save, dispose: engine.dispose,
  };
}

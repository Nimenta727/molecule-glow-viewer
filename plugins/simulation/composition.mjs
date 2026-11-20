import { createMarkovRun, compileMarkovModel, validateParameterSet } from './markov-model.mjs';

/**
 * Several processes in one scene, each with its own engine, seed, clock and counters (4.4.6; classic: the cell corner, a translation station and a KcsA station
 * simulated at once, sharing one control panel). A composition is a list of members (stochastic processes), each with a `timeScale` (its own seconds per scene second),
 * and a list of shared controls, each mapped to one or more parameters of the members. Setting a control at a scene time adds a parameter change at that moment to the
 * members it targets and nothing else: the other members' histories are untouched, bit for bit. The interventions are the saved state: restoring them rebuilds every
 * member exactly, so leaving a station and coming back finds each one where it was.
 *
 *   createComposition({ members: [{ id, label?, process: <Markov declaration>, seed, timeScale?, schedule? }],
 *                       controls: [{ id, label?, targets: [{ member, param }] }] })
 */
export const COMPOSITION_LIMITS = Object.freeze({ members: 8, controls: 24, interventions: 1000 });
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export function createComposition({ members, controls = [] }) {
  if (!Array.isArray(members) || !members.length || members.length > COMPOSITION_LIMITS.members) throw new Error(`组合需要 1–${COMPOSITION_LIMITS.members} 个过程。`);
  const byId = new Map();
  for (const m of members) {
    if (!KEY.test(m?.id ?? '') || byId.has(m.id)) throw new Error(`过程的名称“${String(m?.id)}”不合法或重复。`);
    const { model, errors } = compileMarkovModel(m.process);
    if (errors.length) throw new Error(`过程“${m.id}”无法运行：${errors.join('；')}`);
    const scale = m.timeScale ?? 1;
    if (!(scale > 0) || !Number.isFinite(scale)) throw new Error(`过程“${m.id}”的时间比例必须是正数。`);
    const base = (m.schedule?.length ? m.schedule : [{ time: 0 }]).map((e) => ({ time: e.time ?? 0, ...validateParameterSet(model, e) }));
    byId.set(m.id, { id: m.id, label: m.label ?? m.id, process: m.process, model, seed: m.seed ?? 0, scale, base, run: null, runKey: null });
  }
  const controlById = new Map();
  for (const c of controls.slice(0, COMPOSITION_LIMITS.controls)) {
    if (!KEY.test(c?.id ?? '') || controlById.has(c.id)) throw new Error(`控件的名称“${String(c?.id)}”不合法或重复。`);
    if (!Array.isArray(c.targets) || !c.targets.length) throw new Error(`控件“${c.id}”没有指向任何过程的参数。`);
    for (const t of c.targets) {
      const member = byId.get(t?.member), p = member?.model.parameters.find((x) => x.id === t.param);
      if (!member) throw new Error(`控件“${c.id}”指向不存在的过程“${String(t?.member)}”。`);
      if (!p) throw new Error(`控件“${c.id}”指向过程“${t.member}”里不存在的参数“${String(t.param)}”。`);
    }
    const first = c.targets[0], p = byId.get(first.member).model.parameters.find((x) => x.id === first.param);
    controlById.set(c.id, { id: c.id, label: c.label ?? p.label, targets: c.targets.map((t) => ({ member: t.member, param: t.param })), min: p.min, max: p.max, step: p.step, default: p.default, unit: p.unit });
  }
  let interventions = [];   // [{ t, control, value }] in scene time, the whole saved state

  /** A member's parameter schedule: its own base schedule with the interventions that target it, in order, merged at their local times. */
  const scheduleFor = (m) => {
    const entries = m.base.map((e) => ({ ...e }));
    for (const iv of interventions) for (const target of controlById.get(iv.control).targets) if (target.member === m.id) {
      const time = Math.max(0, iv.t * m.scale), before = [...entries].reverse().find((e) => e.time <= time), at = entries.findIndex((e) => e.time === time);
      if (at >= 0) entries[at][target.param] = iv.value;
      else { const entry = { ...before, time, [target.param]: iv.value }; entries.push(entry); entries.sort((a, b) => a.time - b.time); }
    }
    return entries;
  };
  const runOf = (m) => {
    const schedule = scheduleFor(m), key = JSON.stringify(schedule);
    if (m.runKey !== key) { m.run = createMarkovRun(m.process, m.seed, schedule); m.runKey = key; }   // only a member whose schedule changed is rebuilt
    return m.run;
  };
  const valueAt = (c, t) => {
    const m = byId.get(c.targets[0].member), params = runOf(m).at(Math.max(0, t * m.scale)).parameters;
    return params[c.targets[0].param];
  };

  return {
    members: [...byId.values()].map(({ id, label, scale, model }) => ({ id, label, timeScale: scale, parameters: model.parameters, counters: model.counters })),
    /** The current run of one member and its clock: what a panel needs to read curves, rates and events in the member's own time (`run.at(sceneTime * timeScale)`). */
    member(id) { const m = byId.get(id); if (!m) throw new Error(`没有过程“${id}”。`); return { run: runOf(m), timeScale: m.scale }; },
    controls: [...controlById.values()],
    /** Each member at scene time `t` (its own time is t × timeScale), the counters of all of them (named member.counter), and the value of every control at `t`. */
    at(t) {
      const state = {}, counters = {};
      for (const m of byId.values()) {
        const s = runOf(m).at(Math.max(0, t * m.scale)); state[m.id] = s;
        for (const [k, v] of Object.entries(s.counters)) counters[`${m.id}.${k}`] = v;
      }
      return { time: t, members: state, counters, controls: Object.fromEntries([...controlById.values()].map((c) => [c.id, valueAt(c, t)])) };
    },
    /**
     * Set a shared control from scene time `t` on. Only the members it targets get a parameter change; an earlier intervention of the same control that lies at or
     * after `t` is replaced (as when a run is rewound and changed), the interventions of other controls stay.
     */
    set(controlId, value, t) {
      const c = controlById.get(controlId);
      if (!c) throw new Error(`没有控件“${controlId}”。`);
      if (!Number.isFinite(value) || value < c.min || value > c.max) throw new Error(`${c.label}应在 ${c.min}–${c.max} 之间。`);
      if (!Number.isFinite(t) || t < 0) throw new Error('时间必须是不小于 0 的数。');
      if (interventions.length >= COMPOSITION_LIMITS.interventions) throw new Error('参数改动太多了。');
      const next = [...interventions.filter((iv) => !(iv.control === controlId && iv.t >= t)), { t, control: controlId, value }].sort((a, b) => a.t - b.t);
      for (const target of c.targets) {   // refuse a value one of the targets cannot take before changing anything
        const m = byId.get(target.member); validateParameterSet(m.model, { ...m.base[0], [target.param]: value });
      }
      interventions = next;
    },
    save: () => ({ interventions: interventions.map((iv) => ({ ...iv })) }),
    restore(saved) {
      const list = Array.isArray(saved?.interventions) ? saved.interventions : [];
      const clean = list.filter((iv) => controlById.has(iv?.control) && Number.isFinite(iv.t) && iv.t >= 0 && Number.isFinite(iv.value)).slice(0, COMPOSITION_LIMITS.interventions);
      interventions = clean.map((iv) => ({ t: iv.t, control: iv.control, value: iv.value })).sort((a, b) => a.t - b.t);
    },
    get interventions() { return interventions.map((iv) => ({ ...iv })); },
  };
}

/**
 * The energy-conversion strip of a work (classic: the `energy` and `stage()` of a process, drawn at the top of the classic viewer). It is a row of named steps, each with an
 * explanation and, optionally, the structures the step involves; one step is lit while the animation runs, and a click on a step shows its explanation and marks its structures.
 *
 * The configuration lives in the work's tool entry (`config.energy`), so it is saved with the work and edited in Studio:
 *   { steps: [{ label, text, select? }], stage?: { mode: 'manual' | 'cycle', period? } }
 *   - `label`   short name of the step (shown in the strip);  `text` its explanation (shown when clicked);  `select` a selection expression (plugins/structure/selection.mjs)
 *               for the structures involved, e.g. `entity "/^复合体 I$/"`.
 *   - `stage`   which step is lit: `manual` = none until the reader clicks one; `cycle` = the steps in turn, one round every `period` animation seconds (the animation clock,
 *               so a paused or slowed animation holds the strip). The classic lit the step where the electron actually was; here the cycle is only an illustration of the order.
 * Nothing here knows a protein: the steps are text, the highlights are selection expressions that match whatever parts the structure has.
 */
export const ENERGY_LIMITS = Object.freeze({ steps: 12, label: 40, text: 1600, select: 200, minPeriod: 2, maxPeriod: 120, defaultPeriod: 24 });
export const STAGE_MODES = Object.freeze(['manual', 'cycle']);

/** Validates a strip declaration; returns { energy, errors } (energy is undefined when the declaration is absent or has errors). Strings are plain text, never HTML. */
export function normalizeEnergy(raw) {
  if (raw === undefined || raw === null) return { energy: undefined, errors: [] };
  const errors = [];
  if (typeof raw !== 'object' || Array.isArray(raw)) return { energy: undefined, errors: ['能量转化条必须是 { steps, stage } 对象。'] };
  const list = Array.isArray(raw.steps) ? raw.steps : [];
  if (!list.length) errors.push('能量转化条至少要有一个步骤。');
  if (list.length > ENERGY_LIMITS.steps) errors.push(`能量转化条最多 ${ENERGY_LIMITS.steps} 个步骤（现在 ${list.length} 个）。`);
  const steps = list.slice(0, ENERGY_LIMITS.steps).map((step, i) => {
    const label = typeof step?.label === 'string' ? step.label.trim() : '', text = typeof step?.text === 'string' ? step.text.trim() : '', select = typeof step?.select === 'string' ? step.select.trim() : '';
    if (!label) errors.push(`第 ${i + 1} 步缺少名称（label）。`);
    if (label.length > ENERGY_LIMITS.label) errors.push(`第 ${i + 1} 步的名称超过 ${ENERGY_LIMITS.label} 个字。`);
    if (text.length > ENERGY_LIMITS.text) errors.push(`第 ${i + 1} 步的讲解超过 ${ENERGY_LIMITS.text} 个字。`);
    if (select.length > ENERGY_LIMITS.select) errors.push(`第 ${i + 1} 步的高亮表达式超过 ${ENERGY_LIMITS.select} 个字符。`);
    return { label, text, ...(select ? { select } : {}) };
  });
  const stage = raw.stage && typeof raw.stage === 'object' ? raw.stage : {}, mode = STAGE_MODES.includes(stage.mode) ? stage.mode : stage.mode === undefined ? 'manual' : null;
  if (mode === null) errors.push(`stage.mode 只能是 ${STAGE_MODES.join(' 或 ')}。`);
  const period = Number.isFinite(Number(stage.period)) && stage.period !== null && stage.period !== '' ? Math.max(ENERGY_LIMITS.minPeriod, Math.min(ENERGY_LIMITS.maxPeriod, Number(stage.period))) : ENERGY_LIMITS.defaultPeriod;
  if (errors.length) return { energy: undefined, errors };
  return { energy: { steps, stage: mode === 'cycle' ? { mode, period } : { mode } }, errors };
}

/** The index of the step to light at animation time `t` (seconds), or -1 when none is (manual mode, no steps, a clock that is not a finite number). */
export function litStep(energy, t) {
  const n = energy?.steps?.length ?? 0;
  if (!n || energy.stage?.mode !== 'cycle' || !Number.isFinite(t) || t < 0) return -1;
  const phase = (t % energy.stage.period) / energy.stage.period;
  return Math.min(n - 1, Math.floor(phase * n));
}

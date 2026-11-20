import { chooseAxis, spinAngle, AxisError } from '../../plugins/motion/rotation.mjs';
import { evaluateSelection, selectionSpace, SelectionError } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM, chainGroupKey } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';
import { kwMatch } from '../../plugins/simulation/structure-frame.mjs';

/**
 * Rotating parts (classic: the per-part "spin" switch). Mark parts in the part list, choose the axis (the symmetry / long / short axis of the marked
 * parts, x / y / z, or the line between two groups of residues), set the speed and play. The maths is in plugins/motion/rotation.mjs and the placement
 * in the viewport (setNodeSpins); this file computes the axis in screen coordinates, runs the clock and draws the little panel.
 */
const MODE_NAMES = { sym: '对称轴', long: '长轴', short: '短轴', x: 'x 轴', y: 'y 轴', z: 'z 轴', between: '两组残基之间' };

export function createObjectSpin({ viewport, elements, context }) {
  let state = null, frame = null, last = 0;

  const show = (text) => { elements.info.textContent = text; };
  const settingsOf = () => ({ mode: elements.mode.value, from: elements.from.value, to: elements.to.value, speed: +elements.speed.value });

  function residuesOf(parts) {
    const keys = new Set();
    for (const key of parts) for (const node of context.parts().get(key) ?? []) keys.add(node.extensions?.['org.glow.structure']?.chainKey);
    return selectionSpace(context.model()).residues.filter((r) => keys.has(chainGroupKey(r.atom)));
  }

  /** The axis in screen coordinates for the marked parts and the settings; throws a message. */
  function computeAxis(parts, settings) {
    const model = context.model(), center = displayCenter(model), space = selectionSpace(model);
    const inScreen = (p) => p.map((v, i) => (v - center[i]) * PRESENTATION_METERS_PER_ANGSTROM);
    const group = (expression, what) => {
      try { return evaluateSelection(expression, space).residues.map((r) => r.position); }
      catch (error) { throw new AxisError(`${what}：${error instanceof SelectionError ? error.message : error.message}`); }
    };
    const own = residuesOf(parts).map((r) => r.position);
    const axis = chooseAxis(settings.mode, settings.mode === 'between'
      ? { from: group(settings.from, '第一组残基'), to: group(settings.to, '第二组残基') } : { points: own });
    return { point: inScreen(axis.point), direction: axis.direction };
  }

  function nodesOf(parts) { return parts.flatMap((key) => (context.parts().get(key) ?? []).map(({ id }) => id)); }

  function place() {
    if (!state) { viewport.setNodeSpins(new Map()); return; }
    const spin = { axis: state.axis, angle: state.angle };
    viewport.setNodeSpins(new Map(nodesOf(state.parts).map((id) => [id, spin])));
  }

  /** Re-reads the marked parts and the settings; a bad setting says why and changes nothing. */
  function configure(parts, { keepAngle = true } = {}) {
    const settings = settingsOf();
    if (!parts.length) { stop(); state = null; place(); show('在部件列表里给要旋转的部件勾上“旋转”。'); return; }
    try {
      const axis = computeAxis(parts, settings);
      state = { parts, settings, axis, angle: keepAngle ? state?.angle ?? 0 : 0 };
      place();
      const [x, y, z] = axis.direction;
      show(`${MODE_NAMES[settings.mode]}：方向 (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})，转 ${parts.length} 个部件，${Math.abs(settings.speed).toFixed(2)} 转/秒${settings.speed < 0 ? '（反向）' : ''}。旋转只是画面上的动作，不改变作品里的坐标。`);
      if (elements.play.checked) start();
    } catch (error) { show(error.message); }
  }

  const tick = (now) => {
    if (!state || !elements.play.checked) { frame = null; last = 0; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016);
    last = now;
    state.angle = spinAngle(state.settings.speed, dt, state.angle);
    place();
    frame = requestAnimationFrame(tick);
  };
  function start() { if (frame == null) { last = 0; frame = requestAnimationFrame(tick); } }
  function stop() { if (frame != null) cancelAnimationFrame(frame); frame = null; last = 0; }

  const marked = () => [...elements.partList.querySelectorAll('[data-spin-part]:checked')].map((box) => box.dataset.spinPart);
  elements.partList.addEventListener('change', (event) => { if (event.target.dataset?.spinPart != null) configure(marked()); });
  for (const input of [elements.mode, elements.from, elements.to]) input.addEventListener('change', () => { elements.pair.hidden = elements.mode.value !== 'between'; configure(state?.parts ?? marked()); });
  elements.speed.addEventListener('input', () => { if (state) { state.settings.speed = +elements.speed.value; configure(state.parts); } });
  elements.play.addEventListener('change', () => { if (elements.play.checked) { if (!state) configure(marked()); start(); } });
  elements.reset.addEventListener('click', () => { if (state) { state.angle = 0; place(); } });

  return {
    /** After the parts list was redrawn or the viewport rebuilt: put the marks and the rotation back. */
    reapply() { if (state) { for (const key of state.parts) { const box = elements.partList.querySelector(`[data-spin-part="${CSS.escape(key)}"]`); if (box) box.checked = true; } place(); } },
    reset() { stop(); state = null; elements.play.checked = false; elements.pair.hidden = true; elements.mode.value = 'sym'; show(''); },
    get marked() { return state?.parts ?? []; },
    /**
     * An animation turns these parts (a data animation's rotor): `info` = { parts: [name or /regex/ of a part], mode, angle (radians) }, or null when it stops. The angle comes from the
     * animation's clock, so it is the same on a replay; the reader's own marks are replaced while it drives. Returns false when none of the named parts is in the scene.
     */
    drive(info) {
      if (!info) { if (state?.driven) { state = null; place(); } return true; }
      const key = JSON.stringify([info.parts, info.mode]);
      if (!state?.driven || state.key !== key) {
        const parts = [...context.parts().keys()].filter((k) => info.parts.some((name) => kwMatch(String(JSON.parse(k)[1] ?? ''), name)));
        if (!parts.length) return false;
        try { state = { parts, settings: { mode: info.mode, from: '', to: '', speed: 0 }, axis: computeAxis(parts, { mode: info.mode, from: '', to: '' }), angle: 0, driven: true, key }; }
        catch (error) { show(error.message); return false; }
      }
      state.angle = info.angle; place(); return true;
    },
    save: () => (state && !state.driven ? { parts: state.parts, mode: state.settings.mode, from: state.settings.from, to: state.settings.to, speed: state.settings.speed, angle: state.angle } : null),
    restore(saved) {
      if (!saved || !Array.isArray(saved.parts)) return;
      elements.mode.value = MODE_NAMES[saved.mode] ? saved.mode : 'sym';
      elements.from.value = typeof saved.from === 'string' ? saved.from.slice(0, 500) : '';
      elements.to.value = typeof saved.to === 'string' ? saved.to.slice(0, 500) : '';
      elements.speed.value = String(Number.isFinite(saved.speed) ? Math.max(-1, Math.min(1, saved.speed)) : 0.1);
      elements.pair.hidden = elements.mode.value !== 'between';
      state = { angle: Number.isFinite(saved.angle) ? saved.angle : 0 };
      configure(saved.parts.filter((key) => typeof key === 'string'));
      this.reapply();
    },
  };
}

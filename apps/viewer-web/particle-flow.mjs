import { Solution, normalizeSolutionSpec, SPECIES_NAMES } from '../../plugins/motion/solution.mjs';
import { evaluateSelection, selectionSpace, SelectionError } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';

/**
 * Free particles in the Viewer (classic: the pools and fast-mode streams of the motion kit). Add pools of a species (they wander in the solution around the
 * structure and never enter protein), add flows between two residue groups, choose the time scale (slow: single molecules; fast: streams) and play. The
 * logic is plugins/motion/solution.mjs; this file reads the panel, converts Å to viewport units, draws through viewport.setParticleCloud and keeps the spec
 * (saved with the work). Names are shown as text only; every particle drawn carries one.
 */
const TAG = 'solution', FLOW_TAG = 'solution-flow';

export function createParticleFlow({ viewport, elements, context }) {
  let solution = null, modelOf = null, frame = null, last = 0, available = true;

  const show = (text) => { elements.info.textContent = text; };

  function ensure() {
    const model = context.model();
    if (!model) return null;
    if (solution && modelOf === model) return solution;
    const space = selectionSpace(model);
    solution = new Solution({
      points: space.residues.map((r) => r.position),
      resolveGroup: (expression) => {
        try { return evaluateSelection(expression, space).residues.map((r) => r.position); }
        catch (error) { throw new Error(error instanceof SelectionError ? error.message : error.message); }
      },
    });
    modelOf = model;
    return solution;
  }

  function draw() {
    if (!available || !solution || !context.model()) { viewport.setParticleCloud(TAG, []); viewport.setParticleCloud(FLOW_TAG, []); return; }
    const center = displayCenter(context.model()), k = PRESENTATION_METERS_PER_ANGSTROM, items = solution.frame();
    const convert = (item) => ({ position: item.position.map((v, i) => (v - center[i]) * k), radius: item.radius * k, color: item.color, alpha: item.alpha, label: item.label, name: item.name });
    viewport.setParticleCloud(TAG, items.filter((i) => i.kind === 'pool').map(convert));
    viewport.setParticleCloud(FLOW_TAG, items.filter((i) => i.kind === 'flow').map(convert), { overlay: true });   // a stream stays visible inside channels
  }

  function renderList() {
    const list = elements.list; list.replaceChildren();
    if (!solution) return;
    const add = (text, kind, index) => {
      const item = document.createElement('li'), label = document.createElement('span'), button = document.createElement('button');
      label.textContent = text; button.type = 'button'; button.textContent = '移除'; button.dataset.particleRemove = `${kind}:${index}`;
      button.setAttribute('aria-label', `移除${text}`); item.append(label, ' ', button); list.append(item);
    };
    solution.spec.pools.forEach((p, i) => add(`${p.species} × ${p.n}`, 'pool', i));
    solution.spec.flows.forEach((f, i) => add(`流 ${f.species}：${f.from} → ${f.to}`, 'flow', i));
  }

  function describe() {
    if (!solution) { show('先载入一个结构。'); return; }
    const s = solution.summary(), parts = [];
    if (s.pools.length) parts.push(`溶液中 ${s.pools.map((p) => `${p.species} ${p.shown}/${p.want}`).join('、')}`);
    if (s.flows.length) parts.push(`${s.flows.length} 条流，${s.flows.map((f) => `${f.species} ${f.cps.toFixed(1)} 周期/秒`).join('、')}`);
    if (s.errors.length) parts.push(s.errors.join('；'));
    if (!parts.length) { show('选择分子种类和个数，点“加入”；或写两组残基加一条流。粒子只是画面上的示意，不改变作品里的坐标。'); return; }
    const fastNote = solution.spec.scale === 'fast' && !s.flows.length ? '（快时间尺度显示流；还没有流，所以仍显示单个分子）' : '';
    show(`${parts.join('；')}。${fastNote}粒子只是画面上的示意，不改变作品里的坐标。`);
  }

  function refresh() { renderList(); describe(); draw(); }

  const tick = (now) => {
    if (!available || !solution || !elements.play.checked) { frame = null; last = 0; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016);
    last = now;
    if (solution.advance(dt)) { draw(); describe(); }
    frame = requestAnimationFrame(tick);
  };
  function start() { if (frame == null) { last = 0; frame = requestAnimationFrame(tick); } }
  function stop() { if (frame != null) cancelAnimationFrame(frame); frame = null; last = 0; }

  // The name card: hover (mouse) or tap (touch / pen) a particle to see what it is. Text only.
  let hoverFrame = null, shown = false;
  const hideCard = () => { if (shown) { elements.card.hidden = true; shown = false; } };
  function cardAt(event) {
    const hit = available && solution ? viewport.pickParticle(event) : null;
    if (!hit) { hideCard(); return; }
    const kind = hit.tag === FLOW_TAG ? '粒子流' : '溶液中的分子';
    elements.card.textContent = `${hit.name} · ${kind}`;
    const box = elements.card.parentElement.getBoundingClientRect();
    elements.card.style.left = `${Math.min(event.clientX - box.left + 12, box.width - 150)}px`; elements.card.style.top = `${Math.max(0, event.clientY - box.top - 28)}px`;
    elements.card.hidden = false; shown = true;
  }
  elements.stage.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || hoverFrame != null) return;
    hoverFrame = requestAnimationFrame(() => { hoverFrame = null; cardAt(event); });
  });
  elements.stage.addEventListener('pointerleave', hideCard);
  elements.stage.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'mouse') cardAt(event); else hideCard(); });

  for (const name of SPECIES_NAMES) { const option = document.createElement('option'); option.value = option.textContent = name; elements.species.append(option); }

  elements.add.addEventListener('click', () => {
    const s = ensure(); if (!s) return;
    const n = Math.round(Number(elements.count.value));
    if (!(n >= 1)) { show('个数要是 1 到 200 的整数。'); return; }
    s.addPool(elements.species.value, n); refresh();
  });
  elements.flowAdd.addEventListener('click', () => {
    const s = ensure(); if (!s) return;
    if (!elements.from.value.trim() || !elements.to.value.trim()) { show('流需要起点和终点两组残基，例如“chain A”和“chain B”。'); return; }
    s.addFlow(elements.species.value, elements.from.value, elements.to.value, Number(elements.rate.value));
    refresh();
  });
  elements.list.addEventListener('click', (event) => {
    const spec = event.target.dataset?.particleRemove; if (!spec || !solution) return;
    const [kind, index] = spec.split(':'); solution.remove(kind, Number(index)); refresh();
  });
  elements.scale.addEventListener('change', () => { if (solution) { solution.setScale(elements.scale.value); describe(); draw(); } });
  elements.rate.addEventListener('input', () => { if (solution) solution.spec.flows.forEach((_, i) => solution.setCps(i, Number(elements.rate.value))); });
  elements.play.addEventListener('change', () => { if (elements.play.checked) { ensure(); start(); } });
  elements.reset.addEventListener('click', () => { if (solution) { solution.reset(); draw(); describe(); } });
  elements.clear.addEventListener('click', () => { if (solution) { solution.setSpec({ seed: solution.spec.seed, scale: solution.spec.scale }); refresh(); } });

  return {
    /** After the viewport was rebuilt: draw the particles again. */
    reapply() { if (solution) draw(); },
    /** The motion plugin (the tool behind this panel) came or went: without it nothing is drawn and nothing runs, but the set is kept for when it returns. */
    setAvailable(on) { if (available === on) return; available = on; if (!on) stop(); else if (elements.play.checked) start(); draw(); },
    reset() { hideCard(); stop(); solution = null; modelOf = null; elements.play.checked = false; elements.scale.value = 'slow'; viewport.setParticleCloud(TAG, []); viewport.setParticleCloud(FLOW_TAG, []); elements.list.replaceChildren(); show(''); },
    /** The current set (also when empty, once the panel was used), or null when it never was. */
    save: () => (solution ? JSON.parse(JSON.stringify(solution.spec)) : null),
    restore(saved) {
      const spec = normalizeSolutionSpec(saved);
      if (!spec.pools.length && !spec.flows.length) return;
      const s = ensure(); if (!s) return;
      elements.scale.value = spec.scale;
      if (spec.flows[0]) elements.rate.value = String(spec.flows[0].cps);
      s.setSpec(spec); refresh();
    },
  };
}

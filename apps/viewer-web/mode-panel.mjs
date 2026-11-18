const TITLES = { cell: '细胞区域', system: '系统对象', protein: '蛋白质部件', mechanism: '机理步骤' };

export function createModePanel(panel, { onObject, onStep, onRotate }) {
  let view, nodes, buttons = [], manualStep, currentStep;
  const element = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
  const name = (id) => nodes.get(id)?.name || id;

  function objectButton(id) {
    const button = element('button', name(id));
    button.type = 'button';
    button.dataset.nodeId = id;
    button.setAttribute('aria-pressed', 'false');
    buttons.push(button);
    return button;
  }

  function objectList(objects, includeParts = false, byParent) {
    const list = document.createElement('ul');
    if (!includeParts) list.className = 'mode-choices';
    for (const node of objects) {
      const item = document.createElement('li');
      item.append(objectButton(node.id));
      const parts = byParent.get(node.id);
      if (includeParts && parts?.length) item.append(objectList(parts, true, byParent));
      list.append(item);
    }
    return list;
  }

  function show(nextView, nextNodes, children = []) {
    view = nextView;
    nodes = nextNodes;
    buttons = [];
    currentStep = undefined;
    manualStep = 0;
    panel.replaceChildren();
    panel.hidden = !view;
    if (!view) return;
    panel.append(element('h3', TITLES[view.mode]));
    if (view.mode === 'mechanism') {
      const list = document.createElement('ol');
      list.className = 'mode-steps';
      view.steps.forEach(({ title, nodeIds, time }, index) => {
        const item = document.createElement('li');
        const button = element('button', title);
        button.type = 'button';
        button.dataset.step = index;
        const timing = time === undefined ? '' : ` · ${time.toLocaleString('zh-CN')} 秒`;
        const participants = element('small', `参与对象：${nodeIds.map(name).join('、')}${timing}`);
        item.append(button, participants);
        list.append(item);
        buttons.push(button);
      });
      panel.append(list);
      return;
    }

    const byParent = new Map();
    const visibility = new Map();
    function visible(id) {
      const chain = [];
      while (id != null && !visibility.has(id)) {
        chain.push(id);
        id = nodes.get(id).parentId;
      }
      let shown = id === null || visibility.get(id);
      for (const nodeId of chain.reverse()) {
        shown = shown && nodes.get(nodeId).visible;
        visibility.set(nodeId, shown);
      }
      return shown;
    }
    for (const node of nodes.values()) {
      if (!visible(node.id)) continue;
      if (!byParent.has(node.parentId)) byParent.set(node.parentId, []);
      byParent.get(node.parentId).push(node);
    }
    const objects = byParent.get(view.nodeId) ?? [];
    if (view.mode === 'cell') {
      panel.append(element('p', '场景方位：+Y 向上。选择区域可在视口定位。'));
      const hotspots = new Set(children.map(({ hotspotNodeId }) => hotspotNodeId).filter(Boolean));
      const regions = new Map(objects.map((node) => [node.id, node]));
      for (const id of hotspots) if (visible(id)) regions.set(id, nodes.get(id));
      if (regions.size) panel.append(objectList(regions.values(), false, byParent));
      return;
    }
    if (objects.length) panel.append(objectList(objects, view.mode === 'protein', byParent));
    if (view.mode === 'protein') {
      panel.append(element('p', '拖动视口可旋转。选择部件可聚焦。'));
      for (const [label, direction] of [['向左旋转', -1], ['向右旋转', 1]]) {
        const button = element('button', label);
        button.type = 'button';
        button.dataset.rotate = direction;
        panel.append(button);
      }
    }
    if (view.connections?.length) {
      panel.append(element('h3', '示意方向'));
      const list = document.createElement('ul');
      for (const { from, to, label } of view.connections) {
        list.append(element('li', `${name(from)} → ${name(to)} · ${label}`));
      }
      panel.append(list);
    }
  }

  function syncStep(time) {
    if (view?.mode !== 'mechanism') return undefined;
    const next = view.steps[0].time === undefined
      ? manualStep
      : view.steps.findLastIndex((step) => step.time <= time);
    if (next !== currentStep) {
      currentStep = next;
      buttons.forEach((button, index) => {
        if (index === next) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
    }
    return view.steps[next];
  }

  panel.addEventListener('click', (event) => {
    const data = event.target.closest('button')?.dataset;
    if (!data || !view) return;
    if (data.nodeId) onObject(data.nodeId);
    if (data.rotate) onRotate(Number(data.rotate));
    if (data.step !== undefined) {
      manualStep = Number(data.step);
      onStep(view.steps[manualStep]);
    }
  });

  return {
    show,
    syncStep,
    syncSelection(id) {
      for (const button of buttons) {
        if (button.dataset.nodeId) button.setAttribute('aria-pressed', String(button.dataset.nodeId === id));
      }
    },
  };
}

const MODES = { cell: '细胞', system: '局部系统', protein: '蛋白质', mechanism: '反应机理' };
const PARENTS = { cell: [], system: ['cell'], protein: ['system'], mechanism: ['system', 'protein'] };
const NEW_VIEW = '';

function element(tag, text = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function button(text, action) {
  const control = element('button', text);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

function field(parent, text, control) {
  const label = element('label');
  label.append(element('span', text), control);
  parent.append(label);
  return control;
}

function input(value, type = 'text') {
  const control = element('input');
  control.type = type;
  control.value = value;
  return control;
}

function select(options, value, { multiple = false } = {}) {
  const control = element('select');
  control.multiple = multiple;
  if (multiple) control.size = 3;
  const selected = new Set(multiple ? value : [value]);
  for (const [id, text] of options) control.add(new Option(text, id, false, selected.has(id)));
  return control;
}

const values = (control) => [...control.selectedOptions].map(({ value }) => value);

export function createNavigationEditor(container, { getSelection, getTime, save }) {
  let scene, selectedId, draftMode;
  let dirty = false;
  let updateOptions;
  let announce;

  function rebuild({ focus = false } = {}) {
    container.replaceChildren();
    updateOptions = announce = undefined;
    const navigation = scene.presentation?.navigation;
    const views = navigation?.views ?? [];
    if (selectedId !== NEW_VIEW && !views.some(({ id }) => id === selectedId)) selectedId = views[0]?.id ?? NEW_VIEW;
    const view = views.find(({ id }) => id === selectedId);
    const allowed = Object.keys(MODES).filter((mode) => mode === 'cell' ? !navigation :
      views.some((candidate) => PARENTS[mode].includes(candidate.mode)));
    const mode = view?.mode ?? (allowed.includes(draftMode) ? draftMode : allowed[0]);
    const picker = field(container, '展示视图', select([
      ...views.map(({ id, mode, title }) => [id, `${MODES[mode]} · ${title}`]), [NEW_VIEW, '新增视图'],
    ], selectedId));
    picker.id = 'navigation-view';
    picker.addEventListener('change', () => {
      if (dirty) { picker.value = selectedId; announce('请先保存或放弃当前视图草稿。'); return; }
      selectedId = picker.value;
      draftMode = undefined;
      rebuild({ focus: true });
    });
    if (focus) picker.focus();
    if (!scene.nodes.length) {
      container.append(element('p', '先从场景树创建或导入对象。'));
      return;
    }

    const form = element('form');
    form.className = 'navigation-form';
    form.noValidate = true;
    container.append(form);
    if (!view) {
      const modePicker = field(form, '模式', select(allowed.map((id) => [id, MODES[id]]), mode));
      modePicker.id = 'navigation-mode';
      modePicker.addEventListener('change', () => {
        if (dirty) { modePicker.value = mode; announce('请先保存或放弃当前视图草稿。'); return; }
        draftMode = modePicker.value;
        rebuild();
        container.querySelector('#navigation-mode').focus();
      });
    }
    const nodeOptions = () => scene.nodes.map((node) => [node.id, node.name || node.id]);
    const bookmarkOptions = () => [['', '自动取景'], ...(scene.presentation?.bookmarks ?? []).map(({ id, name }) => [id, name])];
    const noteOptions = () => (scene.presentation?.notes ?? []).map(({ id, text }) => [id, text]);
    const markDirty = () => { dirty = true; };
    form.addEventListener('input', (event) => { if (event.target.id !== 'navigation-mode') markDirty(); });
    form.addEventListener('change', (event) => { if (event.target.id !== 'navigation-mode') markDirty(); });
    const menus = new Map();
    function liveSelect(options, value, config) {
      const control = select(options(), value, config);
      menus.set(control, options);
      return control;
    }
    updateOptions = () => {
      for (const [control, options] of menus) {
        if (!form.contains(control)) { menus.delete(control); continue; }
        const selected = values(control);
        const available = options();
        const ids = new Set(available.map(([id]) => id));
        for (const id of selected) if (!ids.has(id)) available.push([id, '已删除的引用，请重新选择']);
        control.replaceChildren(...available.map(([id, text]) => new Option(text, id)));
        for (const option of control.options) option.selected = selected.includes(option.value);
        if (control.id === 'view-labels') control.parentElement.hidden = available.length === 0;
      }
    };
    const title = field(form, '视图名称', input(view?.title ?? MODES[mode]));
    title.id = 'view-title';
    const target = field(form, '目标对象', liveSelect(() => [['', '请选择目标对象'], ...nodeOptions()], view?.nodeId ?? getSelection() ?? ''));
    target.id = 'view-target';
    form.append(button('使用场景树所选对象', () => {
      if (getSelection()) { target.value = getSelection(); markDirty(); }
    }));
    const parentOptions = views.filter((candidate) => PARENTS[mode].includes(candidate.mode))
      .map(({ id, mode, title }) => [id, `${MODES[mode]} · ${title}`]);
    const parents = mode === 'cell' ? null : field(form, mode === 'mechanism' ? '进入来源（可多选）' : '进入来源',
      mode === 'mechanism'
        ? select(parentOptions, view?.parentIds ?? [], { multiple: true })
        : select([['', '请选择进入来源'], ...parentOptions], view?.parentIds[0] ?? ''));
    if (parents) parents.id = 'view-parents';
    const hotspot = mode === 'cell' ? null : field(form, '热点对象', liveSelect(() => [['', '仅通过按钮进入'], ...nodeOptions()], view?.hotspotNodeId ?? ''));
    if (hotspot) hotspot.id = 'view-hotspot';
    const camera = field(form, '默认镜头', liveSelect(bookmarkOptions, view?.bookmarkId ?? ''));
    camera.id = 'view-camera';
    const labels = field(form, '可见标注（可多选）', liveSelect(noteOptions, view?.labelIds ?? [], { multiple: true }));
    labels.id = 'view-labels';
    labels.parentElement.hidden = labels.options.length === 0;

    const steps = [];
    let timed;
    if (mode === 'mechanism') {
      const block = element('fieldset');
      block.append(element('legend', '机理步骤'));
      timed = input('', 'checkbox');
      timed.id = 'view-timed';
      timed.checked = view?.steps[0]?.time !== undefined;
      field(block, '与时间线同步', timed).parentElement.className = 'navigation-check';
      const rows = element('div');
      block.append(rows);
      function addStep(step = {}) {
        const row = element('fieldset');
        row.className = 'navigation-step';
        const label = field(row, '步骤名称', input(step.title ?? ''));
        label.dataset.stepTitle = '';
        const participants = field(row, '参与对象（可多选）', liveSelect(nodeOptions, step.nodeIds ?? [], { multiple: true }));
        participants.dataset.stepNodes = '';
        const time = field(row, '时间（秒）', input(step.time ?? '', 'number'));
        time.min = '0';
        time.step = 'any';
        time.dataset.stepTime = '';
        const useTime = button('使用当前播放位置', () => { time.value = getTime(); markDirty(); });
        function syncTime() { time.disabled = useTime.disabled = !timed.checked; }
        const entry = { id: step.id ?? `step-${crypto.randomUUID()}`, label, participants, time, syncTime };
        row.append(useTime, button('删除步骤', () => { steps.splice(steps.indexOf(entry), 1); row.remove(); markDirty(); }));
        rows.append(row);
        steps.push(entry);
        syncTime();
      }
      for (const step of view?.steps ?? [{}]) addStep(step);
      timed.addEventListener('change', () => steps.forEach((step) => step.syncTime()));
      const add = button('添加步骤', () => { addStep(); markDirty(); steps.at(-1).label.focus(); });
      add.id = 'add-view-step';
      block.append(add);
      form.append(block);
    }

    const connections = [];
    if (mode === 'system') {
      const block = element('details');
      block.append(element('summary', '示意方向'));
      const rows = element('div');
      block.append(rows);
      function addConnection(connection = {}) {
        const row = element('fieldset');
        const options = () => [['', '请选择对象'], ...nodeOptions()];
        const from = field(row, '从', liveSelect(options, connection.from ?? ''));
        const to = field(row, '到', liveSelect(options, connection.to ?? ''));
        const label = field(row, '说明', input(connection.label ?? ''));
        const entry = { from, to, label };
        connections.push(entry);
        row.append(button('删除方向', () => { connections.splice(connections.indexOf(entry), 1); row.remove(); markDirty(); }));
        rows.append(row);
        return label;
      }
      for (const connection of view?.connections ?? []) addConnection(connection);
      const add = button('添加示意方向', () => { markDirty(); addConnection().focus(); });
      add.id = 'add-view-connection';
      block.append(add);
      form.append(block);
    }

    const errorText = element('p');
    errorText.className = 'navigation-error';
    errorText.setAttribute('role', 'alert');
    announce = (message) => { errorText.textContent = message; };
    const submit = element('button', '保存视图');
    submit.type = 'submit';
    submit.id = 'save-view';
    submit.className = 'primary';
    form.append(errorText, submit, button('放弃草稿', () => { dirty = false; rebuild({ focus: true }); }));
    function commit(next, id) {
      const previous = selectedId;
      const wasDirty = dirty;
      selectedId = id;
      dirty = false;
      try { save(next); }
      catch (error) { selectedId = previous; dirty = wasDirty; throw error; }
      container.querySelector('#navigation-view').focus();
    }
    function guarded(action) {
      try { errorText.textContent = ''; action(); }
      catch (error) { errorText.textContent = error.message; }
    }
    if (view) form.append(button('删除视图', () => guarded(() => {
      if (dirty) throw new Error('请先保存或放弃当前视图草稿。');
      const dependent = views.find(({ parentIds }) => parentIds.includes(view.id));
      if (dependent) throw new Error(`「${dependent.title}」仍从此视图进入。请先调整它的进入来源。`);
      const remaining = views.filter(({ id }) => id !== view.id);
      commit(remaining.length ? { ...navigation, views: remaining } : null, remaining[0]?.id ?? NEW_VIEW);
    })));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      guarded(() => {
        if (!title.value.trim() || !target.value) throw new Error('请填写视图名称并选择目标对象。');
        for (const [control, options] of menus) {
          if (!form.contains(control)) continue;
          const available = new Set(options().map(([id]) => id));
          if (values(control).some((id) => !available.has(id))) throw new Error('有引用已被删除，请重新选择。');
        }
        const parentIds = parents ? values(parents).filter(Boolean) : [];
        if (parents && !parentIds.length) throw new Error('请选择进入来源。');
        const id = view?.id ?? `view-${crypto.randomUUID()}`;
        const next = { id, mode, title: title.value.trim(), nodeId: target.value, parentIds,
          bookmarkId: camera.value || null, labelIds: values(labels) };
        if (hotspot?.value) next.hotspotNodeId = hotspot.value;
        if (mode === 'mechanism') {
          if (!steps.length) throw new Error('至少添加一个机理步骤。');
          let last = -1;
          next.steps = steps.map(({ id, label, participants, time }) => {
            const nodeIds = values(participants);
            if (!label.value.trim() || !nodeIds.length) throw new Error('每个步骤都需要名称和至少一个参与对象。');
            const item = { id, title: label.value.trim(), nodeIds };
            if (timed.checked) {
              const seconds = time.valueAsNumber;
              if (!scene.timeline.tracks.length) throw new Error('请先用时间线添加关键帧。');
              if (!Number.isFinite(seconds) || seconds <= last || seconds < 0 || seconds > scene.timeline.duration) {
                throw new Error('步骤时间须在时间线范围内，并按从早到晚填写。');
              }
              item.time = last = seconds;
            }
            return item;
          });
        }
        if (connections.length || view?.connections) next.connections = connections.map(({ from, to, label }) => {
          if (!from.value || !to.value || from.value === to.value || !label.value.trim()) throw new Error('每条示意方向需要两个不同的对象和说明。');
          return { from: from.value, to: to.value, label: label.value.trim() };
        });
        const nextViews = view ? views.map((existing) => existing.id === id ? next : existing) : [...views, next];
        commit({ version: 1, entryId: navigation?.entryId ?? id, views: nextViews }, id);
      });
    });
  }

  return {
    render(nextScene) {
      if (scene === nextScene) return;
      if (scene?.id !== nextScene.id) { selectedId = undefined; draftMode = undefined; dirty = false; }
      scene = nextScene;
      if (dirty && updateOptions) updateOptions();
      else rebuild();
    },
    assertSaved() {
      if (dirty) throw new Error('四模式导航有未保存的草稿。请先保存视图或放弃草稿。');
    },
  };
}

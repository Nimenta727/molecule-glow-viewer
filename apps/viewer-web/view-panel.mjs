/**
 * The Viewer's "查看" page: buttons for what the command interface (`window.glow`) can already do — how a part is drawn (cartoon, backbone, blobs, sticks, ball-and-stick), how it is coloured,
 * molecular surfaces, which subunits are shown, isolated or focused, and the cut — plus a "视角" block that moves the view (rotate, slide, zoom, standard views, mouse mode, re-centre).
 * Nothing here draws or changes a structure by itself: every button calls one command (so the validation and the error messages are the ones of the command), and a command's error is shown in the panel.
 * `api.run(name, args)` is the Viewer's command queue; `viewport` is the render viewport (navigation only); `chains()` lists the chain ids of the open structure.
 */
const STYLES = [['cartoon', '卡通'], ['backbone', '主链'], ['blob', '团块'], ['sticks', '棍状（键）'], ['ballstick', '球棍'], ['hidden', '隐藏']];
const COLORS = [['chain', '按链'], ['rainbow', '彩虹'], ['secondary', '二级结构'], ['hydrophobicity', '疏水性'], ['charge', '电荷'], ['bfactor', 'B 因子'], ['entity', '默认']];
const SURFACES = [['plain', '单色表面'], ['hydrophobicity', '疏水表面'], ['electrostatic', '静电表面（简化）']];
const VIEWS = [['front', '正面'], ['back', '背面'], ['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下']];
const MODES = [['rotate', '旋转'], ['pan', '平移'], ['zoom', '缩放']];

export function createViewPanel({ root, navRoot, api, viewport, chains, document: doc = root.ownerDocument }) {
  const make = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else node.setAttribute(key, value); }
    node.append(...children); return node;
  };
  const button = (text, onClick, props = {}) => { const node = make('button', { type: 'button', ...props, text }); node.addEventListener('click', onClick); return node; };
  const message = make('p', { class: 'view-message', role: 'status' });
  const say = (text, bad = false) => { message.textContent = text; message.dataset.state = bad ? 'error' : 'ok'; };
  const run = async (name, args, done) => {
    try { const result = await api.run(name, args); say(done ?? result?.note ?? '已完成。'); return result; } catch (error) { say(error.message, true); return null; }
  };

  // ---- what to act on ----
  const scope = make('select', { id: 'view-scope', 'aria-label': '作用对象' }), custom = make('input', { type: 'text', id: 'view-scope-custom', placeholder: '或写选择，如 chain A and resi 10-50', 'aria-label': '选择表达式' });
  const target = () => custom.value.trim() || scope.value;
  function fillScope() {
    const ids = chains() ?? [], previous = scope.value;
    scope.replaceChildren(make('option', { value: 'all', text: '全部' }), make('option', { value: 'ligands', text: '小分子（配体）' }), ...ids.map((id) => make('option', { value: `chain ${id}`, text: `链 ${id}` })));
    if ([...scope.options].some((option) => option.value === previous)) scope.value = previous;
  }
  const row = (...nodes) => make('div', { class: 'view-row' }, ...nodes);
  const title = (text) => make('h4', { class: 'view-title', text });
  const styleButtons = row(...STYLES.map(([id, label]) => button(label, () => run('show', [target(), id], `${label}：${target()}`), { 'data-style': id })), button('恢复默认', () => run('show', ['reset'], '已恢复默认表示。')));
  const colorButtons = row(...COLORS.map(([id, label]) => button(label, () => run('color', id === 'entity' ? 'entity' : (['chain', 'rainbow'].includes(id) ? id : [target(), id]), `${label}`), { 'data-color': id })));
  const swatch = make('input', { type: 'color', value: '#e05a4a', 'aria-label': '自选颜色' });
  const swatchButton = button('上色', () => run('color', [target(), swatch.value], `把 ${target()} 涂成 ${swatch.value}`));
  const surfaceButtons = row(...SURFACES.map(([id, label]) => button(label, () => run('surface', [target(), id], `${label}：${target()}`), { 'data-surface': id })), button('清除表面', () => run('surface', 'clear', '已清除表面。')));

  // ---- subunits ----
  const list = make('div', { class: 'view-chains', role: 'list' });
  const hiddenChains = new Set();
  async function setChain(id, visible) {
    const result = await run('show', [`chain ${id}`, visible ? 'cartoon' : 'hidden'], visible ? `显示链 ${id}` : `隐藏链 ${id}`);
    if (result) { if (visible) hiddenChains.delete(id); else hiddenChains.add(id); }
    return Boolean(result);
  }
  function refreshChains() {
    fillScope();
    const ids = chains() ?? [];
    list.replaceChildren(...(ids.length ? ids : []).map((id) => {
      const box = make('input', { type: 'checkbox', 'aria-label': `显示链 ${id}` }); box.checked = !hiddenChains.has(id);
      box.addEventListener('change', async () => { if (!(await setChain(id, box.checked))) box.checked = !box.checked; });
      const only = button('只看它', async () => { for (const other of ids) await setChain(other, other === id); refreshChains(); }, { title: `隐藏其他所有链，只留链 ${id}` });
      return make('div', { class: 'view-chain', role: 'listitem' }, make('label', {}, box, make('span', { text: ` 链 ${id}` })),
        button('选中', () => run('select', `chain ${id}`, `已选中链 ${id}`)), button('聚焦', () => run('camera', { focus: `chain ${id}` }, `镜头对准链 ${id}`)), only);
    }));
    if (!ids.length) list.append(make('p', { class: 'view-hint', text: '打开结构后，这里列出每条链。' }));
  }
  const allButtons = row(button('全部显示', async () => { await run('show', ['all', 'cartoon'], '全部显示'); hiddenChains.clear(); refreshChains(); }), button('取消选择', () => run('select', 'none', '已取消选择')));

  // ---- look packs (plugin: 光影包; the command refuses with the way back when the plugin is switched off) ----
  const packRow = row();
  async function fillPacks() {
    try {
      const result = await api.run('lookPack', undefined);
      packRow.replaceChildren(...(result.packs ?? []).map((pack) => button(pack.name, () => run('lookPack', pack.id, `光影：${pack.name}。${pack.summary ?? ''}`), { title: pack.summary ?? '', 'data-pack': pack.id })), button('默认墨线', () => run('lookPack', 'none', '已回到默认墨线风格。')));
    } catch (error) { packRow.replaceChildren(make('span', { class: 'view-hint', text: error.message })); }
  }

  // ---- cut ----
  const depth = make('input', { type: 'range', min: '-1', max: '1', step: '0.05', value: '0', 'aria-label': '剖切深度' });
  const cutButtons = row(button('沿视线剖开', () => run('clip', { enabled: true, depth: Number(depth.value), aim: true }, '已剖开：拖动滑块改变深度；换角度后再按一次可重新对准。')), button('关闭剖开', () => run('clip', { enabled: false }, '已关闭剖开。')));
  depth.addEventListener('input', () => { run('clip', { enabled: true, depth: Number(depth.value) }); });

  root.replaceChildren(
    title('作用对象'), row(scope), row(custom),
    title('显示方式'), styleButtons,
    title('颜色'), colorButtons, row(swatch, swatchButton),
    title('分子表面'), surfaceButtons,
    title('光影（插件：光影包）'), packRow,
    title('剖开'), cutButtons, row(make('label', {}, '深度 ', depth)),
    title('亚基'), allButtons, list, message,
  );
  fillScope(); refreshChains(); fillPacks();

  // ---- navigation ----
  const step = 0.08, turn = Math.PI / 12;
  const arrow = (label, fn, name) => button(label, fn, { 'aria-label': name, class: 'view-arrow' });
  const mode = make('div', { class: 'view-modes', role: 'radiogroup', 'aria-label': '鼠标左键的作用' });
  function setMode(id) { try { viewport.setNavigationMode(id); } catch (error) { say(error.message, true); return; } for (const node of mode.children) node.setAttribute('aria-checked', String(node.dataset.mode === id)); }
  for (const [id, label] of MODES) mode.append(button(label, () => setMode(id), { role: 'radio', 'data-mode': id, 'aria-checked': String(id === 'rotate') }));
  const centreOnSelection = () => run('camera', { focus: target() }, `镜头对准 ${target()}（同时拉近）`);
  navRoot.replaceChildren(
    title('鼠标左键'), mode,
    make('p', { class: 'view-hint', text: '左键拖动：按上面的模式；右键拖动：平移；滚轮：朝鼠标所指处缩放；双击画面上的点：把它设为旋转中心。' }),
    title('旋转'), row(arrow('↺', () => viewport.rotateBy(-turn, 0), '向左转'), arrow('↻', () => viewport.rotateBy(turn, 0), '向右转'), arrow('↑', () => viewport.rotateBy(0, turn), '向上转'), arrow('↓', () => viewport.rotateBy(0, -turn), '向下转')),
    title('平移'), row(arrow('←', () => viewport.panBy(-step, 0), '画面左移'), arrow('→', () => viewport.panBy(step, 0), '画面右移'), arrow('↑', () => viewport.panBy(0, step), '画面上移'), arrow('↓', () => viewport.panBy(0, -step), '画面下移')),
    title('缩放'), row(button('放大', () => viewport.zoomBy(0.8)), button('缩小', () => viewport.zoomBy(1.25))),
    title('标准视角'), row(...VIEWS.map(([id, label]) => button(label, () => { try { viewport.setViewDirection(id); } catch (error) { say(error.message, true); } }))),
    title('旋转中心'), row(button('以所选为中心并拉近', centreOnSelection), button('重置视角', () => run('camera', 'reset', '视角已重置'))),
  );
  return { refresh: () => { refreshChains(); fillPacks(); }, setMode, dispose() { root.replaceChildren(); navRoot.replaceChildren(); } };
}

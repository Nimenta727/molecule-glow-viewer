/**
 * The Studio's process tab: what the command interface (`window.studio`, driven by an AI) is doing, step by step, as it happens. A professional maker watches the work grow, can slow the
 * demonstration down, lets the Studio follow with the right tab, and can go back to before any step (every step is an ordinary undoable edit of the work — the log only remembers how deep the
 * undo stack was when the step began). The log is a display: it never changes a command or its answer.
 *   hooks.depth()          how many steps can be undone now          hooks.undoTo(depth)   undo until at most `depth` steps remain
 *   hooks.showTab(id)      bring a tab to the front                   hooks.readOnly(cmd)   true for commands that change nothing
 */
export const TAB_OF = Object.freeze({
  select: 'tab-look', show: 'tab-look', color: 'tab-look', surface: 'tab-look', lookPack: 'tab-look', measure: 'tab-look', label: 'tab-look', annotations: 'tab-look',
  contacts: 'tab-analysis', composition: 'tab-analysis', secondary: 'tab-analysis', superpose: 'tab-analysis', cameraKey: 'tab-story', note: 'tab-story', title: 'tab-story',
});
export const PACES = Object.freeze([[0, '不放慢'], [500, '每步 0.5 秒'], [1200, '每步 1.2 秒'], [2500, '每步 2.5 秒']]);
const LIMIT = 300;

const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
/** A short, readable form of the arguments (long texts, such as a structure file given inline, are not shown). */
export function describeArgs(args) {
  if (args === null || args === undefined) return '';
  const text = JSON.stringify(args, (key, value) => (typeof value === 'string' && value.length > 60 ? `${value.slice(0, 24)}…（${value.length} 个字符）` : value));
  return clip(text.replace(/^\[(.*)\]$/s, '$1'), 110);
}
/** One line for the answer of a command: its own note, else the main numbers. */
export function describeResult(result) {
  if (!result || typeof result !== 'object') return '';
  if (typeof result.note === 'string') return clip(result.note, 220);
  const bits = [];
  for (const key of ['residues', 'pairs', 'rmsd', 'triangles', 'rules', 'current', 'title']) if (result[key] !== undefined) bits.push(`${key} ${typeof result[key] === 'object' ? JSON.stringify(result[key]) : result[key]}`);
  if (result.structures) bits.push(`${result.structures.length} 个结构`);
  if (result.surface) bits.push(`表面 ${result.surface.triangles} 个三角形`);
  if (result.wrote?.length) bits.push(`写入：${result.wrote.join('、')}`);
  return clip(bits.join('；'), 220);
}

export function createProcessLog(container, hooks, { doc = container.ownerDocument } = {}) {
  const el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } n.append(...kids); return n; };
  const follow = el('input', { type: 'checkbox', id: 'process-follow', checked: '' }), pace = el('select', { id: 'process-pace', 'aria-label': '演示速度' }, ...PACES.map(([ms, label]) => el('option', { value: String(ms), text: label })));
  const clear = el('button', { type: 'button', id: 'process-clear', text: '清空记录' }), now = el('p', { class: 'tool-note', id: 'process-now', role: 'status', 'aria-live': 'polite', text: '还没有来自 AI 的操作。' });
  const list = el('ol', { class: 'process-list', id: 'process-list', 'aria-label': 'AI 的操作记录' });
  container.replaceChildren(
    el('p', { class: 'tool-note', text: '这里实时显示通过命令接口（window.studio，给 AI 用）做的每一步。每一步都是作品里普通的、可撤销的修改：你可以随时接手，在画面和各个页签里继续改；点“回到这一步前”撤销到那一步之前。' }),
    el('div', { class: 'button-row' }, el('label', {}, follow, doc.createTextNode(' 跟随 AI 切换页签')), pace, clear), now, list);
  const entries = []; let counter = 0;

  function render(entry) {
    if (!entry.node) { entry.node = el('li', { class: 'process-step' }); list.append(entry.node); while (list.children.length > LIMIT) list.firstChild.remove(); }
    const back = el('button', { type: 'button', 'data-back': String(entry.n), text: '回到这一步前', title: '撤销到这一步开始之前（之后的步骤一并撤销）' }); if (entry.state === 'running') back.disabled = true;
    entry.node.dataset.state = entry.state;
    entry.node.replaceChildren(el('span', { class: 'process-n', text: String(entry.n) }), el('b', { text: entry.cmd }), el('code', { text: entry.argsText }),
      el('span', { class: 'process-note', text: entry.state === 'running' ? '执行中…' : entry.note }), back);
  }
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-back]'); if (!button) return;
    const entry = entries.find((item) => item.n === Number(button.dataset.back)); if (!entry) return;
    hooks.undoTo(entry.depthBefore); now.textContent = `已回到第 ${entry.n} 步（${entry.cmd}）之前。`;
  });
  clear.addEventListener('click', () => { entries.length = 0; list.replaceChildren(); now.textContent = '记录已清空（作品里的修改不受影响）。'; });

  return {
    entries,
    /** Hook for createCommandApi({ onEvent }). Read-only commands are not logged: they change nothing. */
    onEvent(event) {
      if (hooks.readOnly(event.cmd)) return;
      if (event.phase === 'start') {
        const entry = { n: ++counter, cmd: event.cmd, argsText: describeArgs(event.args), state: 'running', note: '', depthBefore: hooks.depth() };
        entries.push(entry); render(entry); now.textContent = `AI 正在执行第 ${entry.n} 步：${entry.cmd}(${entry.argsText})`;
        if (follow.checked && TAB_OF[event.cmd]) hooks.showTab(TAB_OF[event.cmd]);
        return;
      }
      const entry = entries.findLast((item) => item.cmd === event.cmd && item.state === 'running'); if (!entry) return;
      entry.state = event.phase === 'error' ? 'error' : 'done'; entry.note = event.phase === 'error' ? event.error : describeResult(event.result); render(entry);
      now.textContent = entry.state === 'error' ? `第 ${entry.n} 步没有成功：${entry.note}` : `第 ${entry.n} 步完成：${entry.cmd}。`;
    },
    /** Hook for createCommandApi({ pace }): a pause before a command that changes the work, so a person can follow. */
    pace(cmd) {
      const ms = Number(pace.value); if (!(ms > 0) || hooks.readOnly(cmd)) return undefined;
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  };
}

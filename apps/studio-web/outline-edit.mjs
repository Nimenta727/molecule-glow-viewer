/**
 * Outliner editing, pure (no DOM): which rows are selected after a click, and what moving, grouping or removing a selection means as document commands. The Studio turns the
 * commands into one `batch`, so a whole drag is one undo step. `nodes` are the scene document's nodes ({ id, parentId, ... }) in any order; `order` is the row order shown.
 */

/** The selection after a click on row `id`: plain click selects only it; Ctrl/Cmd-click toggles it; Shift-click selects the rows between the anchor and it. Returns { selected: [ids in row order], anchor }. */
export function clickSelection({ order, selected, anchor }, id, { shift = false, toggle = false } = {}) {
  if (!order.includes(id)) return { selected: [...selected].filter((item) => order.includes(item)), anchor };
  if (shift && anchor && order.includes(anchor)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
    return { selected: order.slice(a, b + 1), anchor };
  }
  if (toggle) {
    const set = new Set(selected);
    if (!set.delete(id)) set.add(id);
    return { selected: order.filter((item) => set.has(item)), anchor: id };
  }
  return { selected: [id], anchor: id };
}

const byId = (nodes) => new Map(nodes.map((node) => [node.id, node]));
const ancestors = (map, id) => { const out = []; for (let at = map.get(id)?.parentId; at != null && !out.includes(at); at = map.get(at)?.parentId) out.push(at); return out; };

/** Of the selected ids, the ones that stand for the whole selection: existing nodes none of whose ancestors is also selected (children travel with their parent). */
export function topLevel(nodes, ids) {
  const map = byId(nodes), chosen = new Set(ids.filter((id) => map.has(id)));
  return [...chosen].filter((id) => !ancestors(map, id).some((parent) => chosen.has(parent)));
}

/**
 * Moving `ids` under `targetId` (null = the scene root). Returns { commands, moved, error }: one `updateNode` per top-level selected node whose parent changes. Refused (error set,
 * no commands) when the target is one of the moved nodes or inside one of them, which would make a cycle, or when the target does not exist.
 */
export function reparentPlan(nodes, ids, targetId) {
  const map = byId(nodes);
  if (targetId !== null && !map.has(targetId)) return { commands: [], moved: [], error: '目标对象不存在。' };
  const tops = topLevel(nodes, ids);
  if (targetId !== null && tops.some((id) => id === targetId || ancestors(map, targetId).includes(id))) return { commands: [], moved: [], error: '不能把对象移到它自己或它的子对象下面。' };
  const moved = tops.filter((id) => (map.get(id).parentId ?? null) !== targetId);
  return { commands: moved.map((id) => ({ type: 'updateNode', id, patch: { parentId: targetId } })), moved, error: null };
}

/** Grouping the selection: a new group under the first selected node's parent, and every top-level selected node moved into it. */
export function groupPlan(nodes, ids, group) {
  const tops = topLevel(nodes, ids), map = byId(nodes);
  if (!tops.length) return { commands: [], error: '没有可成组的对象。' };
  const parentId = map.get(tops[0]).parentId ?? null;
  return { commands: [{ type: 'addNode', node: { ...group, parentId } }, ...tops.map((id) => ({ type: 'updateNode', id, patch: { parentId: group.id } }))], error: null };
}

/** Removing the selection: one `removeNode` per top-level selected node (a removed node takes its children with it, so they are not removed twice). */
export const removePlan = (nodes, ids) => topLevel(nodes, ids).map((id) => ({ type: 'removeNode', id }));

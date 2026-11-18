export function createSceneNavigation(definition, nodes) {
  if (!definition) return null;
  const views = new Map(definition.views.map((view) => [view.id, view]));
  const parents = new Map(nodes.map(({ id, parentId }) => [id, parentId]));
  const path = [{ view: views.get(definition.entryId) }];
  let selection = path[0].view.nodeId;

  const current = () => path.at(-1).view;
  const children = () => definition.views.filter(({ parentIds }) => parentIds.includes(current().id));

  function hotspotFor(id) {
    const available = children();
    for (let node = id; node != null; node = parents.get(node)) {
      const view = available.find(({ hotspotNodeId }) => hotspotNodeId === node);
      if (view) return view;
    }
    return null;
  }

  return {
    current,
    children,
    path: () => path.map(({ view }) => view),
    selection: () => selection,
    select(id) { selection = parents.has(id) ? id : current().nodeId; },
    hotspotFor,
    enter(id, camera) {
      const view = children().find((candidate) => candidate.id === id);
      if (!view) return false;
      path.push({ view, returnTo: { selection, camera } });
      selection = view.nodeId;
      return true;
    },
    back() {
      if (path.length < 2) return null;
      const { returnTo } = path.pop();
      selection = returnTo.selection;
      return returnTo.camera;
    },
  };
}

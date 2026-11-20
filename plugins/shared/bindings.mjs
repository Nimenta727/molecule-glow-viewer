/**
 * Role bindings for the structure-based tools: which scene nodes (chains/parts of the imported structure) a tool works on.
 * A work stores the binding in scene.tools[].bindings; without one the tool falls back to matching part names, as before.
 */
export const STRUCTURE_EXTENSION = 'org.glow.structure';
export const partNameOf = (node) => node.extensions?.[STRUCTURE_EXTENSION]?.partName ?? '';

/** The nodes that came from one structure file. */
export const nodesOfSource = (scene, sourceId) => scene.nodes.filter((node) => node.extensions?.[STRUCTURE_EXTENSION]?.sourceAssetId === sourceId);

/**
 * The nodes of a role: the saved binding when there is one (it must name nodes of this structure), otherwise every node
 * the tool's own part-name test accepts.
 */
export function boundOrMatched(nodes, bindings, role, match) {
  const ids = bindings?.[role];
  if (!ids) return nodes.filter(match);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const stray = ids.find((id) => !byId.has(id));
  if (stray !== undefined) throw new Error(`角色 ${role} 绑定的对象 ${stray} 不属于这个结构。`);
  return ids.map((id) => byId.get(id));
}

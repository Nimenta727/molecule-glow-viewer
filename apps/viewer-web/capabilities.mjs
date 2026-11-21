/**
 * What a scene needs that this application may not have (4.5.2, missing capability and old ids). A scene names its tools (`tools[].tool.id`, possibly under an earlier id) and the plugins it depends on
 * (`dependencies`); opening it must neither fail nor silently drop what it cannot run. This reads the scene and says, per item, what will happen: the item runs, it runs under its current id, or it
 * is missing and that part does not run while everything else is shown. Pure; the Viewer adds the messages to the scene's diagnostics, the Studio's publish check uses the same facts.
 * Items are { level: 'info' | 'warning', code, message, ... }.
 *   isKnown(toolId)       whether this application has the tool (built in or registered)
 *   resolveToolId(toolId) the registered id behind an earlier id (aliases) or undefined
 *   knownPlugins          ids of the plugins this application can activate
 */
const major = (version) => Number(String(version ?? '').split('.')[0]);

export function capabilityReport(scene, { isKnown = () => true, resolveToolId = () => undefined, knownPlugins = new Set(), pluginVersions = new Map() } = {}) {
  const items = [];
  for (const entry of scene.tools ?? []) {
    const id = entry.tool.id;
    if (!isKnown(id)) { items.push({ level: 'warning', code: 'tool-missing', toolId: id, entryId: entry.id, message: `作品使用的工具 ${id} 在这个应用里不存在：这一部分不会运行，其余内容照常显示。可以换用较新的版本，或在工坊的模板区看静态版本。` }); continue; }
    const resolved = resolveToolId(id);
    if (resolved && resolved !== id) items.push({ level: 'info', code: 'tool-alias', toolId: id, resolvedId: resolved, entryId: entry.id, message: `工具 ${id} 是旧编号，已按 ${resolved} 运行；重新保存后会写成新编号。` });
  }
  for (const dependency of scene.dependencies ?? []) {
    if (!knownPlugins.has(dependency.id)) {
      items.push({ level: dependency.optional ? 'info' : 'warning', code: 'plugin-missing', pluginId: dependency.id,
        message: `作品${dependency.optional ? '可选地' : ''}依赖插件 ${dependency.id}（${dependency.version}），这个应用没有它${dependency.optional ? '；相关增强不会出现' : '；依赖它的部分不会运行'}。` });
      continue;
    }
    const have = pluginVersions.get(dependency.id);
    if (have && major(have) !== major(dependency.version)) items.push({ level: 'warning', code: 'plugin-version', pluginId: dependency.id, message: `作品按插件 ${dependency.id} ${dependency.version} 制作，这个应用的版本是 ${have}（主版本不同），行为可能不一致。` });
  }
  return items;
}

/**
 * What `glow.help()` says about tools: the registered tools of the plugin host as plain data, from their descriptors, so a script (or a person) can find out which tools exist, what runs them,
 * what their runtime controls are and how to reach them through `glow.animate({ parameters })`, without reading source. Nothing here is executable; a descriptor's functions are left out.
 */
export function describeTool(tool) {
  const parameters = Object.entries(tool.parameters ?? {}).map(([key, spec]) => ({ key, type: spec.type, label: spec.label,
    ...(spec.unit ? { unit: spec.unit } : {}), ...(spec.type === 'number' ? { min: spec.min, max: spec.max, step: spec.step } : {}),
    ...(spec.type === 'select' ? { options: spec.options.map(({ value }) => value) } : {}), default: spec.default }));
  return { id: tool.id, title: tool.title, version: tool.version, runtime: tool.runtime, audience: [...tool.audience], parameters,
    ...(tool.model ? { model: { kind: tool.model.kind, assumptions: [...(tool.model.assumptions ?? [])] } } : {}) };
}
export const describeTools = (tools) => tools.map(describeTool);

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { toolPlugins, toolEvidence, SOLUTION_TOOL, PROCESS_TOOL } from '../../mechanism-catalog.mjs';

const sceneWith = (...ids) => ({ tools: ids.map((id) => ({ id, tool: { id, version: '1.0.0' }, config: {} })) });

test('every tool of a scene gives one modelled line and one illustrative line per declared assumption', async () => {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin);
  for (const plugin of toolPlugins) await host.activate(plugin);
  const lines = toolEvidence(sceneWith(SOLUTION_TOOL, PROCESS_TOOL, SOLUTION_TOOL), { getTool: (id) => host.getTool(id) });
  const byTool = (id) => lines.filter((l) => l.toolId === id);
  const solution = host.getTool(SOLUTION_TOOL);
  assert.equal(byTool(SOLUTION_TOOL).length, 1 + solution.model.assumptions.length, 'a tool listed twice counts once');
  assert.equal(byTool(SOLUTION_TOOL)[0].type, 'modelled');
  assert.ok(byTool(SOLUTION_TOOL).slice(1).every((l) => l.type === 'illustrative' && l.citation.startsWith('溶液粒子与流：')));
  assert.ok(byTool(PROCESS_TOOL).some((l) => /不是分子动力学/.test(l.citation)));
});

test('a tool whose plugin is not active is named, not silently dropped; no tools, no lines', () => {
  const lines = toolEvidence(sceneWith(PROCESS_TOOL), { getTool: () => undefined });
  assert.equal(lines.length, 1); assert.equal(lines[0].type, 'illustrative'); assert.match(lines[0].citation, /插件没有启用/);
  assert.deepEqual(toolEvidence({}, {}), []);
  assert.deepEqual(toolEvidence({ tools: [] }, { getTool: () => undefined }), []);
});

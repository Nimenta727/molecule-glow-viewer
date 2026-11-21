import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityReport } from '../capabilities.mjs';

const tool = (id, entry = 'e1') => ({ id: entry, tool: { id, version: '1.0.0' }, config: {} });
const options = { isKnown: (id) => id.startsWith('org.glow.tool.') || id === 'org.glow.legacy-process.kcsa', resolveToolId: (id) => (id === 'org.glow.legacy-process.kcsa' ? 'org.glow.tool.stochastic-process' : id),
  knownPlugins: new Set(['org.glow.structure', 'org.glow.motion']), pluginVersions: new Map([['org.glow.structure', '1.2.0']]) };

test('a scene with everything it needs reports nothing', () => {
  assert.deepEqual(capabilityReport({ tools: [tool('org.glow.tool.data-animation')], dependencies: [{ id: 'org.glow.structure', version: '1.0.0', optional: false }] }, options), []);
  assert.deepEqual(capabilityReport({}, options), [], 'a scene without tools or dependencies');
});
test('a missing tool is a warning that names it and says the rest still shows; the scene is not refused', () => {
  const [item] = capabilityReport({ tools: [tool('com.example.fancy-tool', 'x9')] }, options);
  assert.deepEqual([item.level, item.code, item.toolId, item.entryId], ['warning', 'tool-missing', 'com.example.fancy-tool', 'x9']);
  assert.match(item.message, /com\.example\.fancy-tool/); assert.match(item.message, /其余内容照常显示/);
});
test('an earlier tool id is information: it runs under the current id', () => {
  const [item] = capabilityReport({ tools: [tool('org.glow.legacy-process.kcsa')] }, options);
  assert.deepEqual([item.level, item.code, item.resolvedId], ['info', 'tool-alias', 'org.glow.tool.stochastic-process']);
  assert.match(item.message, /旧编号/);
});
test('plugin dependencies: a required one that is missing warns, an optional one is information, a different major version warns', () => {
  const items = capabilityReport({ dependencies: [{ id: 'org.example.gone', version: '2.0.0', optional: false }, { id: 'org.example.nice', version: '1.0.0', optional: true }, { id: 'org.glow.structure', version: '2.0.0', optional: false }, { id: 'org.glow.motion', version: '1.0.0', optional: false }] }, options);
  assert.deepEqual(items.map(({ level, code }) => `${level}:${code}`), ['warning:plugin-missing', 'info:plugin-missing', 'warning:plugin-version']);
  assert.match(items[1].message, /可选/); assert.match(items[2].message, /1\.2\.0/);
  assert.deepEqual(capabilityReport({ dependencies: [{ id: 'org.glow.structure', version: '1.0.0', optional: false }] }, options), [], 'the same major version is fine');
});
test('the report is plain data and several problems are all reported, in the order of the scene', () => {
  const items = capabilityReport({ tools: [tool('a.b.c', 'one'), tool('org.glow.legacy-process.kcsa', 'two'), tool('d.e.f', 'three')], dependencies: [{ id: 'x.y', version: '1.0.0', optional: false }] }, options);
  assert.deepEqual(items.map(({ code, entryId, pluginId }) => [code, entryId ?? pluginId]), [['tool-missing', 'one'], ['tool-alias', 'two'], ['tool-missing', 'three'], ['plugin-missing', 'x.y']]);
  assert.doesNotThrow(() => JSON.stringify(items));
});

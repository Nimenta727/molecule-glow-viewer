import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePluginManifest, ManifestError, CATEGORIES } from '../plugin-manifest.mjs';

const good = () => ({ format: 'glow-plugin', schemaVersion: 1, id: 'org.glow.plugin.demo', version: '1.0.0', name: '示例插件', summary: '一句话说明它做什么。', category: 'render',
  adds: ['增加一个功能'], usage: [{ title: '怎么用', how: "await glow.demo({ n: 3 })" }], provides: [{ type: 'command', name: 'demo' }, { type: 'module', path: 'a/b.mjs', exports: ['f'] }],
  dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }], status: { level: 'logic', summary: '只有单元测试。', limits: ['没有界面'] } });

test('a complete manifest is accepted, normalised and frozen', () => {
  const m = validatePluginManifest(good()); assert.equal(m.license, 'Apache-2.0'); assert.deepEqual(m.permissions, []); assert.ok(Object.isFrozen(m)); assert.equal(m.provides.length, 2); assert.ok(Object.keys(CATEGORIES).includes(m.category));
});
test('a plugin with no user entry is refused: modules and scripts are not entry points', () => {
  const m = good(); m.provides = [{ type: 'module', path: 'a.mjs' }, { type: 'cli', path: 'tools/x.mjs' }];
  assert.throws(() => validatePluginManifest(m), (e) => e instanceof ManifestError && /没有任何用户能直接用的入口/.test(e.message));
  for (const entry of [{ type: 'tool-preset', tool: 't', preset: 'p' }, { type: 'tool', id: 'org.glow.tool.x' }, { type: 'panel', id: 'p' }]) { m.provides = [entry]; assert.doesNotThrow(() => validatePluginManifest(m)); }
});
test('what is missing is named: usage, adds, the honest limits, the verification level, ids and versions', () => {
  const bad = (change, pattern) => { const m = good(); change(m); assert.throws(() => validatePluginManifest(m), pattern); };
  bad((m) => { m.usage = []; }, /usage 需要 1–8 项/); bad((m) => { m.adds = []; }, /adds 需要/); bad((m) => { m.status.limits = []; }, /status.limits 需要 1–10 项/); bad((m) => { m.status.level = 'perfect'; }, /status.level/);
  bad((m) => { m.id = 'Demo'; }, /id 应为小写点分名称/); bad((m) => { m.version = '1'; }, /version 应为 x\.y\.z/); bad((m) => { m.category = 'misc'; }, /category/); bad((m) => { m.provides = [{ type: 'magic' }]; }, /provides\[0\]\.type/);
  bad((m) => { m.permissions = ['root']; }, /permissions\[0\]/); bad((m) => { m.dependencies = [{ id: 'x' }]; }, /dependencies\[0\]/); bad((m) => { m.name = ''; }, /name 需要/); bad((m) => { m.format = 'x'; }, /glow-plugin/);
  assert.throws(() => validatePluginManifest(null), /应为对象/);
});

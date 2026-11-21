import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandApi, COMMANDS } from '../command-api.mjs';
import { createViewerCommands } from '../viewer-commands.mjs';
import { createColorState } from '../color-scheme.mjs';

// A fake host: records what the commands ask of the Viewer, so the argument handling of the classic-style commands can be tested without a browser.
function fake() {
  const calls = [], scene = { scene: { id: 's', assets: [], nodes: [], evidence: [] }, timeline: { playing: false, time: 0, duration: 1 }, name: 'x', warnings: [] };
  let colors = createColorState(), camera = { position: [0, 0, 2], target: [0, 0, 0] };
  const host = {
    current: () => scene, plugins: () => [], camera: () => camera, selection: () => null,
    setCamera: (value) => { calls.push(['setCamera', value]); camera = value; }, resetCamera: () => calls.push(['resetCamera']),
    tools: () => [{ id: 'org.glow.tool.demo', title: 'Demo', parameters: [] }],
    measure: (list) => { calls.push(['measure', list]); return list ? { kind: list.length === 2 ? 'distance' : 'angle', value: 3.5, points: list } : null; },
    chainIds: () => ['A', 'B'], colorState: () => colors, setColors: (state) => { colors = state; calls.push(['setColors', state]); },
    sequence: () => ({ visible: false, hidden: 0, chains: [{ label: 'A', chain: 'A', length: 3, sequence: 'MKV', gaps: [] }] }),
    showSequence: (flag) => calls.push(['showSequence', flag]), select: () => calls.push(['select']), selectSet: (expression) => { calls.push(['selectSet', expression]); return { residues: 2, summary: '2 个残基' }; },
    focusPoint: (expression) => { calls.push(['focusPoint', expression]); return { point: [1, 0, 0], radius: 0.5 }; },
    clip: (spec) => { calls.push(['clip', spec]); return { enabled: Boolean(spec.enabled), depth: spec.depth ?? 0, scope: 'all', direction: [0, 0, 1], wedgeParts: [] }; },
    animate: (value) => calls.push(['animate', value]),
  };
  const { api } = createCommandApi(createViewerCommands(host));
  return { api, calls };
}

test('help lists the new commands and the registered tools, and the limits that remain', async () => {
  const { api } = fake(), help = await api.help();
  for (const cmd of ['measure', 'sequence', 'color', 'clip', 'camera', 'animate']) assert.ok(help.commands.some((item) => item.cmd === cmd), cmd);
  assert.deepEqual(help.tools.map(({ id }) => id), ['org.glow.tool.demo']);
  assert.ok(help.limitations.some((text) => /残基范围上色/.test(text)));
  assert.ok(Object.keys(COMMANDS).every((cmd) => typeof api[cmd] === 'function'));
});
test('measure takes positional, array or object arguments and "clear"; the wrong count is refused', async () => {
  const { api, calls } = fake();
  assert.equal((await api.measure('chain A and resi 1', 'chain A and resi 9')).kind, 'distance');
  assert.equal((await api.measure({ a: 'x', b: 'y', c: 'z' })).kind, 'angle');
  assert.equal((await api.measure(['x', 'y'])).kind, 'distance');
  assert.deepEqual(await api.measure('clear'), { cleared: true });
  assert.deepEqual(calls.map(([name]) => name), ['measure', 'measure', 'measure', 'measure']);
  for (const bad of [['x'], 'x', ['a', 'b', 'c', 'd'], ['a', 5], { a: 'x' }, []]) await assert.rejects(api.measure(bad), /measure 需要/);
});
test('color: schemes, one chain, a colour for everything, reset; a residue range is refused with the reason', async () => {
  const { api, calls } = fake();
  assert.equal((await api.color('chain')).scheme, 'chain');
  assert.deepEqual((await api.color('chain B', 'red')).chains, { B: '#e05a4a' });
  assert.deepEqual((await api.color({ target: 'A', color: '#00f' })).chains.A, '#0000ff');
  assert.equal((await api.color('reset')).scheme, 'entity');
  assert.equal(calls.filter(([name]) => name === 'setColors').length, 4);
  await assert.rejects(api.color('chain A and resi 1-9', 'red'), /整条链/);
  await assert.rejects(api.color('chain Z', 'red'), /没有链 Z/);
  await assert.rejects(api.color('chartreuse'), /颜色/);
  await assert.rejects(api.color(), /color 需要/);
  assert.equal(calls.filter(([name]) => name === 'setColors').length, 4, 'a refused colour changes nothing');
});
test('camera: classic forms (orbit, az/el/dist, focus), strings, and the old position/target; bad values are refused', async () => {
  const { api, calls } = fake();
  const turned = await api.camera({ orbit: 90 }); assert.ok(Math.abs(Math.hypot(...turned.position) - 2) < 1e-9);
  await api.camera('orbit 45'); await api.camera({ az: 0, el: 20, dist: 3 });
  const focused = await api.camera('focus chain A'); assert.deepEqual(focused.target, [1, 0, 0]);
  assert.deepEqual(calls.find(([name]) => name === 'focusPoint'), ['focusPoint', 'chain A']);
  await api.camera({ focus: 'chain A', dist: 2 });
  await api.camera({ position: [0, 0, 5], target: [0, 0, 0] });
  await api.camera('reset'); await api.camera({ reset: true });
  assert.equal(calls.filter(([name]) => name === 'resetCamera').length, 2);
  for (const bad of [{ el: 120 }, { orbit: 'x' }, { focus: 5 }, 'sideways', {}, { spin: 1 }, { position: [0, 0, 1] }]) await assert.rejects(api.camera(bad), /镜头|范围|focus|应为/, JSON.stringify(bad));
});
test('sequence reads the chains, toggles the bar and selects through the selection language', async () => {
  const { api, calls } = fake();
  assert.deepEqual((await api.sequence()).chains[0], { label: 'A', chain: 'A', length: 3, sequence: 'MKV', gaps: [] });
  await api.sequence({ show: true }); assert.deepEqual(calls.at(-1), ['showSequence', true]);
  const selected = await api.sequence({ select: 'chain A and resi 1-2' }); assert.equal(selected.selected.residues, 2);
  for (const bad of [{ show: 'yes' }, { select: '' }, { sites: 1 }, 'x']) await assert.rejects(api.sequence(bad), /sequence|show|select|应为/);
});
test('clip validates its arguments and reports the state; animate accepts play and pause', async () => {
  const { api, calls } = fake();
  assert.equal((await api.clip({ enabled: true, depth: 0.25 })).depth, 0.25);
  await api.clip(); await api.clip({ aim: true, scope: 'parts' });
  for (const bad of [{ depth: 2 }, { enabled: 'on' }, { scope: 'half' }, { plane: 1 }, 'x']) await assert.rejects(api.clip(bad), /clip|depth|enabled|scope|超出|应为/);
  await api.animate('play'); await api.animate('pause');
  assert.deepEqual(calls.filter(([name]) => name === 'animate').map(([, v]) => v), [{ pause: false }, { pause: true }]);
});

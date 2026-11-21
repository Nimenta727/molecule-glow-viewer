import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCameraSpec, cameraAngles, cameraFromAngles, CameraSpecError } from '../camera-spec.mjs';
import { describeTools } from '../tool-help.mjs';

const close = (a, b, tol = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const camera = { position: [0, 0, 2], target: [0, 0, 0] };
test('angles round-trip and the distance is kept by an orbit', () => {
  const was = cameraAngles({ position: [1, 1, 2], target: [0.2, 0.1, 0] });
  const back = cameraFromAngles([0.2, 0.1, 0], was);
  assert.ok(close(back.position, [1, 1, 2]));
  const turned = applyCameraSpec(camera, { orbit: 90 });
  assert.ok(close(turned.position, [2, 0, 0], 1e-9) || close(turned.position, [-2, 0, 0], 1e-9));
  assert.ok(Math.abs(Math.hypot(...turned.position) - 2) < 1e-9 && close(turned.target, [0, 0, 0]));
  assert.ok(close(applyCameraSpec(camera, { orbit: 360 }).position, [0, 0, 2], 1e-9));
});
test('az / el / dist set the view; focus moves the target and keeps the direction', () => {
  const view = applyCameraSpec(camera, { az: 0, el: 30, dist: 4 });
  assert.ok(close(view.position, [0, 2, 4 * Math.cos(Math.PI / 6)], 1e-9));
  const focused = applyCameraSpec(camera, { focusPoint: [1, 0, 0], focusRadius: 0.5 });
  assert.ok(close(focused.target, [1, 0, 0])); assert.ok(close(focused.position, [1, 0, 1.6], 1e-9), 'same direction (+z), distance 3.2 x radius');
  const explicit = applyCameraSpec(camera, { focusPoint: [1, 0, 0], focusRadius: 0.5, dist: 5 });
  assert.ok(close(explicit.position, [1, 0, 5], 1e-9));
});
test('out-of-range and unknown camera parameters are refused, not clamped', () => {
  for (const bad of [{ el: 90 }, { el: -95 }, { dist: 0 }, { dist: 'far' }, { orbit: Infinity }, { spin: 1 }, { focusPoint: [1, 2] }]) assert.throws(() => applyCameraSpec(camera, bad), CameraSpecError);
  assert.throws(() => cameraAngles({ position: [1, 1, 1], target: [1, 1, 1] }), /重合/);
});
test('tool help lists registered tools as plain data from their descriptors', () => {
  const tools = [{ id: 'org.glow.tool.demo', title: 'Demo', version: '1.0.0', runtime: 'layer-v1', audience: ['view', 'author'], author: { fields() {}, validate() {} },
    parameters: { rate: { type: 'number', label: 'Rate', unit: 'Hz', min: 0, max: 3, step: 0.1, default: 1 }, mode: { type: 'select', label: 'Mode', options: [{ value: 'a', label: 'A' }], default: 'a' } },
    model: { kind: 'illustrative', assumptions: ['one'] } }];
  const [one] = describeTools(tools);
  assert.deepEqual(one.parameters.map(({ key }) => key), ['rate', 'mode']);
  assert.deepEqual(one.parameters[0], { key: 'rate', type: 'number', label: 'Rate', unit: 'Hz', min: 0, max: 3, step: 0.1, default: 1 });
  assert.deepEqual(one.parameters[1].options, ['a']); assert.equal(one.model.kind, 'illustrative');
  assert.doesNotThrow(() => JSON.stringify(one)); assert.ok(!('author' in one), 'no functions leak into the help');
});

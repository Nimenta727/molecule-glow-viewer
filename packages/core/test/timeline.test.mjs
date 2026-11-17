import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline } from '../timeline.mjs';

const transform = (x, rotation = [0, 0, 0, 1], scaleX = 1) => ({ position: [x, 0, 0], rotation, scale: [scaleX, 1, 1] });
const fixture = () => ({ duration: 4, tracks: [{ nodeId: 'n', keyframes: [
  { time: 1, transform: transform(2) },
  { time: 3, transform: transform(6, [0, 0, 1, 0], 3) },
] }] });

test('samples before, between, and after keyframes with linear position and scale', () => {
  const source = fixture();
  const timeline = createTimeline(source);
  assert.deepEqual(timeline.sample().get('n'), transform(2));
  timeline.seek(2);
  const mid = timeline.sample().get('n');
  assert.deepEqual(mid.position, [4, 0, 0]);
  assert.deepEqual(mid.scale, [2, 1, 1]);
  assert.ok(Math.abs(mid.rotation[2] - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(mid.rotation[3] - Math.SQRT1_2) < 1e-12);
  timeline.seek(4);
  assert.deepEqual(timeline.sample().get('n'), transform(6, [0, 0, 1, 0], 3));
  assert.deepEqual(source.tracks[0].keyframes[0].transform, transform(2));
});

test('returns fresh transform arrays and uses shortest quaternion path', () => {
  const timeline = createTimeline({ duration: 1, tracks: [{ nodeId: 'n', keyframes: [
    { time: 0, transform: transform(0, [0, 0, 0, 1]) },
    { time: 1, transform: transform(1, [0, 0, 0, -1]) },
  ] }] });
  timeline.seek(0.5);
  const first = timeline.sample().get('n');
  assert.deepEqual(first.rotation, [0, 0, 0, 1]);
  first.position[0] = 99;
  assert.equal(timeline.sample().get('n').position[0], 0.5);
});

test('advance and seek produce the same pose; playback stops at duration', () => {
  const stepped = createTimeline(fixture());
  const sought = createTimeline(fixture());
  stepped.play();
  stepped.advance(2);
  sought.seek(2);
  assert.deepEqual(stepped.sample().get('n'), sought.sample().get('n'));
  stepped.advance(20);
  assert.equal(stepped.time, 4);
  assert.equal(stepped.playing, false);
  stepped.play();
  assert.equal(stepped.playing, false);
  stepped.seek(1);
  stepped.play();
  assert.equal(stepped.playing, true);
});

test('clamps seeks, rejects nonfinite inputs, and handles empty timelines', () => {
  const timeline = createTimeline({ duration: 0, tracks: [] });
  timeline.seek(-5);
  assert.equal(timeline.time, 0);
  assert.deepEqual(timeline.sample(), new Map());
  assert.throws(() => timeline.seek(NaN), /finite/);
  assert.throws(() => timeline.advance(Infinity), /finite/);
  timeline.play();
  assert.equal(timeline.playing, false);
});

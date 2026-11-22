import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraAt, sortedCameraKeys } from '../camera-track.mjs';

const presentation = () => ({ notes: [], bookmarks: [{ id: 'a', name: 'A', position: [0, 0, 10], target: [0, 0, 0] }, { id: 'b', name: 'B', position: [10, 0, 0], target: [0, 2, 0] }],
  cameraKeys: [{ id: 'k2', time: 4, bookmarkId: 'b' }, { id: 'k1', time: 1, bookmarkId: 'a' }] });

test('the camera stays on the first key before it, on the last after it, and eases between', () => {
  const p = presentation();
  assert.deepEqual(sortedCameraKeys(p).map((k) => k.id), ['k1', 'k2']);
  assert.deepEqual(cameraAt(p, 0), { position: [0, 0, 10], target: [0, 0, 0] }); assert.deepEqual(cameraAt(p, 9), { position: [10, 0, 0], target: [0, 2, 0] });
  const half = cameraAt(p, 2.5); assert.deepEqual(half.position, [5, 0, 5], 'the middle of an ease-in-out is the middle'); assert.deepEqual(half.target, [0, 1, 0]);
  const early = cameraAt(p, 1.5).position[0]; assert.ok(early > 0 && early < 5 / 3, 'it starts slowly (ease-in)');
});

test('no keys, or keys of a missing bookmark, mean no camera movement; the data is not changed or shared', () => {
  assert.equal(cameraAt({ notes: [], bookmarks: [] }, 1), null); assert.equal(cameraAt(undefined, 1), null);
  assert.equal(cameraAt({ notes: [], bookmarks: [], cameraKeys: [{ id: 'k', time: 0, bookmarkId: 'gone' }] }, 1), null);
  const p = presentation(), first = cameraAt(p, 0); first.position[0] = 99; assert.equal(p.bookmarks[0].position[0], 0);
});

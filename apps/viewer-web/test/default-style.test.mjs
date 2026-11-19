import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultStyleFor } from '../default-style.mjs';

test('scenes with functional-domain rules open in the functional view, everything else as ink blobs', () => {
  assert.equal(defaultStyleFor({ legacy: { scene: { core: [{ name: 'CORE' }] } } }), 'functional');
  assert.equal(defaultStyleFor({ legacy: { scene: { core: [] } } }), 'blob');
  assert.equal(defaultStyleFor({ legacy: { scene: {} } }), 'blob');
  assert.equal(defaultStyleFor({ legacy: { scene: { id: '4AKE', states: ['4AKE', '1AKE'] } } }), 'functional', 'AdK open/closed pair');
  assert.equal(defaultStyleFor({ legacy: { scene: { id: '4AKE', states: ['4AKE', '1AKE'], components: [{}] } } }), 'blob');
  assert.equal(defaultStyleFor({ legacy: { scene: { process: 'kcsa' } } }), 'blob');
  assert.equal(defaultStyleFor({}), 'blob');
  assert.equal(defaultStyleFor(undefined), 'blob');
});

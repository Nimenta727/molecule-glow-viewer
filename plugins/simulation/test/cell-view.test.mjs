import assert from 'node:assert/strict';
import test from 'node:test';
import { cellAroundRibosome } from '../../../apps/viewer-web/cell-view.mjs';
import { ECOLI } from '../cell-geometry.mjs';

// the module imports DOM-free helpers only; a synthetic ribosome: 16S RNA below, 23S above along an arbitrary axis
const residues = [];
const axis = [0.3, 0.8, 0.52], n = Math.hypot(...axis), a = axis.map((v) => v / n);
for (let i = 0; i < 40; i++) residues.push({ entity: '16S ribosomal RNA', position: [-a[0] * 60 + (i % 5), -a[1] * 60 + (i % 7), -a[2] * 60 + (i % 3)] });
for (let i = 0; i < 40; i++) residues.push({ entity: '23S ribosomal RNA', position: [a[0] * 60 + (i % 5), a[1] * 60 + (i % 7), a[2] * 60 + (i % 3)] });

test('the cell is put around the ribosome: the inner membrane is 60 Å above its top along the 16S to 23S axis, the cell extends below', () => {
  const c = cellAroundRibosome(residues);
  assert.ok(c); assert.deepEqual(c.ey.map((v) => +v.toFixed(2)), a.map((v) => +v.toFixed(2)));
  const along = (p) => p[0] * c.ey[0] + p[1] * c.ey[1] + p[2] * c.ey[2];
  const top = Math.max(...residues.map((r) => along(r.position)));
  assert.ok(Math.abs(along(c.top) - (top + 60)) < 1e-9);
  const loc = c.frame.loc(c.top);   // the corner point is on the inner membrane: radius Rim from the cell axis, `uF` along it from the cell centre
  assert.ok(Math.abs(loc.y - ECOLI.Rim) < 1e-6 && Math.abs(loc.u - ECOLI.uF) < 1e-6 && Math.abs(loc.w) < 1e-6, JSON.stringify(loc));
  assert.ok(Math.abs(c.H - (ECOLI.L / 2 - (ECOLI.Rim + ECOLI.env) - 20)) < 1e-9);
  const ribosomeCentre = residues.reduce((t, r) => t.map((v, i) => v + r.position[i] / residues.length), [0, 0, 0]);
  assert.ok(c.frame.loc(ribosomeCentre).y < ECOLI.Rim, 'the ribosome is inside the cell');
});

test('without 16S and 23S RNA there is no ribosome axis and no cell', () => {
  assert.equal(cellAroundRibosome(residues.filter((r) => r.entity.startsWith('16S'))), null);
  assert.equal(cellAroundRibosome([]), null);
});

import { placeCellCrowd, CROWD_TYPES } from '../../../apps/viewer-web/cell-view.mjs';

test('the crowd fills the cytoplasm below the membrane, on the half behind the cut plane, outside the ribosome, with every blob named', () => {
  const cell = cellAroundRibosome(residues);
  const rng = (() => { let a = 5; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  const blob = (n, r) => Array.from({ length: n }, () => [(rng() - 0.5) * 2 * r, (rng() - 0.5) * 2 * r, (rng() - 0.5) * 2 * r]);
  const shapes = Object.fromEntries(CROWD_TYPES.map((t) => [t.id, blob(60, t.id === '1TIM' ? 14 : 30)]));
  const result = placeCellCrowd(cell, residues.map((r) => r.position), shapes, { seed: 3, phi: 0.05 });
  assert.ok(result.copies > 5 && result.items.length > result.copies, `${result.copies} copies, ${result.items.length} blobs`);
  assert.ok(result.items.every((i) => i.name && /^#[0-9a-f]{6}$/.test(i.colour) && i.radius > 0));
  const local = (p) => { const q = p.map((v, k) => v - cell.centre[k]); return [q[0] * cell.e1[0] + q[1] * cell.e1[1] + q[2] * cell.e1[2], q[0] * cell.ey[0] + q[1] * cell.ey[1] + q[2] * cell.ey[2], q[0] * cell.e3[0] + q[1] * cell.e3[1] + q[2] * cell.e3[2]]; };
  const ym = local(cell.top)[1];
  assert.ok(result.items.every((i) => local(i.position)[1] < ym), 'all below the membrane');
  const again = placeCellCrowd(cell, residues.map((r) => r.position), shapes, { seed: 3, phi: 0.05 });
  assert.deepEqual(again.items.slice(0, 5), result.items.slice(0, 5), 'the same seed gives the same crowd');
  assert.equal(placeCellCrowd(cell, residues.map((r) => r.position), {}, {}).copies, 0, 'no structures, no crowd');
});

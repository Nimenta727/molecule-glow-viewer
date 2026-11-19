import assert from 'node:assert/strict';
import test from 'node:test';
import { densitySurface } from '../density-surface.mjs';

test('Gaussian surfaces preserve translation and produce a finite closed residue volume', () => {
  const points = [[0, 0, 0], [3.8, 0, 0], [3.8, 3.8, 0], [0, 3.8, 0]];
  const surface = densitySurface(points, [1, 1, 1, 1]);
  const shift = [50, -20, 7];
  const translated = densitySurface(points.map((p) => p.map((value, i) => value + shift[i])), [1, 1, 1, 1]);
  assert.ok(surface.length > 0 && surface.length % 9 === 0);
  surface.forEach((value, i) => assert.ok(Math.abs(value + shift[i % 3] - translated[i]) < 1e-8));
  let volume = 0;
  for (let i = 0; i < surface.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = surface.slice(i, i + 9);
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  assert.ok(Math.abs(volume) > 100 && Math.abs(volume) < 1000);
});

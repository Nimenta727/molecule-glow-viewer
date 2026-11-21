import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeFrames, isSoftwareRenderer, budgetForTarget, tierOf, adaptBudget, benchmarkReport } from '../budget.mjs';

test('frame statistics: frames per second from the mean, a 95th percentile and the worst frame; nothing for no frames', () => {
  const s = summarizeFrames([16, 16, 16, 16, 100]); assert.equal(s.frames, 5); assert.ok(Math.abs(s.meanMs - 32.8) < 1e-9); assert.ok(Math.abs(s.fps - 1000 / 32.8) < 1e-9); assert.equal(s.worstMs, 100); assert.equal(s.p95Ms, 16);
  assert.equal(summarizeFrames([]), null); assert.equal(summarizeFrames([NaN, 0, -3]), null, 'values that are not durations are ignored');
});

test('software renderers are recognised by name', () => {
  for (const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver', 'Mesa Software Rasterizer']) assert.ok(isSoftwareRenderer(name), name);
  for (const name of ['NVIDIA GeForce RTX 4060/PCIe/SSE2', 'ANGLE (Apple, Apple M2, OpenGL 4.1)', 'Intel(R) Iris(R) Xe Graphics', '', null, undefined]) assert.ok(!isSoftwareRenderer(name), String(name));
});

test('the budget follows the measured rate, keeps a margin, and a light scene does not promise too much', () => {
  const slow = budgetForTarget({ triangles: 1_000_000, fps: 10, targetFps: 30 }); assert.equal(slow.budget, Math.round(1_000_000 * 10 / 30 * 0.7)); assert.match(slow.note, /低于目标 30/); assert.equal(slow.basis, 'measured');
  const fast = budgetForTarget({ triangles: 100_000, fps: 400, targetFps: 30 }); assert.equal(fast.budget, 400_000, 'capped at four times the measured load'); assert.equal(budgetForTarget({ triangles: 100_000, fps: 120, targetFps: 30 }).budget, 280_000, 'below the cap it follows the rate'); assert.match(fast.note, /最多放宽到当前负载的 4 倍/);
  const fits = budgetForTarget({ triangles: 1_000_000, fps: 33, targetFps: 30 }); assert.ok(fits.budget > 700_000 && fits.budget < 4_000_000); assert.match(fits.note, /预计能保持约 30 帧/);
  assert.equal(budgetForTarget({ triangles: 0, fps: 30 }).budget, null); assert.equal(budgetForTarget({ triangles: 5, fps: 30 }).budget, 20000, 'a floor');
});

test('tiers, and the adaptive controller: halves quickly when slow, grows slowly when there is room, stays inside its limits', () => {
  assert.deepEqual([100_000, 1_000_000, 10_000_000, null].map(tierOf), ['low', 'medium', 'high', 'unknown']);
  assert.equal(adaptBudget({ budget: 1_000_000, fps: 10 }), 700_000); assert.equal(adaptBudget({ budget: 1_000_000, fps: 30 }), 1_000_000); assert.equal(adaptBudget({ budget: 1_000_000, fps: 60 }), 1_080_000);
  assert.equal(adaptBudget({ budget: 25_000, fps: 1 }), 20_000, 'never below the minimum'); assert.equal(adaptBudget({ budget: 49_000_000, fps: 200 }), 50_000_000, 'never above the maximum'); assert.equal(adaptBudget({ budget: 5, fps: 0 }), 5);
  let b = 4_000_000; for (let i = 0; i < 12; i++) b = adaptBudget({ budget: b, fps: (2_000_000 / b) * 30 }); assert.ok(b > 1_500_000 && b < 2_600_000, `settles near the budget that holds the target (${b})`);
});

test('the report says plainly when the numbers come from a software renderer, and when frames are uneven', () => {
  const soft = benchmarkReport({ rendererName: 'SwiftShader', frames: [800, 900, 850], triangles: 1_000_000 }); assert.equal(soft.software, true); assert.equal(soft.tier, 'software'); assert.match(soft.advice[0], /软件渲染/);
  const real = benchmarkReport({ rendererName: 'NVIDIA GeForce RTX 4060', frames: Array(60).fill(8), triangles: 2_000_000 }); assert.equal(real.software, false); assert.ok(real.stats.fps > 100); assert.ok(['medium', 'high'].includes(real.tier));
  assert.ok(benchmarkReport({ rendererName: 'x', frames: [10, 10, 10, 10, 10, 10, 10, 10, 10, 90, 95, 99, 100, 120, 150, 10, 10, 10, 10, 10], triangles: 1e6 }).advice.some((t) => /忽快忽慢/.test(t)));
  const none = benchmarkReport({ rendererName: null, frames: [], triangles: 1e6 }); assert.equal(none.tier, 'unknown'); assert.match(none.advice.at(-1), /没有量到帧/);
});

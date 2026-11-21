/**
 * Hardware budget (docs/PLUGIN_ROADMAP.md, B4). A frame costs what the GPU takes to draw its triangles, so a scene that holds its frame rate on one machine can crawl on another. This module does the
 * arithmetic that turns a measurement made on the user's own machine into a triangle budget (the number the instancing code, B1, needs) and a plain recommendation. Pure; the viewport measures,
 * this decides. Nothing here knows what a particular GPU can do: the only trusted number is one measured on the machine in front of you, and a software renderer is named as such.
 */

/** Frame statistics from a list of frame durations in milliseconds: { frames, fps, meanMs, p95Ms, worstMs }. Null for no frames. */
export function summarizeFrames(times) {
  const t = times.filter((v) => Number.isFinite(v) && v > 0);
  if (!t.length) return null;
  const sorted = t.slice().sort((a, b) => a - b), mean = t.reduce((a, b) => a + b, 0) / t.length;
  return { frames: t.length, fps: 1000 / mean, meanMs: mean, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))], worstMs: sorted.at(-1) };
}

/** Whether a WebGL renderer string names a software rasteriser (SwiftShader, llvmpipe, Mesa software, Microsoft Basic Render), which says nothing about real GPUs. */
export const isSoftwareRenderer = (name) => /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(String(name ?? ''));

/**
 * The triangle budget that is expected to hold `targetFps`, from one measurement: `triangles` drawn per frame at `fps` measured. Frame time is taken as proportional to the triangles (the simplest
 * model, and optimistic when the cost is mostly something else, such as the page's own work); `headroom` (default 0.7) keeps a margin. A measurement that is already faster than the target
 * gives a budget above the measured load, but never more than `maxGrowth` times it (a light scene says little about a heavy one). Returns { budget, basis, note }.
 */
export function budgetForTarget({ triangles, fps, targetFps = 30, headroom = 0.7, maxGrowth = 4, minBudget = 20000 }) {
  if (!(triangles > 0) || !(fps > 0)) return { budget: null, basis: 'none', note: '没有可用的测量：场景是空的或没有量到帧率。' };
  const rate = triangles * fps, raw = (rate / targetFps) * headroom, cap = triangles * maxGrowth, budget = Math.max(minBudget, Math.round(Math.min(raw, cap)));
  const note = fps >= targetFps ? (raw > cap ? `现在的画面已经够快（${fps.toFixed(0)} 帧/秒）；预算最多放宽到当前负载的 ${maxGrowth} 倍，因为轻的场景说明不了重的。` : `按这次测量，${budget} 个三角形预计能保持约 ${targetFps} 帧/秒。`) : `现在只有 ${fps.toFixed(1)} 帧/秒，低于目标 ${targetFps}；把每帧三角形压到 ${budget} 以内才有望达到。`;
  return { budget, basis: 'measured', note };
}

/** A tier name for a budget (a label for the interface, not a promise): below 0.3 M low, below 3 M medium, otherwise high. */
export const tierOf = (budget) => (budget == null ? 'unknown' : budget < 300_000 ? 'low' : budget < 3_000_000 ? 'medium' : 'high');

/**
 * A running controller for an adaptive budget: given the last frame statistics it moves the budget towards what holds the target (halving quickly when frames are slow, growing slowly when there
 * is room), inside [min, max]. Pure: returns the next budget.
 */
export function adaptBudget({ budget, fps, targetFps = 30, min = 20000, max = 50_000_000, down = 0.7, up = 1.08 }) {
  if (!(fps > 0)) return budget;
  const next = fps < targetFps * 0.9 ? budget * down : fps > targetFps * 1.4 ? budget * up : budget;
  return Math.round(Math.min(max, Math.max(min, next)));
}

/** What to tell the author after a benchmark: { renderer, software, fps, ..., budget, tier, advice } where `advice` is a list of plain sentences. */
export function benchmarkReport({ rendererName, frames, triangles, targetFps = 30 }) {
  const stats = summarizeFrames(frames), software = isSoftwareRenderer(rendererName), advice = [];
  if (software) advice.push('这台机器在用软件渲染（没有用到显卡）：帧率只说明这台机器，不能推到有显卡的电脑上；要测显卡请在有硬件加速的浏览器或桌面版里再测一次。');
  if (!stats) return { renderer: rendererName ?? null, software, stats: null, budget: null, tier: 'unknown', advice: [...advice, '没有量到帧：页面可能在后台，保持窗口在前台再测。'] };
  const { budget, note } = budgetForTarget({ triangles, fps: stats.fps, targetFps });
  advice.push(note);
  if (stats.p95Ms > stats.meanMs * 2) advice.push('帧时间忽快忽慢（95% 分位是平均的两倍以上）：可能有别的程序占用，或在加载数据。');
  return { renderer: rendererName ?? null, software, stats, triangles, targetFps, budget, tier: software ? 'software' : tierOf(budget), advice };
}

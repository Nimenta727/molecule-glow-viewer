/**
 * Travel and events (classic: `travel`, `eventTag`, `protonAcross` in src/sim/motion-kit.js and the tiny animation runner src/sim/anim-runner.js). Pure state
 * machines, no promises and no page: a `Journey` moves one particle along one or more legs, a `Motion` ticks every journey of a scene (and drops them all when
 * the scene is cleared), an `EventLog` records what happened and keeps the short-lived named event tags.
 *
 * Timing is the classic one: a leg runs for `dur` seconds (at least 0.05), its position follows the curve, a leg that ends in a tick hands over to the next leg
 * without carrying the left-over time (the next leg's first step is the next tick). Two deliberate differences: the tumble is per second, not per frame (the
 * classic adds 0.03 / 0.02 rad every frame, which at 60 fps is 1.8 / 1.2 rad/s, so the two agree at 60 fps), and a journey's later legs are computed when the
 * leg starts, so with several journeys running at once the random numbers are drawn in tick order rather than microtask order (a single journey is identical).
 */
import { catmullRom, brownPath } from './particles.mjs';

/** The classic smoothstep (clamped). */
export const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Alpha during a leg at fraction u: the particle fades in from its starting alpha over the first `fadeIn` of the leg and out over the last `fadeOut`.
 * Neither given: undefined (alpha is left alone).
 */
export function legAlpha(u, a0, { fadeIn = 0, fadeOut = 0 }) {
  if (!fadeIn && !fadeOut) return undefined;
  return Math.min(fadeIn ? Math.min(1, a0 + (1 - a0) * u / fadeIn) : 1, fadeOut ? Math.min(1, (1 - u) / fadeOut) : 1);
}

/**
 * One particle (an item of a pool: { position, alpha, rotation, name, label? }) on one or more legs. A leg is { path | (item) => path, dur, ease, fadeIn,
 * fadeOut, tumble, onStart(item), onEnd(item) }; `path` is a list of [x, y, z] points (two or more). `onDone(item)` runs after the last leg.
 * `step(dt)` returns true when the journey is finished.
 */
export class Journey {
  constructor(item, legs, { onDone, remove = false } = {}) {
    if (!item || !Array.isArray(item.position)) throw new Error('行进需要一个带 position 的粒子');
    if (!item.name) throw new Error('行进的粒子必须有名字');
    if (!Array.isArray(legs) || !legs.length) throw new Error('行进至少需要一段');
    Object.assign(this, { item, legs, onDone, remove, index: -1, curve: null, t: 0, finished: false, cancelled: false });
    this.#start();
  }
  #start() {
    this.index++; this.t = 0;
    if (this.index >= this.legs.length) { this.finished = true; if (this.remove) this.item.gone = true; this.onDone?.(this.item); return; }
    const leg = this.legs[this.index]; leg.onStart?.(this.item);
    const path = typeof leg.path === 'function' ? leg.path(this.item) : leg.path;
    if (!Array.isArray(path) || path.length < 2) throw new Error(`行进第 ${this.index + 1} 段的路径至少要有两个点`);
    this.curve = catmullRom(path); this.dur = Math.max(0.05, leg.dur ?? 1); this.a0 = this.item.alpha ?? 1;
  }
  step(dt) {
    if (this.finished || this.cancelled) return true;
    const leg = this.legs[this.index], it = this.item; this.t += dt;
    const u = Math.min(1, this.t / this.dur);
    this.curve.point(leg.ease ? ease(u) : u, it.position);
    const a = legAlpha(u, this.a0, leg); if (a !== undefined) it.alpha = a;
    if (leg.tumble) { it.rotation ??= [0, 0, 0]; it.rotation[0] += dt * 1.8; it.rotation[1] += dt * 1.2; }
    if (u >= 1) { leg.onEnd?.(it); this.#start(); }
    return this.finished;
  }
  cancel() { this.cancelled = true; }
}

/** Ticks the journeys of a scene. `clear()` cancels them all (the scene was cleared): nothing is left running and nothing is called. */
export class Motion {
  constructor() { this.journeys = []; this.clock = 0; }
  /** Start a journey for `item` along `legs`; returns it. */
  go(item, legs, options) { const j = new Journey(item, legs, options); if (!j.finished) this.journeys.push(j); return j; }
  tick(dt) {
    this.clock += dt;
    for (let i = this.journeys.length - 1; i >= 0; i--) { const j = this.journeys[i]; if (j.step(dt)) this.journeys.splice(i, 1); }
  }
  get running() { return this.journeys.length; }
  clear() { const n = this.journeys.length; for (const j of this.journeys) j.cancel(); this.journeys = []; return n; }
}

/**
 * What happened when. `add(text, position, dur)` records a named chemical / physical event (markup is stripped, the log keeps the latest 500) and shows a tag
 * at the point for `dur` seconds (2.4 by default); `tick(dt)` ages the tags; `tags` are the ones still showing.
 */
export class EventLog {
  constructor(clock = () => 0, limit = 500) { Object.assign(this, { clock, limit, events: [], tags: [] }); }
  add(text, position, dur = 2.4) {
    const plain = String(text).replace(/<[^>]*>/g, '');
    this.events.push({ t: +this.clock().toFixed(3), text: plain }); if (this.events.length > this.limit) this.events.shift();
    const tag = { text: plain, position: position.slice(), dur, age: 0 }; this.tags.push(tag); return tag;
  }
  tick(dt) { for (let i = this.tags.length - 1; i >= 0; i--) { this.tags[i].age += dt; if (this.tags[i].age >= this.tags[i].dur) this.tags.splice(i, 1); } }
  list() { return this.events.slice(); }
  clear() { this.events = []; this.tags = []; }
}

/**
 * A proton (or any small ion) crossing a membrane (classic `protonAcross`): from the bulk of the entry side to the channel mouth by a Brownian path, through the
 * channel, out of the other mouth and into the bulk of the exit side. `from` / `to` are pools (`to` null: the particle just leaves), `channel` the points through
 * the protein (first = entry mouth, last = exit mouth). Options: pace() (speed-up factor, read once), count(), label (tag text while approaching), keepIn /
 * keepOut (project path points into a compartment), tIn 1.6 / tChan 1.0 / tOut 1.4 (seconds), plus `restLabel` (the tag text afterwards, default the name).
 * Returns the journey; the particle is already taken from `from`.
 */
export function membraneCrossing(motion, from, to, channel, options = {}, { rng, occupancy }) {
  if (!Array.isArray(channel) || channel.length < 2) throw new Error('通道至少需要两个点（入口和出口）');
  const k = options.pace ? options.pace() : 1, item = from.take(channel[0]), last = channel[channel.length - 1];
  options.count?.();
  const legs = [
    { path: (it) => brownPath(it.position, channel[0], { free1: 6, keep: options.keepIn }, { rng, occupancy }), dur: (options.tIn ?? 1.6) / k,
      onStart: (it) => { it.fade = (it.alpha ?? 1) < 1; }, get fadeIn() { return item.fade ? 0.3 : 0; }, onEnd: (it) => { if (options.label) it.label = options.label; } },
    { path: channel, dur: (options.tChan ?? 1.0) / k, ease: true, onEnd: (it) => { it.label = options.restLabel ?? it.name; } },
  ];
  if (to) {
    legs.push({
      path: () => {
        const dest = to.region.sample(false) || last.slice(), aim = dest.map((v, i) => v + (last[i] - v) * 0.45);
        return brownPath(last, aim, { free0: 6, free1: 0, keep: options.keepOut }, { rng, occupancy });
      },
      dur: (options.tOut ?? 1.4) / k,
    });
  }
  item.label ??= item.name;
  return motion.go(item, legs, { onDone: (it) => { if (to) to.give(it); }, remove: !to });
}

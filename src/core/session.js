//! Scene lifecycle (WP2, docs/PLATFORM_ENGINEERING_SPEC.md section 4): ResourceRegistry, SceneSession, LoadCoordinator.
//! Every loadScene() is one SceneSession. The session that is on screen is `loads.active`; a load in progress is
//! `loads.latest` (= active when nothing is loading). The old scene is disposed only when the new one has all its data
//! (LoadCoordinator.commit): a failed download leaves the old scene on screen.
/* =============================================================================
   SCENE SESSIONS: who owns what, and who releases it
   - ResourceRegistry: resources with a release function (timers, DOM listeners, Object3D, blob URLs, in-flight downloads,
     any disposer). disposeAll() releases them newest first; anything added after that is released at once (a stale
     coroutine cannot leak into a dead scene). counts() = what is alive, per kind (__viewer.probe().session).
   - SceneSession: one load. abort (its downloads), resources, the load's own state (cfg, seed, restore, errors, process,
     model) and assertLive() (throws Stale when a newer load started or the session was disposed).
   - LoadCoordinator (`loads`): begin -> commit (old scene disposed, new one built) -> finish, or fail (old scene stays).
     ?lowmem=1: low-memory mode, the old scene is disposed before the new one downloads (the behaviour before WP2).
   App-lifetime resources (the pocket-surface worker and its blob URL) are in `appResources`.
   ============================================================================= */
class ResourceRegistry {
  constructor(name) { this.name = name; this.items = new Map(); this.closed = false; this.released = 0; }
  /* res: the handle (also the key); release(res) frees it. Returns res. */
  add(kind, res, release) {
    if (this.closed) { try { release?.(res); } catch (e) { console.warn('release', kind, e); } this.released++; return res; }
    this.items.set(res, { kind, release }); return res;
  }
  /* free one resource now */
  release(res) { const e = this.items.get(res); if (!e) return false; this.items.delete(res); this.released++; try { e.release?.(res); } catch (x) { console.warn('release', e.kind, x); } return true; }
  /* the resource ended by itself (a timer fired, a download finished): stop tracking it */
  forget(res) { return this.items.delete(res); }
  disposeAll() {
    this.closed = true; const E = [...this.items.entries()].reverse(); this.items.clear();
    for (const [res, e] of E) { this.released++; try { e.release?.(res); } catch (x) { console.warn('release', e.kind, x); } }
  }
  counts() { const c = {}; for (const e of this.items.values()) c[e.kind] = (c[e.kind] || 0) + 1; return c; }
  get size() { return this.items.size; }
}
const appResources = new ResourceRegistry('app');

class SceneSession {
  constructor(id, cfg) {
    this.id = id; this.cfg = cfg; this.state = 'loading';   /* loading -> building -> active -> disposed (or failed) */
    this.abort = new AbortController(); this.resources = new ResourceRegistry('scene ' + id);
    this.disposed = false; this.committed = false; this.t0 = performance.now();
    /* the load's own state (was: loadSeq / netAC / loadScene.errors ... as loose globals) */
    this.seed = null; this.restore = null; this.errors = []; this.lastError = null; this.fatal = false; this.proc = null; this.model = null;
  }
  get signal() { return this.abort.signal; }
  get live() { return !this.disposed && loads.latest === this; }
  assertLive() { if (!this.live) throw new Stale(); }
  fail(msg) { this.errors.push(msg); this.lastError ??= msg; }
  /* scene-scoped resources: released with the scene */
  setTimeout(fn, ms = 0) { const h = setTimeout(() => { this.resources.forget(h); if (!this.disposed) fn(); }, ms); return this.resources.add('timer', h, clearTimeout); }
  setInterval(fn, ms) { const h = setInterval(() => { if (!this.disposed) fn(); }, ms); return this.resources.add('timer', h, clearInterval); }
  listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); return this.resources.add('listener', { target, type, fn, opts }, (t) => t.target.removeEventListener(t.type, t.fn, t.opts)); }
  objectURL(blob) { return this.resources.add('blobUrl', URL.createObjectURL(blob), (u) => URL.revokeObjectURL(u)); }
  object3d(obj, parent) { parent?.add(obj); return this.resources.add('object3d', obj, (o) => { o.parent?.remove(o); disposeObj(o); }); }
  onDispose(fn) { return this.resources.add('disposer', fn, (f) => f()); }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.state = this.committed ? 'disposed' : 'failed';
    this.abort.abort(); this.resources.disposeAll(); loads.disposed++;
  }
}

class LoadCoordinator {
  constructor() {
    this.seq = 0; this.created = 0; this.disposed = 0;
    this.lowMemory = new URLSearchParams(location.search).get('lowmem') === '1';
    this.active = this.make(null); this.active.state = 'active'; this.active.committed = true; this.active.onDispose(() => clearSceneContent());
    this.latest = this.active; this.last = this.active;   /* last = the most recent load attempt (its errors are what loadScene reports) */
  }
  make(cfg) { this.created++; return new SceneSession(this.seq, cfg); }
  get signal() { return this.latest.signal; }   /* RCSB / UniProt downloads belong to the newest load */
  get pending() { return this.latest !== this.active ? this.latest : null; }
  get alive() { return this.created - this.disposed; }
  /* a new load: a load still downloading is dropped; the downloads in flight are cancelled (as before), the scene on screen stays */
  begin(cfg) {
    this.seq++; loadSeq = this.seq;
    const prev = this.latest, s = this.make(cfg); this.latest = this.last = s;
    if (prev !== this.active) prev.dispose();
    else { prev.abort.abort(); prev.abort = new AbortController(); }
    return s;
  }
  /* everything the new scene needs has arrived: the old scene goes, the new one is built in its place */
  commit(s) {
    s.assertLive(); if (s.committed) return;
    const old = this.active; this.active = s; s.committed = true; s.state = 'building';
    s.onDispose(() => clearSceneContent());   /* first entry = released last: the scene's meshes, process, tags ... */
    old.dispose();
  }
  finish(s) { if (this.active === s && s.state === 'building') s.state = 'active'; }
  /* the load failed before commit: drop it, the old scene keeps running */
  fail(s) { if (this.latest === s) this.latest = this.active; s.dispose(); }
  /* clearScene(): an empty scene in place of the active one */
  clear() {
    const old = this.active, s = this.make(null); s.state = 'active'; s.committed = true; s.onDispose(() => clearSceneContent());
    this.active = s; if (this.latest === old) this.latest = s; old.dispose();
  }
  report() {
    const A = this.active;
    return { id: A.id, state: A.state, resources: A.resources.counts(), total: A.resources.size, pending: this.pending ? this.pending.id : null,
      alive: this.alive, created: this.created, lowMemory: this.lowMemory, app: appResources.counts() };
  }
}
const loads = new LoadCoordinator();

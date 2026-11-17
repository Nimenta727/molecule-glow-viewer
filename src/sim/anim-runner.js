/* ----------------------------------------------------------------------------- tiny animation runner */
let anims = [];
let eventLog = [];   /* every event label a process shows (__viewer.events(), glow info): what happened when */
/* anim(obj, dur, step(u, dt) -> true to finish early, next() called when done; obj removed if no next) */
let animPending = 0;   /* A11: anims whose continuation (a promise or a callback) has not run yet; must be 0 right after clearScene */
function anim(obj, dur, step, next, fail) {
  if (!next && !fail) { anims.push({ obj, t: 0, dur, step }); return; }
  let done = false; animPending++; const fin = () => { if (!done) { done = true; animPending--; } };
  anims.push({ obj, t: 0, dur, step, fin, next: next && ((...x) => { fin(); return next(...x); }), fail: (e) => { fin(); fail?.(e); } });
}
/* a waitable animation: rejected with Stale when the scene is cleared, so the coroutine awaiting it ends instead of hanging (L1) */
function animP(obj, dur, step) { return new Promise((res, rej) => anim(obj, dur, step, res, rej)); }
function rejectAnims() { const A = anims; anims = []; for (const a of A) try { a.fail?.(new Stale()); } catch (e) {} rejectAnims.left = animPending; }
addEventListener('unhandledrejection', (e) => { if (e.reason instanceof Stale) e.preventDefault(); });   /* coroutines end quietly on Stale */
function tickAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]; a.t += dt;
    const u = a.dur ? Math.min(1, a.t / a.dur) : a.t;
    const done = a.step(u, dt) === true || (a.dur && u >= 1);
    if (done) { anims.splice(i, 1); a.fin?.(); if (a.next) a.next(); else if (a.obj) a.obj.parent?.remove(a.obj); }
  }
}


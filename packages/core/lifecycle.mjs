/** A small owner for resources whose lifetime is bounded by one operation. */
export function createResourceScope() {
  let closed = false;
  const releases = [];

  function runReleases(items) {
    const errors = [];
    for (const release of items.reverse()) {
      try { release(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'One or more resource releases failed');
  }

  return {
    add(dispose) {
      if (typeof dispose !== 'function') throw new TypeError('Resource disposer must be a function');
      if (closed) dispose();
      else releases.push(dispose);
    },
    dispose() {
      if (closed) return;
      closed = true;
      runReleases(releases.splice(0));
    },
  };
}

/** Coordinates async preparation while keeping the last committed handle alive. */
export function createLoadCoordinator({ prepare, commit }) {
  if (typeof prepare !== 'function' || typeof commit !== 'function') {
    throw new TypeError('prepare and commit must be functions');
  }
  let active = null;
  let pending = null;

  function disposeQuietly(scope) {
    try { scope.dispose(); } catch { /* Cleanup is best effort; all registered releases were attempted. */ }
  }

  function cancel(entry) {
    if (!entry) return;
    entry.controller.abort();
    disposeQuietly(entry.scope);
  }

  return {
    async load(input) {
      const superseded = pending;
      const entry = { controller: new AbortController(), scope: createResourceScope() };
      pending = entry;
      cancel(superseded);
      if (pending !== entry) return false;
      try {
        const handle = await prepare(input, { signal: entry.controller.signal, scope: entry.scope });
        if (pending !== entry) {
          disposeQuietly(entry.scope);
          return false;
        }
        // Contract: commit must be synchronous and should perform its visible swap atomically.
        const result = commit(handle);
        if (result && typeof result.then === 'function') throw new TypeError('commit must be synchronous');
        const previous = active;
        active = entry.scope;
        pending = null;
        if (previous) disposeQuietly(previous);
        return true;
      } catch (error) {
        const current = pending === entry;
        if (current) pending = null;
        disposeQuietly(entry.scope);
        if (!current) return false;
        throw error;
      }
    },
    close() {
      const aborted = pending;
      const released = active;
      pending = null;
      active = null;
      cancel(aborted);
      if (released) disposeQuietly(released);
    },
  };
}

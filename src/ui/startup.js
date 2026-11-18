// Classic pre-entry startup cue shared by all app pages and the generated viewer.
(() => {
  const params = new URLSearchParams(location.search);
  const isDev = /(?:^|\/)dev\.html$/i.test(location.pathname) || params.has('dev') || params.has('embed');
  const shellEntry = document.currentScript?.hasAttribute('data-glow-startup');
  const desktop = Boolean(window.glowDesktop) || shellEntry;
  const skip = desktop && (window.glowDesktop?.startupSkip || params.get('startup') === 'skip');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!desktop || isDev || skip || reducedMotion || params.get('startup') === 'off' || document.getElementById('glow-startup')) return;

  const overlay = document.createElement('div');
  overlay.id = 'glow-startup';
  overlay.setAttribute('aria-hidden', 'true');
  const name = document.createElement('div');
  name.className = 'glow-startup-name';
  name.textContent = document.title || 'Molecule Glow';
  overlay.append(name);
  document.body.append(overlay);

  let finished = false;
  let safety;
  const hide = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safety);
    overlay.remove();
  };
  window.__glowStartup = { hide, overlay, duration: 700 };
  window.addEventListener('error', hide, { once: true });
  window.addEventListener('unhandledrejection', hide, { once: true });
  safety = setTimeout(hide, 2200);
  // A brief name reveal and fade, independent of renderer/data initialization.
  requestAnimationFrame(() => {
    overlay.classList.add('is-entering');
    requestAnimationFrame(() => setTimeout(() => overlay.classList.add('is-leaving'), 300));
  });
  setTimeout(hide, 700);
})();

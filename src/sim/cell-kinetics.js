/* =============================================================================
   CELL SIMULATION: compartments, concentrations and coupled fluxes
   A process may define `cell: { init(), step(st, h, ctrl) -> flux, controls, series, comps, dots, explain }`.
   The kinetic model runs in real time (seconds); it drives the 3D: `flux.rate` paces the electron-transfer animation
   (0 = stops, e.g. light off), `flux.rotor` scales the ATP-synthase rotor; pH-coloured backdrops behind the two
   compartments, free H+ / ATP / NADPH dots whose numbers follow the concentrations, and a live panel of curves.
   ============================================================================= */
let cellSim = null;
const PH_STOPS = [[5.0, '#e8503a'], [5.8, '#ff8a3d'], [6.5, '#f5c84a'], [7.0, '#c9d96a'], [7.5, '#86cfa0'], [8.0, '#6fb1f0'], [8.6, '#5a7fe0']];
function phColour(pH) {
  const S = PH_STOPS; if (pH <= S[0][0]) return new THREE.Color(S[0][1]);
  for (let i = 1; i < S.length; i++) if (pH <= S[i][0]) { const u = (pH - S[i - 1][0]) / (S[i][0] - S[i - 1][0]); return new THREE.Color(S[i - 1][1]).lerp(new THREE.Color(S[i][1]), u); }
  return new THREE.Color(S[S.length - 1][1]);
}
function startCellSim(def, saved = null) {
  stopCellSim();
  const sim = { def, st: def.init(), ctrl: { ...Object.fromEntries(def.controls.filter(c => c.id).map(c => [c.id, c.type === 'range' || c.type === 'select' ? c.value : c.on])), ...(saved || {}) }, hist: def.series.map(() => []), t: 0, tH: 0, flux: { rate: 1, rotor: 1 }, objs: [], dots: [], labs: [] };
  if (!def.noWarmup) for (let i = 0; i < 40; i++) sim.flux = def.step(sim.st, 0.05, sim.ctrl) || sim.flux;   // short warm-up (dark / resting start)
  cellSim = sim;
  /* HUD */
  const hud = $('cellHud'); hud.style.display = 'block'; hud.classList.toggle('wide', !!def.wide);
  $('cellHd').firstChild.textContent = (def.title || '细胞区室 · 实时模拟') + ' ';
  $('cellRows').innerHTML = def.series.map((se, i) => `<div class="r"><span>${se.label}</span><b id="cv${i}"></b><canvas id="cs${i}" width="240" height="40"></canvas></div>`).join('');
  $('cellCtl').innerHTML = '';
  /* controls: on/off buttons (default), {type:'range', min, max, step, value, unit}, {type:'select', options:[[v, label]]},
     {type:'button', run(sim)} (an action), {type:'section', label} (a heading) */
  for (const c of def.controls) {
    if (c.type === 'section') { const d = document.createElement('div'); d.className = 'sec'; d.textContent = c.label; $('cellCtl').appendChild(d); continue; }   /* folding: wired up after all controls exist */
    if (c.type === 'range') {
      const row = document.createElement('label'); row.className = 'rng'; row.title = c.tip || '';
      row.innerHTML = `<span></span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${sim.ctrl[c.id] ?? c.value}"><output></output>`;
      row.querySelector('span').textContent = c.label; const inp = row.querySelector('input'), out = row.querySelector('output');
      const show = () => { out.textContent = (+inp.value).toFixed(c.step < 1 ? (c.step < 0.1 ? 2 : 1) : 0) + (c.unit ? ' ' + c.unit : ''); };
      inp.oninput = () => { sim.ctrl[c.id] = +inp.value; show(); }; show(); $('cellCtl').appendChild(row); continue;
    }
    if (c.type === 'select') {
      const s = document.createElement('select'); s.title = c.tip || ''; for (const [v, l] of c.options) { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); }
      s.value = sim.ctrl[c.id] ?? c.value; s.onchange = () => { sim.ctrl[c.id] = s.value; c.change?.(sim, s.value); }; $('cellCtl').appendChild(s); continue;
    }
    if (c.type === 'text') {
      const s = document.createElement('input'); s.type = 'text'; s.placeholder = c.placeholder || ''; s.title = c.tip || ''; s.value = c.value || '';
      s.style.cssText = 'width:100%;font:inherit;font-size:11px;padding:2px 6px;border-radius:8px';
      s.onkeydown = (e) => { if (e.key === 'Enter') c.apply?.(sim, s.value.trim()); e.stopPropagation(); }; $('cellCtl').appendChild(s); continue;
    }
    const b = document.createElement('button'); b.textContent = c.label; b.title = c.tip || '';
    if (c.type === 'button') { b.className = 'act'; b.onclick = () => c.run(sim, b); }
    else { b.classList.toggle('on', !!sim.ctrl[c.id]); b.onclick = () => { sim.ctrl[c.id] = !sim.ctrl[c.id]; b.classList.toggle('on', sim.ctrl[c.id]); }; }
    $('cellCtl').appendChild(b);
  }
  $('cellHd').onclick = () => hud.classList.toggle('min');
  { const kids = [...$('cellCtl').children], secs = kids.filter(x => x.classList.contains('sec')), long = kids.length > 12;
    const setShut = (sec, shut) => { sec.classList.toggle('shut', shut); for (let n = sec.nextElementSibling; n && !n.classList.contains('sec'); n = n.nextElementSibling) n.classList.toggle('hid', shut); };
    secs.forEach((sec, i) => { setShut(sec, long && i > 0); sec.onclick = () => setShut(sec, !sec.classList.contains('shut')); }); }
  { const n = $('cellNote'); n.classList.add('shut'); let t = $('cellNoteT'); if (!t) { t = document.createElement('div'); t.id = 'cellNoteT'; t.className = 'noteT'; n.after(t); }
    t.textContent = '讲解 ▸ 展开'; t.onclick = () => { const sh = n.classList.toggle('shut'); t.textContent = sh ? '讲解 ▸ 展开' : '讲解 ▾ 收起'; }; }
  buildCellVisuals(sim);
}
function stopCellSim() {
  if (!cellSim) return;
  for (const o of cellSim.objs) { o.parent?.remove(o); disposeObj(o); }
  cellSim.labs.forEach(l => l.remove());
  cellSim = null; $('cellHud').style.display = 'none';
}
/* compartments: the strip of membrane the machines sit in; top = +y side, bottom = -y side */
function cellBoxes() {
  const A = model.allAtoms, ym = proc?.ctx?.membraneY?.[0] ?? 0, d = model.rowDir || new THREE.Vector3(1, 0, 0), n = new THREE.Vector3(-d.z, 0, d.x), c = model.focus.centre.clone().setY(0);
  let ulo = 1e9, uhi = -1e9, vlo = 1e9, vhi = -1e9, ylo = 1e9, yhi = -1e9;
  for (let i = 0; i < A.length; i += 3) { const p = A[i].p, q = new THREE.Vector3(p.x - c.x, 0, p.z - c.z), u = q.dot(d), v = q.dot(n);
    ulo = Math.min(ulo, u); uhi = Math.max(uhi, u); vlo = Math.min(vlo, v); vhi = Math.max(vhi, v); ylo = Math.min(ylo, p.y); yhi = Math.max(yhi, p.y); }
  return { ym, d, n, c, ulo: ulo - 20, uhi: uhi + 20, vlo: vlo - 10, vhi: vhi + 10, top: [ym + 24, Math.max(ym + 130, yhi + 15)], bot: [Math.min(ym - 130, ylo - 10), ym - 24] };
}
function buildCellVisuals(sim) {
  const B = sim.box = cellBoxes(), def = sim.def;
  /* pH: each compartment is a VOLUME of solution (a ray-marched box that fills the compartment in 3D, soft at its open
     ends, denser the more acidic), not a flat backdrop; it looks the same from every side */
  sim.panels = !def.comps ? [] : ['top', 'bot'].map((k) => {
    const [y0, y1] = B[k], su = B.uhi - B.ulo, sv = B.vhi - B.vlo, sy = y1 - y0;
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide,
      uniforms: { uCol: { value: new THREE.Color() }, uA: { value: 0.2 }, uTop: { value: k === 'top' ? 1 : 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: new THREE.Vector3(su, sy, sv) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uCol, uCam, uScale; uniform float uA, uTop; varying vec3 vP;
        void main(){
          vec3 ro = uCam, rd = normalize(vP - uCam), iv = 1.0 / rd;
          vec3 t0 = (-0.5 - ro) * iv, t1 = (0.5 - ro) * iv, tn3 = min(t0, t1), tf3 = max(t0, t1);
          float tn = max(max(max(tn3.x, tn3.y), tn3.z), 0.0), tf = min(min(tf3.x, tf3.y), tf3.z);
          if (tf <= tn) discard;
          float acc = 0.0;
          for (int i = 0; i < 24; i++) { vec3 p = ro + rd * mix(tn, tf, (float(i) + 0.5) / 24.0);
            float side = smoothstep(0.5, 0.38, abs(p.x)) * smoothstep(0.5, 0.38, abs(p.z));
            float h = uTop > 0.5 ? p.y + 0.5 : 0.5 - p.y;            /* 0 at the membrane, 1 at the far face */
            acc += side * smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.6, 1.0, h)); }
          float L = length((tf - tn) * rd * uScale);
          gl_FragColor = vec4(uCol, 1.0 - exp(-uA * acc / 24.0 * L / 90.0)); }` });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); m.renderOrder = -5; m.scale.set(su, sy, sv);
    m.position.set(B.c.x, (y0 + y1) / 2, B.c.z).addScaledVector(B.d, (B.ulo + B.uhi) / 2).addScaledVector(B.n, (B.vlo + B.vhi) / 2);
    m.rotation.set(0, Math.atan2(-B.d.z, B.d.x), 0); m.userData = { y: (y0 + y1) / 2, k }; world.add(m); sim.objs.push(m);
    const lab = document.createElement('div'); lab.className = 'compLab'; document.body.appendChild(lab); sim.labs.push(lab);
    return m;
  });
  /* free molecules: a pool of labelled particles per species and compartment (the processes take from / give to them);
     the target count follows the concentration */
  sim.regions = { top: boxRegion(B, B.top[0], B.top[1]), bot: boxRegion(B, B.bot[0], B.bot[1]) };
  sim.dots = (def.dots || []).map((sp) => ({ sp, pool: scenePool(sp.label + '@' + sp.comp, { label: sp.label, col: sp.color, r: sp.r || 2.2, region: sim.regions[sp.comp], maxTags: 2 }) }));
  /* dot legend under the switches */
  const seen = new Set();
  $('cellKey').innerHTML = (def.key || def.dots || []).filter(sp => sp.label && !seen.has(sp.label) && seen.add(sp.label))
    .map(sp => `<span><i style="background:#${new THREE.Color(sp.ink || sp.color).getHexString()}"></i>${sp.label}</span>`).join('');
}
/* illustrative: flat colour (the ink pass draws the outline); video style: glowing */
function dotMaterial(sp) {
  return illustrative() ? new THREE.MeshBasicMaterial({ color: sp.ink || sp.color })
    : new THREE.MeshStandardMaterial({ color: sp.color, emissive: sp.color, emissiveIntensity: 0.6, roughness: 0.45 });
}
const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cs = new THREE.Vector3(), _cv = new THREE.Vector3();
function updateCellSim(dt) {
  const sim = cellSim; if (!sim) return;
  const def = sim.def, n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
  for (let i = 0; i < n; i++) sim.flux = def.step(sim.st, h, sim.ctrl);
  sim.t += dt; sim.tH += dt;
  const vals = def.series.map(se => se.get(sim.st, sim.flux));
  if (sim.tH > 0.25) { sim.tH = 0; vals.forEach((v, i) => { sim.hist[i].push(v); if (sim.hist[i].length > 240) sim.hist[i].shift(); }); drawCellHud(sim, vals); }
  /* pH volumes: colour = pH, density grows with [H+] (log scale); the camera position in each box's own unit frame */
  const B = sim.box, comps = def.comps ? def.comps(sim.st, sim.flux) : [];
  const farOut = proc?.level && proc.level !== 'machine';   /* whole cell zoomed out: the corner's compartment volumes / labels are meaningless */
  sim.panels.forEach((m, i) => {
    m.visible = !farOut; const cp = comps[i], U = m.material.uniforms; U.uCol.value.copy(phColour(cp.pH));
    U.uA.value = (illustrative() ? 0.55 : 0.4) * THREE.MathUtils.clamp(0.55 + 0.22 * (7.6 - cp.pH), 0.35, 1.3);
    m.updateMatrixWorld(); U.uCam.value.copy(camera.position).applyMatrix4(_cm.copy(m.matrixWorld).invert());
    /* label at the box's left-most visible upright edge, half way up */
    const lab = sim.labs[i]; let best = null;
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) { const q = V3n(a, 0, b).applyMatrix4(m.matrixWorld).project(camera); if (q.z < 1 && (!best || q.x < best.x)) best = q; }
    _cv.copy(best || V3n(0, 0, 2));
    const pr = $('panel').getBoundingClientRect(), minX = pr.right > 0 && pr.width > 0 && getComputedStyle($('panel')).display !== 'none' ? pr.right + 10 : 8;
    lab.style.display = _cv.z < 1 && !farOut ? '' : 'none'; lab.style.left = Math.max(minX, (_cv.x * 0.5 + 0.5) * innerWidth) + 'px'; lab.style.top = ((-_cv.y * 0.5 + 0.5) * innerHeight) + 'px';
    lab.innerHTML = `${cp.name} <span style="color:#${phColour(cp.pH).getHexString()}">pH ${cp.pH.toFixed(2)}</span>`;
  });
  /* free molecules: the pools' target counts follow the concentrations (the pools move themselves, see updatePools) */
  for (const D of sim.dots) { D.pool.n = Math.max(0, Math.min(D.sp.max || 60, D.sp.count(sim.st, sim.flux)));
    if (!D.filled) { D.filled = true; D.pool.fill(); } }
}
function drawCellHud(sim, vals) {
  const light = illustrative();
  sim.def.series.forEach((se, i) => {
    const el = $('cv' + i); if (!el) return; el.textContent = se.fmt(vals[i]);
    const cv = $('cs' + i), g = cv.getContext('2d'), H = sim.hist[i], W = cv.width, Hh = cv.height; g.clearRect(0, 0, W, Hh);
    g.strokeStyle = light ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.1)'; g.beginPath(); g.moveTo(0, Hh - 1); g.lineTo(W, Hh - 1); g.stroke();
    if (H.length < 2) return; const [lo, hi] = se.range;
    g.strokeStyle = se.color; g.lineWidth = 2.4; g.beginPath();
    H.forEach((v, k) => { const x = W - (H.length - 1 - k) * (W / 239), y = Hh - 3 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * (Hh - 6); k ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  });
  $('cellNote').textContent = sim.def.explain(sim.st, sim.flux, sim.ctrl);
  $('cellT').textContent = sim.def.timeLabel ? sim.def.timeLabel(sim) : Math.floor(sim.t) + ' s';
}


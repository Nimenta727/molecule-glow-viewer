import { kcsaToolDescriptor, KCSA_TOOL, kcsaSourceId, kcsaChannelTest } from './tool.mjs';
import { nodesOfSource, boundOrMatched } from '../shared/bindings.mjs';
import { DEFAULTS, PARAMETERS, validateParameters, createKinetics, singleChannelCurrent, reversalPotential, conducting } from './kinetics.mjs';
import { buildKcsaStructure } from './structure.mjs';
import { lerp, sub, dot, cross, normalize } from '../motion/vectors.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM as SCALE } from '../structure/representation.mjs';
import { walkPath } from '../motion/path.mjs';
import { KCSA_1K4C_TEMPLATE, normalizeKcsaConfig, numeral } from './config.mjs';
export const KCSA_PLAYER = 'org.glow.legacy-process.kcsa';
export const kcsaPlugin = {
  manifest: { id: KCSA_PLAYER, version: '1.0.0', apiVersion: 1,
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }], capabilities: ['players', 'panels', 'tools'] },
  activate(context) {
    const instances = new Set();
    context.lifecycle.add(() => { for (const instance of instances) instance.dispose(); instances.clear(); });
    context.registerPlayer(KCSA_PLAYER, {
      async prepare(input) {
        context.signal.throwIfAborted();
        await prepareKcsa({ ...input, signal: AbortSignal.any([context.signal, input.signal]) });
        return { states: input.loaded.kcsaModels };
      },
      create(input) {
        if (context.signal.aborted) throw new Error('KcsA 插件已停用。');
        const player = createKcsaPlayer(input), dispose = player.dispose;
        player.dispose = () => { dispose(); instances.delete(player); };
        instances.add(player); return player;
      },
    });
    context.registerTool(KCSA_TOOL, kcsaToolDescriptor(this.manifest.version, KCSA_PLAYER));
    const { panel } = KCSA_1K4C_TEMPLATE;
    context.registerPanel(KCSA_PLAYER, {
      title: panel.title, parametersTitle: panel.parametersTitle, speed: { label: panel.speedLabel, min: 0.05, max: 3, step: 0.05 },
      seed: { label: panel.seedLabel, min: 0, max: 4294967295, step: 1 }, parameters: PARAMETERS,
      evidence: panel.evidence,
    });
  },
};

/** `config` is the work configuration (see config.mjs); omitted = the built-in KcsA/1K4C template. */
export async function prepareKcsa({ loaded, parse, loadAccession, signal, config }) {
  const cfg = normalizeKcsaConfig(config), stateIds = [cfg.states.primary, cfg.states.open, cfg.states.inactivated, cfg.states.tba, cfg.states.barium];
  if (loaded.kcsaModels) return;
  const states = new Map(), additions = [];
  const primary = loaded.scene.assets.find((asset) => asset.provenance?.parserVersion);
  if (!primary || loaded.scene.legacy?.scene?.id !== cfg.states.primary) throw new Error(`KcsA 播放器需要 ${cfg.states.primary} 主结构。`);
  for (const id of stateIds) {
    signal.throwIfAborted();
    const stored = id === cfg.states.primary ? primary : loaded.scene.assets.find((asset) => asset.provenance?.mechanismState?.player === KCSA_PLAYER && asset.provenance.mechanismState.accession === id);
    const input = stored ? { bytes: loaded.resources.get(stored.path), name: stored.path, mediaType: stored.mediaType }
      : await loadAccession(id, signal);
    const model = parse(input, { assemblyId: '1' });
    states.set(id, model);
    if (!stored) {
      const hash = await crypto.subtle.digest('SHA-256', input.bytes);
      additions.push({ asset: { id: `kcsa-state-${id}`, kind: 'file', path: `assets/kcsa/${id}.cif`, mediaType: 'chemical/x-mmcif',
        sha256: [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join(''),
        provenance: { source: input.source, assemblyId: '1', mechanismState: { player: KCSA_PLAYER, accession: id } } }, bytes: input.bytes });
    }
  }
  signal.throwIfAborted();
  // Commit coordinate resources only after every required state is available.
  if (additions.some(({ asset }) => loaded.scene.assets.some((old) => old.id === asset.id || old.path === asset.path))) throw new Error('KcsA 构象资源 ID 或路径与现有资源冲突。');
  for (const { asset, bytes } of additions) { loaded.scene.assets.push(asset); loaded.resources.set(asset.path, bytes); }
  loaded.kcsaModels = states;
}
/** `config` must be the same configuration that was given to prepareKcsa. */
export function createKcsaPlayer({ model, scene, state = {}, states, config, bindings }) {
  const cfg = normalizeKcsaConfig(config);
  const structure = buildKcsaStructure(model, states, cfg);
  const sourceId = scene.assets.find((asset) => asset.provenance?.parserVersion)?.id;
  const nodes = boundOrMatched(nodesOfSource(scene, sourceId), bindings, 'channel', kcsaChannelTest(cfg));   // the saved binding, else the configured chain name
  if (nodes.length !== cfg.protein.chains) throw new Error(`KcsA 预览需要${numeral(cfg.protein.chains)}个通道链节点。`);
  const steps = cfg.steps.map(({ title, caption }) => ({ title, caption, nodeIds: nodes.map(({ id }) => id) }));
  const base = { nodeId: nodes[0].parentId ?? nodes[0].id, bookmarkId: null, labelIds: [] };
  const prefix = cfg.navigation.idPrefix;
  const navigation = { version: 1, entryId: `${prefix}-system`, views: [
    { ...base, id: `${prefix}-system`, mode: 'system', title: cfg.navigation.systemTitle, parentIds: [] },
    { ...base, id: `${prefix}-protein`, mode: 'protein', title: cfg.navigation.proteinTitle, parentIds: [`${prefix}-system`] },
    { ...base, id: `${prefix}-mechanism`, mode: 'mechanism', title: cfg.navigation.mechanismTitle, parentIds: [`${prefix}-system`, `${prefix}-protein`],
      steps: steps.map(({ title, nodeIds }, i) => ({ id: `${prefix}-step-${i}`, title, nodeIds })) },
  ] };
  const seed = Number.isSafeInteger(state.seed) && state.seed >= 0 && state.seed <= 4294967295 ? state.seed : 1;
  const start = { ...DEFAULTS, ...cfg.conditions };   // initial experimental conditions of this work
  const initial = { ...start, speed: 1, time: 0 };
  function validateEntry(entry) {
    const { time, speed, ...parameters } = entry;
    validateParameters(parameters);
    if (!Number.isFinite(time) || time < 0 || time > 120 || !Number.isFinite(speed) || speed < 0.05 || speed > 3) throw new Error('KcsA 播放记录无效。');
    return { ...start, ...parameters, time, speed };
  }
  let schedule = [initial];
  if (state.schedule != null) {
    if (!Array.isArray(state.schedule) || !state.schedule.length || state.schedule.length > 1000) throw new Error('KcsA 播放记录超出范围。');
    schedule = state.schedule.map(validateEntry);
    if (schedule[0].time !== 0 || schedule.some((entry, i) => i && entry.time <= schedule[i - 1].time)) throw new Error('KcsA 播放记录时间顺序无效。');
  }
  let time = Number.isFinite(state.time) ? Math.max(0, Math.min(120, state.time)) : 0, playing = false, disposed = false;
  let playbackRate = [0.25, 1, 2, 5].includes(state.playbackRate) ? state.playbackRate : 1;
  let kinetics = createKinetics(seed, schedule);
  const ensureLive = () => { if (disposed) throw new Error('KcsA 播放器已释放。'); };
  const positions = { ...structure.sites, inside: structure.paths.inside[0], outside: structure.paths.outside.at(-1) };
  const occupancy = { A: ['S1', 'S3'], B: ['S1', 'S3', 'cav'], C: ['S0', 'S2', 'S4'], D: ['S2', 'S4'], X: ['S1', 'S4'] };
  const transitions = {
    AB: [['S1', 'S1'], ['S3', 'S3'], ['inside', 'cav']], BA: [['S1', 'S1'], ['S3', 'S3'], ['cav', 'inside']],
    BC: [['S1', 'S0'], ['S3', 'S2'], ['cav', 'S4']], CB: [['S0', 'S1'], ['S2', 'S3'], ['S4', 'cav']],
    CD: [['S2', 'S2'], ['S4', 'S4'], ['S0', 'outside']], DC: [['S2', 'S2'], ['S4', 'S4'], ['outside', 'S0']],
    DA: [['S2', 'S1'], ['S4', 'S3']], AD: [['S1', 'S2'], ['S3', 'S4']],
  };
  const walk = walkPath;
  function snapshot() {
    if (disposed) throw new Error('KcsA 播放器已释放。');
    const s = kinetics.at(time), f = Math.min(1, Math.max(0, (time - s.permTime) / 0.2));
    let moves = conducting(s) && f < 1 && transitions[s.lastPermId];
    moves ||= occupancy[s.perm].map((site) => [site, site]);
    const particles = [0, 1, 2].map((i) => {
      const move = moves[i]; let position = positions.S1;
      if (move) {
        const [a, b] = move;
        position = a === 'inside' && b === 'cav' ? walk(structure.paths.inside, f)
          : a === 'cav' && b === 'inside' ? walk(structure.paths.inside, 1 - f)
            : a === 'S0' && b === 'outside' ? walk(structure.paths.outside, f)
              : a === 'outside' && b === 'S0' ? walk(structure.paths.outside, 1 - f) : lerp(positions[a], positions[b], f);
      }
      return { name: cfg.particles.potassium.name, color: cfg.particles.potassium.color, position: structure.point(position), visible: Boolean(move) };
    });
    const nf = Math.min(1, Math.max(0, (time - s.naTime) / 0.4));
    particles.push({ name: cfg.particles.sodium.name, color: cfg.particles.sodium.color, position: structure.point(walk(structure.paths.inside, nf < 0.5 ? nf * 2 : 2 - nf * 2)), visible: s.naTime >= 0 && nf < 1 });
    particles.push({ name: cfg.blockers.tba.name, color: cfg.blockers.tba.color, ...structure.blockers.TBA, visible: s.tba });
    particles.push({ name: cfg.blockers.barium.name, color: cfg.blockers.barium.color, ...structure.blockers.Ba, visible: s.ba });
    const pA = singleChannelCurrent(s.parameters), ek = reversalPotential(s.parameters);
    return { time, seed, speed: s.parameters.speed, playbackRate, playing, stage: s.stage,
      parameters: Object.fromEntries(Object.keys(PARAMETERS).map((key) => [key, s.parameters[key]])),
      counters: { [cfg.counterLabels.out]: s.out, [cfg.counterLabels.in]: s.inn, [cfg.counterLabels.sodium]: s.na },
      metrics: `门${s.gate === 'C' ? '关闭' : s.gate === 'I' ? '失活' : '开放'}${s.tba ? ` · ${cfg.blockers.tba.name} 阻断` : ''}${s.ba ? ` · ${cfg.blockers.barium.name} 阻断` : ''} · 瞬时导电电流 ${(conducting(s) ? pA : 0).toFixed(2)} pA · 开放未阻断模型电流 ${pA.toFixed(2)} pA · E_K ${ek.toFixed(1)} mV · 门控 ${s.gateSeconds.toFixed(2)} s · 渗透 ${s.ns.toFixed(2)} ns`,
      gate: s.gate, conducting: conducting(s), current: conducting(s) ? pA : 0, openCurrent: pA, reversalPotential: ek,
      gateSeconds: s.gateSeconds, permeationNs: s.ns, openProbability: s.gateSeconds ? s.openSeconds / s.gateSeconds : 0,
      particles, transforms: new Map(), conformation: { weights: s.weights }, events: s.events };
  }
  // ---- what the player adds to the picture without changing its snapshot (the golden trace): free ions in the two baths, hydration shells, waters in the empty filter sites,
  // and the curves. The Viewer draws `clouds` through its particle sets and `series` as small plots. Everything is a function of the time and the seed, so seeking and replaying
  // show the same picture.
  const hash = (i, salt) => { let n = Math.imul((i + 1) * 0x9e3779b1 ^ salt * 0x85ebca6b, 0xc2b2ae35) >>> 0; n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d) >>> 0; n ^= n >>> 12; return (n >>> 0) / 4294967296; };
  const axisVec = structure.axis, perpendicular = (() => { const w = Math.abs(axisVec[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u = normalize(cross(axisVec, w)); return [u, cross(axisVec, u)]; })();
  const height = (p) => dot(sub(p, structure.sites.S2), axisVec), onAxis = (h) => structure.sites.S2.map((v, k) => v + axisVec[k] * h);
  const hOut = height(structure.sites.S0), hCav = height(structure.sites.cav);
  const baths = [
    { key: 'Ko', species: 'K⁺', where: '胞外', color: cfg.particles.potassium.color, r: 1.9, h: [hOut + 24, hOut + 80], salt: 11, count: (c) => Math.min(60, Math.round(c.Ko * 0.4)) },
    { key: 'Ki', species: 'K⁺', where: '胞内', color: cfg.particles.potassium.color, r: 1.9, h: [hCav - 85, hCav - 50], salt: 23, count: (c) => Math.min(60, Math.round(c.Ki * 0.4)) },
    { key: 'Nao', species: 'Na⁺', where: '胞外', color: cfg.particles.sodium.color, r: 1.6, h: [hOut + 24, hOut + 80], salt: 37, count: (c) => Math.min(60, Math.round(c.Nao * 0.4)) },   // like the classic, the outside Na⁺ bath only follows its concentration
    { key: 'Nai', species: 'Na⁺', where: '胞内', color: cfg.particles.sodium.color, r: 1.6, h: [hCav - 85, hCav - 50], salt: 41, count: (c) => Math.min(60, Math.round(c.Nai * 0.4)) },
  ];
  let extrasKey = '', extrasValue = null;
  function extras() {
    ensureLive();
    const key = `${time}|${kinetics.at(time).configIndex}`;
    if (key === extrasKey) return extrasValue;
    const s = kinetics.at(time), c = s.parameters, bulk = [];
    for (const bath of baths) for (let i = 0, n = bath.count(c); i < n; i++) {
      const radius = 12 + hash(i, bath.salt) * 58, angle = hash(i, bath.salt + 1) * 6.2832, h = bath.h[0] + hash(i, bath.salt + 2) * (bath.h[1] - bath.h[0]);
      const sway = [0, 1, 2].map((k) => 2.2 * Math.sin(time * (0.7 + 0.3 * k) + hash(i, bath.salt + 3 + k) * 6.2832));
      const offset = [0, 1, 2].map((k) => axisVec[k] * (h + sway[2]) + perpendicular[0][k] * (radius * Math.cos(angle) + sway[0]) + perpendicular[1][k] * (radius * Math.sin(angle) + sway[1]));
      bulk.push({ position: structure.point(structure.sites.S2.map((v, k) => v + offset[k])), radius: bath.r * SCALE, color: bath.color, name: `${bath.species}（${bath.where}溶液，自由离子）` });
    }
    // the hydration shell of every ion on its way through the pore: six waters circling it, present in solution, gone inside the filter
    const hydration = (site) => (/^(inside|outside|cav)$/.test(site) ? 1 : site === 'S0' ? 0.4 : 0);
    const f = Math.min(1, Math.max(0, (time - s.permTime) / 0.2)), moving = conducting(s) && f < 1 && transitions[s.lastPermId], shells = [];
    const ionNative = ([a, b]) => (a === 'inside' && b === 'cav' ? walk(structure.paths.inside, f) : a === 'cav' && b === 'inside' ? walk(structure.paths.inside, 1 - f)
      : a === 'S0' && b === 'outside' ? walk(structure.paths.outside, f) : a === 'outside' && b === 'S0' ? walk(structure.paths.outside, 1 - f) : lerp(positions[a], positions[b], f));
    (moving || occupancy[s.perm].map((site) => [site, site])).slice(0, 3).forEach((move, index) => {
      const hyd = moving ? hydration(move[0]) * (1 - f) + hydration(move[1]) * f : hydration(move[0]);
      if (hyd < 0.05) return;
      const centre = ionNative(move);
      for (let k = 0; k < 6; k++) {
        const angle = time * 3 + index + k * Math.PI / 3, r = 3.4 * hyd;
        shells.push({ position: structure.point(centre.map((v, j) => v + perpendicular[0][j] * r * Math.cos(angle) + perpendicular[1][j] * r * Math.sin(angle) + axisVec[j] * 2.2 * Math.sin(angle * 1.7 + k))), radius: 0.85 * hyd * SCALE, color: '#dfe8f5', name: 'H₂O（K⁺ 的水合层，进过滤器前脱去）' });
      }
    });
    // waters in the empty filter sites (ions and water alternate)
    const occupied = new Set(occupancy[s.perm]);
    if (s.perm !== 'X') for (const site of ['S1', 'S2', 'S3', 'S4']) if (!occupied.has(site) && !(s.ba && site === 'S4')) shells.push({ position: structure.point(positions[site]), radius: 1.0 * SCALE, color: '#dfe8f5', name: 'H₂O（过滤器里的水）' });
    // curves over the last 10 display seconds: the single-channel current, whether the channel conducts, and the potassium reversal potential
    const window = Math.min(10, time), points = 40, series = [{ label: '单通道电流', unit: 'pA', color: '#8a5cf0', range: [-12, 12], values: [] }, { label: '导电', unit: '', color: '#2fb39c', range: [0, 1], values: [] }, { label: 'E_K', unit: 'mV', color: '#e4572e', range: [-150, 50], values: [] }];
    for (let i = 0; i < points; i++) {
      const t = time - window + window * i / (points - 1), at = kinetics.at(Math.max(0, t));
      series[0].values.push(conducting(at) ? singleChannelCurrent(at.parameters) : 0); series[1].values.push(conducting(at) ? 1 : 0); series[2].values.push(reversalPotential(at.parameters));
    }
    extrasKey = key; extrasValue = { clouds: { 'kcsa-bulk': bulk, 'kcsa-water': shells }, series, window };
    return extrasValue;
  }
  function setParameters(parameters) {
    const validated = validateParameters(parameters);
    change(validated);
  }
  function change(patch) {
    ensureLive();
    if (schedule.length >= 1000) throw new Error('KcsA 参数变更已达上限。');
    const current = kinetics.at(time).parameters;
    schedule = [...schedule.filter((entry) => entry.time < time), { ...current, ...patch, time }];
    kinetics = createKinetics(seed, schedule);
  }
  return {
    duration: 120, steps, navigation, snapshot, extras, setParameters, validateParameters,
    decorate: (layers) => { ensureLive(); return structure.decorate(layers, nodes); },
    particleParentId: nodes[0].parentId,
    membrane: { center: structure.center, axis: structure.axis, radius: cfg.membrane.radius },
    evidence: { type: 'modelled', citation: cfg.evidence.citation, details: `孔区 ${cfg.pore.fitRange[0]}–${cfg.pore.fitRange[1]} ${numeral(cfg.protein.chains)}链叠合 RMSD（Å）：${Object.entries(structure.fits).map(([id, fit]) => `${id} ${fit.rmsd.toFixed(3)}`).join('；')}。${cfg.evidence.note}` },
    seek(value) { ensureLive(); if (!Number.isFinite(value)) throw new Error('时间必须有限。'); time = Math.min(120, Math.max(0, value)); if (time === 120) playing = false; return snapshot(); },
    advance(dt) { ensureLive(); if (!Number.isFinite(dt) || dt < 0) throw new Error('时间增量无效。'); if (playing) time = Math.min(120, Math.round((time + dt * playbackRate) * 1e9) / 1e9); if (time === 120) playing = false; return snapshot(); },
    play() { ensureLive(); if (time < 120) playing = true; }, pause() { ensureLive(); playing = false; },
    setSpeed(speed) { if (!Number.isFinite(speed) || speed < 0.05 || speed > 3) throw new Error('模拟倍率应为 0.05–3。'); change({ speed }); },
    setPlaybackRate(value) { ensureLive(); if (![0.25, 1, 2, 5].includes(value)) throw new Error('播放倍率无效。'); playbackRate = value; },
    stepTime(index) { if (!Number.isInteger(index) || !steps[index]) throw new Error('机制步骤无效。'); return undefined; },
    save() { ensureLive(); return { time, speed: kinetics.at(time).parameters.speed, seed, playbackRate, schedule: schedule.map((entry) => ({ ...entry })) }; },
    dispose() { disposed = true; playing = false; },
  };
}

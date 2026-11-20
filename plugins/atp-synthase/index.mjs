import { atpToolDescriptor, ATP_TOOL, atpSourceId, atpRotorTest } from './tool.mjs';
import { nodesOfSource, boundOrMatched } from '../shared/bindings.mjs';
import { centroid, rotateVector, superpose } from '../structure/alignment.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM as scale, selectCoordinateAtoms } from '../structure/representation.mjs';
import { matchesPart } from '../structure/functional-preview.mjs';
import { ATP_6ZPO_TEMPLATE, normalizeAtpConfig } from './config.mjs';
import { sub as subtract, normalize, cross } from '../motion/vectors.mjs';
import { displaceVertices } from '../motion/conformation.mjs';
import { createMachine, normalizeMachine } from '../motion/conformation-machine.mjs';

export const ATP_PLAYER = 'org.glow.legacy-process.atp-synthase';
export const atpSynthasePlugin = {
  manifest: { id: ATP_PLAYER, version: '1.0.0', apiVersion: 1,
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }], capabilities: ['players', 'panels', 'tools'] },
  activate(context) {
    const instances = new Set();
    context.lifecycle.add(() => { for (const player of instances) player.dispose(); instances.clear(); });
    context.registerPlayer(ATP_PLAYER, { create(input) {
      if (context.signal.aborted) throw new Error('ATP 合酶插件已停用。');
      const player = createAtpPlayer(input);
      const dispose = player.dispose;
      player.dispose = () => { dispose(); instances.delete(player); };
      instances.add(player);
      return player;
    } });
    context.registerTool(ATP_TOOL, atpToolDescriptor(this.manifest.version, ATP_PLAYER));
    const { panel } = ATP_6ZPO_TEMPLATE;
    context.registerPanel(ATP_PLAYER, {
      title: panel.title,
      speed: { label: panel.speedLabel, min: 0.05, max: 3, step: 0.05 },
      seed: { label: panel.seedLabel, min: 0, max: 4294967295, step: 1 },
      evidence: panel.evidence,
    });
  },
};

export const ATP_STEPS = ATP_6ZPO_TEMPLATE.steps;   // kept for callers; the data lives in config.mjs
const TAU = 2 * Math.PI;
const smooth = (value) => { const f = Math.max(0, Math.min(1, value)); return f * f * (3 - 2 * f); };
const chainKey = (atom) => JSON.stringify([atom.authChainId, atom.labelChainId, atom.assemblyCopy]);
const residueKey = (atom) => String(atom.labelSeqId || atom.authSeqId);
const round = (value) => Math.round(value * 1e9) / 1e9;

/** `config` is the work configuration (see config.mjs); omitted = the built-in 6ZPO template, which keeps old packs working. */
export function createAtpPlayer({ model, scene, state = {}, config, bindings }) {
  const cfg = normalizeAtpConfig(config);
  let disposed = false;
  const atoms = selectCoordinateAtoms(model).map(({ atom }) => atom);
  const nameOf = (atom) => model.chainNames?.[atom.labelChainId] ?? '';
  const ca = atoms.filter((atom) => atom.name === 'CA' && atom.element === 'C');
  const named = (pattern) => ca.filter((atom) => matchesPart(nameOf(atom), pattern));
  const ring = named(cfg.parts.ring), beta = named(cfg.parts.catalytic);
  if (!ring.length || !beta.length) throw new Error('ATP 合酶需要 c 环和 β 亚基的沉积链名称。');
  const ringCount = new Set(ring.map(chainKey)).size;
  if (cfg.counts.ringSubunits !== null ? ringCount !== cfg.counts.ringSubunits : ringCount < 3) {
    throw new Error(cfg.counts.ringSubunits !== null ? `此播放器适用于具有 ${cfg.counts.ringSubunits} 个 c 亚基的 ATP 合酶组装体。` : '此播放器至少需要 3 个 c 亚基。');
  }
  const betaChains = new Map();
  for (const atom of beta) {
    const key = chainKey(atom);
    if (!betaChains.has(key)) betaChains.set(key, []);
    betaChains.get(key).push(atom);
  }
  if (betaChains.size !== 3) throw new Error('ATP 合酶播放器需要三个 β 亚基。');
  const center = centroid(ring.map(({ position }) => position));
  const head = centroid(beta.map(({ position }) => position));
  const direction = subtract(head, center);
  if (Math.hypot(...direction) < 1e-6) throw new Error('无法从 c 环和 β 亚基确定转轴。');
  const axis = normalize(direction);
  const reference = Math.abs(axis[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1];
  const u = normalize(cross(axis, reference)), v = cross(axis, u);
  const angleOf = (point) => {
    const delta = subtract(point, center);
    return Math.atan2(delta.reduce((sum, value, i) => sum + value * v[i], 0),
      delta.reduce((sum, value, i) => sum + value * u[i], 0));
  };
  const chainList = [...betaChains.values()].sort((a, b) =>
    angleOf(centroid(a.map(({ position }) => position))) - angleOf(centroid(b.map(({ position }) => position))));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const atom of atoms) {
    if (['HOH', 'WAT', 'DOD', 'H2O'].includes(atom.residueName)) continue;
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], atom.position[i]); max[i] = Math.max(max[i], atom.position[i]); }
  }
  const origin = min.map((value, i) => (value + max[i]) / 2);
  const point = (position) => position.map((value, i) => (value - origin[i]) * scale);
  const pivot = point(center);
  const nextStates = new Map();
  for (const own of chainList) {
    const numbers = own.map(residueKey).map(Number).filter(Number.isFinite);
    const threshold = Math.min(...numbers) + 0.62 * (Math.max(...numbers) - Math.min(...numbers));
    const alternatives = chainList.map((other) => {
      const byNumber = new Map(other.map((atom) => [residueKey(atom), atom]));
      const shared = own.filter((atom) => Number(residueKey(atom)) < threshold && byNumber.has(residueKey(atom)));
      const fit = superpose(shared.map(({ position }) => position), shared.map((atom) => byNumber.get(residueKey(atom)).position));
      return new Map(own.map((atom) => [residueKey(atom), byNumber.has(residueKey(atom))
        ? fit(byNumber.get(residueKey(atom)).position) : atom.position]));
    });
    nextStates.set(chainKey(own[0]), alternatives);
  }
  const nodes = nodesOfSource(scene, atpSourceId(scene));
  const rotor = boundOrMatched(nodes, bindings, 'rotor', atpRotorTest(cfg));   // the saved binding, else the configured part names
  if (!rotor.length) throw new Error('当前预览没有 ATP 合酶转子节点。');
  const steps = cfg.steps.map((step) => ({ ...step, nodeIds: nodes.filter((node) =>
    step.parts.some((name) => matchesPart(node.extensions['org.glow.structure'].partName, name))).map(({ id }) => id) }));
  const root = rotor[0].parentId ?? rotor[0].id;
  const baseView = { nodeId: root, bookmarkId: null, labelIds: [] };
  const prefix = cfg.navigation.idPrefix;
  const navigation = {
    version: 1, entryId: `${prefix}-system`, views: [
      { ...baseView, id: `${prefix}-system`, mode: 'system', title: cfg.navigation.systemTitle, parentIds: [] },
      { ...baseView, id: `${prefix}-protein`, mode: 'protein', title: cfg.navigation.proteinTitle, parentIds: [`${prefix}-system`] },
      { ...baseView, id: `${prefix}-mechanism`, mode: 'mechanism', title: cfg.navigation.mechanismTitle,
        parentIds: [`${prefix}-system`, `${prefix}-protein`], steps: steps.map(({ title, nodeIds }, i) => ({
          id: `${prefix}-step-${i}`, title, nodeIds: nodeIds.length ? nodeIds : [rotor[0].id],
        })) },
    ],
  };
  const seed = Number.isSafeInteger(state.seed) ? state.seed >>> 0 : Number.isSafeInteger(scene.legacy?.scene?.seed) ? scene.legacy.scene.seed >>> 0 : 1;
  // the time side is a conformation state machine (rotary profile): the catalytic sites are the three beta subunits, the rotor's own units the c subunits of the ring
  const machine = createMachine(normalizeMachine({ kind: 'rotary', sites: 3, ...cfg.machine, counters: { cycles: cfg.counterLabels.atp, unit: cfg.counterLabels.proton }, eventLabel: cfg.eventLabel }, 'ATP 播放器'), state, { seed, units: ringCount });
  const carbonSites = chainList.map((chain) => {
    const coordinates = chain.map(({ position }) => position);
    const nucleotides = atoms.filter((atom) => cfg.nucleotides.bound.includes(atom.residueName));
    let closest, best = Infinity;
    for (const nucleotide of nucleotides) {
      if (nucleotide.name !== cfg.nucleotides.anchorAtom) continue;
      for (const coordinate of coordinates) {
        const distance = Math.hypot(...subtract(coordinate, nucleotide.position));
        if (distance < best) { best = distance; closest = nucleotide.position; }
      }
    }
    return point(closest ?? centroid(coordinates));
  });
  const ringRadius = Math.max(...ring.map(({ position }) => {
    const d = subtract(position, center);
    const axial = d.reduce((sum, value, i) => sum + value * axis[i], 0);
    return Math.hypot(...d.map((value, i) => value - axial * axis[i]));
  })) * scale;
  const noise = (index) => {
    let value = (seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0;
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b) >>> 0;
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
  };
  function moleculeTemplate(name) {
    const anchor = atoms.find((atom) => atom.residueName === name);
    if (!anchor) return;
    const molecule = atoms.filter((atom) => atom.residueName === name && chainKey(atom) === chainKey(anchor) &&
      residueKey(atom) === residueKey(anchor) && atom.authSeqId === anchor.authSeqId &&
      !['H', 'D'].includes(atom.element) && (!atom.altLoc || atom.altLoc === 'A'));
    const center = centroid(molecule.map(({ position }) => position));
    return molecule.map((atom) => ({ element: atom.element, position: subtract(atom.position, center).map((value) => value * scale) }));
  }
  const templates = {
    ADP: moleculeTemplate(cfg.nucleotides.adp), ATP: moleculeTemplate(cfg.nucleotides.atp),
    Pi: moleculeTemplate(cfg.nucleotides.phosphate) ?? [
      { element: 'P', position: [0, 0, 0] },
      ...[[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map((position) =>
        ({ element: 'O', position: position.map((value) => value * 0.045) })),
    ],
  };
  function snapshot() {
    if (disposed) throw new Error('播放器已释放。');
    const core = machine.snapshot(), { time, speed, playbackRate, playing, turns, stage } = core;
    const theta = turns * TAU;
    const quaternion = [...axis.map((value) => value * Math.sin(theta / 2)), Math.cos(theta / 2)];
    const spun = rotateVector(pivot, quaternion);
    const transforms = new Map(rotor.map((node) => [node.id, {
      ...node.transform, position: pivot.map((value, i) => value - spun[i]), rotation: quaternion,
    }]));
    const particles = [];
    for (let i = 0; i < ringCount; i++) {
      const fraction = (turns + i / ringCount + noise(i) * 0.03) % 1;
      const angle = fraction * TAU;
      const position = pivot.map((value, j) => value + ringRadius * (u[j] * Math.cos(angle) + v[j] * Math.sin(angle)) +
        axis[j] * (fraction - 0.5) * 1.4);
      particles.push({ name: cfg.particles.proton.name, color: cfg.particles.proton.color, position });
    }
    for (const [index, site] of carbonSites.entries()) {
      const f = (turns + index / 3) % 1;
      const outward = normalize(subtract(site, point(head)));
      const distance = f < 0.3 ? (0.3 - f) * 2 : f > 0.8 ? (f - 0.8) * 4 : 0;
      const nucleotide = f > 0.72 ? cfg.particles.atp : cfg.particles.adp;
      particles.push({ name: nucleotide.name, molecule: templates[f > 0.72 ? 'ATP' : 'ADP'],
        color: nucleotide.color,
        position: site.map((value, j) => value + outward[j] * distance) });
      particles.push({ name: cfg.particles.phosphate.name, molecule: templates.Pi, visible: f < 0.72, color: cfg.particles.phosphate.color, position: site.map((value, j) =>
        value + outward[j] * (distance + 0.18)) });
    }
    return { time, speed, seed, playbackRate, playing, stage, transforms, particles, events: core.events,
      turns, counters: core.counters, conformation: core.conformation,
    };
  }
  function decorate(layers) {
    for (const node of nodes) {
      const metadata = node.extensions['org.glow.structure'];
      const chain = chainList.find((list) => metadata.chainId === (list[0].authChainId || list[0].labelChainId));
      if (!chain) continue;
      const alternatives = nextStates.get(chainKey(chain[0]));
      const ownIndex = chainList.indexOf(chain);
      const conformations = [0, 1, 2].map((offset) => alternatives[(ownIndex + offset) % 3]);
      const vertices = layers.get(node.assetId);
      if (!vertices) continue;
      const anchors = chain.map((atom) => ({ ref: atom, at: point(atom.position), from: atom.position }));
      const resolvers = conformations.map((state) => (anchor) => state.get(residueKey(anchor.ref)));
      for (const layer of vertices) layer.conformations = displaceVertices(layer.positions, anchors, resolvers, { scale });
    }
    return layers;
  }
  return {
    duration: machine.duration, steps, navigation, decorate, snapshot,
    particleParentId: rotor[0].parentId,
    membrane: { center: pivot, axis, radius: ringRadius * 2.2 },
    seek(value) { machine.seek(value); return snapshot(); },
    advance(dt) { machine.advance(dt); return snapshot(); },
    play() { machine.play(); }, pause() { machine.pause(); },
    setSpeed(value) { machine.setSpeed(value); return snapshot(); },
    stepTime(index) { return machine.stepTime(index); },
    setPlaybackRate(value) { machine.setPlaybackRate(value); },
    save() { return machine.save(); },
    dispose() { disposed = true; machine.dispose(); },
  };
}

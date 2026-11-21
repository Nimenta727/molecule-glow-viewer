import assert from 'node:assert/strict';
import test from 'node:test';
import { mechanismWorkConfig, MECHANISM_WORK_PROCESSES } from '../works/mechanism-works.mjs';
import { normalizeDataConfig } from '../data-tool.mjs';
import { dataAnimationEntry, toolEntriesForScene, processEntry } from '../../mechanism-catalog.mjs';
import { orientedFrame } from '../structure-frame.mjs';
import { KineticSimulation } from '../kinetic-model.mjs';

const respirasome = { process: 'respiratoryChain', axisFit: ['Cytochrome b', 'oxidase'], up: 'flavoprotein 1', membranes: [{ at: '/^Cytochrome b$/', offset: 0 }] };

test('the two compartment-kinetics works become valid data-animation configurations carrying the classic scene\'s orientation', () => {
  assert.deepEqual([...MECHANISM_WORK_PROCESSES].sort(), ['chloroplast', 'flagellarMotor', 'respiratoryChain']);
  const config = normalizeDataConfig(mechanismWorkConfig(respirasome));
  assert.deepEqual(Object.keys(config.animation.compartments).sort(), ['bot', 'top']);
  assert.deepEqual([config.axis, config.axisFit, config.up], ['short', ['Cytochrome b', 'oxidase'], 'flavoprotein 1']);
  assert.equal(config.membranes[0].at, '/^Cytochrome b$/');
  const chloroplast = normalizeDataConfig(mechanismWorkConfig({ process: 'chloroplast', down: 'Oxygen-evolving enhancer protein 1', membranes: [{ at: 'Photosystem II protein D1', offset: 0 }] }));
  assert.equal(chloroplast.down, 'Oxygen-evolving enhancer protein 1'); assert.equal(chloroplast.up, undefined);
  assert.equal(mechanismWorkConfig({ process: 'translation' }), undefined); assert.equal(mechanismWorkConfig(undefined), undefined);
  // the model it carries runs: light on, the lumen acidifies
  const sim = new KineticSimulation(chloroplast.kinetics); for (let i = 0; i < 400; i++) sim.update(0.05);
  assert.ok(sim.state.dpH > 1, `dpH ${sim.state.dpH}`);
});

test('a classic scene that names one of these processes gets the tool entry; the mechanism players and plain scenes are untouched', () => {
  const entry = dataAnimationEntry({ legacy: { scene: { id: '5GUP', ...respirasome } } });
  assert.equal(entry.tool.id, 'org.glow.tool.data-animation'); assert.equal(entry.config.kinetics.title, '线粒体呼吸链：区室动力学');
  assert.equal(toolEntriesForScene({ legacy: { scene: { id: '5GUP', ...respirasome } } }).length, 1);
  assert.equal(dataAnimationEntry({ legacy: { scene: { id: '1ABC' } } }), undefined);
});

test('orientation: the flattest direction of the named parts becomes vertical and the named part ends up above (or below)', () => {
  // a flat slab of "membrane" residues in the x–y plane (so its normal is z) with a "tip" part on one side of it
  const residues = [];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) residues.push({ position: [i * 5, j * 5, (i + j) % 2 * 0.5], entity: 'membrane slab', authSeq: i * 12 + j, labelSeq: i * 12 + j, chain: 'A', labelAsym: 'A' });
  for (let k = 0; k < 20; k++) residues.push({ position: [27 + (k % 4), 27 + (k % 5), 25 + k], entity: 'tip', authSeq: 500 + k, labelSeq: 500 + k, chain: 'B', labelAsym: 'B' });
  const mean = (list, k) => list.reduce((t, p) => t + p[k], 0) / list.length;
  for (const [key, expectUp] of [['up', true], ['down', false]]) {
    const frame = orientedFrame({ residues, config: { axis: 'short', axisFit: ['membrane slab'], [key]: 'tip', membranes: [{ at: 'membrane slab', offset: 0 }] } });
    const slab = frame.structure.points.slice(0, 144), tip = frame.structure.points.slice(144);
    assert.ok(Math.max(...slab.map((p) => p[1])) - Math.min(...slab.map((p) => p[1])) < 2, 'the slab is horizontal');
    assert.equal(mean(tip, 1) > mean(slab, 1), expectUp, key);
    assert.ok(Math.abs(frame.structure.membraneY[0] - mean(slab, 1)) < 1e-9);
    assert.deepEqual(frame.fromNative(frame.toNative([1, 2, 3])).map((v) => +v.toFixed(9)), [1, 2, 3], 'maps back to the structure');
  }
});

test('the flagellar motor: eleven stator channels on a ring, protons flow from the periplasm to the cytoplasm; the direction and driving-gradient controls are the work\'s kinetics', () => {
  const config = normalizeDataConfig(mechanismWorkConfig({ process: 'flagellarMotor', axis: 'long', up: 'hook protein', membranes: [{ at: 'M-ring', offset: 18 }, { at: 'L-ring', offset: 0 }] }));
  assert.equal(config.animation.flows.length, 11); assert.deepEqual(config.kinetics.controls.map(({ id }) => id), ['pmf', 'cw']);
  assert.deepEqual([config.axis, config.up], ['long', 'hook protein']);
  assert.ok(config.animation.flows.every((f) => f.perTurn === 4), 'each stator passes 4 protons per turn: 44 in all');
  assert.deepEqual(config.animation.flows.map((f) => f.phase), Array.from({ length: 11 }, (_, k) => +(k / 44).toFixed(6)), 'the stators take turns, 1/44 turn apart');
  assert.equal(config.animation.rotor, undefined, 'no rotor without the parts the scene spins');
  const radii = config.animation.flows.map((f) => Math.hypot(f.via[0].offset[0], f.via[0].offset[2])); assert.ok(radii.every((r) => Math.abs(r - 215) < 0.01));
  assert.ok(config.animation.flows.every((f) => f.via[0].offset[1] > f.via[1].offset[1] && f.from === 'top' && f.to === 'bot'));
  assert.equal(new Set(config.animation.flows.map((f) => f.counter)).size, 1, 'one shared proton counter');
});

test('the classic ribosome scene and cell corner become the translation tool and the multi-process tool', () => {
  const t = processEntry({ legacy: { scene: { id: '4V6F', process: 'translation' } } }), c = processEntry({ legacy: { scene: { id: '4V6F', process: 'cellCorner' } } });
  assert.equal(t.tool.id, 'org.glow.tool.translation'); assert.equal(t.config.template, 'ubq');
  assert.equal(c.tool.id, 'org.glow.tool.multi-process'); assert.deepEqual(c.config.members.map((m) => m.kind), ['translation', 'process']); assert.equal(c.config.controls.length, 2);
  assert.equal(processEntry({ legacy: { scene: { process: 'wholeCell' } } }).tool.id, 'org.glow.tool.multi-process', 'the whole cell runs the same two stations inside the cell'); assert.equal(processEntry({}), undefined);
  assert.equal(toolEntriesForScene({ legacy: { scene: { process: 'translation' } } }).length, 1);
  assert.equal(processEntry({ legacy: { scene: { process: 'translation', seed: 11 } } }).config.seed, 11);
});

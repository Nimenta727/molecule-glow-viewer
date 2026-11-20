import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseCategory, parseChemComp, parseIdealSdf, bondsFromTemplate, bondsByDistance, loadChemComp, clearChemCompCache, AROMATIC, ChemicalComponentError } from '../chemical-component.mjs';

const text = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('ATP: atom names, elements, bond orders and aromatic flags come from the dictionary', () => {
  const atp = parseChemComp(text('ccd-ATP.cif'), 'ATP');
  assert.equal(atp.source, 'CCD');
  assert.equal(atp.atoms.length, 31);
  assert.ok(atp.atoms.every((a) => a.element !== 'H'));
  assert.ok(atp.atoms.some((a) => a.name === "O5'") && atp.atoms.some((a) => a.name === 'PG'), 'quoted names such as O5\' survive');
  const order = (a, b) => atp.bonds.find(([i, j]) => [atp.atoms[i].name, atp.atoms[j].name].sort().join() === [a, b].sort().join())?.[2];
  assert.equal(order('PA', 'O1A'), 2, 'P=O is a double bond');
  assert.equal(order('PB', 'O3B'), 1);
  assert.equal(order('C4', 'C5'), AROMATIC, 'purine ring bonds are aromatic');
  const centre = atp.atoms.reduce((s, a) => s.map((v, k) => v + a.position[k] / atp.atoms.length), [0, 0, 0]);
  assert.ok(centre.every((v) => Math.abs(v) < 1e-9), 'template is centred');
});

test('single ions and a heme parse too', () => {
  const k = parseChemComp(text('ccd-K.cif'), 'K');
  assert.deepEqual([k.atoms.length, k.bonds.length], [1, 0]);
  const hem = parseChemComp(text('ccd-HEM.cif'), 'HEM');
  assert.ok(hem.atoms.some((a) => a.element === 'FE') && hem.bonds.length > 40);
});

test('bonds are matched to ligand atoms by name, and unmatched atoms are left out', () => {
  const atp = parseChemComp(text('ccd-ATP.cif'), 'ATP');
  const ligand = atp.atoms.filter((a) => a.name !== 'PG').map((a) => ({ name: a.name, element: a.element, position: a.position }));
  const bonds = bondsFromTemplate(ligand, atp);
  assert.ok(bonds.length > 0 && bonds.length < atp.bonds.length);
  assert.ok(bonds.every(([i, j]) => i < ligand.length && j < ligand.length));
  assert.equal(bondsFromTemplate([{ name: 'ZZ' }], atp), null);
  assert.equal(bondsFromTemplate([{ name: 'C1' }], null), null);
});

test('without a dictionary bonds are guessed from distances; ions are never bonded', () => {
  const atoms = [
    { element: 'C', position: [0, 0, 0] }, { element: 'O', position: [1.2, 0, 0] }, { element: 'O', position: [5, 0, 0] },
    { element: 'K', position: [0.5, 0.5, 0] },
  ];
  assert.deepEqual(bondsByDistance(atoms), [[0, 1, 1]]);
});

test('the ideal SDF is a fallback without atom names', () => {
  const sdf = parseIdealSdf(text('ccd-ATP_ideal.sdf'), 'ATP');
  assert.equal(sdf.source, 'SDF');
  assert.ok(sdf.atoms.length > 20 && sdf.atoms.every((a) => a.name === '' && a.element !== 'H'));
  assert.ok(sdf.bonds.every(([i, j, o]) => i < sdf.atoms.length && j < sdf.atoms.length && o >= 1));
});

test('loading: CCD first, SDF when the CCD cannot be read, cached, aborts are not masked, bad ids refused', async () => {
  clearChemCompCache();
  const calls = [];
  const fetchText = async (url) => { calls.push(url); if (url.endsWith('ATP.cif')) return text('ccd-ATP.cif'); throw new Error('HTTP 404'); };
  const first = await loadChemComp('atp', { fetchText });
  assert.equal(first.source, 'CCD');
  await loadChemComp('ATP', { fetchText });
  assert.equal(calls.length, 1, 'cached');
  clearChemCompCache();
  const sdfOnly = await loadChemComp('ATP', { fetchText: async (url) => { if (url.endsWith('_ideal.sdf')) return text('ccd-ATP_ideal.sdf'); throw new Error('HTTP 404'); } });
  assert.equal(sdfOnly.source, 'SDF');
  clearChemCompCache();
  await assert.rejects(loadChemComp('ATP', { fetchText: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } }), { name: 'AbortError' });
  await assert.rejects(loadChemComp('ATP', { fetchText: async () => { throw new Error('offline'); } }), ChemicalComponentError);
  await assert.rejects(loadChemComp('../etc', { fetchText }), ChemicalComponentError);
  assert.deepEqual(parseCategory('data_x\n_a.b 1\n_a.c "x y"\n', '_a'), [{ b: '1', c: 'x y' }]);
});

// Differential test: plugins/structure/site-analysis.mjs against the classic code, run unchanged in a vm: the pocket surface (pocketSurfaceJob, src/derived/pocket.js), the pore /
// tunnel search (findChannel, alongPath, pathLength, src/derived/tunnel.js) and the interaction rules of the binding-site view (the block of focusLigand in src/ui/ligand-focus.js,
// cut out of the source by its own markers and run on the same atoms). Real residues and ligands of the fixture structures. Usage: node tools/site-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { siteInteractions, siteAround, pocketSurface, findChannel, alongPath, pathLength } from '../plugins/structure/site-analysis.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/site-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const model = (id) => parseMmcif(fs.readFileSync(path.join(dir, id + '.cif'), 'utf8'));
const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || v === b[i]);

const ctx = vm.createContext({ THREE, Math, console: { log() {}, warn() {}, error() {} }, appResources: { add: (_, x) => x } });
vm.runInContext(read('src/derived/pocket.js') + '\n' + read('src/derived/tunnel.js'), ctx);
const run = (code) => vm.runInContext(code, ctx);

// 1. interactions ---------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const src = read('src/ui/ligand-focus.js'), a = src.indexOf('const inter = [], hydro'), endMark = "inter.length = 0; inter.push(...[...best.values()].sort((x, y) => x.d - y.d)); }", b = src.indexOf(endMark) + endMark.length;
  if (a < 0 || b < endMark.length) throw new Error('classic interaction block not found');
  const block = src.slice(a, b);
  vm.runInContext(`var METALS = new Set(['MG', 'K', 'NA', 'CA', 'ZN', 'MN', 'FE', 'CO', 'NI', 'CU', 'CD']); function classicInteractions(lig, het, res, L) { ${block}; return { inter, hydro }; }`, ctx);
  for (const [id, comp, radius] of [['1AKE', 'AP5', 5], ['6ZPO', 'ATP', 5], ['6ZPO', 'ADP', 5], ['1K4C', 'K', 5], ['2HVK', 'TBA', 5], ['2HVK', 'L2C', 5]]) {
    const m = model(id), atoms = m.atoms ?? m.models?.[0]?.atoms;
    const mk = (atom) => ({ el: String(atom.element).toUpperCase(), an: atom.name, comp: String(atom.residueName).toUpperCase(), asym: atom.labelChainId, seq: Number.parseInt(atom.labelSeqId, 10) || Number.parseInt(atom.authSeqId, 10), aseq: atom.authSeqId, position: [...atom.position] });
    const heavy = atoms.filter((x) => x.element !== 'H' && x.element !== 'D' && (!x.altLoc || ['.', '?', 'A'].includes(x.altLoc)));
    const hets = heavy.filter((x) => x.record === 'HETATM' && String(x.residueName).toUpperCase() !== 'HOH');
    const first = hets.find((x) => String(x.residueName).toUpperCase() === comp); if (!first) { check(`${id} ${comp}: not in this structure`, false, 'missing'); continue; }
    const key = (x) => `${x.labelChainId}|${x.residueName}|${x.authSeqId}`, one = hets.filter((x) => key(x) === key(first)), centre = one.reduce((s, x) => [s[0] + x.position[0] / one.length, s[1] + x.position[1] / one.length, s[2] + x.position[2] / one.length], [0, 0, 0]);
    const near = (x) => Math.hypot(x.position[0] - centre[0], x.position[1] - centre[1], x.position[2] - centre[2]) <= radius + 8;
    const lig = one.map(mk), het = hets.filter((x) => near(x) && key(x) !== key(first)).map(mk);
    const groups = new Map();
    for (const x of heavy) if (x.record === 'ATOM' && near(x)) { const k = `${x.labelChainId}|${x.labelSeqId}`; if (!groups.has(k)) groups.set(k, { asym: x.labelChainId, seq: Number.parseInt(x.labelSeqId, 10), comp: String(x.residueName).toUpperCase(), atoms: [] }); groups.get(k).atoms.push(mk(x)); }
    const residues = [...groups.values()].filter((g) => g.atoms.some((x) => lig.some((l) => Math.hypot(l.position[0] - x.position[0], l.position[1] - x.position[1], l.position[2] - x.position[2]) <= radius)));
    const V = (x) => ({ ...x, q: new THREE.Vector3(...x.position) });
    const cl = { lig: lig.map(V), het: het.map(V) }, cres = new Map(residues.map((r) => [r.asym + '|' + r.seq, { ...r, atoms: r.atoms.map(V) }]));
    ctx.__lig = cl.lig; ctx.__het = cl.het; ctx.__res = cres; ctx.__L = { comp };
    const classic = run('(() => { const r = classicInteractions(__lig, __het, __res, __L); return { inter: r.inter.map((i) => [i.type, i.a.an, i.a.asym, i.b.an, i.rr ? i.rr.asym + i.rr.seq : null, i.d]), hydro: [...r.hydro].map((rr) => rr.asym + rr.seq) }; })()');
    const mine = siteInteractions({ ligand: lig, residues, het, ligandComp: comp });
    const mi = mine.interactions.map((i) => [i.type, i.a.an, i.a.asym, i.b.an, i.residue ? i.residue.asym + i.residue.seq : null, i.distance]);
    const hy = [...mine.hydrophobic].map((rr) => rr.asym + rr.seq);
    const eq = JSON.stringify(classic.inter) === JSON.stringify(mi) && JSON.stringify(classic.hydro) === JSON.stringify(hy);
    const types = ['hbond', 'salt', 'metal'].map((t) => `${mi.filter((i) => i[0] === t).length} ${t}`).join(', ');
    // the same rules fed from the adapter that reads the surroundings out of a loaded structure (siteAround)
    {
      const space = selectionSpace(m), entry = space.ligands.find((l) => l.comp === comp && l.atom.labelChainId === first.labelChainId && String(l.atom.authSeqId) === String(first.authSeqId)) ?? space.ligands.find((l) => l.comp === comp);
      const around = siteAround(m, entry, radius), aRes = new Map(around.residues.map((r) => [r.asym + '|' + r.seq, { ...r, atoms: r.atoms.map(V) }]));
      ctx.__lig = around.ligand.map(V); ctx.__het = around.het.map(V); ctx.__res = aRes; ctx.__L = { comp };
      const c2 = run('(() => { const r = classicInteractions(__lig, __het, __res, __L); return { inter: r.inter.map((i) => [i.type, i.a.an, i.a.asym, i.b.an, i.rr ? i.rr.asym + i.rr.seq : null, i.d]), hydro: [...r.hydro].map((rr) => rr.asym + rr.seq) }; })()');
      const m2 = siteInteractions({ ligand: around.ligand, residues: around.residues, het: around.het, ligandComp: comp });
      const e2 = JSON.stringify(c2.inter) === JSON.stringify(m2.interactions.map((i) => [i.type, i.a.an, i.a.asym, i.b.an, i.residue ? i.residue.asym + i.residue.seq : null, i.distance])) && JSON.stringify(c2.hydro) === JSON.stringify([...m2.hydrophobic].map((rr) => rr.asym + rr.seq));
      check(`${id} ${comp} read from the loaded structure (siteAround): ${around.ligand.length} ligand atoms, ${around.residues.length} residues, ${around.het.length} other hetero atoms → ${m2.interactions.length} interactions, same as the classic rules on the same atoms`, e2 && around.ligand.length > 0 && around.residues.length > 0, JSON.stringify([c2.inter.length, m2.interactions.length]));
    }
    check(`${id} ${comp} (${lig.length} atoms, ${residues.length} residues in ${radius} Å, ${het.length} other hetero atoms): ${mi.length} interactions (${types}), ${hy.length} hydrophobic residues, ${mine.clashes} skipped clashes: same list, same order, same distances to the last bit as the classic`, eq && mi.length + hy.length > 0, JSON.stringify([classic.inter.length, mi.length, classic.hydro.length, hy.length]));
  }
}

// 2. pocket surface -------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  for (const [id, comp] of [['1AKE', 'AP5'], ['6ZPO', 'ATP']]) {
    const m = model(id), atoms = m.atoms ?? m.models?.[0]?.atoms, first = atoms.find((x) => x.record === 'HETATM' && String(x.residueName).toUpperCase() === comp);
    const key = (x) => `${x.labelChainId}|${x.residueName}|${x.authSeqId}`, one = atoms.filter((x) => x.record === 'HETATM' && key(x) === key(first));
    const c = one.reduce((s, x) => [s[0] + x.position[0] / one.length, s[1] + x.position[1] / one.length, s[2] + x.position[2] / one.length], [0, 0, 0]);
    const site = atoms.filter((x) => x.record === 'ATOM' && x.element !== 'H' && Math.hypot(x.position[0] - c[0], x.position[1] - c[1], x.position[2] - c[2]) < 9);
    const VDW = { C: 1.7, N: 1.55, O: 1.52, S: 1.8 }, classes = ['ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL'];
    const job = { pos: new Float32Array(site.flatMap((x) => x.position)), rad: new Float32Array(site.map((x) => VDW[x.element] || 1.8)), cls: new Uint8Array(site.map((x) => { const k = classes.indexOf(String(x.residueName).toUpperCase()); return k < 0 ? 255 : k; })), centre: c, cut: Math.max(...one.map((x) => Math.hypot(x.position[0] - c[0], x.position[1] - c[1], x.position[2] - c[2])), 3) + 5 };
    ctx.__job = job;
    const classic = run('pocketSurfaceJob(__job)'), mine = pocketSurface(job);
    check(`${id} ${comp} pocket: ${site.length} site atoms → ${mine.pos.length / 3} surface vertices, ${mine.idx.length / 3} triangles: vertices, indices and residue classes identical to the classic`,
      mine.idx.length > 0 && same([...classic.pos], [...mine.pos]) && same([...classic.idx], [...mine.idx]) && same([...classic.cls], [...mine.cls]), `${classic.pos.length}/${mine.pos.length}`);
  }
}

// 3. channel search -------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const cases = [['1K4C', 'KcsA pore, from the filter centre outwards', null], ['2HVK', 'KcsA pore (closed-state fixture)', null], ['6ZPO', 'ATP synthase, from the c-ring centre', { minLen: 40 }], ['1K4C', 'KcsA pore with the classic defaults (2 Å grid, 120 Å box)', 'defaults']];
  for (const [id, label, opt] of cases) {
    const space = selectionSpace(model(id)), pts = space.residues.map((r) => [...r.position]), n = pts.length, centre = pts.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
    const options = opt === 'defaults' ? {} : { h: 3, radius: 60, minClear: 3.5, openClear: 12, minLen: 25, ...(opt ?? {}) };
    ctx.__pts = pts.map((p) => new THREE.Vector3(...p)); ctx.__start = new THREE.Vector3(...centre); ctx.__opts = options;
    const classic = run('(() => { const r = findChannel(__pts, __start, __opts); return r && r.map((x) => [x.p.x, x.p.y, x.p.z, x.r]); })()'), mine = findChannel(pts, centre, options);
    const eq = classic === null ? mine === null : mine !== null && classic.length === mine.length && classic.every((r, i) => same(r, [...mine[i].p, mine[i].r]));
    let alongWorst = 0, lenSame = true;
    if (mine) {
      ctx.__path = mine.map((x) => ({ p: new THREE.Vector3(...x.p), r: x.r }));
      const L = pathLength(mine); lenSame = run('pathLength(__path)') === L;
      for (const s of [-5, 0, 7.3, L / 3, L / 2, L, L + 11]) { const c = run(`(() => { const v = alongPath(__path, ${s}); return [v.x, v.y, v.z]; })()`), m = alongPath(mine, s); alongWorst = Math.max(alongWorst, ...c.map((v, i) => Math.abs(v - m[i]))); }
    }
    check(`${id} ${label}: ${mine ? `${mine.length} points, length ${pathLength(mine).toFixed(1)} Å, narrowest ${Math.min(...mine.map((x) => x.r)).toFixed(2)} Å` : 'no way out (the classic finds none either)'}: path equal point by point to the last bit; points along the path differ by ${alongWorst.toExponential(1)}`, eq && lenSame && alongWorst === 0, `${classic?.length}/${mine?.length}`);
  }
}

console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;

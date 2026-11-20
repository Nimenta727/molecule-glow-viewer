// Differential test (offline): the automatic introduction of plugins/structure/entry-intro.mjs against the classic card (showAutoCard in
// src/sim/processes/auto.js), both fed the same recorded RCSB / UniProt responses. The classic card is run as it is, with a stub page;
// what it shows (title, source line, species, citation, annotations, UniProt function) is compared with the structured result.
// Usage: node tools/intro-parity.mjs [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadIntroduction, readableTitle } from '../plugins/structure/entry-intro.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIX = path.join(ROOT, 'plugins/structure/test/fixtures');
const out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
const src = fs.readFileSync(path.join(ROOT, 'src/sim/processes/auto.js'), 'utf8');
const between = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker not found: ' + a); return src.slice(i, j); };
const json = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const text = (html) => html.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const lines = []; let bad = 0, total = 0;
const check = (id, what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${id} ${what}${same ? '' : ' — ' + detail}`); };
for (const id of ['4AKE', '1K4C']) {
  const graphql = json(`rcsb-intro-${id}.json`);
  const uniprot = (url) => { const acc = /uniprotkb\/([A-Z0-9]+)\.json/.exec(url)?.[1]; return json(`uniprot-function-${acc}.json`); };
  const fetchJson = async (url) => (url.includes('graphql') ? graphql : uniprot(url));
  const { intro } = await loadIntroduction(id, { fetchJson, sizeOf: () => 0 });

  const els = {};
  const page = (key) => (els[key] ??= { style: {}, textContent: '', innerHTML: '' });
  const ctx = vm.createContext({
    console, Math, Map, Set, Array, Object, Number, String, JSON, Promise, $: page, esc, loads: { active: { setTimeout: () => {} } },
    LIPIDS: new Set(), AA1: {}, MEM_SRC: {}, focusLigand: () => {}, proc: null,
    fetchText: async (url) => JSON.stringify(uniprot(url)), model: { ligands: [] }, groups: [],
    current: { auto: true, id, autoInfo: { e: graphql.data.entry, uni: {} }, autoMem: null },
  });
  // groups: one per entity description, sized as the entities are (the classic card ranks function text by group size)
  ctx.groups = intro.entities.map((e) => ({ name: e.description, atoms: [{ asym: 'A' }] }));
  vm.runInContext(between('const niceTitle', 'PROCESSES.auto'), ctx);
  vm.runInContext(between('async function showAutoCard', '\n}\n') + '\n}\n', ctx);
  await vm.runInContext('showAutoCard()', ctx);
  const cardTitle = els.infoT.textContent, cardText = text(els.infoB.innerHTML), fn = text(ctx.current.uniFn ?? '');

  check(id, 'title (sentence case)', cardTitle === readableTitle(intro.title), `classic "${cardTitle}" vs new "${readableTitle(intro.title)}"`);
  const source = `${id} · ${intro.methods.join(' / ')} · ${intro.resolution.toFixed(1)} Å · ${intro.organisms.slice(0, 3).join('、')}`;
  check(id, 'source line: id, method, resolution, species', cardText.includes(source), `new "${source}" not in classic text`);
  check(id, 'keywords', !intro.keywords || cardText.toLowerCase().includes(intro.keywords.toLowerCase()), 'keywords missing');
  const cit = intro.citation;
  check(id, 'citation title, journal, year, DOI', cardText.includes(cit.title) && cardText.includes(`${cit.journal} ${cit.year}`) && els.infoB.innerHTML.includes(cit.doi), `citation not found: ${cit.title}`);
  check(id, 'annotations (families, GO)', [...intro.families, ...intro.go].every((a) => cardText.includes(a)), `missing ${[...intro.families, ...intro.go].filter((a) => !cardText.includes(a)).join('; ')}`);
  const fnOk = intro.functions.length > 0 && intro.functions.every((f) => fn.includes(f.name) && fn.includes(f.accession) && fn.includes((f.text.length > 520 ? f.text.slice(0, 520) + '…' : f.text)) && (!f.gene || fn.includes(f.gene)));
  check(id, `UniProt function text (${intro.functions.map((f) => f.accession).join(', ')})`, fnOk, `classic: ${fn.slice(0, 200)}`);
  const classicAccs = [...fn.matchAll(/\b([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9][A-Z][A-Z0-9]{2}[0-9])\b/g)].map((m) => m[1]);
  check(id, 'same entities chosen for function text', JSON.stringify([...new Set(classicAccs)].sort()) === JSON.stringify(intro.functions.map((f) => f.accession).sort()), `classic ${[...new Set(classicAccs)]} vs new ${intro.functions.map((f) => f.accession)}`);
}
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;

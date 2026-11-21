#!/usr/bin/env node
// Authoring tool: makes a complex record (packages/schema/complex.mjs) from one real structure file. The chains are grouped by the name the entry gives them; every copy keeps the entry's
// own coordinates; the resource reference ({ id, version, sha256 }) is computed from the file the same way the importers do, so it matches the workshop catalogue when --accession names an RCSB entry.
// Usage: node tools/complex-from-structure.mjs <structure.cif> --accession 6N2Y --id cx.ps3-atp-synthase --title "枯草芽孢杆菌 PS3 ATP 合酶" [--citation "..."] [--output complex.json]
import fs from 'node:fs';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { describeStructureAsset, sha256Hex } from '../packages/schema/resource.mjs';
import { complexFromStructure, stoichiometry } from '../packages/schema/complex.mjs';

const args = process.argv.slice(2), file = args[0], option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (!file || !option('--id') || !option('--title')) { console.error('usage: node tools/complex-from-structure.mjs <structure.cif> --id <complex id> --title <title> [--accession <RCSB id>] [--citation <text>] [--output <file>]'); process.exit(2); }
const bytes = new Uint8Array(fs.readFileSync(file)), sha256 = await sha256Hex(bytes), accession = option('--accession');
const asset = { path: file.split('/').at(-1), sha256, mediaType: 'chemical/x-mmcif', provenance: { source: accession ? { provider: 'RCSB PDB', accession } : { provider: 'local', accession: file.split('/').at(-1) } } };
const { record } = describeStructureAsset(asset, bytes);
const resource = { id: record.id, version: record.version, sha256 };
const complex = complexFromStructure({ model: parseMmcif(new TextDecoder().decode(bytes)), resource, id: option('--id'), title: option('--title'), citation: option('--citation') });
for (const [name, copies] of stoichiometry(complex)) console.log(String(copies).padStart(4), name);
console.log(`${complex.members.length} members, ${complex.members.reduce((n, m) => n + m.copies, 0)} copies; resource ${resource.id}@${resource.version}`);
if (option('--output')) { fs.writeFileSync(option('--output'), JSON.stringify(complex, null, 1) + '\n'); console.log('wrote', option('--output')); }

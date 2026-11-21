/**
 * The scientific basics of a structure file, read from the file itself: what it is called, how it was determined, at what resolution, from which organism, what its entities and chains are, which ligands
 * it holds, what paper it comes from. This is the "card" of a protein template (docs: the first layer of the platform: the original file plus what is known about it). Nothing here is fetched or guessed:
 * a field the file does not state is empty, and the card says which format it read. mmCIF is read in full (header categories only, the coordinates are never touched, so a 40 MB entry costs a few
 * milliseconds); PDB-format files give what their header records give.
 */
export class CardError extends Error { constructor(message) { super(message); this.name = 'CardError'; } }

const clean = (value) => { const text = String(value ?? '').trim(); return text === '?' || text === '.' ? '' : text; };
const number = (value) => { const n = Number.parseFloat(clean(value)); return Number.isFinite(n) ? n : null; };

/** The header part of an mmCIF text as { scalars: Map(key -> value), loops: [{ headers, rows }] }; stops at the first coordinate row. */
export function readCifHeader(text) {
  const scalars = new Map(), loops = [], n = text.length;
  let i = 0, tokenQuoted = false;
  const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13;
  function next() {   // one token, or null at the end; sets tokenQuoted
    while (i < n) {
      const c = text.charCodeAt(i);
      if (isSpace(c)) { i++; continue; }
      if (c === 35) { while (i < n && text.charCodeAt(i) !== 10) i++; continue; }   // # comment
      break;
    }
    if (i >= n) return null;
    const c = text[i];
    if (c === ';' && (i === 0 || text[i - 1] === '\n')) {   // a text block runs to a line that starts with ;
      const end = text.indexOf('\n;', i + 1);
      const body = text.slice(i + 1, end < 0 ? n : end); i = end < 0 ? n : end + 2; tokenQuoted = true;
      return body.replace(/^\s+|\s+$/g, '');
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && !(text[j] === c && (j + 1 >= n || isSpace(text.charCodeAt(j + 1))))) j++;
      const body = text.slice(i + 1, j); i = Math.min(n, j + 1); tokenQuoted = true; return body;
    }
    let j = i; while (j < n && !isSpace(text.charCodeAt(j))) j++;
    const body = text.slice(i, j); i = j; tokenQuoted = false; return body;
  }
  let token = next(), quoted = tokenQuoted;
  const advance = () => { token = next(); quoted = tokenQuoted; };
  const control = () => token !== null && !quoted && (token === 'loop_' || token.startsWith('_') || token.startsWith('data_'));
  while (token !== null) {
    if (!quoted && token === 'loop_') {
      advance();
      const headers = [];
      while (token !== null && !quoted && token.startsWith('_')) { headers.push(token.toLowerCase()); advance(); }
      if (headers[0]?.startsWith('_atom_site.')) break;   // the coordinates: everything the card needs came before
      const rows = []; let row = [];
      while (token !== null && !control()) { row.push(token); if (row.length === headers.length) { rows.push(row); row = []; } advance(); }
      loops.push({ headers, rows });
    } else if (!quoted && token.startsWith('_')) {
      const key = token.toLowerCase(); if (key.startsWith('_atom_site.')) break;
      advance(); if (token !== null && !control()) { scalars.set(key, token); advance(); }
    } else advance();
  }
  return { scalars, loops };
}

function table(header, category) {   // rows of one category as objects keyed by field name, from a loop or from scalars
  const prefix = `${category}.`, loop = header.loops.find((l) => l.headers[0]?.startsWith(prefix));
  if (loop) return loop.rows.map((row) => Object.fromEntries(loop.headers.map((h, k) => [h.slice(prefix.length), row[k]])));
  const fields = [...header.scalars].filter(([k]) => k.startsWith(prefix));
  return fields.length ? [Object.fromEntries(fields.map(([k, v]) => [k.slice(prefix.length), v]))] : [];
}
const one = (header, category) => table(header, category)[0] ?? {};

function cardFromMmcif(text) {
  const header = readCifHeader(text);
  if (!header.scalars.has('_entry.id') && !header.loops.length) throw new CardError('这不像是 mmCIF 文件：没有读到任何头部信息。');
  const entities = table(header, '_entity'), poly = new Map(table(header, '_entity_poly').map((r) => [clean(r.entity_id), r]));
  const sources = new Map(); for (const category of ['_entity_src_gen', '_entity_src_nat', '_pdbx_entity_src_syn']) for (const r of table(header, category)) {
    const id = clean(r.entity_id); if (!id || sources.has(id)) continue;
    sources.set(id, clean(r.pdbx_gene_src_scientific_name) || clean(r.pdbx_organism_scientific) || clean(r.organism_scientific) || '');
  }
  const nonpoly = new Map(table(header, '_pdbx_entity_nonpoly').map((r) => [clean(r.entity_id), r]));
  const chainsOf = new Map(); for (const r of table(header, '_struct_asym')) { const id = clean(r.entity_id); if (!chainsOf.has(id)) chainsOf.set(id, []); chainsOf.get(id).push(clean(r.id)); }
  const list = entities.map((r) => {
    const id = clean(r.id), type = clean(r.type), p = poly.get(id), sequence = clean(p?.pdbx_seq_one_letter_code_can).replace(/\s+/g, '');
    return { id, type, name: clean(r.pdbx_description), copies: Number.parseInt(clean(r.pdbx_number_of_molecules), 10) || (chainsOf.get(id)?.length ?? 0), chains: chainsOf.get(id) ?? [],
      ...(type === 'polymer' ? { polymerType: clean(p?.type), length: sequence.length, sequence } : {}), organism: sources.get(id) ?? '', mutation: clean(r.pdbx_mutation), ...(nonpoly.has(id) ? { comp: clean(nonpoly.get(id).comp_id) } : {}) };
  });
  const organisms = [...new Set(list.map((e) => e.organism).filter(Boolean))];
  const ligands = list.filter((e) => e.type === 'non-polymer').map((e) => ({ comp: e.comp ?? '', name: e.name, count: e.copies }));
  const citations = table(header, '_citation'), cite = citations.find((c) => clean(c.id) === 'primary') ?? citations[0] ?? {};
  const resolution = number(one(header, '_refine').ls_d_res_high) ?? number(one(header, '_em_3d_reconstruction').resolution) ?? number(one(header, '_reflns').d_resolution_high);
  const status = one(header, '_pdbx_database_status'), revisions = table(header, '_pdbx_audit_revision_history'), mutated = list.filter((e) => e.mutation);
  return { format: 'mmcif', id: clean(header.scalars.get('_entry.id')), title: clean(one(header, '_struct').title), keywords: clean(one(header, '_struct_keywords').pdbx_keywords),
    method: clean(one(header, '_exptl').method), resolution, organisms, deposited: clean(status.recvd_initial_deposition_date), released: clean(revisions[0]?.revision_date),
    entities: list, polymerEntities: list.filter((e) => e.type === 'polymer').length, chains: list.filter((e) => e.type === 'polymer').reduce((s, e) => s + e.chains.length, 0),   // polymer chains: water and ions have asym ids of their own
    ligands, mutations: mutated.map((e) => ({ entity: e.name, mutation: e.mutation })), assemblies: table(header, '_pdbx_struct_assembly').length,
    citation: { title: clean(cite.title), journal: clean(cite.journal_abbrev), year: clean(cite.year), doi: clean(cite.pdbx_database_id_doi) } };
}

function cardFromPdb(text) {
  const lines = text.split(/\r?\n/), take = (prefix) => lines.filter((l) => l.startsWith(prefix));
  const join = (prefix, from = 10) => take(prefix).map((l) => l.slice(from).trim().replace(/^\d+\s/, '')).join(' ').replace(/\s+/g, ' ').trim();
  const header = lines.find((l) => l.startsWith('HEADER')) ?? '', id = header.slice(62, 66).trim();
  const expdta = join('EXPDTA'), resolutionLine = lines.find((l) => /^REMARK +2 +RESOLUTION\./.test(l)), resolution = number(resolutionLine?.match(/RESOLUTION\.\s+([\d.]+)/)?.[1]);
  const compnd = join('COMPND'), entities = []; let current = null;
  for (const part of compnd.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [key, ...rest] = part.split(':'), value = rest.join(':').trim();
    if (/^MOL_ID$/i.test(key)) { current = { id: value, type: 'polymer', name: '', copies: 0, chains: [], organism: '', mutation: '' }; entities.push(current); }
    else if (current && /^MOLECULE$/i.test(key)) current.name = value;
    else if (current && /^CHAIN$/i.test(key)) { current.chains = value.split(',').map((c) => c.trim()).filter(Boolean); current.copies = current.chains.length; }
    else if (current && /^MUTATION$/i.test(key)) current.mutation = value;
  }
  const organisms = []; { let k = -1; for (const part of join('SOURCE').split(';').map((s) => s.trim()).filter(Boolean)) { const [key, ...rest] = part.split(':'), value = rest.join(':').trim();
    if (/^MOL_ID$/i.test(key)) k++; else if (/^ORGANISM_SCIENTIFIC$/i.test(key)) { if (entities[k]) entities[k].organism = value; if (!organisms.includes(value)) organisms.push(value); } } }
  const seqres = new Map(); for (const l of take('SEQRES')) { const chain = l[11], count = Number.parseInt(l.slice(13, 17), 10); if (chain && count) seqres.set(chain, count); }
  for (const e of entities) { const lengths = e.chains.map((c) => seqres.get(c)).filter(Boolean); if (lengths.length) e.length = lengths[0]; }
  const het = new Map(); for (const l of take('HETNAM')) { const comp = l.slice(11, 14).trim(); if (comp) het.set(comp, (het.get(comp) ?? '') + ' ' + l.slice(15).trim()); }
  const hetCount = new Map(); for (const l of take('HET   ')) { const comp = l.slice(7, 10).trim(); hetCount.set(comp, (hetCount.get(comp) ?? 0) + 1); }
  const ligands = [...hetCount].filter(([comp]) => comp !== 'HOH').map(([comp, count]) => ({ comp, name: (het.get(comp) ?? '').trim(), count }));
  const jrnl = lines.filter((l) => l.startsWith('JRNL')), field = (tag) => jrnl.filter((l) => l.slice(12, 16).trim() === tag).map((l) => l.slice(19).trim()).join(' ').replace(/\s+/g, ' ').trim();
  const refn = jrnl.find((l) => l.slice(12, 16).trim() === 'DOI'), year = field('REF').match(/\b(19|20)\d{2}\b/)?.[0] ?? '';
  return { format: 'pdb', id, title: join('TITLE'), keywords: header.slice(10, 50).trim(), method: expdta, resolution, organisms, deposited: header.slice(50, 59).trim(), released: '',
    entities, polymerEntities: entities.length, chains: new Set(entities.flatMap((e) => e.chains)).size, ligands, mutations: entities.filter((e) => e.mutation).map((e) => ({ entity: e.name, mutation: e.mutation })), assemblies: 0,
    citation: { title: field('TITL'), journal: field('REF').slice(0, 80), year, doi: refn ? refn.slice(19).trim() : '' } };
}

/** The card of a structure file's text. `format` is "mmcif" or "pdb"; by default it is guessed from the first lines. */
export function extractStructureCard(text, { format } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new CardError('文件是空的。');
  const kind = format ?? (/^\s*(data_|#|loop_|_)/m.test(text.slice(0, 2000)) && !/^(HEADER|ATOM  |HETATM|REMARK|TITLE |COMPND|SEQRES)/m.test(text.slice(0, 2000)) ? 'mmcif' : 'pdb');
  const card = kind === 'mmcif' ? cardFromMmcif(text) : cardFromPdb(text);
  if (!card.entities.length && !card.title) throw new CardError('没有从文件里读到任何科研信息（没有标题，也没有实体）：它可能不是蛋白质结构文件。');
  return card;
}

/** The short string map that goes into a resource record's `card` (what the workshop lists): only what the file states. */
export function cardStrings(card) {
  const polymers = card.entities.filter((e) => e.type === 'polymer'), out = {};
  if (card.title) out.title = card.title.slice(0, 300);
  if (card.organisms.length) out.species = card.organisms.join('; ').slice(0, 300);
  if (card.method) out.method = card.method;
  if (card.resolution != null) out.resolution = `${card.resolution} Å`;
  if (card.mutations.length) out.mutation = card.mutations.map((m) => m.mutation).join('; ').slice(0, 200);
  if (card.citation.title) out.citation = `${card.citation.title}${card.citation.year ? ` (${card.citation.year})` : ''}`.slice(0, 400);
  if (card.citation.doi) out.doi = card.citation.doi;
  if (polymers.length) out.chains = `${card.chains} 条链，${polymers.length} 种聚合物：${polymers.map((e) => `${e.name || '（未命名）'}${e.length ? ` ${e.length} aa` : ''} ×${e.copies}`).join('；')}`.slice(0, 500);
  if (card.ligands.length) out.ligands = card.ligands.map((l) => `${l.comp || l.name} ×${l.count}`).join('、').slice(0, 300);
  return out;
}

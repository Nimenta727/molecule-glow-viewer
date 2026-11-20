/**
 * Automatic introduction of a PDB entry (classic: showAutoCard / fetchAutoInfo in src/sim/processes/auto.js). It answers "what is this structure"
 * from authoritative records only: RCSB PDB for the entry (title, method, resolution, species, engineered substitutions, citation, entities,
 * annotations) and UniProt for what the protein does. Every field names its source; anything the records do not give is listed in `missing`
 * and shown as unavailable. Nothing is inferred or written from memory. Network access is injected (`fetchJson`).
 */
const ENTRY_ID = /^[0-9][A-Za-z0-9]{3}$/;
const ACCESSION = /^[A-Z0-9]{6,10}$/;
export const RCSB_GRAPHQL_URL = 'https://data.rcsb.org/graphql';
/** Crystallisation fusion partners (T4 lysozyme, BRIL, MBP): they are in the entry but are not what it is about. */
export const FUSION_PARTNERS = new Set(['P00720', 'P0ABE7', 'P0AEX9']);

export class EntryIntroError extends Error {
  constructor(message) { super(message); this.name = 'EntryIntroError'; }
}

export function introductionQuery(entryId) {
  if (!ENTRY_ID.test(entryId ?? '')) throw new EntryIntroError('只有 PDB 条目才能读取自动简介');
  return `{ entry(entry_id:"${entryId.toUpperCase()}"){ struct{title} struct_keywords{pdbx_keywords} exptl{method}
    rcsb_entry_info{resolution_combined} rcsb_accession_info{initial_release_date}
    rcsb_primary_citation{title journal_abbrev year pdbx_database_id_DOI pdbx_database_id_PubMed}
    polymer_entities{ rcsb_polymer_entity{pdbx_description pdbx_mutation pdbx_number_of_molecules} entity_poly{type}
      rcsb_entity_source_organism{scientific_name} rcsb_polymer_entity_container_identifiers{entity_id uniprot_ids asym_ids}
      rcsb_polymer_entity_annotation{type name} } } }`;
}

/** RCSB titles are often ALL CAPS: show them in sentence case (the stored title is left as it is). */
export const readableTitle = (title) => !title ? '' : title === title.toUpperCase() ? title.charAt(0) + title.slice(1).toLowerCase() : title;

const plain = (value) => String(value ?? '').replace(/<[^>]+>/g, '').trim();
const unique = (list) => [...new Set(list.filter(Boolean))];

const annotationsOf = (entry, type) => unique((entry.polymer_entities ?? []).flatMap((pe) => (pe.rcsb_polymer_entity_annotation ?? []).filter((a) => a.type === type).map((a) => plain(a.name))));

/** Structured introduction from an RCSB GraphQL response. `unavailable` fields are null and named in `missing`. */
export function introductionFromRcsb(response, entryId) {
  const entry = response?.data?.entry;
  if (!entry) throw new EntryIntroError('RCSB 没有返回这个条目的信息');
  const entities = (entry.polymer_entities ?? []).map((pe) => {
    const info = pe.rcsb_polymer_entity ?? {}, ids = pe.rcsb_polymer_entity_container_identifiers ?? {};
    const annotations = pe.rcsb_polymer_entity_annotation ?? [];
    const named = (type) => annotations.filter((a) => a.type === type).map((a) => plain(a.name));
    return {
      entityId: String(ids.entity_id ?? ''), description: plain(info.pdbx_description) || null, type: pe.entity_poly?.type ?? null,
      copies: Number.isInteger(info.pdbx_number_of_molecules) ? info.pdbx_number_of_molecules : null,
      substitutions: info.pdbx_mutation ? plain(info.pdbx_mutation) : null,
      organisms: unique((pe.rcsb_entity_source_organism ?? []).map((o) => plain(o.scientific_name))),
      uniprotIds: (ids.uniprot_ids ?? []).filter((id) => ACCESSION.test(id)), asyms: (ids.asym_ids ?? []).map(String),
      families: [...named('mpstruc'), ...named('OPM'), ...named('InterPro')], go: named('GO'),
    };
  });
  const citation = entry.rcsb_primary_citation;
  const resolution = entry.rcsb_entry_info?.resolution_combined?.[0];
  const intro = {
    id: String(entryId).toUpperCase(),
    title: plain(entry.struct?.title) || null,
    keywords: entry.struct_keywords?.pdbx_keywords ?? null,
    methods: unique((entry.exptl ?? []).map((x) => x.method)),
    resolution: Number.isFinite(resolution) ? resolution : null,
    released: entry.rcsb_accession_info?.initial_release_date?.slice(0, 10) ?? null,
    organisms: unique(entities.flatMap((e) => e.organisms)),
    citation: citation?.title ? {
      title: plain(citation.title), journal: citation.journal_abbrev ?? null, year: citation.year ?? null,
      doi: citation.pdbx_database_id_DOI ?? null, pubmed: citation.pdbx_database_id_PubMed ?? null,
    } : null,
    entities,
    // what the card shows, as the classic card did: one mpstruc and one OPM label, up to three InterPro names, up to four GO terms
    families: [...annotationsOf(entry, 'mpstruc').slice(0, 1), ...annotationsOf(entry, 'OPM').slice(0, 1), ...annotationsOf(entry, 'InterPro').slice(0, 3)],
    go: annotationsOf(entry, 'GO').slice(0, 4),
    functions: [],
    sources: { entry: 'RCSB PDB', function: 'UniProt' },
  };
  intro.missing = [
    !intro.methods.length && '实验方法', intro.resolution == null && '分辨率', !intro.organisms.length && '来源物种',
    !intro.citation && '文献', !intro.released && '发布日期', !entities.length && '实体信息',
  ].filter(Boolean);
  return intro;
}

/** UniProt accessions worth reading the function of: the largest entities first, fusion partners last (at most `limit`). */
export function functionAccessions(intro, { sizeOf = () => 0, limit = 2 } = {}) {
  const ranked = intro.entities.map((e) => [e, sizeOf(e)]).sort((a, b) => b[1] - a[1]);
  return unique(ranked.flatMap(([e]) => e.uniprotIds.slice().sort((a, b) => FUSION_PARTNERS.has(a) - FUSION_PARTNERS.has(b)))).slice(0, limit);
}

/** { accession, name, gene, text } from a UniProt entry; `text` is null when UniProt has no function annotation. */
export function functionFromUniprot(uniprot, accession) {
  const text = (uniprot?.comments ?? []).filter((c) => c.commentType === 'FUNCTION').flatMap((c) => c.texts ?? []).map((t) => t.value).join(' ')
    .replace(/\s*\((?:PubMed|By similarity|Ref\.|ECO)[^)]*\)/g, '').trim();
  return {
    accession, name: uniprot?.proteinDescription?.recommendedName?.fullName?.value ?? accession,
    gene: uniprot?.genes?.[0]?.geneName?.value ?? null, text: text || null,
  };
}

export const uniprotUrl = (accession) => `https://rest.uniprot.org/uniprotkb/${accession}.json?fields=cc_function,protein_name,gene_names`;

/** Reads the introduction. A failing UniProt lookup is reported in `warnings`; the RCSB part is still returned. */
export async function loadIntroduction(entryId, { fetchJson, sizeOf, signal } = {}) {
  const query = introductionQuery(entryId);
  const intro = introductionFromRcsb(await fetchJson(RCSB_GRAPHQL_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal,
  }), entryId);
  const warnings = [];
  const accessions = functionAccessions(intro, { sizeOf });
  const read = await Promise.all(accessions.map(async (accession) => {
    try { return functionFromUniprot(await fetchJson(uniprotUrl(accession), { signal }), accession); }
    catch (error) {
      if (signal?.aborted) throw error;
      warnings.push(`无法读取 UniProt ${accession} 的功能注释：${error.message}`);
      return null;
    }
  }));
  intro.functions = read.filter(Boolean);
  return { intro, warnings };
}

/** Text of the introduction as plain lines (title, source, what is unavailable): for the API and for tests. */
export function describeIntroduction(intro) {
  const lines = [readableTitle(intro.title) || `${intro.id}（RCSB 没有标题）`];
  lines.push([intro.id, intro.methods.join(' / ') || '实验方法不可用', intro.resolution != null ? `${intro.resolution.toFixed(1)} Å` : '分辨率不可用'].join(' · '));
  lines.push(`来源物种：${intro.organisms.join('、') || '不可用'}（RCSB PDB）`);
  const mutated = intro.entities.filter((e) => e.substitutions);
  if (mutated.length) lines.push(`替换/突变：${mutated.map((e) => `${e.description ?? `实体 ${e.entityId}`}：${e.substitutions}`).join('；')}（RCSB PDB）`);
  lines.push(intro.citation ? `文献：${intro.citation.title} ${intro.citation.journal ?? ''} ${intro.citation.year ?? ''}`.trim() : '文献：不可用');
  return lines;
}

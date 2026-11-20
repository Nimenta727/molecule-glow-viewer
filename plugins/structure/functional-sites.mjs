/**
 * UniProt functional sites for a PDB entry (classic: the "UniProt 注释" button of src/ui/sequence-bar.js).
 * RCSB's sequence alignment says which UniProt entry each entity is, and how its residues map; UniProt says where the sites are. The two are
 * joined here so a site comes out in the structure's label_seq numbering, always carrying the UniProt accession it came from.
 * Network access is injected (`fetchJson`) so the logic is testable offline; nothing here touches the page.
 */
export const SITE_CATEGORIES = Object.freeze({
  'Active site': { label: '活性位点', color: '#d0342c' },
  'Binding site': { label: '结合位点', color: '#2a6fdb' },
  Site: { label: '重要位点', color: '#8a3fd1' },
  Transmembrane: { label: '跨膜段', color: '#2e9d57' },
  Intramembrane: { label: '膜内片段', color: '#5bbf7d' },
  Motif: { label: '基序', color: '#c77d00' },
  'Disulfide bond': { label: '二硫键', color: '#b58900' },
});

const ENTRY_ID = /^[0-9][A-Za-z0-9]{3}$/;
const ACCESSION = /^[A-Z0-9]{6,10}$/;
export const UNIPROT_FIELDS = 'ft_act_site,ft_binding,ft_site,ft_transmem,ft_intramem,ft_motif,ft_disulfid';
export const RCSB_GRAPHQL_URL = 'https://data.rcsb.org/graphql';

export class FunctionalSiteError extends Error {
  constructor(message) { super(message); this.name = 'FunctionalSiteError'; }
}

export function alignmentQuery(entryId) {
  if (!ENTRY_ID.test(entryId ?? '')) throw new FunctionalSiteError('只有 PDB 条目才能读取 UniProt 注释');
  return `{ entry(entry_id:"${entryId.toUpperCase()}"){ polymer_entities{ rcsb_polymer_entity_container_identifiers{entity_id asym_ids }
    rcsb_polymer_entity_align{ reference_database_name reference_database_accession aligned_regions{ entity_beg_seq_id ref_beg_seq_id length } } } } }`;
}

/** One alignment per entity (the first UniProt one): { entityId, asyms (label_asym ids), accession, regions }. Entities without one are skipped. */
export function alignmentsFromRcsb(response) {
  const entities = response?.data?.entry?.polymer_entities;
  if (!Array.isArray(entities)) throw new FunctionalSiteError('RCSB 没有返回这个条目的序列比对');
  const result = [];
  for (const entity of entities) {
    const ids = entity?.rcsb_polymer_entity_container_identifiers ?? {};
    const align = (entity?.rcsb_polymer_entity_align ?? []).find((item) => item?.reference_database_name === 'UniProt');
    if (!align || !ACCESSION.test(align.reference_database_accession ?? '')) continue;
    result.push({
      entityId: String(ids.entity_id ?? ''), asyms: (ids.asym_ids ?? []).map(String), accession: align.reference_database_accession,
      regions: (align.aligned_regions ?? []).map((r) => ({ entityStart: +r.entity_beg_seq_id, refStart: +r.ref_beg_seq_id, length: +r.length })),
    });
  }
  return result;
}

/** UniProt position -> structure (entity) sequence position, or null when the structure does not cover it. */
export function mapPosition(regions, position) {
  for (const r of regions) if (position >= r.refStart && position < r.refStart + r.length) return r.entityStart + position - r.refStart;
  return null;
}

/** Sites of one alignment, in label_seq numbering: [{ type, asyms, from, to, to2, text, accession }] (`to2` = the other end of a disulfide bond). */
export function sitesFromUniprot(uniprot, alignment) {
  const sites = [];
  for (const feature of uniprot?.features ?? []) {
    if (!Object.hasOwn(SITE_CATEGORIES, feature.type)) continue;
    const start = feature.location?.start?.value, end = feature.location?.end?.value ?? start;
    const a = mapPosition(alignment.regions, start), b = mapPosition(alignment.regions, end);
    if (a == null || b == null) continue;
    const bond = feature.type === 'Disulfide bond';
    sites.push({
      type: feature.type, asyms: alignment.asyms, from: Math.min(a, b), to: bond ? Math.min(a, b) : Math.max(a, b), to2: bond ? Math.max(a, b) : null,
      text: [feature.description, feature.ligand?.name].filter(Boolean).join(' · '), accession: alignment.accession,
    });
  }
  return sites;
}

/**
 * Reads the sites of a PDB entry. `fetchJson(url, init)` must resolve to parsed JSON. A failing UniProt lookup for one entity is reported in
 * `warnings` and does not hide the others. Returns { sites: { type: [site...] }, accessions, warnings }.
 */
export async function loadFunctionalSites(entryId, { fetchJson, signal } = {}) {
  const query = alignmentQuery(entryId);
  const alignments = alignmentsFromRcsb(await fetchJson(RCSB_GRAPHQL_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal,
  }));
  const sites = {}, warnings = [];
  await Promise.all(alignments.map(async (alignment) => {
    try {
      const uniprot = await fetchJson(`https://rest.uniprot.org/uniprotkb/${alignment.accession}.json?fields=${UNIPROT_FIELDS}`, { signal });
      for (const site of sitesFromUniprot(uniprot, alignment)) (sites[site.type] ??= []).push(site);
    } catch (error) {
      if (signal?.aborted) throw error;
      warnings.push(`无法读取 UniProt ${alignment.accession} 的注释：${error.message}`);
    }
  }));
  return { sites, accessions: [...new Set(alignments.map((a) => a.accession))], warnings };
}

/** A selection-language expression for all sites of one category (label_asym covers every symmetry copy). */
export function siteExpression(sites) {
  if (!sites?.length) return 'none';
  return sites.map((s) => {
    const asym = `label_asym ${s.asyms.join(',')}`;
    return `(${asym} and label_seq ${s.from}-${s.to}${s.to2 != null ? ` or ${asym} and label_seq ${s.to2}` : ''})`;
  }).join(' or ');
}

/** The sites covering one structure residue ({ labelAsym, labelSeq }), as [{ type, site }]. */
export function sitesAtResidue(sites, residue) {
  const found = [];
  for (const [type, list] of Object.entries(sites ?? {})) {
    for (const site of list) {
      if (site.asyms.includes(residue.labelAsym) && ((residue.labelSeq >= site.from && residue.labelSeq <= site.to) || residue.labelSeq === site.to2)) found.push({ type, site });
    }
  }
  return found;
}

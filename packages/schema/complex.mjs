import { Validator } from '@cfworker/json-schema';
import { SchemaValidationError } from './errors.mjs';

/**
 * A complex record says which resources a complex is made of, how many copies of each, and where each copy sits relative to the others, with the evidence for those relations
 * (docs/PLUGIN_ROADMAP.md, A3). It is the data an assembly tool (C1), the interaction evidence layer (D1) and instancing (B1) read; it holds no coordinates itself, only references
 * to immutable resources ({ id, version, sha256 }, as scenes do) and placements.
 *
 * Evidence types are the project's own: experimental (the relation is in a deposited entry's coordinates), derived (computed from experimental data), modelled, illustrative (a layout
 * chosen to show something; never to be read as a measurement). A placement points at the evidence that supports it.
 */
const ID = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' };
const SHA256 = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const VERSION = { type: 'string', pattern: '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$' };
const REF = { type: 'object', additionalProperties: false, required: ['id', 'version', 'sha256'], properties: { id: ID, version: VERSION, sha256: SHA256 } };
const VEC = (n) => ({ type: 'array', minItems: n, maxItems: n, items: { type: 'number' } });
export const EVIDENCE_TYPES = Object.freeze(['experimental', 'derived', 'modelled', 'illustrative']);
export const MAX_MEMBERS = 256, MAX_COPIES = 100000;

export const COMPLEX_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object', additionalProperties: false,
  required: ['format', 'schemaVersion', 'id', 'version', 'title', 'frame', 'members', 'evidence'],
  properties: {
    format: { const: 'glow-complex' }, schemaVersion: { const: 1 }, id: ID, version: VERSION,
    title: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 1000 },
    frame: { type: 'object', additionalProperties: false, required: ['resource'], properties: { resource: REF, note: { type: 'string', maxLength: 300 } } },
    members: { type: 'array', minItems: 1, maxItems: MAX_MEMBERS, items: {
      type: 'object', additionalProperties: false, required: ['id', 'name', 'resource', 'copies', 'placements'],
      properties: {
        id: ID, name: { type: 'string', minLength: 1, maxLength: 200 },
        resource: REF,   // the resource the member's coordinates come from
        copies: { type: 'integer', minimum: 1, maximum: MAX_COPIES },
        placements: { type: 'array', minItems: 1, items: {
          type: 'object', additionalProperties: false, required: ['chains', 'transform', 'evidence'],
          properties: { transform: { type: 'object', additionalProperties: false, required: ['position', 'rotation', 'scale'], properties: { position: VEC(3), rotation: VEC(4), scale: VEC(3) } },
            evidence: { type: 'integer', minimum: 0 },
            chains: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 16 } } },   // mmCIF label_asym_id of the chains of the resource this copy is made of
        } },
      },
    } },
    evidence: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['type', 'citation'],
      properties: { type: { enum: [...EVIDENCE_TYPES] }, citation: { type: 'string', minLength: 1, maxLength: 500 }, resource: REF } } },
  },
};
const validator = new Validator(COMPLEX_SCHEMA, '2020-12', false);

const refKey = ({ id, version }) => `${id}@${version}`;

/** Schema plus the rules a schema cannot say: unique ids, one placement per copy, evidence indices in range, unit rotations, positive scales. Returns a copy. */
export function validateComplex(input) {
  const record = structuredClone(input), result = validator.validate(record);
  if (!result.valid) throw new SchemaValidationError('Complex', result.errors);
  const fail = (message) => { throw new SchemaValidationError(`Complex ${record.id}: ${message}`); };
  const ids = new Set();
  for (const member of record.members) {
    if (ids.has(member.id)) fail(`duplicate member id ${member.id}`);
    ids.add(member.id);
    if (member.placements.length !== member.copies) fail(`member ${member.id} has ${member.copies} copies but ${member.placements.length} placements`);
    for (const [i, placement] of member.placements.entries()) {
      if (placement.evidence >= record.evidence.length) fail(`member ${member.id} placement ${i} points at evidence ${placement.evidence}, which does not exist`);
      const { rotation, scale } = placement.transform, length = Math.hypot(...rotation);
      if (Math.abs(length - 1) > 1e-6) fail(`member ${member.id} placement ${i}: the rotation is not a unit quaternion`);
      if (scale.some((s) => !(s > 0))) fail(`member ${member.id} placement ${i}: the scale must be positive`);
      if (new Set(placement.chains).size !== placement.chains.length) fail(`member ${member.id} placement ${i}: a chain is listed twice`);
    }
  }
  return record;
}

/** How many copies of each member: { name -> copies }, summed over members that share a name. */
export function stoichiometry(complex) {
  const out = new Map();
  for (const { name, copies } of complex.members) out.set(name, (out.get(name) ?? 0) + copies);
  return out;
}

/** True when the transform is the identity (the relation is the entry's own coordinates, nothing was moved). */
export const isIdentity = ({ position, rotation, scale }) => position.every((v) => v === 0) && rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0 && rotation[3] === 1 && scale.every((v) => v === 1);

/**
 * The expansion a front end draws: one instance per copy, { memberId, name, resource, chains, copy, transform, evidence: { index, type, citation } }. `resources` is a Map of "id@version" -> sha256
 * the application holds (or anything with `.get`); members whose resource is not there are reported, not dropped silently.
 * Returns { instances, missing: [{ memberId, resource }], mismatched: [{ memberId, resource, expected, held }] }.
 */
export function resolveComplex(complex, resources) {
  const instances = [], missing = [], mismatched = [], seen = new Set();
  for (const member of complex.members) {
    const key = refKey(member.resource), held = resources.get(key);
    if (held === undefined) { if (!seen.has(`m${member.id}`)) { seen.add(`m${member.id}`); missing.push({ memberId: member.id, resource: key }); } continue; }
    if (held !== member.resource.sha256) { mismatched.push({ memberId: member.id, resource: key, expected: member.resource.sha256, held }); continue; }
    for (const [index, placement] of member.placements.entries()) {
      const evidence = complex.evidence[placement.evidence];
      instances.push({ memberId: member.id, name: member.name, resource: member.resource, chains: placement.chains, copy: index, transform: placement.transform,
        evidence: { index: placement.evidence, type: evidence.type, citation: evidence.citation } });
    }
  }
  return { instances, missing, mismatched };
}

/** Readable findings for the author: [{ level: 'error'|'warning'|'info', code, message }]. */
export function diagnoseComplex(complex, resources) {
  const out = [], { missing, mismatched } = resolveComplex(complex, resources);
  for (const { memberId, resource } of missing) out.push({ level: 'error', code: 'resource-missing', message: `成员 ${memberId} 需要资源 ${resource}，这里没有。` });
  for (const { memberId, resource } of mismatched) out.push({ level: 'error', code: 'resource-hash', message: `成员 ${memberId} 的资源 ${resource} 与记录的哈希不符，已拒绝使用。` });
  const frameHeld = resources.get(refKey(complex.frame.resource));
  if (frameHeld === undefined) out.push({ level: 'warning', code: 'frame-missing', message: `参照坐标系的资源 ${refKey(complex.frame.resource)} 不在这里：无法核对各成员的相对位置。` });
  const types = new Set(complex.evidence.map(({ type }) => type));
  if (types.has('illustrative')) out.push({ level: 'info', code: 'illustrative', message: '其中有示意性的摆放：它们只用来说明，不是测量结果。' });
  if (!types.has('experimental') && !types.has('derived')) out.push({ level: 'warning', code: 'no-measured-evidence', message: '没有任何实验或推导的证据支撑这些相对位置。' });
  return out;
}

const IDENTITY = () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'member';

/**
 * A complex taken straight from one real structure: the chains of the entry are grouped by the name the entry gives them (its entity description, so eight "subunit C1" chains
 * become one member with eight copies), every copy keeps the entry's own coordinates (identity transform), and the evidence is the entry itself. This is the experimental case of
 * the record; assemblies built from several entries are made by the assembly tool, which adds placements with their own evidence.
 *   model       a parsed structure: { atoms, chainNames } (the structure plugin's parser)
 *   resource    { id, version, sha256 } of the structure resource
 *   skip(name)  names to leave out (default: water)
 */
export function complexFromStructure({ model, resource, id, title, citation, skip = (name) => /^(water|hoh)$/i.test(name) }) {
  const order = [], byName = new Map();
  for (const atom of model.atoms) {
    const chain = atom.labelChainId;
    if (!chain || order.includes(chain)) continue;
    order.push(chain);
  }
  for (const chain of order) {
    const name = model.chainNames?.[chain] ?? `chain ${chain}`;
    if (skip(name)) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(chain);
  }
  const used = new Set(), members = [];
  for (const [name, chains] of byName) {
    let memberId = slugOf(name), n = 1;
    while (used.has(memberId)) memberId = `${slugOf(name)}-${++n}`;
    used.add(memberId);
    members.push({ id: memberId, name, resource, copies: chains.length, placements: chains.map((chain) => ({ chains: [chain], transform: IDENTITY(), evidence: 0 })) });
  }
  if (!members.length) throw new Error('这个结构里没有可以登记为成员的链。');
  return validateComplex({ format: 'glow-complex', schemaVersion: 1, id, version: resource.version, title,
    frame: { resource, note: '各成员的相对位置就是该条目自己的坐标。' }, members,
    evidence: [{ type: 'experimental', citation: citation ?? `沉积坐标 ${resource.id}`, resource }] });
}

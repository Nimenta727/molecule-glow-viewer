import { Validator } from '@cfworker/json-schema';
import { SchemaValidationError } from './documents.mjs';

/**
 * Resources are immutable raw material (structures, ligands, sequences) with identity, source and licence.
 * See docs/CONTRACT_4.3.0.md §2. Scene documents will reference them by { id, version, sha256 }.
 */
const ID = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' };
const SHA256 = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const SEMVERISH = { type: 'string', pattern: '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$' };
const STRING_MAP = { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } };

export const RESOURCE_KINDS = Object.freeze(['structure', 'ligand', 'sequence', 'map', 'image']);

export const RESOURCE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object', additionalProperties: false,
  required: ['format', 'schemaVersion', 'id', 'version', 'kind', 'files', 'source', 'attribution'],
  properties: {
    format: { const: 'glow-resource' }, schemaVersion: { const: 1 }, id: ID, version: SEMVERISH,
    kind: { enum: [...RESOURCE_KINDS] },
    files: { type: 'array', minItems: 1, items: {
      type: 'object', additionalProperties: false, required: ['path', 'sha256', 'mediaType', 'bytes'],
      properties: { path: { type: 'string', minLength: 1 }, sha256: SHA256, mediaType: { type: 'string', minLength: 1 },
        bytes: { type: 'integer', minimum: 0 } },
    } },
    source: { type: 'object', additionalProperties: false, required: ['provider', 'accession'],
      properties: { provider: { type: 'string', minLength: 1 }, accession: { type: 'string', minLength: 1 },
        retrievedAt: { type: 'string' }, assemblyId: { type: 'string' }, url: { type: 'string' } } },
    attribution: { type: 'object', additionalProperties: false, required: ['license'],
      properties: { license: { type: 'string', minLength: 1 }, credit: { type: 'string' }, url: { type: 'string' },
        embedAllowed: { type: 'boolean' } } },
    card: STRING_MAP,
  },
};

const validator = new Validator(RESOURCE_SCHEMA, '2020-12', false);

export async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateResource(input) {
  const record = structuredClone(input);
  const result = validator.validate(record);
  if (!result.valid) throw new SchemaValidationError('Resource', result.errors);
  const paths = new Set();
  for (const { path } of record.files) {
    if (paths.has(path)) throw new SchemaValidationError(`Resource ${record.id}: duplicate file path ${path}`);
    paths.add(path);
  }
  return record;
}

export class ResourceError extends Error {
  constructor(code, message) { super(message); this.name = 'ResourceError'; this.code = code; }
}

/**
 * In-memory resource store. Bytes are kept once per sha256 (several resources or versions may share a file) and are
 * verified on the way in and on the way out. A record is never replaced: a changed resource needs a new version.
 */
export function createResourceStore() {
  const records = new Map();   // "id@version" -> frozen record
  const blobs = new Map();     // sha256 -> Uint8Array
  const key = (id, version) => `${id}@${version}`;

  async function add(input, files) {
    const record = validateResource(input);
    const k = key(record.id, record.version);
    if (records.has(k)) throw new ResourceError('res-exists', `Resource ${k} already exists; publish a new version instead.`);
    const staged = new Map();
    for (const file of record.files) {
      const data = files.get(file.path);
      if (!(data instanceof Uint8Array)) throw new ResourceError('res-missing', `Resource ${k}: bytes missing for ${file.path}.`);
      if (data.byteLength !== file.bytes || await sha256Hex(data) !== file.sha256) {
        throw new ResourceError('res-hash-mismatch', `Resource ${k}: ${file.path} does not match its recorded sha256.`);
      }
      staged.set(file.sha256, data);
    }
    for (const [hash, data] of staged) if (!blobs.has(hash)) blobs.set(hash, data.slice());   // commit only after every file passed
    records.set(k, Object.freeze(record));
    return record;
  }

  /** Resolve a scene reference { id, version, sha256 } to its record and a verified copy of the bytes. */
  async function resolve(ref) {
    const record = records.get(key(ref.id, ref.version));
    if (!record) throw new ResourceError('res-missing', `Resource ${key(ref.id, ref.version)} is not in the store.`);
    const files = new Map();
    for (const file of record.files) {
      const data = blobs.get(file.sha256);
      if (!data) throw new ResourceError('res-missing', `Resource ${key(ref.id, ref.version)}: bytes for ${file.path} were lost.`);
      if (await sha256Hex(data) !== file.sha256) throw new ResourceError('res-hash-mismatch', `Resource ${key(ref.id, ref.version)}: ${file.path} is corrupted.`);
      files.set(file.path, data.slice());   // callers get copies, so instances cannot overwrite the original
    }
    if (ref.sha256 && !record.files.some((file) => file.sha256 === ref.sha256)) {
      throw new ResourceError('res-hash-mismatch', `Reference to ${key(ref.id, ref.version)} expects sha256 ${ref.sha256}, which is not part of that version.`);
    }
    return { record, files };
  }

  return Object.freeze({
    add, resolve,
    has: (id, version) => records.has(key(id, version)),
    list: () => [...records.values()],
    get blobCount() { return blobs.size; },
  });
}

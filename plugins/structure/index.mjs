import { parseMmcif, parsePdb } from './parser.mjs';
import { buildRepresentations, PRESENTATION_METERS_PER_ANGSTROM, selectStructure } from './representation.mjs';
import { encodeGeometry, GEOMETRY_MEDIA_TYPE } from '../../packages/schema/geometry.mjs';

export const STRUCTURE_PLUGIN_ID = 'org.glow.structure';
export const STRUCTURE_IMPORTER_ID = 'org.glow.structure.coordinates';
export const STRUCTURE_SERVICE_ID = 'org.glow.structure.model';
const VERSION = '1.0.0';
const MAX_INPUT = 30 * 1024 * 1024;

export const structurePlugin = {
  manifest: {
    id: STRUCTURE_PLUGIN_ID, version: VERSION, apiVersion: 1,
    dependencies: [], capabilities: ['importers', 'representations', 'services'],
  },
  activate(context) {
    context.registerImporter(STRUCTURE_IMPORTER_ID, { importScene: importStructureScene });
    context.registerRepresentation('org.glow.structure.preview', { build: buildRepresentations });
    context.registerService(STRUCTURE_SERVICE_ID, VERSION, { parse: parseCoordinates, select: selectStructure });
  },
};

async function hash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function parseCoordinates({ bytes, name, mediaType }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_INPUT) throw new TypeError('结构文件超过 30 MiB 或格式无效。');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return mediaType === 'chemical/x-mmcif' || /\.m?cif$/i.test(name) ? parseMmcif(text) : parsePdb(text);
}

function createNode(id, name, assetId, extensions) {
  return {
    id, name, assetId, parentId: null, visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    extensions,
  };
}

export async function importStructureScene(input, { signal } = {}) {
  signal?.throwIfAborted();
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > MAX_INPUT) {
    throw new TypeError('结构文件超过 30 MiB 或格式无效。');
  }
  const bytes = new Uint8Array(input.bytes);
  const model = parseCoordinates({ ...input, bytes });
  const extension = model.format === 'mmcif' ? 'cif' : 'pdb';
  const path = `assets/source.${extension}`;
  const source = input.source ?? { provider: 'local', accession: input.name };
  const rawAsset = {
    id: 'source', kind: 'file', path, sha256: await hash(bytes),
    mediaType: extension === 'cif' ? 'chemical/x-mmcif' : 'chemical/x-pdb',
    provenance: { source },
  };
  const resources = new Map([[path, bytes]]);
  const assets = [rawAsset];
  const nodes = [];
  const representations = buildRepresentations(model, { style: 'cartoon' });
  if (!representations.length) throw new Error('结构文件没有可生成预览的坐标。');
  if (representations.length > 253) throw new Error('结构预览超过单包支持的分组数量。');

  for (const [index, representation] of representations.entries()) {
    signal?.throwIfAborted();
    const id = `preview-${index + 1}`;
    const previewPath = `assets/${id}.json`;
    const preview = encodeGeometry(representation.layers);
    assets.push({
      id, kind: 'file', path: previewPath, sha256: await hash(preview), mediaType: GEOMETRY_MEDIA_TYPE,
      provenance: {
        sourceAssetId: rawAsset.id, style: 'cartoon',
        presentationMetersPerAngstrom: PRESENTATION_METERS_PER_ANGSTROM,
      },
    });
    resources.set(previewPath, preview);
    nodes.push(createNode(id, representation.label, id, {
      [STRUCTURE_PLUGIN_ID]: { chainId: representation.chainId, sourceAssetId: rawAsset.id },
    }));
  }
  signal?.throwIfAborted();
  const id = input.name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 70);
  return {
    model,
    scene: {
      format: 'glow-scene', schemaVersion: 2, id: id || 'structure', title: input.name,
      units: { length: 'meter', time: 'second' }, assets, nodes, timeline: { duration: 0, tracks: [] },
      dependencies: [{ id: STRUCTURE_PLUGIN_ID, version: VERSION, optional: true }],
      evidence: [
        { type: 'source', assetId: rawAsset.id, coordinateUnit: 'angstrom', source },
        { type: 'illustrative', assets: assets.slice(1).map((asset) => asset.id), style: 'cartoon' },
      ],
    },
    resources,
    warnings: [],
  };
}

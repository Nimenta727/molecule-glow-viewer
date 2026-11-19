import { parseMmcif, parsePdb } from './parser.mjs';
import { applyBiologicalAssembly, CoordinateAssemblyError } from './assembly.mjs';
import { buildRepresentations, findLigandContacts, PRESENTATION_METERS_PER_ANGSTROM, selectStructure } from './representation.mjs';
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
    context.registerService(STRUCTURE_SERVICE_ID, VERSION,
      { parse: parseCoordinates, select: selectStructure, contacts: findLigandContacts });
  },
};

async function hash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function filterChains(model, chains) {
  if (!Array.isArray(chains) || !chains.length) return model;
  return { ...model, atoms: model.atoms.filter((atom) => chains.includes(atom.labelChainId || atom.authChainId)) };
}

function parseCoordinates({ bytes, name, mediaType }, { assemblyId, chains } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_INPUT) throw new TypeError('结构文件超过 30 MiB 或格式无效。');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const model = mediaType === 'chemical/x-mmcif' || /\.m?cif$/i.test(name) ? parseMmcif(text) : parsePdb(text);
  return filterChains(assemblyId ? applyBiologicalAssembly(model, assemblyId) : model, chains);
}

function createNode(id, name, assetId, extensions) {
  return {
    id, name, assetId, parentId: null, visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    extensions,
  };
}

export async function importStructureScene(input, { signal, previewGroupLimit = 253, chains, includeLayout = false, assembly = false } = {}) {
  signal?.throwIfAborted();
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > MAX_INPUT) {
    throw new TypeError('结构文件超过 30 MiB 或格式无效。');
  }
  const bytes = new Uint8Array(input.bytes);
  const original = parseCoordinates({ ...input, bytes });
  let model = original, assemblyDiagnostic;
  if (assembly) {
    try { model = applyBiologicalAssembly(original, assembly); }
    catch (error) {
      if (!(error instanceof CoordinateAssemblyError) || assembly !== true) throw error;
      assemblyDiagnostic = `${error.message} 显示原始坐标。`;
    }
  }
  model = filterChains(model, chains);
  const extension = model.format === 'mmcif' ? 'cif' : 'pdb';
  const path = `assets/source.${extension}`;
  const source = input.source ?? { provider: 'local', accession: input.name };
  const rawAsset = {
    id: 'source', kind: 'file', path, sha256: await hash(bytes),
    mediaType: extension === 'cif' ? 'chemical/x-mmcif' : 'chemical/x-pdb',
    provenance: {
      source, parserVersion: VERSION,
      ...(model.assemblyId ? { assemblyId: model.assemblyId } : {}),
      ...(assemblyDiagnostic ? { assemblyDiagnostic } : {}),
      ...(Array.isArray(chains) && chains.length ? { chains: chains.slice() } : {}),
    },
  };
  const resources = new Map([[path, bytes]]);
  const assets = [rawAsset];
  const nodes = [];
  const representations = buildRepresentations(model, { style: 'cartoon' });
  if (!representations.length) throw new Error('结构文件没有可生成预览的坐标。');
  const partName = ({ labelChainId, label }) => Object.hasOwn(model.chainNames ?? {}, labelChainId)
    ? model.chainNames[labelChainId] : label;
  const layout = includeLayout ? representations.map((group) => {
    const marker = group.pointTargets.findIndex((targets) => targets?.[0]?.kind === 'residue');
    const index = marker >= 0 ? marker : group.layers.findIndex(({ mode }) => mode === 'points');
    const positions = group.layers[index]?.positions ?? [];
    const points = [];
    const step = 3 * Math.max(1, Math.ceil(positions.length / 768));
    for (let i = 0; i < positions.length; i += step) points.push(positions.slice(i, i + 3));
    return { name: partName(group), points, polymer: marker >= 0 };
  }) : undefined;
  const maxPreviewGroups = Math.min(253, previewGroupLimit);
  const omittedGroups = Math.max(0, representations.length - maxPreviewGroups);
  if (omittedGroups) {
    const size = ({ layers }) => layers.reduce((total, { positions }) => total + positions.length, 0);
    representations.sort((a, b) => size(b) - size(a));
    rawAsset.provenance.omittedPreviewGroups = omittedGroups;
  }

  for (const [index, representation] of representations.slice(0, maxPreviewGroups).entries()) {
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
      [STRUCTURE_PLUGIN_ID]: {
        chainId: representation.chainId, chainKey: representation.key, sourceAssetId: rawAsset.id,
        partName: partName(representation), ...(model.assemblyId ? { assemblyId: model.assemblyId } : {}),
      },
    }));
  }
  signal?.throwIfAborted();
  const id = input.name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 70);
  return {
    model,
    ...(layout ? { layout } : {}),
    scene: {
      format: 'glow-scene', schemaVersion: 2, id: id || 'structure', title: input.name,
      units: { length: 'meter', time: 'second' }, assets, nodes, timeline: { duration: 0, tracks: [] },
      dependencies: [{ id: STRUCTURE_PLUGIN_ID, version: VERSION, optional: true }],
      evidence: [
        { type: 'source', assetId: rawAsset.id, coordinateUnit: 'angstrom', source },
        { type: 'illustrative', assets: assets.slice(1).map((asset) => asset.id), style: 'cartoon' },
        ...(model.assemblyId ? [{
          type: 'derived', assetId: rawAsset.id,
          citation: `${model.format === 'pdb' ? 'PDB REMARK 350' : 'mmCIF'} 生物组装体 ${model.assemblyId} 的沉积坐标变换`,
        }] : []),
      ],
    },
    resources,
    warnings: [],
  };
}

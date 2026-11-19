const MAX_COPIES = 256;
const MAX_ATOMS = 600_000;

export class CoordinateAssemblyError extends Error {}

function alternatives(group) {
  const result = [];
  for (const item of group.split(',')) {
    const range = /^(\d+)-(\d+)$/.exec(item);
    if (!range) {
      if (!/^[A-Za-z0-9_.]+$/.test(item)) throw new CoordinateAssemblyError('无效的生物组装体操作符。');
      result.push(item);
      continue;
    }
    const start = Number(range[1]), end = Number(range[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start >= MAX_COPIES) {
      throw new CoordinateAssemblyError('生物组装体操作符范围无效或过大。');
    }
    for (let value = start; value <= end; value++) result.push(String(value));
  }
  return [...new Set(result)];
}

export function expandAssemblyExpression(expression) {
  const value = expression.replace(/\s+/g, '');
  const groups = value.startsWith('(') ? [...value.matchAll(/\(([^()]+)\)/g)] : [];
  if (value.includes('(') && groups.map((match) => match[0]).join('') !== value) {
    throw new CoordinateAssemblyError('无效的生物组装体操作表达式。');
  }
  let products = [[]];
  for (const group of groups.length ? groups.map((match) => match[1]) : [value]) {
    const operators = alternatives(group);
    if (products.length * operators.length > MAX_COPIES) throw new CoordinateAssemblyError('生物组装体副本过多。');
    products = products.flatMap((product) => operators.map((id) => [...product, id]));
  }
  return products;
}

export function applyBiologicalAssembly(model, requested = true) {
  const assembly = requested === true
    ? model.assemblies?.find(({ id }) => id === '1') ?? model.assemblies?.[0]
    : model.assemblies?.find(({ id }) => id === requested);
  if (!assembly) throw new CoordinateAssemblyError('坐标文件中没有所选的生物组装体。');

  const byChain = new Map();
  const labels = new Set(model.atoms.map(({ labelChainId }) => labelChainId));
  const operators = new Map((model.assemblyOperators ?? []).map(({ id, rows }) => [id, rows]));
  for (const generator of assembly.generators) {
    for (const product of expandAssemblyExpression(generator.expression)) {
      const matrices = product.map((id) => operators.get(id));
      if (!matrices.every(Boolean)) throw new CoordinateAssemblyError('组装体引用了缺失或无效的坐标变换。');
      const copy = product.join(' × ');
      for (const chain of generator.chains) {
        if (!labels.has(chain)) continue;
        if (!byChain.has(chain)) byChain.set(chain, new Map());
        const copies = byChain.get(chain);
        copies.set(copy, matrices);
        if (copies.size > MAX_COPIES) throw new CoordinateAssemblyError('生物组装体副本过多。');
      }
    }
  }
  const modelId = model.atoms[0].modelId;
  let count = 0;
  for (const atom of model.atoms) {
    if (atom.modelId === modelId) count += byChain.get(atom.labelChainId)?.size ?? 0;
    if (count > MAX_ATOMS) throw new CoordinateAssemblyError('展开后的生物组装体超过坐标预览上限。');
  }
  if (!count) throw new CoordinateAssemblyError('生物组装体未匹配到可用的标签链坐标。');
  const atoms = [];
  for (const atom of model.atoms) {
    if (atom.modelId !== modelId) continue;
    for (const [assemblyCopy, matrices] of byChain.get(atom.labelChainId) ?? []) {
      let position = atom.position;
      // PDBx products apply the rightmost operation first.
      for (let i = matrices.length - 1; i >= 0; i--) {
        const [x, y, z] = position;
        position = matrices[i].map(([a, b, c, t]) => a * x + b * y + c * z + t);
      }
      if (!position.every(Number.isFinite)) throw new CoordinateAssemblyError('组装体变换产生了无效坐标。');
      atoms.push({ ...atom, position, assemblyCopy });
    }
  }
  return { ...model, atoms, assemblyId: assembly.id };
}

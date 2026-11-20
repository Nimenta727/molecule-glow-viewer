import { normalizeSpec } from './tool-descriptor.mjs';

/**
 * Pure helpers over tool descriptors: the controls a front end should show, value validation, and validated edits of a
 * tool's authoring configuration. No DOM here, so Viewer, Studio and tests share it.
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Runtime parameters shown to `audience`, in declaration order, as { key, ...spec }. */
export function toolControls(descriptor, audience) {
  if (!descriptor?.audience?.includes(audience)) return [];
  return Object.entries(descriptor.parameters ?? {}).filter(([, spec]) => spec.audience.includes(audience)).map(([key, spec]) => ({ key, ...spec }));
}

export const defaultValues = (descriptor, audience) => Object.fromEntries(toolControls(descriptor, audience).map(({ key, default: value }) => [key, value]));

function checkValue(spec, value) {
  if (spec.type === 'number') return Number.isFinite(value) && value >= spec.min && value <= spec.max && (!spec.integer || Number.isInteger(value));
  if (spec.type === 'boolean') return typeof value === 'boolean';
  if (spec.type === 'select') return spec.options.some((option) => option.value === value);
  if (spec.type === 'color') return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  return typeof value === 'string' && value.length <= (spec.maxLength ?? 5000);
}

/** Validates a partial set of runtime values; unknown keys and out-of-range values are refused. Returns a copy. */
export function validateToolValues(descriptor, values, audience) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`${descriptor.title} 参数需要对象。`);
  const allowed = new Map(toolControls(descriptor, audience).map((control) => [control.key, control]));
  for (const [key, value] of Object.entries(values)) {
    const spec = allowed.get(key);
    if (!spec || !checkValue(spec, value)) throw new Error(`${descriptor.title} 参数 ${key} 无效。`);
  }
  return { ...values };
}

const segments = (path) => {
  const parts = String(path).split('.');
  if (!parts.length || parts.some((part) => !part || FORBIDDEN.has(part))) throw new TypeError(`Invalid config path "${path}"`);
  return parts;
};
export function getPath(object, path) {
  let value = object;
  for (const part of segments(path)) { if (value == null || typeof value !== 'object') return undefined; value = value[part]; }
  return value;
}
/** Returns a copy of `object` with `path` set; arrays are addressed by index. Missing intermediate objects are created. */
export function setPath(object, path, value) {
  const parts = segments(path), root = structuredClone(object);
  let target = root;
  parts.slice(0, -1).forEach((part, i) => {
    if (target[part] == null || typeof target[part] !== 'object') target[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    target = target[part];
  });
  target[parts.at(-1)] = value;
  return root;
}

/** The author fields for this configuration, validated; each is { path, ...spec } and is meant for an input element. */
export function authorFields(descriptor, config) {
  if (!descriptor?.author || !descriptor.audience.includes('author')) return [];
  return descriptor.author.fields(config).map((field) => ({ path: segments(field.path).join('.'), ...normalizeSpec(descriptor.title, field.path, field, { withDefault: false }),
    ...(field.default !== undefined ? { default: field.default } : {}) }));
}

/** Converts what an input element yields into the field's value type. `nullable` numbers accept an empty entry as null. */
export function coerceField(field, raw) {
  if (field.type === 'number') {
    if (field.nullable && (raw === '' || raw === null || raw === 'null')) return null;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (raw === '' || !Number.isFinite(value)) throw new Error(`${field.label}：请输入数字。`);
    if (field.integer && !Number.isInteger(value)) throw new Error(`${field.label}：需要整数。`);
    if (value < field.min || value > field.max) throw new Error(`${field.label}：应在 ${field.min}–${field.max} 之间。`);
    return value;
  }
  if (field.type === 'boolean') return raw === true || raw === 'true';
  if (field.type === 'select' && !field.options.some((option) => option.value === raw)) throw new Error(`${field.label}：不是可选项。`);
  if (field.type === 'color' && !/^#[0-9a-fA-F]{6}$/.test(String(raw))) throw new Error(`${field.label}：需要 #rrggbb 颜色。`);
  if (field.type === 'text' && (typeof raw !== 'string' || !raw.length)) throw new Error(`${field.label}：不能为空。`);
  if (field.type === 'text' && raw.length > (field.maxLength ?? 5000)) throw new Error(`${field.label}：太长。`);
  return raw;
}

/**
 * One validated edit of a tool's configuration: sets the field, then lets the tool's own validator accept or refuse the
 * whole result. Throws with a readable message and leaves the given config untouched.
 */
export function editAuthorField(descriptor, config, path, raw) {
  const field = authorFields(descriptor, config).find((item) => item.path === path);
  if (!field) throw new Error(`${descriptor.title} 没有可编辑的配置项 ${path}。`);
  const next = setPath(config, path, coerceField(field, raw));
  return JSON.parse(JSON.stringify(descriptor.author.validate(next)));
}

// ---- applicability and role bindings -----------------------------------------------------------------------------

/** The roles a tool works on, as [{ role, label, min, max }]. */
export const toolRoles = (descriptor) => Object.entries(descriptor?.inputs?.roles ?? {}).map(([role, spec]) => ({ role, ...spec }));

/**
 * Does this tool fit this scene, and which objects does it work on? The tool's own `check` proposes candidates and reports
 * problems; the entry's saved bindings win over the proposal. Counts are checked against each role's min/max.
 * Returns { applicable, problems, candidates, bindings, unbound } — `bindings` is what the tool will use.
 */
export function checkApplicability(descriptor, scene, entry) {
  const roles = toolRoles(descriptor);
  if (!roles.length) return { applicable: true, problems: [], candidates: {}, bindings: {}, unbound: [] };
  const sceneNodes = new Set(scene.nodes.map(({ id }) => id));
  const proposal = descriptor.inputs.check(scene, entry.config ?? {});
  const problems = [...(proposal.problems ?? [])], candidates = proposal.candidates ?? {}, bindings = {}, unbound = [];
  for (const { role, label, min, max } of roles) {
    const saved = entry.bindings?.[role];
    let ids = saved ?? candidates[role] ?? [];
    const missing = ids.filter((id) => !sceneNodes.has(id));
    if (missing.length) { problems.push(`${label}：绑定的对象已不在场景中（${missing.length} 个）。`); ids = ids.filter((id) => sceneNodes.has(id)); }
    if (ids.length < min) { problems.push(`${label}：需要至少 ${min} 个对象，当前 ${ids.length} 个。`); unbound.push(role); }
    else if (max !== null && ids.length > max) problems.push(`${label}：最多 ${max} 个对象，当前 ${ids.length} 个。`);
    bindings[role] = ids;
  }
  return { applicable: problems.length === 0, problems, candidates, bindings, unbound };
}

/** The bindings the tool proposes for this scene, limited to each role's maximum; roles with no candidates are left out. */
export function autoBindings(descriptor, scene, entry) {
  const { candidates } = checkApplicability(descriptor, scene, { ...entry, bindings: undefined });
  const result = {};
  for (const { role, max } of toolRoles(descriptor)) {
    const ids = (candidates[role] ?? []).slice(0, max ?? undefined);
    if (ids.length) result[role] = ids;
  }
  return result;
}

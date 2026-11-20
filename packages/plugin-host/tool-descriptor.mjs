/**
 * Tool descriptors (docs/CONTRACT_4.3.0.md §3, §10). A trusted plugin registers one per tool with
 * `context.registerTool(id, descriptor)`. The descriptor is data plus two plugin-owned functions for authoring
 * (`author.fields`, `author.validate`); front ends build their controls from it instead of knowing the tool.
 *
 *   { version, title, audience: ['view'|'author'...], runtime: 'player-v1' (runs on a clock) | 'layer-v1' (drawn over the structure by the front end),
 *     parameters?: { key: { type, label, default, audience?, ...type details } },   // runtime controls
 *     author?: { template, fields(config) -> field specs, validate(config) -> normalised config },  // edits scene.tools[].config
 *     model?: { kind, assumptions: [text] } }
 */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
export const AUDIENCES = Object.freeze(['view', 'author']);
export const PARAMETER_TYPES = Object.freeze(['number', 'boolean', 'select', 'text', 'color']);
const RUNTIMES = new Set(['player-v1', 'layer-v1']);   // a player runs on a clock; a layer is drawn over the structure by the front end
const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ROLES = 16;

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const fail = (id, message) => { throw new TypeError(`Tool ${id}: ${message}`); };
const text = (id, value, field, max = 200) => {
  if (typeof value !== 'string' || !value.length || value.length > max) fail(id, `${field} must be a text of 1-${max} characters`);
  return value;
};

export function audienceOf(value, id, field, allowed = AUDIENCES) {
  if (!Array.isArray(value) || !value.length || value.some((item) => !allowed.includes(item)) || new Set(value).size !== value.length) {
    fail(id, `${field} must list ${allowed.join(' and/or ')}, once each`);
  }
  return [...value];
}

/** Validates one parameter or field spec and returns a normalised, frozen copy. */
export function normalizeSpec(id, key, spec, { withDefault = true } = {}) {
  if (!isObject(spec)) fail(id, `${key} must be an object`);
  const type = spec.type;
  if (!PARAMETER_TYPES.includes(type)) fail(id, `${key} has an unknown type "${type}"`);
  const out = { type, label: text(id, spec.label, `${key}.label`, 120) };
  if (spec.unit !== undefined) out.unit = text(id, spec.unit, `${key}.unit`, 24);
  if (spec.group !== undefined) out.group = text(id, spec.group, `${key}.group`, 60);
  if (type === 'number') {
    for (const field of ['min', 'max', 'step']) if (!Number.isFinite(spec[field])) fail(id, `${key}.${field} must be a finite number`);
    if (spec.min > spec.max || !(spec.step > 0)) fail(id, `${key} needs min <= max and step > 0`);
    Object.assign(out, { min: spec.min, max: spec.max, step: spec.step });
    if (spec.integer !== undefined) out.integer = Boolean(spec.integer);
    if (spec.control !== undefined) { if (spec.control !== 'range') fail(id, `${key}.control must be "range"`); out.control = 'range'; }
    if (spec.nullable !== undefined) out.nullable = Boolean(spec.nullable);
  }
  if (type === 'select') {
    if (!Array.isArray(spec.options) || !spec.options.length) fail(id, `${key}.options must list the choices`);
    out.options = spec.options.map((option, i) => ({ value: text(id, option?.value, `${key}.options[${i}].value`, 80), label: text(id, option?.label, `${key}.options[${i}].label`, 120) }));
  }
  if (type === 'text' && spec.maxLength !== undefined) {
    if (!Number.isInteger(spec.maxLength) || spec.maxLength < 1 || spec.maxLength > 5000) fail(id, `${key}.maxLength must be 1-5000`);
    out.maxLength = spec.maxLength;
  }
  if (withDefault) {
    const value = spec.default;
    const ok = type === 'number' ? Number.isFinite(value) && value >= spec.min && value <= spec.max && (!out.integer || Number.isInteger(value))
      : type === 'boolean' ? typeof value === 'boolean'
        : type === 'select' ? out.options.some((option) => option.value === value)
          : type === 'color' ? typeof value === 'string' && COLOR.test(value)
            : typeof value === 'string' && value.length <= (out.maxLength ?? 5000);
    if (!ok) fail(id, `${key}.default is not a valid ${type} value`);
    out.default = value;
  }
  return Object.freeze(out);
}

export function validateToolDescriptor(id, descriptor) {
  if (!isObject(descriptor)) fail(id, 'descriptor must be an object');
  if (typeof descriptor.version !== 'string' || !SEMVER.test(descriptor.version)) fail(id, 'version must be an exact x.y.z');
  const audience = audienceOf(descriptor.audience, id, 'audience');
  if (!RUNTIMES.has(descriptor.runtime)) fail(id, `runtime must be one of ${[...RUNTIMES].join(', ')}`);
  const result = { version: descriptor.version, title: text(id, descriptor.title, 'title', 80), audience: Object.freeze(audience), runtime: descriptor.runtime };

  // Other names the tool answers to (earlier ids saved in existing works) and the id its player factory is registered under.
  if (descriptor.aliases !== undefined) {
    if (!Array.isArray(descriptor.aliases) || descriptor.aliases.length > 8 || descriptor.aliases.some((alias) => typeof alias !== 'string' || !TOOL_ID.test(alias)) ||
      new Set(descriptor.aliases).size !== descriptor.aliases.length || descriptor.aliases.includes(id)) fail(id, 'aliases must be at most 8 distinct valid ids other than the tool\'s own');
    result.aliases = Object.freeze([...descriptor.aliases]);
  }
  if (descriptor.player !== undefined) {
    if (typeof descriptor.player !== 'string' || !TOOL_ID.test(descriptor.player)) fail(id, 'player must be a valid id');
    result.player = descriptor.player;
  }

  // Applicability and role bindings: which objects of a scene the tool works on. `check(scene, config)` is the tool's own
  // test and returns { problems: [text], candidates: { role: [nodeId] } }.
  if (descriptor.inputs !== undefined) {
    const { roles, check } = descriptor.inputs ?? {};
    if (!isObject(roles) || !Object.keys(roles).length || Object.keys(roles).length > MAX_ROLES || typeof check !== 'function') fail(id, 'inputs needs 1-16 roles and a check() function');
    const normal = {};
    for (const [role, spec] of Object.entries(roles)) {
      if (!KEY.test(role) || !isObject(spec)) fail(id, `role name "${role}" is not valid`);
      const min = spec.min ?? 1, max = spec.max ?? null;
      if (!Number.isInteger(min) || min < 0 || (max !== null && (!Number.isInteger(max) || max < Math.max(1, min)))) fail(id, `${role} needs integer min >= 0 and max >= min`);
      normal[role] = Object.freeze({ label: text(id, spec.label, `${role}.label`, 120), min, max });
    }
    result.inputs = Object.freeze({ roles: Object.freeze(normal), check });
  }

  if (descriptor.parameters !== undefined) {
    if (!isObject(descriptor.parameters) || Object.keys(descriptor.parameters).length > 64) fail(id, 'parameters must be an object of at most 64 entries');
    const parameters = {};
    for (const [key, spec] of Object.entries(descriptor.parameters)) {
      if (!KEY.test(key)) fail(id, `parameter name "${key}" is not valid`);
      const normal = normalizeSpec(id, key, spec);
      const own = spec.audience === undefined ? audience : audienceOf(spec.audience, id, `${key}.audience`, audience);
      parameters[key] = Object.freeze({ ...normal, audience: Object.freeze([...own]) });
    }
    result.parameters = Object.freeze(parameters);
  }

  if (descriptor.author !== undefined) {
    if (!audience.includes('author')) fail(id, 'an author block needs "author" in audience');
    const { author } = descriptor;
    if (!isObject(author) || !isObject(author.template) || typeof author.validate !== 'function' || typeof author.fields !== 'function') {
      fail(id, 'author needs a template object and fields() and validate() functions');
    }
    result.author = Object.freeze({ template: author.template, fields: author.fields, validate: author.validate });
  }

  if (descriptor.model !== undefined) {
    const { kind, assumptions } = descriptor.model ?? {};
    if (!Array.isArray(assumptions)) fail(id, 'model.assumptions must be a list');
    result.model = Object.freeze({ kind: text(id, kind, 'model.kind', 80), assumptions: Object.freeze(assumptions.map((item, i) => text(id, item, `model.assumptions[${i}]`, 500))) });
  }
  return Object.freeze(result);
}

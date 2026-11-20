/**
 * Small validators shared by the work configurations of the official plugins (see docs/CONTRACT_4.3.0.md §4).
 * Each configuration is plain data: no functions, no code. Errors name the offending field and are prefixed by `label`.
 */
export const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function deepFreeze(value) {
  if (value && typeof value === 'object') for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

export function createValidators(label) {
  const fail = (message) => { throw new TypeError(`${label}：${message}`); };
  const text = (value, field, max = 500) => {
    if (typeof value !== 'string' || !value.length || value.length > max) fail(`${field} 必须是 1–${max} 字符的文本。`);
    return value;
  };
  const list = (value, field, { min = 1, max = 16, item = (entry, name) => text(entry, name, 120) } = {}) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${field} 必须是 ${min}–${max} 项的列表。`);
    return value.map((entry, i) => item(entry, `${field}[${i}]`));
  };
  const color = (value, field) => {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(`${field} 必须是 #rrggbb 颜色。`);
    return value;
  };
  const integer = (value, field, min, max, { nullable = false } = {}) => {
    if (nullable && value === null) return null;
    if (!Number.isInteger(value) || value < min || value > max) fail(`${field} 必须是 ${min}–${max} 的整数${nullable ? '或 null' : ''}。`);
    return value;
  };
  const number = (value, field, min, max) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${field} 必须是 ${min}–${max} 的数。`);
    return value;
  };
  /** Shallow-merge input[name] over base[name]; both must be objects. */
  const section = (input, base, name) => {
    if (input[name] !== undefined && !isObject(input[name])) fail(`${name} 必须是对象。`);
    return { ...base[name], ...(input[name] ?? {}) };
  };
  return { fail, text, list, color, integer, number, section };
}

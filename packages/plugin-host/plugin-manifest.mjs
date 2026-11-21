/**
 * Plugin manifests (the "package" of a plugin, shown in the workshop's plugin zone). A manifest says what a plugin is called, what it is for, what function it adds, how to use it, what it provides
 * (the entry points a user can reach), what it depends on and needs permission for, how far it has been verified, and its limits. It is plain data and carries no code: the code of an official plugin
 * ships with the application and is switched on from an allow-list (the project's security model has no scripts inside packages and no sandbox for third-party code).
 *
 * A plugin must add a function a user can reach: `provides` needs at least one USER ENTRY (a `command` of the Viewer's `glow` API, a `tool-preset` of a registered tool, a `tool` or a `panel`);
 * modules, command-line scripts and documents are listed as well, but they are not entry points.
 */
const ID = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const CATEGORIES = Object.freeze({ resource: '资源与数据', render: '渲染与规模', assembly: '装配与布局', interaction: '相互作用', process: '过程模拟' });
export const VERIFICATION = Object.freeze({
  logic: '只有单元测试（纯逻辑）',
  'real-data': '单元测试 + 真实数据或解析解对照',
  browser: '单元测试 + 真实浏览器检查',
  'real-and-browser': '单元测试 + 真实数据对照 + 真实浏览器检查',
});
export const USER_ENTRY_TYPES = Object.freeze(['command', 'tool-preset', 'tool', 'panel']);
export const PROVIDES_TYPES = Object.freeze([...USER_ENTRY_TYPES, 'module', 'cli']);
export const PERMISSIONS = Object.freeze({ network: '联网（取回外部数据）' });

export class ManifestError extends Error { constructor(message) { super(message); this.name = 'ManifestError'; } }
const fail = (id, message) => { throw new ManifestError(`插件 ${id ?? '（无编号）'}：${message}`); };
const text = (id, value, field, max) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(id, `${field} 需要 1–${max} 个字符的文字。`); return value.trim(); };
const list = (id, value, field, { min = 0, max = 16, item }) => { if (!Array.isArray(value) || value.length < min || value.length > max) fail(id, `${field} 需要 ${min}–${max} 项。`); return value.map((entry, i) => item(entry, `${field}[${i}]`)); };

/** Validates a manifest and returns a clean copy; throws ManifestError naming the plugin and the field. */
export function validatePluginManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ManifestError('插件清单应为对象。');
  const id = raw.id;
  if (raw.format !== 'glow-plugin' || raw.schemaVersion !== 1) fail(id, 'format 应为 glow-plugin，schemaVersion 应为 1。');
  if (typeof id !== 'string' || !ID.test(id) || id.length > 80) fail(id, 'id 应为小写点分名称，如 org.glow.plugin.instancing。');
  if (typeof raw.version !== 'string' || !SEMVER.test(raw.version)) fail(id, 'version 应为 x.y.z。');
  if (!Object.hasOwn(CATEGORIES, raw.category)) fail(id, `category 应为 ${Object.keys(CATEGORIES).join('、')} 之一。`);
  const out = { format: 'glow-plugin', schemaVersion: 1, id, version: raw.version, name: text(id, raw.name, 'name', 40), summary: text(id, raw.summary, 'summary', 140), category: raw.category };
  out.adds = list(id, raw.adds, 'adds', { min: 1, max: 6, item: (v, f) => text(id, v, f, 200) });   // the functions the plugin adds
  out.usage = list(id, raw.usage, 'usage', { min: 1, max: 8, item: (v, f) => ({ title: text(id, v?.title, `${f}.title`, 60), how: text(id, v?.how, `${f}.how`, 600), ...(v?.note ? { note: text(id, v.note, `${f}.note`, 300) } : {}) }) });
  out.provides = list(id, raw.provides, 'provides', { min: 1, max: 24, item: (v, f) => {
    if (!v || !PROVIDES_TYPES.includes(v.type)) fail(id, `${f}.type 应为 ${PROVIDES_TYPES.join('、')} 之一。`);
    if (v.type === 'command') return { type: 'command', name: text(id, v.name, `${f}.name`, 40) };
    if (v.type === 'tool-preset') return { type: 'tool-preset', tool: text(id, v.tool, `${f}.tool`, 120), preset: text(id, v.preset, `${f}.preset`, 40) };
    if (v.type === 'tool' || v.type === 'panel') return { type: v.type, id: text(id, v.id, `${f}.id`, 120) };
    if (v.type === 'module') return { type: 'module', path: text(id, v.path, `${f}.path`, 200), exports: list(id, v.exports ?? [], `${f}.exports`, { max: 24, item: (e, g) => text(id, e, g, 60) }) };
    return { type: 'cli', path: text(id, v.path, `${f}.path`, 200) };
  } });
  if (!out.provides.some(({ type }) => USER_ENTRY_TYPES.includes(type))) fail(id, `没有任何用户能直接用的入口：provides 里至少要有一个 ${USER_ENTRY_TYPES.join(' / ')}（模块和命令行脚本不算）。`);
  out.dependencies = list(id, raw.dependencies ?? [], 'dependencies', { max: 12, item: (v, f) => { if (typeof v?.id !== 'string' || !ID.test(v.id) || typeof v.version !== 'string' || !SEMVER.test(v.version)) fail(id, `${f} 需要 id 和 x.y.z 版本。`); return { id: v.id, version: v.version }; } });
  out.permissions = list(id, raw.permissions ?? [], 'permissions', { max: 4, item: (v, f) => { if (!Object.hasOwn(PERMISSIONS, v)) fail(id, `${f} 应为 ${Object.keys(PERMISSIONS).join('、')} 之一。`); return v; } });
  if (!raw.status || !Object.hasOwn(VERIFICATION, raw.status.level)) fail(id, `status.level 应为 ${Object.keys(VERIFICATION).join('、')} 之一。`);
  out.status = { level: raw.status.level, summary: text(id, raw.status.summary, 'status.summary', 400),
    limits: list(id, raw.status.limits, 'status.limits', { min: 1, max: 10, item: (v, f) => text(id, v, f, 300) }) };   // an honest list of what it does not do is required
  out.license = text(id, raw.license ?? 'Apache-2.0', 'license', 40); out.author = text(id, raw.author ?? 'Molecule Glow 官方', 'author', 60);
  out.docs = list(id, raw.docs ?? [], 'docs', { max: 6, item: (v, f) => text(id, v, f, 200) });
  out.tags = list(id, raw.tags ?? [], 'tags', { max: 8, item: (v, f) => text(id, v, f, 20) });
  return Object.freeze(out);
}

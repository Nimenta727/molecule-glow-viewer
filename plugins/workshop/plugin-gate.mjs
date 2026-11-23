/**
 * Which plugin owns which `glow` command, and the on/off switch the workshop's plugin zone shows. Official plugins ship with the application, so "enabling" one is a switch, not a download:
 * a disabled plugin's commands refuse with a message that says where to turn it back on. The map is checked against the manifests (tools/test/plugin-packages.test.mjs), so it cannot drift.
 * Plugins whose entry is not a command (a tool preset, a panel) cannot be switched off from here: `canToggle` says so, and the dialog shows no button for them.
 */
export const COMMAND_OWNERS = Object.freeze({
  instances: 'org.glow.plugin.instancing', volume: 'org.glow.plugin.density-maps', membrane: 'org.glow.plugin.membrane-builder', benchmark: 'org.glow.plugin.hardware-budget',
  complex: 'org.glow.plugin.complex-records', assemble: 'org.glow.plugin.assembly', embed: 'org.glow.plugin.membrane-embedding', compose: 'org.glow.plugin.composition-planner',
  interactions: 'org.glow.plugin.interaction-evidence', binding: 'org.glow.plugin.binding', source: 'org.glow.plugin.data-sources', lookPack: 'org.glow.plugin.look-packs', neighborhood: 'org.glow.plugin.residue-neighborhood', hbonds: 'org.glow.plugin.bond-details', composition: 'org.glow.plugin.residue-composition', contacts: 'org.glow.plugin.interface-contacts',
});
/** Display names of the switchable plugins (checked against the manifests by the repository tests). */
export const PLUGIN_NAMES = Object.freeze({
  'org.glow.plugin.assembly': "装配（按共有亚基叠合）",
  'org.glow.plugin.binding': "结合/解离的空间过程",
  'org.glow.plugin.complex-records': "复合体登记",
  'org.glow.plugin.composition-planner': "组成规划器",
  'org.glow.plugin.data-sources': "外部数据源客户端",
  'org.glow.plugin.density-maps': "体积数据（冷冻电镜/断层）",
  'org.glow.plugin.hardware-budget': "硬件预算与基准测试",
  'org.glow.plugin.instancing': "实例化与细节分级",
  'org.glow.plugin.interaction-evidence': "相互作用证据层",
  'org.glow.plugin.look-packs': "光影包",
  'org.glow.plugin.residue-neighborhood': "周边残基查看",
  'org.glow.plugin.bond-details': "氢键与价键细节",
  'org.glow.plugin.residue-composition': "组成与性质分析",
  'org.glow.plugin.interface-contacts': "界面接触分析",
  'org.glow.plugin.membrane-builder': "脂双层构建",
  'org.glow.plugin.membrane-embedding': "膜蛋白插膜",
});
const KEY = 'glow.plugins.disabled';

/** A set of disabled plugin ids kept in `storage` (localStorage-like; every access is guarded because storage can be missing or blocked). */
export function createPluginSwitch(storage) {
  const read = () => { try { const value = JSON.parse(storage?.getItem(KEY) ?? '[]'); return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []); } catch { return new Set(); } };
  let disabled = read();
  const save = () => { try { storage?.setItem(KEY, JSON.stringify([...disabled])); } catch { /* the choice then lasts for this session only */ } };
  return {
    isEnabled: (id) => !disabled.has(id),
    set(id, enabled) { if (enabled) disabled.delete(id); else disabled.add(id); save(); },
    canToggle: (id) => Object.values(COMMAND_OWNERS).includes(id),
    /** Wraps a command adapter so it refuses while its plugin is off. */
    guard(command, fn) {
      const owner = COMMAND_OWNERS[command];
      if (!owner) return fn;
      return (...args) => { if (disabled.has(owner)) throw new Error(`插件“${PLUGIN_NAMES[owner] ?? owner}”已停用：在工坊的“插件区”里重新启用后才能使用 glow.${command}。`); return fn(...args); };
    },
    /** A copy of the host adapter whose plugin-owned commands are guarded. */
    guardAll(host) { return Object.fromEntries(Object.entries(host).map(([key, fn]) => [key, typeof fn === 'function' ? this.guard(key, fn) : fn])); },
  };
}

import { attachScopedCommandBridge } from '../../src/api/embed-permissions.js';
// Host commands use explicit adapters. Scene packages never supply executable commands.
const READ_ONLY = new Set(['help', 'info', 'snapshot', 'exportPack', 'validatePack', 'sequence']);
export const COMMANDS = {
  help: '列出当前入口支持的命令与迁移限制。',
  info: '返回场景、插件、镜头、选择与播放状态。',
  load: '打开 {pdb}、{url}、{packText} 或 exportPack 返回的 v2 包。',
  select: '选择 {chainId?, residueId?, sourceAssetId?}，或 chain A / resid 8 / none。',
  represent: '切换 cartoon / backbone / blob / functional / surface。',
  camera: '读取镜头；reset；{position:[x,y,z],target:[x,y,z]}；或经典写法 {orbit:度}（绕竖直轴转）、{az,el,dist}（角度和距离，米）、{focus:"选择表达式"}（飞到选择处，可再带 dist）；也接受 "reset"、"orbit 90"、"focus chain A"。',
  animate: '设置 {pause?,time?,speed?,seed?,step?,steps?,parameters?,morph?}；也接受 "play" / "pause"。morph 为 0–1 或 auto，需要两态构象插件。定步推进后暂停。',
  measure: '测量：measure(a,b) 两个选择 → 距离（Å），measure(a,b,c) 三个 → 角度（°，b 是顶点）；每个选择必须正好是一个残基（Cα，核酸 P）或一个小分子（中心）。也可传 {a,b,c} 或数组；measure("clear") 清除标线。',
  sequence: '序列：无参数返回每条链的一字母序列、残基数和缺失段；{show:true|false} 开关序列条；{select:"表达式"} 用选择语言选中；{sites:...} 暂不支持。',
  color: '上色（按整条链）：color("chain" | "entity" | "rainbow" | "reset")；color("chain A","#e05a4a") 或 color({target,color})；颜色为 #rrggbb 或 red/blue/green…；残基范围上色尚未迁移。',
  clip: '剖切：{enabled?:布尔, depth?:-1..1, scope?:"all"|"parts", aim?:true（对准当前视线）}；不带参数读取状态。',
  snapshot: '返回视口 PNG data URL，接受 {width:64..4096}。',
  exportPack: '返回 {format:"glow-v2",encoding:"base64",data}，包括原始资源。',
  validatePack: '检查 v1 JSON 文本或 exportPack 返回的 v2 包。',
};

export function createCommandApi(adapter) {
  let queue = Promise.resolve(), pending = 0, disposed = false;
  const log = [];
  const copy = (value) => JSON.parse(JSON.stringify(value ?? null));
  const api = {
    version: '2.0.0',
    get log() { return copy(log); },
    run(cmd, args, authorize) {
      if (disposed) return Promise.reject(new Error('命令接口已关闭。'));
      if (!Object.hasOwn(COMMANDS, cmd)) return Promise.reject(new Error(`此入口尚不支持命令 ${String(cmd)}。请调用 glow.help()。`));
      if (pending >= 32) return Promise.reject(new Error('命令队列已满。'));
      // Snapshot caller input before it enters the queue. No host objects are accepted.
      let input;
      try { input = copy(args); } catch { return Promise.reject(new Error('命令参数必须可以序列化为 JSON。')); }
      pending++;
      const job = queue.then(async () => {
        if (disposed) throw new Error('命令接口已关闭。');
        authorize?.();
        let ok = false;
        try {
          const result = cmd === 'help' ? {
            api: api.version, commands: Object.entries(COMMANDS).map(([cmd, doc]) => ({ cmd, doc })),
            tools: adapter.tools?.() ?? [],
            limitations: ['select 支持选择语言（chain / resi / within / sele …）；上色目前只到整条链，按残基范围上色、style（画风）尚未迁移；表示按选择换模式尚未迁移。',
              'exportPack 返回 v2 ZIP 的 base64 包装；不返回经典 v1 对象。',
              'tools 来自已注册工具的描述符：运行参数用 glow.animate({parameters}) 设置（需要该工具的播放器）。'],
          } : await adapter[cmd](input);
          authorize?.('result');
          ok = true;
          return copy(result);
        } finally {
          // Never retain local coordinate files or exported packages in the command log.
          const text = JSON.stringify(input);
          const recorded = cmd === 'load' || cmd === 'validatePack' || text.length > 4096
            ? { omitted: true } : input;
          log.push({ t: new Date().toISOString(), cmd, args: recorded, ok });
          if (log.length > 200) log.shift();
        }
      });
      queue = job.catch(() => {}).finally(() => { pending--; });
      return job;
    },
    async replay(entries, authorize) {
      if (typeof entries === 'string') entries = JSON.parse(entries);
      if (!Array.isArray(entries) || entries.length > 200) throw new Error('replay 需要最多 200 条日志。');
      const result = [];
      for (const entry of copy(entries)) {
        authorize?.();
        if (!entry?.ok || READ_ONLY.has(entry.cmd) || entry.args?.omitted) {
          result.push({ cmd: entry?.cmd ?? null, skipped: true }); continue;
        }
        try { await api.run(entry.cmd, entry.args, authorize); result.push({ cmd: entry.cmd, ok: true }); }
        catch (error) { result.push({ cmd: entry.cmd, ok: false, error: error.message }); }
      }
      return result;
    },
  };
  // glow.measure(a, b, c) and glow.color('chain A', 'red') take positional arguments as in the classic: more than one becomes an array
  for (const cmd of Object.keys(COMMANDS)) api[cmd] = (...args) => api.run(cmd, args.length > 1 ? args : args[0]);
  return { api, dispose() { disposed = true; } };
}

export function attachCommandBridge(target, api, options) {
  return attachScopedCommandBridge(target, api, { commands: Object.keys(COMMANDS), ...options });
}

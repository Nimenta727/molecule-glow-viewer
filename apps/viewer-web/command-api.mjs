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
  color: '上色：color("chain" | "entity" | "rainbow" | "confidence" | "reset")；color("chain A","#e05a4a") 整条链；color("chain A and resi 10-50","#e05a4a") 用选择语言按残基上色（最多 64 条，后面的覆盖前面的，卡通、主链、团块表示都能画出；表面和功能分区仍显示链的颜色）；按性质上色：color("hydrophobicity")（疏水性）、color("bfactor")（B 因子，蓝低红高）、color("charge")（电荷）、color("secondary")（二级结构），也可对选择：color("chain A","hydrophobicity")、color("resi 1-50","rainbow")；"confidence" 按预测置信度（pLDDT 四档）上色，只对登记为预测结构的资源有效；颜色为 #rrggbb 或 red/blue/green…。',
  benchmark: '在这台机器上测当前画面的真实帧率：{seconds?:1..30（默认 3）, targetFps?:10..144（默认 30）}；返回显卡/渲染器名称、是否软件渲染、帧率统计、能保持目标帧率的每帧三角形预算和建议。**软件渲染的数字不能代表显卡**；帧率受显示器刷新率限制。',
  membrane: '在当前场景上画一个脂双层：{shape:{kind:"plane"{width,height}|"sphere"{radius}|"capsule"{radius,length}|"ellipsoid"{a,b,c}（单位 Å）}, thickness?:Å（默认 40，未核对来源）, normal?:[x,y,z]（膜的 +z 朝向）, offset?:[x,y,z]（Å，相对结构中心）, opacity?, resolution?}；"clear" 清除。画的是两个半透明小叶面。',
  volume: '在当前场景上叠加密度体积（冷冻电镜/断层）：{map:MRC/CCP4 文件的 base64, level?:数值或"auto", opacity?:0.05..1, slice?:{axis:0|1|2,index:整数}}；不带 map 时按新参数重画已加载的体积；"clear" 清除。界面里也可以直接打开 .mrc / .map 文件。返回尺寸、体素大小、统计、所用阈值（"auto" 只是均值+3σ 的启发式）和被降采样/截断的说明。',
  instances: '把当前看到的结构复制成许多份并按细节分级绘制：{copies:1..20000, layout?:"sphere"|"grid", spread?:0.5..4, seed?:整数, budget?:每帧三角形预算}；"clear" 或 null 清除。返回每级的三角形数、本帧各级实例数、被剔除数和不分级时的三角形数。',
  complex: '把当前结构整理成“复合体记录”：{id?, title?, record?:true 返回完整记录}；返回成员（按链名分组）、份数、化学计量。成员的证据等级为“实验（沉积坐标）”。',
  assemble: '把另一个条目的链按共同亚基叠合到当前结构上：{pdb:"4位编号", baseSelection, addSelection, carry, mode?:"number"|"sequence", maxRmsd?, threshold?}；返回 RMSD、匹配残基数、变换和碰撞。位置是推导出来的（evidence=derived），不是测得的。',
  embed: '把当前膜蛋白按其疏水带朝向嵌入膜中并复制：{shape:{kind,…}, copies:1..5000, seed?, inward?, opacity?, budget?}；"clear" 清除。每份的位置是示意（均匀取点+随机自旋），膜厚取自结构；找不到膜朝向时会说明。',
  compose: '按组分表摆放示意图：{region:{kind:"box"{x,y,z}|"sphere"{radius}|"ellipsoid"{a,b,c}|"capsule"{radius,length}}, components:[{id,copies,radius,color?,name?,useOpenStructure?}], membrane?:shape, membraneThickness?, inset?, seed?}；"clear" 清除。互不重叠；份数、半径都是你给的，不是真实细胞的分布。',
  interactions: '列出当前结构里哪些成员互相接触：{cutoff?:Å（默认 4.5）, minContacts?, limit?}；返回每一对的接触数、最近距离、残基和证据等级。接触是几何事实，不代表亲和力。成员超过 120 份会拒绝。',
  binding: '布朗动力学结合模拟：{box:nm, particles, D:nm²/µs, radius:nm, microseconds, dt?, koff?, seed?, reinject?}；返回结合速率与 Smoluchowski 理论值的比值，koff>0 时返回占有率。点粒子+完全吸收位点，是教学级模型。',
  source: '经受信任的客户端从外部数据源取数据：{source:"alphafold"|"emdb"|…, accession, expectedSha256?, allowUpdate?}；只访问白名单主机、有大小上限、记录哈希、可离线缓存；返回资源记录。未核对条款的数据源会标注 verified:false。',
  show: '对选择设表示（PyMOL 的 show / hide）：show("resi 1-30","hidden")、show("chain B","backbone")、show("ligands","blob")；样式为 cartoon（卡通）/ backbone（主链）/ blob（团块）/ hidden（隐藏，也不可选）；show("blob") 对全部；show("reset") 清除。后面的规则覆盖前面的，随作品保存；表面和功能分区表示不受影响。注意：这和经典的 style（画风）不是一回事。',
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
            limitations: ['select 支持选择语言（chain / resi / within / sele …）；style（画风）尚未迁移；残基上色只有“团块”表示能画出；表示按选择换模式尚未迁移。',
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

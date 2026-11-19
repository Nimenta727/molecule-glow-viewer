# 新版 Viewer 命令接口（第四阶段首批）

入口为 `apps/viewer-web/index.html`。`window.glow` 操作当前 Viewer 的场景和受信插件，版本为 `2.0.0`。调用均返回 Promise；`glow.help()` 列出当前支持的命令。经典 Viewer 的完整接口仍保留在 `web/index.html`。

```js
await glow.load({ pdb: '4HHB', assembly: true });
await glow.select({ chainId: 'A', residueId: '8' });
await glow.represent('surface');
const state = await glow.info();
const png = await glow.snapshot({ width: 1200 });
const pack = await glow.exportPack();
await glow.validatePack(pack);
await glow.load(pack);
```

| 命令 | 新版参数与行为 |
|---|---|
| `help()` / `run(name,args)` | 查询命令或统一调用，失败时拒绝 Promise；一个命令失败后队列继续 |
| `info()` | 场景 ID、来源、插件、部件、证据、镜头、选择及播放状态 |
| `load(spec)` | `{pdb,assembly?}`、`{url,assembly?}`、`{packText}` 或 v2 包；按需启用官方结构插件 |
| `select(spec)` | `{chainId?,residueId?,sourceAssetId?}`；残基可写 `{authSeqId,labelSeqId,insertionCode}`；简写 `chain A`、`resid 8`、`none` |
| `represent(mode)` | `cartoon`、`backbone`、`blob`、`functional`、`surface`，作用于主结构；分部件设置沿用当前场景规则 |
| `camera(pose)` | 省略读取，`reset` 重置，或 `{position:[x,y,z],target:[x,y,z]}`，使用场景米制坐标 |
| `animate(opts)` | `{pause?,time?,speed?,seed?,step?,steps?,parameters?,morph?}`；speed、seed 需要机制插件；领域参数由当前插件校验；morph 为 0–1 或 `auto`，需要两态插件；跳转、数值 morph 或定步后暂停 |
| `snapshot({width?})` | 当前视口 PNG data URL，宽度 64–4096；不包含控制面板 |
| `exportPack()` | `{format:'glow-v2',encoding:'base64',data}`；v2 ZIP 包含原坐标、预览及当前保存状态 |
| `validatePack(pack)` | 检查 v1 JSON 文本或上述 v2 包，返回 `{ok,errors?}` |
| `log` / `replay(log)` | 最近 200 条日志的副本；重放跳过读取命令、失败命令及省略的文件内容 |

选择返回匹配原子数，高亮第一个具有可视化标记的匹配残基/配体；不会声称已高亮整个选择集。`sourceAssetId` 可指定组合场景中的坐标来源。编号和插入码保留结构原身份。

机制播放器使用当前场景中的同一个实例。例如加载 ATP 合酶场景后：

```js
await glow.animate({ seed: 19, time: 0, step: 1 / 30, steps: 180 });
await glow.animate({ time: 6 }); // 与上面的固定步进得到相同计数
await glow.animate({ pause: false });
await glow.animate({ pause: true });
```

`speed` 是机制参数，`step` 是示意时间增量。种子变更把时间归零并保留已有转速干预记录。该接口没有增加新的定量科学模型。

KcsA 插件支持 `glow.animate({parameters:{pH:4,V:50,Ki:140,Ko:5,Nai:10,TBA:0,Ba:0,wt:0,ionSpeed:10,gateSpeed:0.05}})`；单位和范围见机制面板。`info()` 另外返回门状态、电流、平衡电位、两种模拟时间和开放概率。参数变更记录在共享播放器中，导出后保留。讲解步骤只检查参与部件与说明，不强制随机通道进入某个状态。

AdK 官方两态场景支持 `glow.animate({morph:0.5})`、`glow.animate({morph:'auto',pause:false})` 和 `glow.animate({parameters:{ap5:0}})`。`info()` 返回构象程度与 `domainMeasurements`（相对张开态 CORE 的转角及位移，单位 ° / Å）。自动/手动切换、变速和参考配体设置随包保存。该展示没有反应速率、底物消耗或 ADP 产量；`official.adk-reaction-data.glow` 尚待单独迁移。

## 嵌入

在 URL 显式使用 `?embed=1` 或 `?dev=1` 仅开启消息桥，不授予权限。候选来源是 `https://nimenta727.github.io`，`dev=1` 另外允许同源父窗口；请求必须来自当前父窗口或 opener。`null`、非许可来源、伪造子域、自身发消息及其他同源窗口均被忽略，URL 的 `origin=` 不会扩大权限。

| 权限 | 命令与回包 |
|---|---|
| 公开状态 | `ready` / `help` 只含接口版本与静态说明，不含场景身份或文件名 |
| 场景控制 | `load`、`select`、`represent`、`camera`、`animate`、`validatePack` 需要用户点击允许；回包统一为 `{accepted:true}`，不会转发适配器返回的完整场景信息 |
| 敏感读取 | `info`、`snapshot`、`exportPack`、`log` 需要另一项明确允许，界面告知可能读取未公开结构数据；远程日志只含时间、命令和成功状态，参数省略，避免跨场景泄露历史文件 |
| 日志重放 | `replay` 同时需要控制和敏感读取权限，逐命令检查授权 |

两类授权都绑定 origin、请求窗口和当前场景；拒绝会记住到撤销/换场景，授权后可点击“撤销全部嵌入权限”。换场景尝试、页面关闭会撤销；排队的未执行命令被拒绝，执行中的敏感结果也不能在撤销后返回。已开始的场景操作不能自动回滚，`load` 完成只回确认，新场景须重新授权。直接在页面内调用 `window.glow` 不变。

经典与新版共用 `src/api/embed-permissions.js`；经典另保留其他 HTTPS 父窗口经用户允许后的控制能力，但不向这些来源开放敏感读取。同源开发者工作台仍可直接使用本地 API；同源父页面本来就有浏览器 DOM 访问权限，消息桥的提示不构成同源页面之间的安全隔离。

```js
frame.contentWindow.postMessage({
  glow: 'cmd', id: 'camera-1', cmd: 'camera', args: 'reset'
}, viewerOrigin);
// 回应：{glow:'reply',id:'camera-1',ok:true,result:...}
// 失败：{glow:'reply',id:'camera-1',ok:false,error:...}
```

`ready` 通知只包含协议版本。响应只发回请求来源。嵌入请求上限 256 KiB；大文件使用本地接口。远程文件只允许同源或 RCSB HTTPS 坐标，拒绝跳转，下载限 30 MiB / 30 秒。页面关闭会中止下载并解绑桥。

## 当前兼容范围与验收

保留命令名称、`run`、日志重放及消息信封；尚未完整兼容经典参数和回包。复杂选择语言、`color`、`style`、`sequence`、`measure`、工坊/预设别名，以及其他机制命令仍待迁移。未支持的命令明确报错。导出返回 v2 ZIP 包装，与经典 v1 对象不同。

单元测试覆盖命令串行、失败恢复、参数快照、日志脱敏/重放、关闭、精确来源、请求窗口、分级授权、拒绝/撤销和排队结果失效。`GLOW_COMMAND_SMOKE=<目录>` 用 Electron 运行 `tools/studio-smoke.cjs`，验证本地结构的插入码选择、表示、错误恢复、导出重开、镜头、截图及自发消息被拒绝。真实父 iframe 的分级授权由 `node tools/security-smoke.cjs --stage <目录> --live` 验证，经典和新版均覆盖；同样可传 `--exe <候选>`。`GLOW_ATP_SMOKE` 额外验证实际 6ZPO 的命令定步、跳转、种子和播放暂停。截图已检查宽屏、560 px 窄屏及独立导出的 PNG。

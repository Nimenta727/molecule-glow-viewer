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
| `animate(opts)` | `{pause?,time?,speed?,seed?,step?,steps?,parameters?}`；speed、seed 需要机制插件；领域参数由当前插件校验；跳转或定步后暂停 |
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

## 嵌入

在 URL 显式使用 `?embed=1` 或 `?dev=1` 开启消息桥。允许 `https://nimenta727.github.io`；`dev=1` 另外允许同源调用。`null` 来源、非许可来源和伪造子域不被接受，URL 的 `origin=` 不会扩大权限。其他站点的用户授权流程尚待迁移。

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

单元测试覆盖命令串行、失败恢复、参数快照、日志脱敏/重放、关闭和精确来源检查。`GLOW_COMMAND_SMOKE=<目录>` 用 Electron 运行 `tools/studio-smoke.cjs`，验证本地结构的插入码选择、表示、错误恢复、导出重开、镜头、截图及同源消息桥。`GLOW_ATP_SMOKE` 额外验证实际 6ZPO 的命令定步、跳转、种子和播放暂停。截图已检查宽屏、560 px 窄屏及独立导出的 PNG。

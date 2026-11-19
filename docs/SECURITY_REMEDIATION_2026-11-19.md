# 4.1 安全整改与验收

代码：`01c8daee546e1e4be0a7c8269646913b5f3c0a37`。本轮处理 [执行计划](MIGRATION_EXECUTION_PLAN.md)的 4.1，保持经典科学实现及新版主体＋官方插件方向。本次干净提交的暂存目录、真实 EXE 和远端 CI 均通过下述范围，机器记录见 [验收 JSON](validation/2026-11-19-p1.json)。

## 修复范围

### 坐标文本到经典 DOM

图例的实体名、配体代码/名称/标题改为 DOM 文本与属性赋值，仅固定模板解析 HTML。结合位点信息卡的宿主、接触残基、原子名、来源、域名及说明在固定模板中统一转义。拆装信息里的配体和接触标签也转义。序列条、选择说明及证据相关路径核对既有转义；没有为显示文本去修改科学坐标解析结果。

加入 [恶意 mmCIF 样本](../tools/fixtures/security/malicious.cif)，含实体、配体、作者编号和原子名中的标签/事件载荷。真实页面沿文件输入→解析→图例验证，再以同一组合成坐标模拟 ModelServer 的结合位点响应，实测氢键信息和聚焦控件：没有生成 img/svg，没有执行事件。样本是安全回归用合成坐标，不是科学结构或远程 RCSB 实验数据。生成的 web、skill 和桌面副本保持一致。

### 桌面响应缓存与外链

缓存逻辑拆到 `desktop/response-cache.cjs`：每资源 30 MiB、30 秒、最多 8 个并发写入、已提交正文预算 2 GiB。实际解码字节也计数，覆盖无 Content-Length 和虚报长度；压缩响应区分传输长度与解码正文。正文流式写盘，不在主进程 arrayBuffer 后再缓存。

每次写入使用独立临时文件/载荷代次，计算 SHA-256，完整后原子更新元数据。元数据是提交标记；旧版完整缓存可读。超限、异常中断、超时和清缓存取消读取并清理临时文件；并发同 URL 的请求各自返回自己的字节。缓存驱逐按正文预算执行，陈旧元数据清理，窗口关闭的请求信号传给真实下载。缓存容量不含最多八个正在写入的临时正文；每个临时正文仍受 30 MiB 限制。未缓存的直通响应没有新增主进程缓冲。

导航、重定向和弹窗共用 `network-policy.cjs`：内部仅允许精确的 `app://glow` 页面列表，外部只把 http/https 交给系统；其他协议、伪造 app host/port 和带凭据的 URL 被拒绝。app 资源处理器同时校验 host。规则遵循 [Electron 导航与外链安全建议](https://www.electronjs.org/docs/latest/tutorial/security)。

### 嵌入权限与开发者接口

两代 Viewer 共用 `src/api/embed-permissions.js`，没有再维护两套许可实现。`embed=1`/`dev=1` 只是启用桥，固定可信来源也不能自动读取私有数据；请求同时绑定父窗口/opener 与精确 origin。

- 公开的 ready/help 不含当前场景信息。
- 用户分别允许场景控制与敏感读取；info、截图、原始包、日志都属于后者。控制命令只返回确认，防止 load/animate 的 info 回包旁路。
- 远程日志省略参数，避免当前授权读到历史场景文件；本地 window.glow 接口保持可用。
- 拒绝、撤销、换场景尝试和页面关闭使权限失效；队列执行前、异步结果返回前和重放每一步重新检查。已开始的修改不自动回滚；load 成功只回确认，新场景重新授权。
- 经典入口保留其他 HTTPS 父窗口经允许后的控制，但不给这些来源敏感读取。新版仍限制到官方站点和 dev 同源。

同源页面原本可以直接访问彼此 DOM；权限提示不能替代浏览器同源隔离或后续完整插件沙箱。详细协议见 [命令接口](VIEWER_COMMAND_API.md)。

## 可复验检查

```powershell
npm test
node tools/build.mjs --check
node tools/check-copies.mjs
node workshop/tools/validate.mjs
node tools/security-smoke.cjs --stage <暂存目录> --live --output <证据目录>
node tools/security-smoke.cjs --exe <候选EXE> --live --output <证据目录>
```

完整 Node 检查 **134 项通过**。新增测试覆盖磁盘流、声明/实际超限、HTTP 错误、中断/超时、并发写、缓存清空、正文预算、真实 HTTP 分块/压缩、协议拒绝、窗口绑定、授权/拒绝/撤销、队列与异步读取失效、两代命令队列及远程日志脱敏。网络单测只绑定 127.0.0.1；受限环境须允许本机连接才能运行。

`security-smoke.cjs` 的四例为：经典恶意坐标 DOM、新版真实父 iframe 授权、经典真实父 iframe 授权、Electron 实时下载 1K4C 并按固定 SHA-256 检查与再次命中。iframe 自动化使用同源 dev 场景，精确外部 origin/伪造窗口拒绝由单测覆盖，不冒称访问真实官方父站。已接入 Windows 暂存和实际 EXE 两处 CI 门槛，沿用已有六项产物回归。

## 产物验收

本地暂存与真实 portable EXE 各 **六项功能＋四项安全** 回归通过，运行中的 ASAR 与预先提取校验的归档哈希相同，保持沙箱、上下文隔离及关闭 Node 集成。[本次 CI](https://github.com/Nimenta727/molecule-glow-viewer/actions/runs/44498741719) 的 source/windows-artifact 均成功，独立执行同一套门槛。候选未签名、未发布 Release；分支保护 required checks 仍由维护者配置。

| 本地候选 | 值 |
|---|---|
| 文件 | `MoleculeGlow-0.4.0-01c8daee-win-x64.exe` |
| 字节数 | 78,927,718 |
| EXE SHA-256 | `2d473a3d6f0ad8b573ab4391f471192b15c4e7de5e4b3424b7d602e4bb1efa4b` |
| ASAR SHA-256 | `b5cde19d3a64cfe196fe4ae827f27d8f2fa2f7ae6643f32fee37842d507fc312` |
| 清单内容 SHA-256 | `bc57e81f33bdad2a7f8f5eb7f7c9dd70107bd98bb8806d54a66b5c00e209e768` |
| 环境 | Windows 10.0.26300 x64 / Node 26.13.1 / Electron 33.4.11 / 产物测试 SwiftShader |

这些哈希只标识本地候选，不能代替 CI 独立构建的二进制身份。本地曾同时启动两套 portable 测试，一次经典入口进程退出后没有生成报告；随后串行执行全部六例通过，CI 两组始终串行执行。此失败尝试保留在 JSON 中，没有计为通过。

| 实际 EXE 安全界面 | 常规 | 560 px |
|---|---|---|
| 恶意 mmCIF 与接触标签 | [截图](images/p1-classic-dom-normal.png) | [截图](images/p1-classic-dom-narrow.png) |
| 新 Viewer 数据读取提示 | [截图](images/p1-embed-consent-normal.png) | [截图](images/p1-embed-consent-narrow.png) |
| 经典 Viewer 数据读取提示 | [截图](images/p1-embed-classic-normal.png) | [截图](images/p1-embed-classic-narrow.png) |

已人工查看以上六张图。授权文案和按钮在窄屏可读；经典窄屏面板仍有遮挡，最终布局收尾没有计入本轮。

此外，经典原有完整脚本本轮在源码桌面环境通过：六科学场景、连切、seed 7、全细胞重复加载、返回、待定动画、失败保留和桥接；[原始结果](validation/2026-11-19-p1-classic.log)保留数值及 FPS 警告。它核对的经典 HTML 哈希另见 JSON；这不是在 EXE 中完整重跑经典科学套件。并行验证期间帧率较低，未将其算作性能等价。Studio M3、命令导出/重开、经典构建/副本和 15 包数据校验也通过。

当前下一项是 **4.2 经典功能对照与科学验收基础**。

本记录仅涵盖上述具体数据流与测试；不表示框架/全部依赖的完整安全审计、完整科学等价、正式签名或 GitHub Release 发布。

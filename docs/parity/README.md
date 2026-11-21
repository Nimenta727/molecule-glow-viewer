# 功能对照验收基础

`docs/feature-parity.json` 是功能范围与状态入口，`cases.json` 是测试契约：27 项功能各有经典/新版案例、数据和可观察标准；六经典场景与十一项专项共 17 条回归映射。`manual-contract` 和 `planned` 是待执行用例，`partial-automation` 明确只覆盖部分行为。它们都不能因为脚本存在就被算作通过。

`node tools/check-feature-parity.mjs` 检查路径、唯一 ID、案例/数据引用、旧回归映射、已实现范围的干净产物记录、科学验证卡，以及数值报告使用的源码哈希。`npm test` 含负例：删除旧案例、伪造路径、将迁移状态升级却没有证据、过期源码、篡改误差和删除已知差异都会失败。工作流也覆盖本目录、功能清单和科学卡的变更。

## 数值基线

```powershell
node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures
node tools/parity-numerics.mjs --fixtures desktop/dist/smoke-structures --output docs/parity/numerical-baseline.json
node tools/check-feature-parity.mjs
```

真实坐标比较需要桌面的既有 Three.js 依赖（`npm ci --prefix desktop`）；不往仓库嵌入坐标。CI Windows 作业用同一哈希数据重新比较，报告作为产物上传。纯解析/动力学单测不需要下载或 Three.js。

脚本直接执行经典源码中的 KcsA 方法、simStep、ATP update 和 domainTurns，再与插件的实际实现比较，不维护第三份科学模型。固定种子为 7，但解析速率/电流和构象插值没有随机抽样；同种子不代表跨引擎随机事件相同。

当前报告包括 19 行解析/相位结果、5 行真实坐标/质子账本结果及 1,080 组门控速率比较。ATP 的经典探针禁用渲染流并留空催化位点，仅检查转子质子账本，**没有测量经典 ATP 产量或事件相位**。AdK 只对照闭合端相对 CORE 的域转角/位移，不能据此判定两种全局叠合的中间路径一致。KcsA 只对照解析速率和开放电流，动画阻塞/随机事件仍待对照。

模型源码或比较脚本改变后，旧报告的规范化 LF SHA-256 会失效；须重新执行、审查数值与差异再提交。坐标使用原始字节 SHA-256，不做换行归一化。不能通过增大误差容限、删掉差异或把任务设为“不适用”来关闭功能缺口。

## 事件时间表对照

`node tools/atp-parity.mjs --output docs/parity/atp-parity-report.txt` 在 vm 中原样运行经典 `PROCESSES.atpSynthase.update`（位点、粒子池和绘制只用占位对象，不影响时间表），按转子角度与插件的转子构象状态机比较 H⁺ 计数、ATP 计数和阶段边界；结论与已知差异写在报告里（ATP 在经典里于位点闭合处、在候选里于完整位点周期处计数，相差一个 12% 窗口）。粒子轨迹和位置是种子化示意，不比较。

## 推进单项迁移

1. 按具体经典/新版案例和数据运行，不把静态预览当动态模拟。
2. 填写数值、行为、截图、提交/内容哈希及环境；科学卡保留假设、单位、文献和未解决差异。
3. `implemented_scope` 只证明声明的实现范围。功能/科学/视觉/当前产物分别记录；完整 parity 需要覆盖两侧全部案例、截图、源码哈希与明确科学审阅，不能继承此前某次 EXE 冒烟结果。

本门槛验证证据结构与选定软件不变量，不自动证明实验有效性，也不能取代人的科学审阅。

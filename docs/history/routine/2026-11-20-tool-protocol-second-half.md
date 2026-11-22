# 2026-11-20 — 工具协议第二半：独立工具 ID、适用条件与角色绑定

## 做了什么
- **协议**（`packages/plugin-host`）：描述符新增 `aliases`、`player`、`inputs`（角色 + 工具自己的 `check`）；宿主 `registerTool` 把别名/播放器 ID 登记为标记，新增 `resolveToolId`，`getTool` 经别名解析，`listTools` 不重复列出；`tool-model.mjs` 新增 `toolRoles`、`checkApplicability`、`autoBindings`。
- **schema v3**：`tools[].bindings`（角色 → 节点 ID，每个角色内不重复），校验节点存在。
- **三个插件**：规范 ID `org.glow.tool.rotary-atpase` / `conformation-pair` / `channel-gating`（旧 ID 作别名与 player）；各自的角色与适用条件（`plugins/*/tool.mjs`，共用 `plugins/shared/bindings.mjs`）；播放器接受 `bindings`，有绑定就用绑定。
- **Viewer**：`mechanism-runtime` 按别名解析工具条目、把 `config`/`bindings` 传给播放器、对没有绑定的条目补建议绑定并写回；`work-scene.completeBindings`；`toolEntriesForScene` 在旧包升级时直接带上建议绑定并写规范 ID。
- **Studio**：工具页的“适用性 + 对象绑定”区、`setToolBindings` 命令、添加工具时自动绑定。

## 验证
- 221 项 Node 测试通过（新增 10 项：协议 4、插件适用条件/绑定 4、schema 绑定 1、Studio 命令 1）；三个播放器的黄金输出与真实数据对照未变（无绑定时行为逐位一致）；数值基线只有源码哈希变化。
- 浏览器端到端（软件渲染 Chromium，无页面错误）：
  - Viewer 打开旧版 ATP .glow → 导出 v3 包：工具 ID 为 `org.glow.tool.rotary-atpase`，`rotor` 绑定为 γ、δ、ε 和 8 个 c 亚基共 11 个部件。
  - Studio 导入旧 ID 的 v3 包：通过别名识别，显示“适用（使用建议绑定，尚未保存）”，选中 11 个；“自动绑定”→已保存；手动取消 2 个→保存 9 个；全部取消→“不适用：需要至少 1 个对象”；再自动绑定恢复；给该 ATP 场景添加 KcsA→明确提示“需要 4 个通道链节点，找到 0 个”；导出的包含绑定；Viewer 重新打开仍为 `ATP 3 · H⁺ 8`。截图 `docs/images/studio-tool-bindings-1600.png`。
- 过程中发现并修复我自己的一个错误：用 Python 一行同时“以写模式打开并读取”同一个文件，把 `tools/parity-numerics.mjs` 截成了空文件；已用 git 恢复并重做，之后全部检查通过。

## 需要你知道的
- 绑定只覆盖播放器真正使用的对象角色；协议里仍没有 `outputs`。
- 测试夹具里 ATP 有一个多余的无原子节点 `C`（夹具的小毛病），适用性测试里去掉了它。真实场景是 8 个 c 亚基节点。
- 没重跑 Electron 冒烟/安全用例，也没在真实 GPU/EXE 验证。

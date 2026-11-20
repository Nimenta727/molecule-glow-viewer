# 2026-11-20 — 工具协议（4.3.3）第一版

## 做了什么
- **宿主**（`packages/plugin-host`）：新增 `tools` 能力——`context.registerTool(id, descriptor)`、`host.getTool(id)`、`host.listTools({audience})`（按 `view`/`author` 过滤、按 id 排序）。`tool-descriptor.mjs` 校验描述符（受众、运行时、参数类型/范围/默认值、`author` 块必须声明 `author` 受众、参数受众必须在工具受众之内、`model.assumptions`），返回冻结副本。
- **共用逻辑**：`tool-model.mjs`（`toolControls`、`validateToolValues`、`authorFields`、`coerceField`、`editAuthorField`、带原型污染防护的 `getPath/setPath`）；`tool-panel.mjs`（`renderControl(s)`、`readControl`、`writeControl`，数字/滑块沿用 Viewer 原有 DOM）。
- **三个内置播放器登记为工具**（`plugins/*/tool.mjs`）：运行参数取自各自原有的 `PARAMETERS`；制作字段覆盖部件选择、粒子、讲解文案、初始实验条件（ATP 22、AdK 22、KcsA 51 项，字段列表随配置动态生成，如步骤数）。
- **Viewer**：机制参数面板改由描述符（view 受众）生成，参数值读写支持布尔/选择/文本；无描述符的播放器回退到面板定义。
- **Studio**：新增“工具配置”区（`apps/studio-web/tool-config.mjs`）+ `setToolConfig` 会话命令（可撤销/重做）+“导入场景包”。面板完全由描述符生成；缺工具时配置保留并提示。

## 验证
- 209 项 Node 测试通过（协议 7 项、内置工具 6 项、Studio 命令 1 项；既有测试全部不变）。要点：描述符各类错误逐项拒绝；Viewer 看不到只属于制作的工具；运行参数与旧 `PARAMETERS` 在边界值/越界/NaN/非整数上接受与拒绝完全一致；每个制作字段都能解析，**把当前值原样写回配置不变**；编辑真正影响播放器（KcsA 初始 pH、ATP 步骤文字/颜色/环亚基数 10）；工具自己的校验器拥有最终否决权。
- **浏览器端到端**（软件渲染 Chromium）：
  - Viewer：KcsA 10 个、AdK 3 个（含滑块）、ATP 无面板——标签、范围、步长、默认值与改动前一致，改值生效。
  - Studio：导入 Viewer 导出的 ATP v3 包 → 工具配置区自动出现 22 个字段（4 组）→ 改机理标题与 H⁺ 颜色成功；环亚基数填 2 被工具拒绝（“应在 3–64 之间”）并还原为 8；撤销/重做正确 → 导出场景 → 包内配置为新值 → 重新载入 Viewer 从 4 秒、`ATP 3 · H⁺ 8` 继续。截图 `docs/images/studio-tool-config-1600.png`。
- 数值基线重新生成：只有源码哈希变化。`check-feature-parity`、`check-docs` 通过。未重跑 Electron 冒烟/安全用例，未在真实 GPU/EXE 验证。

## 需要你知道的
- 这是**第一版**：协议里还没有适用条件/角色绑定（`inputs`）和输出声明；工具 ID 仍是旧的 `legacy-process`；Studio 只能编辑已有工具条目，还不能新建。
- 已保存过导航的作品，Studio 里改“讲解”文字后，Viewer 仍显示已保存的导航文字（先前说明过的取舍，等 Studio 面板结构改造时再决定是否加“从配置重新生成”）。
- Studio 里 ATP 场景显示为管状示意（Studio 沿用导入时的预览几何），与 Viewer 的墨线表示不同，属于 Studio 视口尚未用墨线画风的差距。

## 下一步
1. 把 `motion` 能力注册成独立工具 `org.glow.tool.*`（保留旧 ID 映射），补 `inputs`（适用条件与角色绑定）。
2. Studio 面板结构改造（场景树 + 属性 + 工具面板，借鉴专业软件结构），Studio 导入直接写 v3，能新建工具条目。
3. 导出时按 `embedAllowed` 处理资源字节；工具条目登记 `dependencies`。

# 2026-11-19 — 4.3.1：资源库接入 Viewer 载入流程

## 改动
- `packages/schema/resource.mjs`：新增 `describeStructureAsset`（RCSB → `res.rcsb.<ACC>` + CC0；本地文件 → `res.local.<sha8>` + 授权未知、不可嵌入；版本 = 哈希前 8 位，同字节幂等）和 `store.ensure`（同 id@version 同内容幂等，不同内容拒绝）。
- `apps/viewer-web/resource-registry.mjs`：载入场景时把原始结构文件登记为资源，并在 `asset.provenance.resource = {id,version,sha256}` 建立链接；单个文件缺失/哈希不符只产生诊断，不阻止打开；预览几何是派生数据，不登记。
- `main.mjs`：`prepare` 中登记；`glow.info().resources`；面板新增“资源与来源”小节（来源、授权、大小、id@version）。
- 测试：新增 4 项（RCSB→CC0、本地→未知授权不可嵌入、幂等/去重、缺失与哈希不符的诊断）；总计 **155 项通过**。

## 验证
ATP 合酶官方包在 Chromium（软件渲染）载入后，`glow.info().resources` 与面板均显示 `RCSB 6ZPO · CC0-1.0 · res.rcsb.6ZPO@7a992857`。未在真实 GPU/EXE 验证。

## 边界（避免误读）
- 链接目前写在 `provenance`（自由 JSON）里，是 v2 内的过渡；一等公民的 `resource` 字段与 `tools[]` 随 schemaVersion 3 一起做。
- 只接入 Viewer；Studio 导入、导出时按 `embedAllowed` 决定是否嵌入离线副本，尚未实现。
- 资源库是会话内存，不跨窗口持久化。

## 下一步
1. ATP 样板抽配置：把 8 个 c 亚基/β 链分组/步骤文案/6ZPO 引用从 `plugins/atp-synthase` 搬到作品配置，行为不变。
2. 导出包按 `embedAllowed` 处理；Studio 导入接入资源库。
3. schemaVersion 3（`resource` 一等引用 + `tools[]`）与 v2 自动迁移。

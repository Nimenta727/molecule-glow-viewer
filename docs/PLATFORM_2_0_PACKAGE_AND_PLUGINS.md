# Glow 2.0 文件包与插件契约

## ADR-003 · 持久化格式

- 场景 JSON 使用 `format: "glow-scene"` 和 `schemaVersion: 2`。场景包含 `id`、`title`、`units`、`assets`、`nodes`、`timeline`、`dependencies`、`evidence`。位置用米，时间用秒。节点、变换和关键帧沿用 [Core 契约](PLATFORM_2_0_CORE_CONTRACT.md)。
- 资源分为 `primitive`、`file` 和 `external`。包内文件使用 `path`、`sha256` 和 `mediaType` 引用。外部资源使用来源和访问编号记录出处。打开包时只解析数据和包内资源。无专业表示时，通用视图保留节点层级和可显示的几何，并提示依赖。
- `glow-project` v1 保存标题、有独立 ID 的场景和活动场景引用。`glow-package` v1 是发布清单，包含 `manifest.json` 清单自身之外每个文件的路径、字节数和 SHA-256。场景文件为 `scene.json`，资源存放在 `assets/`。v2 `.glow` 交付采用 ZIP Store，先校验版本、路径、数量、大小和哈希，再替换活动场景。新平台工具使用 Node 20 及更高版本。
- v1 导入单向进行。沿用旧清理和校验规则，保存来源、已识别字段和迁移诊断。预设流程映射为版本化能力。无可显示几何时提示依赖，并提供旧版 Viewer 入口。旧文件由用户保留。

## ADR-004 · 官方插件 SDK

- 宿主接收应用明确提供的官方模块。插件以 `manifest` 声明 ID、版本、`apiVersion`、依赖与能力，并实现 `activate(context)` 和可选的 `deactivate()`。首版插件与服务依赖采用精确版本。
- `PluginContext` 提供场景快照、命令接口、取消信号、释放登记及已声明的导入器、表示和服务注册接口。宿主在激活成功后发布注册项，激活失败回收本次资源。卸载撤销注册、取消任务并释放资源。
- 场景包中的依赖只是 ID 和版本声明，由宿主匹配已受信的可用插件。场景包无代码执行入口。第三方插件的隔离、权限和分发另行验收。

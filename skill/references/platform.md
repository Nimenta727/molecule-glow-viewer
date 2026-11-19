# 当前主体＋插件平台（Desktop/Skill 0.5.0）

## 入口与能力

经典资产保留完整原有科学工作流；新 Viewer 已接入结构、基础 API 与 ATP/KcsA/AdK，Studio 已有多场景/关键帧/证据/书签与导出。呼吸链、光反应、翻译、鞭毛、多站/全细胞和通用数据反应仍待迁，不把结构预览称为机制完成。

仓库文档以 docs/README.md 为入口；当前功能、架构、审计、ROADMAP、CODEX_MIGRATION_HANDOFF 分工明确。旧阶段文件在 docs/history，不作为当前计划。下一项 4.3.1 通用 data-animation 和 AdK/KcsA 数据包；Claude 最终处理全面前端/结构收尾。维护者本次单独授权的文档、EXE 和 Skill 更新不表示全迁移完成。

## 在仓库里实现

- apps/viewer-web 协调加载/UI，mechanism-runtime 只适配原场景/player；packages 提供 Core、Schema、宿主、渲染、兼容和编辑器。
- plugins/structure、rcsb 提供结构与来源；mechanism-catalog 是应用受信目录，当前三个机制有各自版本和 scientific-card.json。
- 插件使用同一场景、时钟、选择、镜头与资源生命周期。不要复制第三套解析/动力学/会话。
- 社区 .glow 只提供数据；v1 声明只匹配已安装播放器；v2 是带原始资源与哈希的 ZIP。用仓库 Schema/导出器，不手造二进制格式。

## 科学与对照

新机制加入官方目录时要有匹配 ID/版本的科学卡：结构来源与原始哈希、物种/代用构象、实验/推导/建模/示意、方程、参数/单位、时钟、假设、限制与文献。

feature-parity.json 和 docs/parity/cases.json 绑定经典/新版案例、数据和预期。planned/manual/partial 不能计通过；改模型或比较器后数值报告源码哈希失效，须重跑并审查。已有报告只证明选定不变量：ATP 生产/释放语义、KcsA 动画阻塞/随机时钟、AdK 初始相位/叠合仍有差异；AdK 两态不是催化反应。

## 命令与嵌入

window.glow 是页面内接口，先 help() 了解当前入口。新版复杂选择、color/style/measure/sequence 等尚未完全兼容经典。导出新版返回 glow-v2 的 base64 包装，不能假装是 v1 对象。

embed=1/dev=1 只启用桥。固定可信 origin 也需要用户明确授权；请求绑定父窗口/opener、origin 和当前场景。控制只回确认，info/snapshot/exportPack/log 为单独敏感权限；撤销/换场景使权限失效。URL origin 参数不能自授权。同源页面仍有原有 DOM 权限；完整插件沙箱待收尾。

## 检查和交付

按任务执行 npm test、node tools/check-feature-parity.mjs、构建/副本与 15 包数据校验；数值脚本使用固定原始坐标，不能用重新生成的假数据代替真实结构。

源码、暂存、真正 Windows EXE 分开验证三个入口和所有已安装机制，记录保存重开、取消/失败、停插件和资源释放。人工查看宽/窄截图，不凭窗口存在或退出码验收。只有所有契约与完整行为关闭，才写最终迁移报告和 migration-complete 标签。

仓库与最新文档：[GitHub](https://github.com/Nimenta727/molecule-glow-viewer)。独立 Skill 资产是经典实现；要修改新平台，先取得仓库源码。

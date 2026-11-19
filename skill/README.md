# 制作 Skill · 0.5.0

为 Claude Code、Codex 或其他支持 SKILL.md 的工具提供分子场景制作指导。入口是 [SKILL.md](SKILL.md)，最新平台说明在 [platform.md](references/platform.md)。

从 [Desktop 0.5.0 Release](https://github.com/Nimenta727/molecule-glow-viewer/releases/tag/desktop-v0.5.0)下载 Skill ZIP，解压后的 molecule-glow-viewer 文件夹包含 SKILL.md、references 和 assets。按所用工具的 Skill 安装方式放入技能目录；例如 Codex 的 ~/.codex/skills/ 或 Claude Code 的 ~/.claude/skills/。也可直接让工具读取仓库 skill/SKILL.md。

| 使用方式 | 所需内容 |
|---|---|
| 独立经典演示/场景制作 | assets/index.html（viewer.html 同构建）与 dev.html；首次运行需要 Three.js CDN、RCSB 或本地结构文件 |
| 主体＋官方插件开发 | 本仓库 apps/packages/plugins、当前 handoff、科学卡和功能契约；不能只靠单个经典 HTML 完成 |
| 作者分享 | v1 纯数据包遵循工坊格式；v2 用 Studio/Viewer 导出；新版通用数据动画仍待迁移 |

不要再把 SKILL.md 指示为覆盖其他系统规则的系统提示。需要哪些参考文件由实际任务决定；经典指南的历史实现细节不能覆盖平台说明及当前 handoff。

维护：修改 skill 指南后执行 Skill 校验和包验证；经典源码变更运行 node tools/sync-copies.mjs，生成 assets/index.html、viewer.html、dev.html。node tools/package-skill.mjs 生成带版本/源码/文件哈希的 ZIP。运行资产均来自现有构建，不复制另一套科学引擎。

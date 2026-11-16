# 制作 skill：教人或 AI 做分子场景

这个目录说明这个查看器是怎么做的，以及怎样在上面添加新的结构、机制动画和模拟。可以给人读，也可以直接交给 AI。

## 给 Claude Code
把整个 `skill/` 目录复制到 `~/.claude/skills/molecule-glow-viewer/`。之后直接说"把 XXX 做成动画""加一个 YYY 预设"，Claude 会自动加载它。

## 给其他 AI（ChatGPT、Gemini、Cursor 等）
先把 `SKILL.md` 作为系统提示或第一条消息发给它，再按需要附上 `references/` 里的对应文件，最后附上 `assets/viewer.html` 让它在上面改。

## 内容
| 文件 | 讲什么 |
|---|---|
| `SKILL.md` | 入口：执行规则、工作流、验证清单、各主题的索引 |
| `assets/viewer.html` | 查看器本体（与 `web/index.html` 相同） |
| `references/architecture.md` | 代码结构，以及每个功能的实现方式（按版本分节） |
| `references/processes.md` | 怎样写过程动画（ATP 合酶、呼吸链、叶绿体、离子通道……） |
| `references/paper_to_animation.md` | 从论文或机制描述做出动画：找结构 → 找状态 → 写预设 → 写动画 |
| `references/structures.md` | 怎样查证 PDB 编号、实体名称、配体代码（不要凭记忆写） |
| `references/style_guide.md` | 画风对照：视频光影 / 插画 |
| `references/parameters.md` | 可调参数 |
| `references/small_molecules.md` | 小分子、价键模型、结合位点 |
| `references/setup.md` | 运行环境 |
| `references/troubleshooting.md` | 常见问题（画面全白、发黑、穿模……） |
| `references/rebuild_from_scratch.md` | 从零重建 |
| `references/build_log.md` | 每个版本改了什么、为什么改 |
| `references/scene_packs.md` | 场景包 `.glow` 和纯数据动画的格式：做能分享、能上传创意工坊的场景时先看这个 |

## 动画质量标准
- 粒子从周围溶液扩散过来，不凭空出现、不闪光。
- 粒子不穿过蛋白。
- 每个粒子都标名字：e⁻、光子、H⁺、ATP……
- 化学反应用文字标出。
- 快放看大量粒子流的方向，慢放看每一步的细节。

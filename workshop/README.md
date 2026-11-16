# 创意工坊

查看器里点“🧩 创意工坊”就能浏览这里的场景。打开、订阅、自动更新都在程序里完成。

| 目录 | 内容 |
|---|---|
| `official/` | **官方源**：项目维护的场景，包括全部内置预设和带动画的示例 |
| `community/` | **社区源**：用户投稿的场景 |
| `*/packs/` | 场景包（`.glow`），格式见 [SCHEMA.md](SCHEMA.md) |
| `*/covers/` | 封面图，由 `build-index` 生成 |
| `*/index.json` | 目录：程序读取它来列出场景，文件的 SHA-256 写在里面。由 `build-index` 生成，不要手改 |
| `tools/` | 检查、生成目录、导出预设的脚本（Node 18+，无依赖） |

## 怎么投稿
1. 在查看器里把场景调好（结构、配色、剖面、镜头、讲解），点 **导出场景**，得到一个 `.glow` 文件。也可以按 [SCHEMA.md](SCHEMA.md) 手写，比如加上 `animation`。
2. 二选一：
   - **简单**：打开 [投稿页面](https://github.com/Nimenta727/molecule-glow-viewer/issues/new?template=submit-scene.yml)，填好表单，把 `.glow` 压缩成 `.zip` 拖进去（GitHub 不接受 `.glow` 扩展名）。机器人会自动检查，并把它整理成一个 Pull Request。
   - **熟悉 Git**：把文件放进 `workshop/community/packs/<id>.glow`，提交 Pull Request。
3. 自动检查通过、维护者审核合并后，目录会自动重建，几分钟后场景就会出现在程序的“社区”里。

### 社区场景的要求
- `id` 和文件名一致；不能以 `official.` / `example.` 开头；写上 `author.name`。
- 许可证用 `CC-BY-4.0`、`CC-BY-SA-4.0` 或 `CC0-1.0`。
- 引用的结构和论文写进 `citations`。
- 动画只能用 `animation`（纯数据）描述，不能带代码。也可以引用查看器的内置过程（`process`）。

## 安全
- 场景包只有数据，查看器不会执行包里的任何东西。
- 社区文字里的 `<` `>` 会被转义；`/正则/` 写错时按普通文字处理；数量和大小都有上限。
- 程序下载场景时会核对 `index.json` 里的 SHA-256，对不上就拒绝打开。
- 程序里每个社区场景都有“举报”按钮，点了会打开一个 GitHub issue。

## 评分、评论、举报
- **评分和评论**：每个场景在仓库 Discussions（Show and tell）里有一个讨论帖，👍 / 👎 就是评分，回复就是评论，用 GitHub 账号登录。CI 每 6 小时把点赞数、评论数和最新 3 条评论写进 `stats.json`，程序的工坊卡片读这个文件（`tools/threads.mjs`，新场景会自动建帖）。
- **举报**：用“举报社区场景”issue 模板。机器人（`tools/report.mjs`）确认场景存在并回复；同一个社区场景有 **3 位不同用户**举报时，它会被写进 `community/held.json`，目录重建时不再列出（暂停展示），等维护者审核。审核通过后从 `held.json` 删掉这一项即可恢复。官方场景不会自动下架。

## 维护者
```bash
node workshop/tools/validate.mjs            # 检查全部场景包（也可以给文件路径）
node workshop/tools/build-index.mjs         # 重建 index.json 和封面（结果不变时不改文件）
node workshop/tools/export-presets.mjs      # 把查看器内置预设导出成官方场景包（只在预设改动时升版本）
```
推送到 main 后，GitHub Actions 会自动检查并重建目录（`.github/workflows/workshop.yml`）。投稿 issue 会由 `.github/workflows/workshop-submission.yml` 自动检查并整理成 Pull Request。

### 第二阶段（还没做）
账号登录、一键上传、评分、评论、下载量统计。这些需要一个真正的后端（例如 Supabase 或 Cloudflare）；目录格式（`index.json`）可以保持不变，只是改成由后端生成。

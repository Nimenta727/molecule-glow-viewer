# 2026-11-21 · 0.7.0 之后的下一步计划

## 现状核对（今天实际查到的）

- `main` = `021a16c`，0.7.0 的代码、发行说明（`docs/releases/desktop-v0.7.0.md`）、README 下载链接都已合入。
- **GitHub 上还没有 `desktop-v0.7.0` 标签，也没有 0.7.0 Release**（最新 Release 是 0.6.0，2026-11-20）。README 里的 0.7.0 下载链接此刻是悬空的。
- 发布由 `desktop-release` 工作流负责：推送 `desktop-v*` 标签后，先跑完整闸门（测试、暂存、真实 EXE 启动回归），全过才自动建 Release。

## 本次改动

- 只新增本文件并更新 `docs/STATUS.md` 的“下一步”；没有改代码，没有打标签。

## 下一步（按顺序）

1. **发布 0.7.0（需维护者确认）**：在 `021a16c` 上打标签 `desktop-v0.7.0` 并推送，或在 Actions 里对 main 手动运行 `desktop-release`（该工作流支持手动运行并给通过闸门的提交打标签）。打标签会公开发布并触发 CI，所以先等确认。
2. **发布后核对**：Release 里应有 EXE、Skill zip、validation zip、`release-manifest.json`、`SHA256SUMS.txt`；把 manifest 哈希和闸门结果记入 `docs/validation/desktop-v0.7.0.json` 和一篇 routine（0.6.0 的做法同此）；确认 README 下载链接可用。
3. **维护者事项（我做不了，需要你在真机/GitHub 上操作）**：
   - 在真实 GPU 的 Windows 上运行 EXE，看性能与外观（目前只有软件渲染的 CI 结果）；
   - 把 `platform-release-gate` 设为 main 的必过检查；
   - 为 4.3 完成门槛选定真实的第二个结构对。
4. **0.8.0 开发重点（4.4.8 余下）**：
   - 回退/干预界面、能量条的肉眼确认（浏览器截图）；
   - 把 ATP/AdK 的专用播放器升成 layer-v1 通用工具（构象集已就绪）；
   - 整细胞区域层级的粗略内容与内膜“洞”；
   - 官方作品里 7CGO/8YJT/6YKM/1UCU/4V6F 登记为资源（需结构哈希评审）。
5. **API 缺口**：`style` 画风（需先决定是否把画风做成场景属性）、按残基范围上色（需逐残基着色的渲染）。

## 建议

先做 1–2，让 0.7.0 真正落地；3 并行由你推进；4–5 作为 0.8.0 起点。

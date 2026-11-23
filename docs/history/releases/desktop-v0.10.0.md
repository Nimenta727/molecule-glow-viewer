# 分子光影 Desktop v0.10.0 · 给 AI 的作图接口与光影包

Windows 便携版（未签名，首次运行时 SmartScreen 可能提示，选择“仍要运行”）。默认仍打开经典 Viewer，「工作区」菜单可切换新版 Viewer、Studio 与经典工作台。

## 相比 0.9.0 的新内容

**修复（请优先更新）**
- 个别 Windows 机器上，所有在线结构（RCSB）都显示“载入失败：Failed to fetch”：原因是结构缓存提交时 `rename` 报 `EXDEV`（跨设备链接）。现在遇到这个错误会改为复制再删除。感谢用户提供的调试记录。

**给 AI 的 Studio 命令接口与过程页签**
- `window.studio`：作图和分析的每一步都是一条带校验的命令，中文报错会说明怎么改；Studio 的“过程”页签实时显示每一步，可放慢演示、回到某一步之前。操作手册和制作规范在 Skill 的 `references/studio_authoring.md`。
- 新增命令：`clip`（按视线剖开，对结构、表面都有效）、`part("chain A,B,C", …)`（多链）；`surface` 可加 `inflate`。

**光影包**：暗场·细胞内部、冷光·膜蛋白、暖光·活性位点、论文白底；只改外观，不改坐标。

**大复合体作图**：噬菌体 T7 的衣壳、门户-尾部、核心蛋白等大复合体已用这套命令做成作品（作品留在作者本地，不随发行页发布）；构建脚本在仓库的 `tools/build-phage-model.py` 与 `tools/make-phage-works.cjs`。

## 这个版本没有做到的（请如实看待）

- 真实显卡上的帧率和观感没有测过（开发环境是软件渲染）；大复合体表面每个有几十万到上百万个三角形。
- 0.9.0 里列出的限制仍然成立：静电是简化库仑、氢键/盐桥只用距离、叠合只用 Cα、表面是高斯近似、各处科学表述未经专业人员审阅。

## 资产

- `MoleculeGlow-0.10.0-win-x64.exe`：便携 EXE
- `molecule-glow-viewer-skill-0.10.0.zip`：制作 Skill
- `desktop-validation-0.10.0.zip`：暂存与实际 EXE 回归的日志、截图和 JSON
- `release-manifest.json`、`SHA256SUMS.txt`：源码提交、内容哈希与逐文件校验

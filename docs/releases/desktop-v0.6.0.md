# 分子光影 Desktop v0.6.0 · 通用工具与机理迁移

Windows 便携版（未签名，首次运行时 SmartScreen 可能提示，选择“仍要运行”）。默认仍打开经典 Viewer，「工作区」菜单可切换新版 Viewer、Studio 与经典开发者工作台。

## 相比 0.5.0 的新内容（4.4.x 至 4.4.8）

- 粒子与流动工具：溶液粒子云、路径与流、跨膜事件，可在 Studio 编辑并随作品保存。
- 数据动画引擎：工作位点脉冲、pH 体积、倒带与干预（确定性重放）。
- 能量转换条带、选择语言（含实体正则）、序列条、位点分析与原子级特写。
- 呼吸链与叶绿体光反应的电子/质子接力，按真实结构 5GUP、PSII/b6f/PSI 与经典对照。
- 翻译过程：4V6F 核糖体上的 tRNA/mRNA 移动、EF-Tu/EF-G/RF1、出口隧道、新生肽链与抗生素位点。
- 整个细胞场景：拟核 DNA、核糖体、鞭毛、肽聚糖、LPS 与膜蛋白。
- ATP 合酶与鞭毛马达的转子耦合；ATP 合酶、AdK 运行在通用构象状态机上（金标准轨迹不变）；KcsA 门控运行在通用 Markov 引擎上。
- 修正：桌面打包检查对纯工具插件误要求科学卡，导致 Windows 候选无法构建。

## 资产

- `MoleculeGlow-0.6.0-win-x64.exe`：便携 EXE
- `molecule-glow-viewer-skill-0.6.0.zip`：制作 Skill
- `desktop-validation-0.6.0.zip`：暂存与实际 EXE 回归的日志、截图和 JSON
- `release-manifest.json`、`SHA256SUMS.txt`：源码提交、内容哈希与逐文件校验

所有资产由 `desktop-release` 工作流在标签提交上构建，且完整发布闸门全部通过后才上传。新平台仍为迁移预览，不代表与经典版科学或视觉完全等价，详见 docs/feature-parity.json。

# 从零重做（只在用户明确要求、或 viewer.html 不可用时）

按顺序实现，每一步都有验收标准；不通过不要进下一步。参考实现就是 `assets/viewer.html`，函数名对应 architecture.md。

| # | 实现 | 关键做法 | 验收 |
|---|---|---|---|
| 1 | 空页面 + Three.js | importmap 指向 `three@0.160.0`；黑背景；OrbitControls | 能转动一个测试球 |
| 2 | 下载与解析 | ModelServer 取 CA/P（mmCIF）；按 `_atom_site` 表头定位列；分词要处理引号；只取第一个 model | 4HHB 解析出 574 个残基 |
| 3 | 名称与组装体 | GraphQL 查 polymer/nonpolymer entities + assemblies；解析 `(1-60)(61-88)` 笛卡尔积 | 2FT1 展开后 115,140 个残基 |
| 4 | 定向 | PCA（Jacobi）；long/short/native；`axisFrom` 两质心连线 | 7CGO 竖直；6ZPO 中心柄竖直 |
| 5 | 团块 | 每残基一个 InstancedMesh 实例（二十面体细分 1–2）；半径 4.6；轻微随机大小和亮度 | 一个部件一个颜色，颗粒感 |
| 6 | 着色器注入 | onBeforeCompile：起伏、热运动、菲涅尔边缘（只朝上强）、结合位点脉动、构象 delta、剖开 | 边缘有彩色光，下方暗 |
| 7 | 灯光 | 顶部主光强、无底光、冷蓝背光 + 品红侧光、低环境 | 对照 style_guide.md |
| 8 | 后期 | GTAO → Bokeh → 清深度 → 叠加层 → Bloom（阈值 0.75）→ Output（ACES）→ 调色（饱和/对比/暗角/颗粒） | 无白雾；缝隙暗 |
| 9 | 膜 | 六角网格脂质（头球 + 双尾）、蛋白处挖洞、裁剪平面剖开 | 剖面能看到一根根脂质 |
| 10 | 组件拼接 | 其他 PDB 定向后按锚点高度放置；ring / helix 复制 | 鞭毛马达四部分齐全 |
| 11 | 小分子 | HETATM → 分子；距离成键；球棍 InstancedMesh；CCD 理想 SDF 模板 | 6ZPO 有 ATP/ADP/MG/CDL 行 |
| 12 | 叠加层 | 动画物体单独场景，在 AO/景深之后渲染；先给 readBuffer 清深度 | 口袋里的 ATP 清晰不发黑 |
| 13 | 过程动画 | PROCESSES 注册表 + 补间运行器；状态与转子角度绑定 | ATP 计数随转动增加 |
| 14 | 两构象 | Horn 四元数叠合；每个残基 delta 作为实例属性；uMorph | 4AKE→1AKE 开合 |
| 15 | 面板与图例 | 显/转/剖复选；小分子行；预设按钮；本地文件导入 | 全部控件生效 |
| 16 | 性能 | 画质三档 + 显卡识别；超大结构降细分 | 无显卡 ≥10 fps，独显 ≥30 fps |
| 17 | 健壮性 | 加载令牌（新加载取消旧加载）；setup 完成才激活过程 | 连点预设无报错、无残留 |

每一步都用浏览器截图看画面，并参考 build_log.md 中当时遇到的问题。

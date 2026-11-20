# 2026-11-20 4.4.7c 自动定膜

## 做了什么
把经典 `auto.js` 的膜定位（`autoMembrane`、`hydroSlab`）写成纯函数并逐位对照，再在 Viewer 加“寻找细胞膜”按钮。

## 改动
- 新增 `plugins/structure/membrane-placement.mjs`：`placeMembrane`（跨膜片段主方向→膜法线、中位高度→膜中心、正电在内规则或 UniProt 拓扑定胞质侧）、`hydrophobicBelt`（600 方向疏水带扫描）、`applyPlacement`/`undoPlacement`、RCSB 膜注释查询与解析（`loadMembraneInfo`，网络由调用方注入）。
- `tools/membrane-parity.mjs` + `docs/parity/membrane-parity-report.txt`：经典代码原样运行，结果记录和每个移动后的点**8/8 逐位一致**（KcsA 带拓扑/不带、另一个 KcsA 条目、6ZPO 疏水带扫描、4AKE 可溶阴性对照等）。KcsA 的跨膜片段按已发表拓扑手写（经典是下载 OPM 等），因此全程离线。
- 单元测试 3 项（倾斜螺旋束恢复法线、Lys 侧为内侧、逆变换、RCSB 响应解析）；`npm test` 398/398。
- Viewer：`membrane-view.mjs` + 按钮：有 PDB 编号读 RCSB 注释，否则扫描；画膜的两个面（蓝=外，橙=内），不移动结构，写出来源、半厚度、胞质侧依据与是否确定。6ZPO 实测画出两个面，4AKE 报告“没有找到膜”。截图 `docs/images/membrane-view.png`。

## 与经典的差别
Viewer 路径暂不读 UniProt 拓扑（纯函数已支持）；不自动把结构转到膜水平（经典会）。

## 下一步
通道显示、距离/角度测量、字幕/能量条/书签/图例、残基棍状显示。

# 结构清单

## 查询一个新结构（写进预设前必做）

```bash
# 标题、原子数、链数
curl -s https://data.rcsb.org/rest/v1/core/entry/6ZPO | python -c "import sys,json;d=json.load(sys.stdin);i=d['rcsb_entry_info'];print(d['struct']['title'],i['deposited_atom_count'],i['deposited_polymer_entity_instance_count'])"
# 实体名称（预设关键词从这里挑）+ 小分子
curl -s -X POST https://data.rcsb.org/graphql -H "Content-Type: application/json" -d "{\"query\":\"{entry(entry_id:\\\"6ZPO\\\"){polymer_entities{rcsb_polymer_entity{pdbx_description}rcsb_polymer_entity_container_identifiers{asym_ids}}nonpolymer_entities{nonpolymer_comp{chem_comp{id name}}}}}\"}"
# 按关键词搜编号
curl -s -X POST https://search.rcsb.org/rcsbsearch/v2/query -H "Content-Type: application/json" -d "{\"query\":{\"type\":\"terminal\",\"service\":\"full_text\",\"parameters\":{\"value\":\"ATP synthase bovine monomer\"}},\"return_type\":\"entry\"}"
```
浏览器控制台：`await __viewer.loadScene({id:'XXXX'})` 后 `__viewer.groups().map(g=>g.name)`、`__viewer.ligands().map(l=>l.key)`。

## 已实测（2026-11，v2）

| 预设 | PDB | 团块 / 小分子 | 过程 | 说明 |
|---|---|---|---|---|
| ATP 合酶（合成 ATP） | 6ZPO | 5,150 / 16 | atpSynthase | 牛线粒体 ATP 合酶单体状态 1；ATP×3、ADP、MG、CDL、LHG；18 个部件 |
| 鞭毛马达 | 7CGO + 8YJT + 6YKM×11 + 1UCU×130 | 154,583 / 0 | flagellarMotor | 见下表 |
| 钾离子通道（K⁺ 通过） | 1BL8 | 388 / 3 | ionChannel | KcsA 四聚体，按链着色，K⁺×3 |
| 腺苷酸激酶（开合） | 4AKE ⇄ 1AKE（链 A） | 214 / 1 | 构象变形 | 1AKE 带抑制剂 Ap5A |
| GroEL 伴侣蛋白 | 1AON | 8,015 / 14 | — | ADP、MG 等 |
| 核糖体 | 4YBB | 10,411 / 343 | — | 大量 Mg²⁺ |
| 核小体 | 1KX5 | 1,266 / 18 | — | |
| 蛋白酶体 | 5LE5 | 6,268 / 82 | — | |
| 线粒体呼吸链 | 5GUP + 1HRC + 6ZPO | 19,174 / 67 | — | 按复合体合并部件；电子沿真实辅因子跳 |
| 叶绿体光反应 | 3JCU + 6RQF + 5L8R + 6FKF + 1PLC + 1A70 + 1FNB | 18,512 / 607 | — | 色素默认不勾选；coreLigands 只取电子传递辅因子 |
| （任意）| 4HHB | 574 | — | 血红蛋白（带 HEM） |

鞭毛马达部件：7CGO（杆、MS/LP 环、钩、输出装置）；8YJT（C 环 CCW，顺时针态 8WIW，组件 axis 用 short）；6YKM（MotA5B2 定子，环形 11 个、半径 215 Å）；1UCU（鞭毛蛋白，螺旋上升 4.7 Å、扭转 65.8°）。

ATP 合酶其他可用状态：6ZQM、6ZQN（同一研究的状态 2、3）；6OQR/6OQS（大肠杆菌，含 ATP/ADP/PO4）；1BMF（F1 头部，经典）。

## 推荐尝试（未实测，先查询确认）
| 主题 | PDB | 备注 |
|---|---|---|
| 噬菌体 T4 基板 | 5IV5 | 很大，用低画质 |
| 网格蛋白笼 | 1XI4 | |
| 水通道 | 1J4N | axis short |
| RNA 聚合酶 II | 1I6H | |
| 光系统 II | 3WU2 | 叶绿素等大量配体 |
| SERCA 钙泵两态 | 1SU4 / 1IWO | 先确认链名一致 |

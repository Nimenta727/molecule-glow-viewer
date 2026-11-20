# 官方机制科学验证卡

| 插件 | 机器可读卡 | 适用范围 |
|---|---|---|
| ATP synthase | [atp-synthase.json](../../plugins/atp-synthase/scientific-card.json) | 6ZPO 牛线粒体 c8 教学播放器；质子账本通过，合成/释放计数语义和完整事件仍待比对 |
| KcsA | [kcsa.json](../../plugins/kcsa/scientific-card.json) | 五套坐标、四态教学速率；速率/电流对照通过，随机时钟、区室、水合和曲线未追平 |
| 呼吸链 | [respiratory-chain.card.json](../../plugins/simulation/works/respiratory-chain.card.json) | 5GUP 呼吸体＋6ZPO＋1HRC 组合教学场景；区室动力学与经典逐位一致，电子路径/泵编排未迁，未经专家审阅 |
| 叶绿体 | [chloroplast.card.json](../../plugins/simulation/works/chloroplast.card.json) | 3JCU 光系统 II–LHCII；区室动力学与经典逐位一致，电子路径/泵编排未迁，未经专家审阅 |
| AdK | [adenylate-kinase.json](../../plugins/adenylate-kinase/scientific-card.json) | 4AKE/1AKE A 链两态；闭合端相对 CORE 的域测量通过，反应动力学未迁移 |

[structures.json](structures.json)保留本轮 RCSB 技能查询的紧凑来源摘要；坐标 SHA-256 对应 [固定下载清单](../../tools/fixtures/structures.json)。没有把实体 1 一律当目标蛋白：KcsA 的实体 1 是 Fab，实际通道为实体 3；物种描述据此核对。5VK6 的条目标题明确为 E71A，不能因为 API 的 mutation count 为 0 就称其为野生型。[5VK6 记录](https://www.rcsb.org/structure/5VK6)

三张卡都分别声明实验坐标、推导、建模与示意，以及参数/单位、时钟、方程、物种/代用构象、限制、原始结构文献和验证状态。文献提供结构来源，不自动验证代码中选择的动力学参数。当前均为有测试的教学模型，实验专业验收保持 pending。

主要结构文献：[牛 ATP 合酶结构，2020](https://doi.org/10.1073/pnas.2013998117)；[KcsA 门控构象，2017](https://doi.org/10.7554/eLife.28032)；[AdK 开放结构，1996](https://doi.org/10.1016/S0969-2126(96)00018-4)及 [Ap5A 结合结构，1992](https://doi.org/10.1016/0022-2836(92)90582-5)。机器卡保存本轮核实的 DOI/PMID 和标题。

以后每个安装进受信机制目录的插件都必须有匹配插件 ID/版本的卡，校验器会检查。新增卡至少包含现有三卡的证据分类、结构身份、方程、参数单位、时钟、限制、文献、经典/新版源码和验证记录；不能复制“通过”状态而没有案例与数据。

卡的唯一正文放在各插件目录的 `scientific-card.json`，通过完整官方插件复制规则进入桌面产物；此目录集中保存查询摘要和阅读索引，不复制第二份卡。

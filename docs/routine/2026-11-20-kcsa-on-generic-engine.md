# 2026-11-20 KcsA 动力学并入通用 Markov 引擎

## 做了什么
- KcsA 的 pH 门控、TBA/Ba²⁺ 阻断和四态敲击渗透：`plugins/kcsa/kinetics.mjs` 的 `createKinetics` 原来是手写的一条连续时间马尔可夫链，现在是**通用引擎的薄封装**：模型是数据（`plugins/simulation/works/kcsa-gating.mjs`，由原先 `test/kcsa-markov.mjs` 的验收用例转为随包发布的作品），`createMarkovRun` 做精确 Gillespie 抽样、参数时间表、时钟、计数；封装只负责把引擎的状态变回播放器读的字段（构象权重、阶段、上次 K⁺ 移动时间等由事件逐个折叠而来，增量保存）。
- 验证：同种子同时间表，事件、事件时刻、状态、时钟、计数与旧链**逐位一致**（24 个种子×5 个时间表，`markov-model.test.mjs`）；KcsA 播放器黄金轨迹（6 个时间点、改参数、保存重开）不变；`npm test` 413。数值基线只有源码哈希更新（`kcsa-max-rate` 等数字一样）。

## ATP 合酶、AdK
它们的算法（环旋转、构象插值、叠合、位移）早已使用共享的 `plugins/motion`（conformation、vectors）、`plugins/structure`（alignment、representation）和 `plugins/shared`（绑定、配置校验）；播放器剩下的是各自的时间轴、粒子和事件编排。这部分不是可再并的算法，所以没有为“并入”而改写（改写只会增加风险）。工具描述符 `rotary-atpase`、`conformation-pair` 本来就是以配置驱动的通用名字，4.3 的完成门槛（另一个结构对复用同一工具）仍等你选定真实的第二个结构对。

## 下一步
KcsA 的体相粒子、水合、曲线；Studio 粒子预览；能量转化条。

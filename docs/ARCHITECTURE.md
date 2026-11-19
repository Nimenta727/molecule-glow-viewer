# 当前结构与制作链

## 目标边界：资源、功能插件、作品

维护者本次澄清优先于此前“一个机制内容对应一个插件”的理解。下面是需要落实的产品边界，不代表 0.5.0 已完成拆分。

| 层次 | 保存什么 / 提供什么 | 例子 |
|---|---|---|
| 主体 | 场景状态、资源引用、选择、时间轴、编辑/播放、保存、插件宿主 | Viewer、Studio、Core/Schema |
| 功能插件 | 可复用制作工具、模拟计算或科研分析；声明适用输入、参数、单位、输出与限制 | 构象叠合/插值、旋转/路径动画、粒子流、区室/反应网络、距离/接触/口袋分析 |
| 原始资源 | 可复用结构及其来源，不预置特定教学剧情 | 导入的 PDB/mmCIF、蛋白复合体、配体、多个实验构象 |
| 作品 | 资源的实例布局、工具配置、动画/模拟规则、参数、镜头、讲解、分析结果及证据 | 线粒体呼吸链演示、ATP 合酶教学、KcsA 门控实验、全细胞展示 |

创意工坊提供独立的**资源区**与**作品区**。同一结构可被多个作品引用；作品可以使用多个功能插件。作者导入蛋白质，从工具面板选用功能，配置并预览，然后保存工程或发布作品。科研插件针对适用输入给出分析结果、方法、单位和证据；不把导入任意结构等同于自动推断真实机制。

资源记录应保留来源/原始字节哈希、编号/构象/组装体、授权与署名；同一 accession 的修订不能悄悄替换旧作品使用的字节。作品记录资源引用和可离线携带的副本、能力 ID/版本、配置与状态。缺资源或缺能力时明确提示并在可用范围内预览；工坊资源和作品均不携带可执行 JavaScript。分析结果属于作品/分析记录，不改写原始结构。

插件实现可内部拆分科学算法，也可有专业适用范围，但不能把某个蛋白或某个作品写死成唯一入口。新增作品应尽量组合已有能力和资源；确需新算法时补一个有输入/输出契约的功能插件。科学来源拆分为资源来源、插件方法/假设、作品参数与解释三层，现有科学卡在迁移前继续保留。

## 当前代码与目标的差距

`plugins/atp-synthase`、`plugins/kcsa`、`plugins/adenylate-kinase` 仍是内容与能力耦合的过渡实现。它们的存在和已通过测试是现状，不是后续插件划分标准。需逐项提取通用工具，把指定结构、布局、剧情和参数移到资源/作品数据；保留旧 ID 兼容与科学回归，不能只改目录名宣布完成。线粒体、呼吸链等后续内容作为验收作品，不再逐个新增同名内容插件。

以下为当前源码关系：

```text
src/ --tools/build.mjs--> web/index.html + dev.html
                         |--> desktop 经典工作区
                         `--> skill/assets/index.html + viewer.html + dev.html
apps/viewer-web/ -------> packages/core + schema + plugin-host + render-three
       `---------------> plugins/structure + rcsb + mechanism-catalog
                          ATP synthase / KcsA / AdK 过渡专用实现
apps/studio-web/ -------> studio-editor + 同一 Core/Schema/渲染能力
workshop/ .glow v1 -----> legacy-compat + 结构/布局恢复 + 对应已安装播放器
Studio / Viewer -------> .glow v2 ZIP + 原始资源 + 状态 + 来源/预览
```

经典 src 保留独立科学与渲染实现，是回退和行为基线；新平台是迁移目标。两者仍并存，[重复实现表](DUPLICATION_MAP.md)记录未合并位置。

新版入口协调加载/UI；mechanism-runtime.mjs 适配 prepare/create/降级，复用原 loaded、资源与播放器句柄。领域模型放插件，复用场景、选择、相机、时钟和生命周期，不增加平行状态源。全面合并依 [Claude 交接](CODEX_MIGRATION_HANDOFF.md)收尾。

Schema 限制包大小/条目、路径和链接，校验 CRC/SHA-256；legacy-compat 保留旧声明。旧过程只有匹配已安装受信播放器才获得动态行为。社区包只携带数据。

| 桌面模块 | 职责 |
|---|---|
| platform-shell.cjs | 默认经典、工作区菜单、版本/提交/内容哈希 |
| response-cache.cjs | 限量、超时/并发、流式缓存和原子元数据 |
| network-policy.cjs | 内部页面、外链、导航/重定向和弹窗策略 |
| src/api/embed-permissions.js | 两代共用 origin/窗口/场景绑定授权 |
| package-platform.cjs | 完整官方插件/科学卡复制、暂存/portable 构建；不能借仓库补依赖 |

科学卡唯一正文在插件目录并进入 EXE；查询摘要与契约在 docs/science、docs/parity。Skill 的经典 HTML 同步 web 构建，platform.md 路由新平台开发。发布使用同一干净源码版本的 EXE、Skill ZIP、校验与清单，明确区分 main、构建提交、标签和公开下载文件。

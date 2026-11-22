# 用 Studio 命令接口做作品（给 AI 的操作手册和制作规范）

Studio（`apps/studio-web/index.html`，桌面版“工作区 → Studio”）有一个给 AI 用的命令接口 `window.studio`：作图和分析的每一步都是一条带校验的 JSON 命令，不需要点页面。专业制作者在同一个 Studio 里看着“过程”页签实时显示你的每一步，可以随时接手修改、撤销。**你做的每一步都是作品里普通的、可撤销的修改。**

## 1. 开工前

1. 在能跑 Studio 的页面里调用（浏览器自动化、Electron 桌面版的开发者工具、或 Playwright 脚本）：`await studio.help()`。它列出全部命令、使用规矩和每个分析的限制。`await studio.help("surface")` 只看一条。
2. `await studio.info()` 看场景现状；`await studio.structures()` 看里面有哪些结构、链、残基数。
3. 命令都返回 Promise，按顺序排队执行；参数写错会得到中文报错并说明怎么改，不会静默忽略。**读报错，改参数，再试**，不要换一种说法绕过去。

## 2. 命令总览（以 `help()` 为准）

| 做什么 | 命令 |
|---|---|
| 结构 | `import({pdb})` 新建作品；`addStructure({pdb})` 往同一场景加结构（最多 4 个）；也可 `{name,text}` / `{name,base64}` |
| 选择 | `select("chain A and resi 10-50")`（设为“当前选择”，分析命令的默认输入）；`select("none")` |
| 表示与颜色 | `show(选择, "cartoon"/"backbone"/"blob"/"sticks"/"hidden")`；`color(选择, "#e05a4a"\|"hydrophobicity"\|"bfactor"\|"charge"\|"secondary")`；`show("reset")`、`color("reset")` |
| 表面 | `surface(选择, "electrostatic"\|"hydrophobicity"\|"plain", "#颜色"?)`；`surface("clear")` |
| 标注 | `measure(a,b[,c])`（每个选择必须正好一个残基）、`label(选择, 文字)`、`annotations("clear")` |
| 分析（默认只算不写） | `contacts({a,b,cutoff?,write?})`、`composition({part,write?})`、`secondary({part,write?})`、`superpose({mobile,reference,mobileStructure?,referenceStructure?,mode?,write?})` |
| 对象与镜头 | `parts()`、`part("ligands"\|"all"\|"chain X", true/false)`、`camera({focus:"选择"})`、`camera({position,target})`、`cameraKey({time})` |
| 光影 | `lookPack("glow.cell-dark"\|"glow.membrane-cool"\|"glow.active-site-warm"\|"paper.clean-white"\|"none", {recolor?})` |
| 讲解与发布 | `note(文字)`、`title(文字)`、`publication({author,license,topic,description,tags})` |
| 撤销与交付 | `undo()`、`redo()`、`snapshot({width})`、`exportScene()`（返回 base64 的场景包） |

`write` 里写什么才会写进作品：contacts 的 `paint`/`draw`/`record`，composition 的 `hydrophobicity`/`charge`/`record`，secondary 的 `paint`/`record`，superpose 的 `place`/`mark`/`record`/`reset`。`record` 把结果记为“推导”证据，自动写明方法和阈值。

## 3. 一个完整作品的顺序

1. `import` 结构，`structures()` 核对链和残基数是不是你以为的那个（不要凭记忆写链名）。
2. 先 `select` 要讲的部分，看回包里的残基数对不对，再设表示和颜色。
3. 分析：先不带 `write` 跑一次看数字，确认合理再带 `write` 写进作品；`record` 每个分析各记一次。
4. `lookPack` 选光影；大复合体先 `part("ligands", false)` 或 `part("all", false)`（只留表面时）再画表面。
5. `camera({focus})` 对准要讲的部分；需要动画就在几个时间点 `cameraKey`。
6. `note` 写讲解，`title`，`publication`，最后 `exportScene()` 并**读回来核对**（见 §6）。

## 4. 制作规范（必须遵守）

**诚实**
- 算出来的东西不是测出来的：所有分析结果都是“推导”，不能写成“实验测得”。静电势是简化库仑（不是 APBS），氢键/盐桥只用距离（没有角度），叠合只用 Cα，二级结构是文件登记的。**每个分析回包里有 `limits`，对外转述结果时必须带上。**
- 不知道的写不知道。阈值（4.5 Å、3.5 Å、4.0 Å）是常用经验值，不是结构决定的结论。
- 叠合移动整条链后，高亮、测量、标签、界面列表和表面仍按原始坐标，不会跟着走：用到这些之前先想清楚顺序（先标注，再移动，或移动后重新算）。
- 不要宣称“与 PyMOL/ChimeraX 一致”，除非你真的对照过同一输入。

**来源与可复现**
- 结构用 PDB 编号取，写进作品的是原始文件；不要手改坐标。多结构对比要在讲解里写明各是哪个条目、哪个状态（开放/闭合）。
- 叠合的“核心”选择要说明依据（哪些残基、为什么）；不要用全长去叠铰链运动的蛋白（会得到很差的结果）。
- 作品里每条事实应能在原文件里核对。拿不准的不写进讲解。

**画面（光影与配色）**
- 一种东西一种色相：核酸暖色（红）、蛋白冷色（蓝/紫），不按链各给一种颜色；颜色只用来区分类别或表示一个量，并且要有图例或讲解说明（如“红 = 负电，蓝 = 正电，饱和在 ±10 kcal/(mol·e)”）。
- 光影包只改外观，不改坐标和结论。深色包（`glow.*`）用于展示和海报；投稿图用 `paper.clean-white`（白底、不加轮廓和景深）。
- 一个画面只讲一件事：先用 `part`/`show(...,"hidden")`/`camera({focus})` 去掉无关部分；大复合体表面很重（一个亚基几十万个三角形），能少画就少画。
- 导出前 `snapshot({width: 1600})` 看一眼：颜色是不是对、有没有遮挡关键部分、文字标签是否压在一起。

**与专业制作者协作**
- 你的每一步会实时出现在 Studio 的“过程”页签；专业制作者可能随时改动作品。**每一步之前用 `info()` 重新读一次现状**，不要假设上一步的结果还在。
- 不要一口气发几十条命令不看回包；回包里的数字、`note` 和 `wrote` 要读，和预期不符就停下来说明。
- 想让人看清楚做了什么，可以让他们把“过程”页签的“演示速度”调慢。

## 5. 常见错误

| 现象 | 原因与做法 |
|---|---|
| “没有选中任何残基” | 选择语言写错或链名不对：先 `structures()` 看链，再 `select` 试 |
| “应正好选中一个残基” | `measure`/`label` 的每个点只能是一个残基：用 `resi 57`，不要用范围 |
| “结构里没有链 protein” | `color("protein", …)` 里单独一个词会被当成链名（整链上色）：要按残基上色就写成选择表达式，如 `"protein and not nucleic"`、`"chain A and resi 1-60"` |
| “棍状…一次最多 300 个残基” | 缩小选择（`within 5 of ligands`、一小段） |
| “这部分太大/超过表面上限” | 一次只画一个亚基或一组链；核糖体级别会自动用粗网格，仍不行就拆开 |
| “对应多个对象，不能移动” | 结构带生物组装体（同一链名多份）：换 `asym` 选择，或导入时不展开组装体 |
| 屏幕上看不到表面/光影 | 用的是 Viewer：先点“启用官方结构插件”；Studio 里不需要 |

## 6. 交付前的核对

1. `exportScene()` 得到 base64 场景包；用仓库的 `packages/schema/archive.mjs` 的 `readScenePackage` 读回来，检查标题、规则（`viewerState` 里的 `styles`/`surfaces`/`bonds`/`measures`/`labels`/`lookPack`）、证据条数和 `publication`。
2. 几何类结果（叠合、放置）**独立重算**：用场景包里的链变换和原始坐标文件，在脚本里自己算一遍 RMSD，应与命令回包一致（参考 `tools/studio-api-check.cjs`、`tools/cross-superposition-check.cjs`）。
3. 在 Viewer 里打开场景包（`?startup=skip`，点“启用官方结构插件”），确认颜色、线、表面、光影和镜头关键帧与 Studio 里一致。
4. 写 `docs/routine/<日期>-<主题>.md`：做了什么、改了什么、没做到什么、下一步。

## 7. 在仓库里改这个接口

- 命令表和实现：`apps/studio-web/studio-commands.mjs`；每个命令都走 `packages/plugin-host/panels.mjs` 的五扇门（外观、标注、证据、整条链位置、自己的数据），不要绕过。
- 新增分析：做成面板（`plugins/structure/panels/`）并导出 `recordResult`，命令里直接复用；清单写进 `plugins/packages/*.json` 并如实写限制；浏览器检查用独立重算验证。
- 命令接口的队列在 `apps/viewer-web/command-api.mjs`（Viewer 与 Studio 共用），“过程”页签通过它的 `onEvent`/`pace` 钩子显示，不能改变命令或回包。

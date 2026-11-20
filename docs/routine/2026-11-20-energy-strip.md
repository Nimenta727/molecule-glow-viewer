# 2026-11-20 4.4.8 能量转化条（随作品配置）

## 做了什么
经典查看器顶部的“能量转化”条（一排步骤，播放时轮流点亮，点一步看讲解并高亮涉及的结构）现在是**作品配置的一部分**：写在数据动画工具的 `config.energy` 里，随作品保存，Studio 可编辑，呼吸链、叶绿体、鞭毛马达三个官方作品自带经典的步骤文字。

## 改动
- `plugins/simulation/energy-strip.mjs`（新，纯逻辑）：`normalizeEnergy`（1–12 步、名称/讲解/表达式长度限制、`stage.mode` = `manual` | `cycle`、轮流周期 2–120 s，每个错误按名称报告）与 `litStep(energy, t)`（按动画时钟轮流；手动模式、负数/非有限时间返回 -1）。
- `plugins/simulation/data-tool.mjs`：`normalizeDataConfig` 接受并校验 `energy`；`dataAuthorFields` 为每一步生成名称、讲解、涉及结构三个字段，外加“哪一步亮”和周期。
- `plugins/simulation/works/mechanism-energy.mjs`（新）：三个作品的步骤数据（呼吸链 7、叶绿体 7、鞭毛 5 步）。文字由脚本从经典 `web/index.html` 的 `energy`/`energyHL` **原样提取**，经典的 `/^复合体 I$/` 这类键转成选择表达式；与提取结果逐字比对一致。`mechanism-works.mjs` 为三个作品附上它的副本。
- `plugins/structure/selection.mjs`：`entity "/正则/"` 写法（不分大小写，≤ 198 字符，写错报 `SelectionError`）。原因：经典里高亮键可以是锚定正则，纯子串的 `entity "复合体 I"` 会同时命中 II、III。原有写法行为不变。
- `apps/viewer-web/energy-strip.mjs`（新）+ `index.html` / `viewer.css` / `main.mjs` / `data-animation.mjs`：视口顶部的条；全部用 `textContent` 构造，作品文字不会进 HTML。点击展开讲解并用已有的选择入口标出结构；“◎ 跟随”在步骤变化时自动标出，**读者自己的选择不会被覆盖**；表达式写错只在状态栏报告该步骤。
- 文档：`skill/references/tools.md` 增加 `energy` 格式；`docs/feature-parity.json` 三个作品的 `remaining` 去掉“能量条”并说明新做法。

## 验证
- `npm test`：430/430（+1 选择语言、+4 能量条纯逻辑与作品配置、+5 组件逻辑；此前 420）。第一次提交时有 1 个失败（Skill 包校验：`tools.md` 里的相对链接指向包外），随后修复；教训：提交前以退出码而不是 grep 输出判断测试结果。组件逻辑用最小假 DOM 在 Node 里测：点击→讲解与标记、再点关闭、坏表达式只上报、跟随不覆盖读者选择、无结构表达式时不出现跟随按钮。
- `check-docs`、`check-copies`、`check-feature-parity`、`parity-numerics`：通过。
- 环境问题：容器没装依赖，先 `npm ci`（`@cfworker/json-schema`），之后 viewer 的三个测试文件才能跑；与本次改动无关。

## 没有做（诚实清单）
- **浏览器里没有看到这条能量条。** 在容器里启动本地 HTTP 服务器被权限分类器拒绝，所以没有做 Playwright 实测与截图；DOM 与 CSS（位置、窄屏、与右上标题徽章/左侧面板的遮挡）、真实结构上 `entity "/^复合体 I$/"` 能否命中经典部件名（依赖布局写入 `model.chainNames`），都**未经肉眼确认**。
- `kinetics-parity`（需要 `desktop/node_modules/three`）与 `selection-parity`（需要真实结构目录）没有重跑；动力学模型未改，选择语言只新增了正则分支。
- 点亮顺序只是示意：经典按电子实际位置点亮（`stage()` 取自编排代码，电子编排尚未迁移）。
- ATP 合酶、KcsA、AdK、翻译、细胞一角的能量条未做（前三者是专用播放器，翻译/细胞一角是别的工具；这些工具没有 `energy` 字段）。

## 下一步
1. 在能运行本地服务器的环境里做浏览器实测：打开三个官方包，确认条的显示/轮流/点击/跟随，并检查标题徽章与面板是否遮挡；截图放 `docs/images/`。
2. 把 `energy` 也接到其它工具（翻译、随机过程、多过程）和旧三件播放器，需要先决定这些工具的时钟。
3. 回退/干预界面；电子/质子沿辅因子链运动的编排（做完后可把点亮顺序改成取自它）。

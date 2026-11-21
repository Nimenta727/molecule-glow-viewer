# 场景包格式 `.glow`（glow-scene v1）

一个场景包就是一个 UTF-8 JSON 文件，扩展名为 `.glow`，里面只有数据，没有代码。查看器和工坊的自动检查用的是同一套规则：`web/index.html` 里的 `sanitizePack` 和 `checkAnimation`。

## 顶层字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | ✓ | 固定为 `"glow-scene"` |
| `version` | ✓ | 格式版本，现在是 `1`。查看器遇到比自己新的版本会提示更新 |
| `id` | ✓ | 小写字母、数字、`.`、`_`、`-`，3–64 个字符；文件名必须是 `<id>.glow`。官方用 `official.` 开头，社区作品建议用 `<作者>.<名字>` |
| `revision` |  | 内容版本，从 1 开始，每次更新加 1。订阅的人靠它判断有没有更新 |
| `title` | ✓ | 标题，最多 80 字 |
| `category` | ✓ | `cell`（细胞）/ `system`（局部系统）/ `single`（单个蛋白）/ `mechanism`（分子机理） |
| `tags` |  | 最多 8 个，每个最多 20 字 |
| `author` | 社区必填 | `{ "name": "...", "url": "https://..." }`，url 只接受 https |
| `license` | 社区必填 | `CC-BY-4.0`、`CC-BY-SA-4.0` 或 `CC0-1.0` |
| `description` |  | 一两句话的介绍，显示在工坊卡片上；场景没有 `caption` 时也用作底部说明 |
| `citations` |  | `[{ "pdb": "1K4C", "ref": "作者 (年份) 期刊 卷, 页" }]` |
| `cover` |  | 封面，`data:image/jpeg;base64,...`，不超过约 450 KB。查看器导出时自动截取 |
| `created` / `updated` |  | 日期 `YYYY-MM-DD` |
| `derivedFrom` |  | 派生自哪个作品：`{ "id": "official.kcsa", "revision": 1 }`（`revision` 可省）。校验要求：来源在工坊里存在、`revision` 不超过它现有的版本、不自己派生、没有循环，且授权必须与来源兼容（来源含 CC BY-SA → 只能 CC BY-SA；来源是 CC BY → CC BY 或 CC BY-SA；CC0 → 三种皆可）。工坊详情里会显示派生链和“来源已更新”提示 |
| `scene` | ✓ | 场景本身，见下 |

## `scene`：场景

字段和查看器内置预设完全一样（`web/index.html` 里的 `PRESETS`）。最常用的：

| 字段 | 说明 |
|---|---|
| `id` | PDB 编号（4 位，首位是数字）。没有 PDB 编号时用 `structure` |
| `structure` | 内嵌结构，用于 AlphaFold 或自己建的模型：`{ "name": "model.cif", "text": "<mmCIF 或 PDB 原文>" }`，上限 30 MB。证据徽章把它算作“建模”；如果它其实是某个 PDB 条目的实验坐标，加 `"source": { "pdb": "1ABC" }` |
| `chains` | 只显示这些链，如 `["A"]` |
| `components` | 再放进来的其他结构：`[{ "id": "1HRC", "label": "细胞色素 c", "axis": "long" }]`，最多 16 个 |
| `states` | 两个构象之间变形：`["4AKE", "1AKE"]` |
| `axis` | 哪个方向竖直：`long` / `sym` / `short` / `native` |
| `colors` | 部件名 → 颜色。键可以是名字的一部分，或者 `/正则/` |
| `notes` | 部件名 → `[标签, 一句话作用, 详细讲解]`，用于点击讲解 |
| `siteNotes` | 小分子代码 → 讲解 |
| `energy` | 能量转化条：`[[步骤名, 解释], ...]` |
| `membranes`、`memR` | 膜的位置（`[{ "at": "部件名", "offset": 0 }]`）和半径 |
| `cut`、`cutWhat` | 剖面 |
| `camera` | `{ "az": 弧度, "el": 弧度, "dist": 倍数 }`。查看器导出时会记下当前视角 |
| `ligOff` | 默认隐藏的小分子代码 |
| `caption` | 底部说明文字 |
| `process` | 内置过程动画的名字，如 `atpSynthase`、`kcsa`。只能用查看器自带的；社区作品请用 `animation` |
| `mechanism` | 具体机理定义：关注对象、状态/步骤、锚点、输入输出和证据说明；适合一个小分子或一个蛋白质的局部机理展示。当前 v1 查看器先保存并校验该数据，步骤播放器按工程规范逐步接入 |
| `animation` | 纯数据动画，见下 |
| `evidence` | 证据等级补充说明，显示在标题下的徽章里：`{ "experimental": [...], "derived": [...], "modelled": [...], "illustrative": [...] }`，每项一句话。查看器会自动列出它能推出来的（PDB 坐标、简化外形、插值、动画粒子……），这里补充只有作者知道的，例如“复合体之间的距离按冷冻电镜断层图估计” |
| `seed` | 随机数种子（整数）。同一个种子，粒子路径、拥挤分子摆放、随机事件每次都一样，便于讲课和截图对比 |

社区作品里的文字会被转义（`<` → `&lt;`），不能插入 HTML；`/正则/` 写错或超过 200 字会当成普通文字处理。

## 用工作台和命令接口制作
- 打开 [`web/dev.html`](../web/dev.html)（[在线版](https://nimenta727.github.io/molecule-glow-viewer/dev.html)）：左边编辑 JSON，“校验”用的就是查看器和 CI 同一套规则，“预览”在右边实时打开，“下载 .glow”后可“投稿到工坊”。
- AI 或脚本可以直接调用查看器的 `window.glow`（同页）或 `postMessage`（嵌入时）：`glow.help()` 列出全部命令；`glow.validatePack(pack)` 校验；`glow.load({pack})` 预览；`glow.exportPack({title, ...})` 从当前画面生成场景包。

## `animation`：纯数据动画（v1）

用数据描述粒子从哪里来、经过哪里、到哪里去，由查看器的运动引擎画出来：
- 粒子从溶液扩散过来，绕开蛋白，每个都有名字。
- 反应用文字标出。
- **慢放**看每个分子，**快放**（时间尺度切到快放）看粒子流。

```json
"animation": {
  "version": 1,
  "orient": { "up": { "ligands": "K" } },
  "species": { "AMP": { "col": "#7ee0a0", "r": 2.8 } },
  "compartments": {
    "胞内": { "side": "below", "membrane": 0, "gap": 24 },
    "胞外": { "side": "above", "membrane": 0, "gap": 24 }
  },
  "pools": [ { "species": "K⁺", "in": "胞内", "n": 10 } ],
  "flows": [ {
    "name": "K⁺ 外流", "species": "K⁺", "from": "胞内", "to": "胞外",
    "via": [[0, -14, 0], { "ligands": "K", "order": "up" }],
    "labelVia": "K⁺（脱水）",
    "events": [{ "at": 2, "text": "脱水：羰基氧替代水分子" }],
    "rate": 0.8, "counter": "K⁺ 外流"
  } ],
  "reactions": [ {
    "name": "磷酰基转移", "site": { "ligand": "AP5" },
    "in":  [{ "species": "ATP", "from": "溶液" }, { "species": "AMP", "from": "溶液" }],
    "out": [{ "species": "ADP", "to": "溶液" }, { "species": "ADP", "to": "溶液" }],
    "text": "ATP + AMP → 2 ADP", "rate": 0.3, "counter": "ADP 生成"
  } ]
}
```

| 部分 | 说明 | 上限 |
|---|---|---|
| `orient.up` | 让这个锚点所在的一侧朝上（主轴方向的正负是随机的） | — |
| `species` | 自定义粒子：颜色 `col`、半径 `r`（0.8–6 Å）。内置的有 H⁺、e⁻、K⁺、Na⁺、O₂、H₂O、NADH、NAD⁺、NADPH、NADP⁺、ATP、ADP、Pi、PQH₂、QH₂、光子 hν、激发能、CO₂ | 24 种 |
| `compartments` | 隔室：`side` 为 `above` / `below` 时表示第 `membrane` 层膜的上方 / 下方，`gap` 是离膜中心的距离（Å），`r` 是溶液范围（模型半径的倍数，默认 1.2）。不写就只有一个“溶液” | 6 个 |
| `pools` | 某个隔室里游荡的粒子数 `n` | 24 个池，n ≤ 40 |
| `flows` | 一条通路：粒子从 `from` 隔室的溶液取一个，扩散到 `via` 第一个点，沿 `via` 依次经过，再扩散进 `to` 隔室。`labelVia` 是在通路里时的名字，`events` 在经过第 `at` 个点时弹出文字，`rate` 是每秒次数，`counter` 是底部计数器的名字 | 16 条，via ≤ 40 个点，rate ≤ 30 |
| `reactions` | 一个反应：`in` 的分子从各自隔室扩散到 `site`，消失，弹出 `text`，`out` 的分子从 `site` 扩散进 `to` 隔室（不写 `to` 就在原地淡出） | 16 个，每个 ≤ 8 个分子 |

可选的时间参数（秒，快放时按转速缩短）：`tIn`、`tVia`、`tOut`、`hold`。`free` 是允许贴近锚点的距离（Å），默认 flow 6、reaction 10。

### 锚点（坐标都是 Å，模型坐标系）

| 写法 | 位置 |
|---|---|
| `[x, y, z]` | 直接写坐标 |
| `{ "ligand": "AP5", "index": 0 }` | 第 `index` 个该小分子的中心 |
| `{ "ligands": "K", "order": "up" }` | 所有该小分子（对称拷贝去重），按 y 从下到上（`down` 从上到下）展开成多个点 |
| `{ "residue": 77, "part": "kcsa", "chain": "A" }` | 某个残基（作者编号）的位置 |
| `{ "part": "subunit a" }` | 部件的中心 |
| `{ "membrane": 0 }` | 第 0 层膜的中心 |
| `{ "centre": true }` | 模型中心 |

每种写法都可以加 `"offset": [dx, dy, dz]`。

## 示例
- `official/packs/official.kcsa-data.glow`：flows，离子通过通道。
- `official/packs/official.adk-reaction-data.glow`：reactions，酶催化。

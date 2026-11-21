# 在有独立显卡的电脑上安装并验收（给 AI 读的提示词）

**怎么用**：在那台电脑上打开 Claude Code（或别的能执行命令的 AI），把下面“提示词”整段复制进去。它会安装、跑测试、跑 GPU 验收，最后给你一份报告和一张“请你亲眼看”的清单。
**它做不了的**：判断画面好不好看、动画顺不顺——这些必须你自己看，提示词里已经要求它不替你下结论。

**两条路线，提示词里都有**：
- **A. 下载桌面版（EXE）验收**（步骤 A）：这是“用户真正拿到手的东西”，包含全部插件。**只有在 v0.8.0 发布之后才有**；如果下载返回 404，说明还没发布，让 AI 停下来告诉你。
- **B. 源码 + GPU 脚本**（步骤 1–4）：能测出每个场景在这张卡上的真实帧率，自动出报告。EXE 本身不带这个脚本，所以两条路线要一起跑。

提示词里的分支名 `claude/affectionate-fermat-fxt4cr` 是目前所有工作所在的分支；合并到 main 之后，把它改成 `main`。工坊里的“血红蛋白”作品是从 GitHub 的 main 分支读取的，所以 EXE 里要在合并之后才看得到它。

---

## 提示词（从这里开始复制）

```
你是一个验收助手。目标：在这台有独立显卡的电脑上，把“分子光影”（molecule-glow-viewer）装起来，按下面的步骤跑自动检查，收集证据，最后写一份诚实的验收报告。你不是来修 bug 的。

【铁律】
1. 不修改仓库里的任何代码、测试或阈值；不 git commit、不 git push；不要为了“让它通过”去改任何东西。步骤失败时，原样记录命令、退出码和关键输出，然后继续后面能做的步骤。
2. 不替我判断“画面对不对、动画顺不顺、好不好看”。自动检查只能说明“跑得动、没报错、数字在范围内”。这类判断只能写进“请你亲眼看”清单，留给我。
3. 软件渲染不算显卡。如果 WebGL 渲染器名字里有 SwiftShader、llvmpipe、Microsoft Basic Render、Software 等字样，这次就不是显卡验收，必须在报告最前面写明，并帮我排查（见步骤 4 的排查表）。
4. 遇到需要我做的决定（装软件、改系统设置、联网权限），停下来问我，不要自己决定。需要管理员权限的操作先告诉我要做什么。
5. 不要把任何账号、令牌、个人信息写进报告或命令行。
6. 全程用中文向我汇报；命令和错误信息保持原文。

【步骤 0：看看这台机器】
- 记录：操作系统与版本、CPU、内存、显卡型号与驱动版本（Windows：`Get-CimInstance Win32_VideoController | Select Name,DriverVersion`；有 NVIDIA 卡再跑 `nvidia-smi`）。
- 笔记本或台式机装了两块显卡（集显 + 独显）时，注意浏览器默认可能用的是集显：记下来，步骤 4 会用到。
- 确认 Node.js ≥ 20（`node -v`）和 git。缺了就告诉我，不要擅自安装。

【步骤 A：下载桌面版并校验（发布后才有；404 就停下来告诉我“还没发布”）】
（PowerShell）
  $v = '0.8.0'; $base = "https://github.com/Nimenta727/molecule-glow-viewer/releases/download/desktop-v$v"
  New-Item -ItemType Directory -Force desktop-release | Out-Null; Set-Location desktop-release
  foreach ($f in "MoleculeGlow-$v-win-x64.exe", 'SHA256SUMS.txt', 'release-manifest.json') { Invoke-WebRequest "$base/$f" -OutFile $f }
  Get-FileHash "MoleculeGlow-$v-win-x64.exe" -Algorithm SHA256
  Get-Content SHA256SUMS.txt
把算出的哈希和 SHA256SUMS.txt 里 EXE 那一行逐字比较，不一致就停下，告诉我，不要运行。再读 release-manifest.json，把 version、sourceCommit、signed（应为 false：未签名）、gate.run（发布闸门那次运行的网址）抄进报告。
运行：这个程序未签名，Windows SmartScreen 可能拦一下，“仍要运行”要我自己来点——请告诉我，不要替我点。为了能在里面跑 `glow.benchmark()`，用下面的方式启动（开发者工具会在旁边弹出）：
  $env:GLOW_DEVTOOLS = '1'; Start-Process ".\MoleculeGlow-$v-win-x64.exe"
在 EXE 里确认并记录：
  a) 菜单“帮助 → 版本与构建”：版本应为 0.8.0，提交号应等于 release-manifest.json 的 sourceCommit；
  b) 菜单“工作区”切到新 Viewer，点“工坊”：应有“静态作品 / 作品区 / 资源区 / 插件区 / 我的模板”五个分页；“插件区”应有 17 个插件；“静态作品”里应有“血红蛋白：四个亚基与四个血红素”（需要联网，且要在合并到 main 之后）；
  c) 开发者工具的控制台里：`await glow.help()`，核对命令列表包含 complex、assemble、embed、compose、interactions、binding、source、instances、volume、membrane、benchmark；
  d) 打开任意结构后：`await glow.benchmark()`，把返回的 renderer、software、stats.fps、budget、tier 抄进报告（software 为 true 就是没用显卡，按步骤 4 的排查表处理）；
  e) 关闭程序再打开一次，确认能正常启动（不闪退、不白屏）。
然后让我做步骤 7 的清单（EXE 里点工坊打开作品，代替 ?work= 地址）。

【步骤 1：取代码并安装】
  git clone https://github.com/Nimenta727/molecule-glow-viewer.git
  cd molecule-glow-viewer
  git checkout claude/affectionate-fermat-fxt4cr
  npm ci
  npm ci --prefix desktop
  npm install --no-save playwright@1.63.0
  npx playwright install chromium
记录 `git rev-parse HEAD`（提交号）写进报告。`--no-save` 是为了不改 package.json。

【步骤 2：单元测试（只用 CPU，不涉及显卡）】
  npm test
期望：全部通过（本次发布时是 670 项以上，0 失败）。记录通过/失败数；有失败就贴出失败测试名和报错。

【步骤 3：取固定的真实结构（带哈希校验）】
  node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures
记录输出里每个结构是否“verified”。如果网络不通，告诉我，后面的 GPU 验收会改走实时 RCSB，同样需要网络。

【步骤 4：GPU 验收（最重要）】
  node tools/gpu-acceptance.cjs --out gpu-acceptance-out
它会打开一个可见的浏览器窗口（不要最小化、不要遮挡，更不要切到别的程序——后台窗口会被浏览器降速，帧率会失真），依次跑：显卡自检、血红蛋白作品、ATP 合酶、呼吸链、核糖体翻译、鞭毛马达、整细胞、叶绿体光反应、实例化 100/400/2000 份、膜蛋白嵌膜 40/400 份、新增命令冒烟。大约 10–30 分钟，请耐心等，不要中途打断。
结果在 gpu-acceptance-out/ 里：report.md（人读）、report.json、每个场景一张截图。
- 先看 report.md 第一行的结论：PASS / FAIL / NOT A GPU RUN。
- 如果是 NOT A GPU RUN（用了软件渲染），按这张表排查，每试一项就重跑一次 `node tools/gpu-acceptance.cjs --out gpu-acceptance-out`：
  a) 打开 Chromium 的 chrome://gpu（Playwright 的浏览器：`npx playwright open chrome://gpu`），截图或抄下 “Graphics Feature Status” 和 “GL_RENDERER”，写进报告；
  b) 驱动是否太旧、是否装了厂商驱动（不是 Windows 自带的“基本显示适配器”）——只告诉我，不要自己装；
  c) 双显卡笔记本：Windows 设置 → 系统 → 屏幕 → 图形 → 添加 Playwright 的 chromium（它装在 `%LOCALAPPDATA%\ms-playwright\chromium-*` 下面，找到里面的 chrome.exe）→ 选项 → 高性能；这个要先问我同意；
  d) 是否在远程桌面/虚拟机里：远程桌面会话常常没有显卡加速，告诉我，需要我在本机登录跑。
- 如果是 FAIL：把 report.md 里“未通过”的项、原因和对应截图列出来，不要解释成“可以忽略”。
- 报告里 “能保持 30 fps 的每帧三角形预算” 和 “档位” 是这张卡的关键数据，请原样抄进你的最终报告。

【步骤 5：Windows 桌面程序（EXE）验收——仅 Windows；做不了就说明原因】
  node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures --refresh
  node desktop/scripts/package-platform.cjs --stage-only
  node tools/platform-release-smoke.cjs --stage <上一条输出的目录> --fixtures desktop/dist/smoke-structures --output desktop/dist/gate-stage
  node desktop/scripts/package-platform.cjs
  （PowerShell）$candidate = Get-Content desktop/dist/release/candidate.json | ConvertFrom-Json
  node tools/platform-release-smoke.cjs --exe (Join-Path 'desktop/dist/release' $candidate.file) --fixtures desktop/dist/smoke-structures --output desktop/dist/gate-exe
记录每条命令的退出码和最后 30 行输出。然后用 `npm start --prefix desktop` 打开桌面程序一次，确认窗口能打开、不闪退，把 EXE 版本号和“帮助 → 版本与构建信息”里的提交号抄下来。再让我在窗口里亲手做步骤 7 的清单。

【步骤 6：用浏览器版做人工看图（给我准备好）】
在仓库根目录起一个本地静态服务（任选一种，保持它运行）：
  npx --yes http-server . -p 8765 -c-1
然后告诉我这几个地址（用我的默认浏览器打开，别用 Playwright 的）：
  新 Viewer：            http://localhost:8765/apps/viewer-web/index.html?startup=skip
  血红蛋白作品：         http://localhost:8765/apps/viewer-web/index.html?startup=skip&work=2hhb-d4e8f138-3f31-4d3f-b219-aec06f657ba8
  ATP 合酶作品：         http://localhost:8765/apps/viewer-web/index.html?startup=skip&work=official.atp-synthase.work
  核糖体翻译作品：       http://localhost:8765/apps/viewer-web/index.html?startup=skip&work=official.translation.work
  呼吸链作品：           http://localhost:8765/apps/viewer-web/index.html?startup=skip&work=official.respiratory-chain.work
  Studio：               http://localhost:8765/apps/studio-web/index.html
（页面里用 Three.js 的 CDN 版本，需要能访问 cdn.jsdelivr.net；不通就告诉我。）

【步骤 7：请你亲眼看（把这张清单原样放进最终报告，留空让我填）】
请我逐项看并回答 好 / 有问题 / 看不出来，有问题就写现象（最好截图）：
 1. 血红蛋白作品：四条链颜色不同；左侧有 α 链、β 链、血红素、磷酸根的标注，有两条证据和“全貌”书签；点“全貌”能回到整体视角。
 2. ATP 合酶作品：点播放后中央柄/c 环在转，右侧计数 ATP、H⁺ 随转角增加；转动是否顺畅（有没有卡顿或跳帧）。
 3. 核糖体翻译作品：展开面板里点“播放”（过程面板），核糖体朝向你的一侧被剖开，里面能看到橙色/红色的 tRNA 在位点间移动，右侧有新生肽链从出口通道伸出；肽链长度、已合成蛋白数在增长。
 4. 呼吸链作品：能量转化条随步骤点亮，计数器在走。
 5. 工坊（Viewer 里点“工坊”）：有“静态作品 / 作品区 / 资源区 / 插件区 / 我的模板”五个分页；“我的模板”里能导入一份自己的结构文件（必须选授权）、能从 PDB 编号添加（试 4AKE）、刷新页面后还在、点“打开结构”能打开；“插件区”里有 17 个插件，停用“膜蛋白插膜”后在控制台 `await glow.embed({shape:{kind:'sphere',radius:400},copies:3})` 会提示已停用。
 6. 控制台（F12）里在打开任意结构后运行：`await glow.benchmark()`，把返回的 renderer、fps、budget、tier 抄给我（这就是这张卡的真实数据）。
 7. 实例化：打开结构 6N2Y（RCSB 编号框输入后“打开结构”），控制台 `await glow.instances({copies: 2000})`，转动、缩放时是否流畅；`await glow.instances(null)` 能清除。
 8. 膜蛋白嵌膜：打开 1K4C（勾选“导入时使用生物组装体”），控制台 `await glow.embed({shape:{kind:'sphere',radius:1600},copies:400,seed:3})`，看囊泡上的 400 个通道是否均匀、朝向是否一致（朝向相对于膜是否合理要人判断）。
 9. 滚动、缩放、旋转时有没有明显掉帧、闪烁、花屏、黑块。
10. 整个过程中有没有崩溃、白屏、风扇狂转到不正常。

【步骤 8：交付】
写一份 gpu-acceptance-out/ACCEPTANCE_REPORT.md，结构固定：
  1. 结论（一句话）：显卡验收 通过 / 未通过 / 不是显卡验收（为什么）。
  2. 机器：系统、CPU、内存、显卡与驱动、WebGL 渲染器、提交号。
  3. 各步骤结果表：步骤 / 命令 / 退出码 / 通过与否 / 备注（失败要贴关键输出）。
  4. GPU 数据：每个场景的帧率、三角形数、档位、预算（来自 report.json）。
  5. 自动检查没覆盖的事（直接抄步骤 7 的清单，留空）。
  6. 你的观察：只写事实（“第 3 项我看到……”），不写“应该没问题”。
  7. 问题清单：每条一行——现象 / 在哪一步 / 证据（文件名）。
然后把 gpu-acceptance-out 文件夹压成 zip，告诉我路径。不要上传到任何地方。
```

## 提示词到此结束

---

## 给你的说明（不用复制）

- **步骤 A 的下载地址和资产名来自发布工作流**（`MoleculeGlow-<版本>-win-x64.exe`、`SHA256SUMS.txt`、`release-manifest.json`），在 v0.8.0 真正发布之前它们不存在。**其余每条命令都在仓库里真实存在**（`tools/gpu-acceptance.cjs`、`tools/fetch-smoke-structures.mjs`、`desktop/scripts/package-platform.cjs`、`tools/platform-release-smoke.cjs`、`npm test`）。`gpu-acceptance.cjs` 在没有显卡的容器里用 `--software` 试跑过：显卡自检、嵌膜 40/400 份、命令冒烟通过，且正确地把结论标成“NOT A GPU RUN”；**真显卡上的数字没有测过**——那正是这次要你验收的。
- 自动判定：血红蛋白、ATP 合酶、呼吸链要求 ≥ 30 fps（场景不重）；其余场景只记录并在低于 15 fps 时提醒。这些阈值是我定的经验值，不是标准；如果你的卡全部低于它，先看 report.md 里的“档位”和预算，再决定阈值是否合理。
- 翻译作品、整细胞、叶绿体在软件渲染下没有完整跑过（太慢）；真显卡上第一次跑，出现失败请把报告和截图发回来。
- 官方作品里的结构会按哈希校验：如果 RCSB 之后更新了某个条目的文件，作品会拒绝打开并说明——这是设计行为，请原样记下。

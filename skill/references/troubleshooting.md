# 故障排除（症状 → 原因 → 解决）

| 症状 | 原因 | 解决 |
|---|---|---|
| 页面全黑，没有面板 | Three.js CDN 加载失败 | 控制台看 `Failed to fetch dynamically imported module`；换网络或按 setup.md §4 离线部署 |
| 状态栏“下载失败 …” | 编号不存在 / RCSB 不可用 / 网络拦截 | 浏览器直接打开该地址看返回 |
| “找不到 PDB 条目” | 未发布或已作废 | rcsb.org 搜索确认 |
| 画面一大片白光 / 奶白雾 | 辉光、自发光、曝光太高；白色部件进 bloom；外壳半透明 | 见 style_guide.md 失败画面表 |
| 转动时有些结构消失 / 闪烁 | v2 的剖面每帧跟随相机 | 已修：楔形剖面固定在模型上；要换剖开方向点“剖面对准当前视角” |
| 结构示意模式里螺旋 / 折叠不对 | 条目没有沉积二级结构注释，退回 Cα 几何猜测 | 控制台查 `__viewer.groups()[0].atoms.some(a=>a.ss>0)`；本地文件没有注释是正常的 |
| 结构示意模式外壳发灰 / 雾 | 外壳进了 AO 或用了普通半透明 | 保留两遍渲染（depth + color）和 `hideShellsDuring` |
| 团块颜色发白 / 边缘光总是白色 | 片元着色器用了 `#ifdef USE_INSTANCING_COLOR`（只在顶点着色器定义） | 用 `#if defined(USE_COLOR) \|\| defined(USE_INSTANCING_COLOR)` |
| 插画画风描边太粗 / 物体越大描边越粗 | 在物体空间沿法线外推（受缩放影响） | 在视空间外推，宽度 ∝ 深度 |
| 简化弯管上有黑色条纹 | 路径带螺旋起伏，管自交 | 路径平滑 ±6 残基，控制点稀疏化 |
| 剖开的团块像玻璃泡泡 | 用了逐片元裁剪 | 用内置“剖”（整颗团块去掉） |
| 小分子看不见 / 发黑 | 埋在口袋里被 AO 压暗、被前面团块挡住 | 动画分子用 `ctx.makeMol`（自动进叠加层）；静态配体可勾“剖”剖开外壳；调大“小分子大小” |
| 叠加层的分子仍被挡 | `RenderPass.clearDepth` 在 r160 清错目标 | 保留 `ClearDepthPass`，不要换成 clearDepth=true |
| 不同 boost 的配体材质看起来一样 | three 复用了同一个着色器程序 | 设 `customProgramCacheKey` |
| 转子转起来摆动 | PCA 轴和真实转轴有偏差 | 预设用 `axisFrom: [转子部件, 定子头部]` |
| 组件方向错（如 C 环正对镜头） | 定向模式选错 | C 环 `short`；换 long/short/native 试，`flip: true` |
| 关键词匹配到错误部件 | “subunit a” 也匹配 “subunit alpha” | 用正则 `'/subunit a$/'`，或把更具体的键写在前面 |
| 过程动画报 `Cannot read properties of undefined` | update 在 setup 完成前被调用 | 已修：setup 完成后才激活；自写过程不要在 update 里假设 setup 中断后的状态 |
| 连点预设后场景混在一起 | 两次加载交错 | 已修：加载令牌；自写代码在 `loadScene` 的每个 await 后调用 `live()` |
| 构象变形没反应 | 两个条目链名不一致，配对 0 个残基 | 状态栏看“匹配 N 个残基”；用 `chains` 或换条目 |
| 只看到小点 / 细线 | 取景被长细丝撑大 | 取景只按主结构；调 `camera.dist` |
| 膜看不见 | 膜半径太小或位置不在跨膜处 | `memR`、`membranes.at`；查 `__viewer.model().entityStats` |
| 卡顿 | 软件渲染 / 团块太多 | 降画质；减少组件拷贝；`chrome://gpu` 确认独显 |
| 动画完全不动、帧率显示 “—” | 页面在隐藏的窗口/面板里，浏览器暂停了 requestAnimationFrame | 让窗口可见（Claude 内置浏览器：先显示浏览器面板） |
| 控制台 `Framebuffer is incomplete: zero size` | 窗口尺寸为 0 | 显示窗口；测试时先设视口再触发 resize |
| 网址参数无效 | 预览工具把页面转成 data: 地址 | 用真实浏览器打开；测试时用控制台设置控件 |

## 自动化测试方法（给 AI）
1. 打开 `viewer.html`；**确保浏览器面板可见**；视口设 1280×720 后 `dispatchEvent(new Event('resize'))`。
2. 等加载并读状态（脚本工具通常 45 秒超时：长任务放到后台 async 里跑，结果写进 `window.__out` 再读）：
   ```js
   window.__out = []; (async () => { const V = window.__viewer;
     for (const n of Object.keys(V.PRESETS)) { await V.loadScene({ ...V.PRESETS[n], name: n }); await new Promise(r => setTimeout(r, 2500));
       window.__out.push(n + ' | ' + document.getElementById('status').textContent + ' | ' + JSON.stringify(V.proc()?.ctx.counters || null)); }
     window.__out.push('DONE'); })();
   ```
   **同一时间只跑一个这样的循环**（超时的脚本仍在后台运行，再开一个会两份加载交错）。
3. 设置控件：
   ```js
   const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
   set('quality', 'medium'); document.getElementById('panel').classList.add('hidden');
   ```
4. 拉近到位点截图：
   ```js
   const V = __viewer, S = V.proc().sites[1].S; V.controls.target.copy(S);
   V.camera.position.set(S.x + 150 * Math.cos(-0.6), S.y + 60, S.z + 150 * Math.sin(-0.6)); V.controls.update();
   ```
5. 截图亲眼看（SKILL.md 步骤 6）。无显卡机器先 `set('quality','low')` 加载，再切“中”截图。

## v4 常见问题
- **聚焦出现 0.5 Å 的“盐桥”**：位点文件里有 altloc A/B 两套原子，只保留 '.', '?', 'A'。
- **浏览器预览里 `?preset=` 不生效**：预览把本地文件转成 data: URL，`location.search` 为空；测试时用 `__viewer.loadScene({...__viewer.PRESETS[k], name: k})`。
- **某个部件不该是半透明背景**：它被判成③支架（简化、无核心、不转、无构象）。给预设加 `keepDetail` 或 `core`，或在“组成”里取消“简”。
- **找不到预设**：预设键是中文名（如 '钾离子通道（K⁺ 通过）'），用正则在 `Object.keys(PRESETS)` 里找。

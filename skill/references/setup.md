> 经典环境指南；其中历史帧率和硬件预期不是本次发行认证。实际性能须在目标机器测量，平台边界见 [platform.md](platform.md)。

# 运行环境：硬件 → 软件 → 设置 → 验证

## 1. 硬件分档（实测 + 预期）

| 档位 | 例子 | 自动画质 | 鞭毛马达全套（约 15.5 万团块） | 说明 |
|---|---|---|---|---|
| 无显卡 / 远程桌面 / 虚拟机 | WebGL 显示为 “Microsoft Basic Render Driver” / SwiftShader / llvmpipe | 低 | 实测“低” ≈10 fps，“中” ≈18 fps（1280×720） | 能看、能转，但有延迟；适合检查 |
| 核显 | Intel UHD/Iris、AMD Radeon Graphics、Apple M1 | 中 | 预期 20–40 fps | 关掉景深更流畅 |
| 独显笔记本 | RTX 4060/5070 Ti Laptop 等 | 高 | 预期 60 fps 级 | 必须让浏览器用独显（见 §3） |
| 台式高端卡 | RTX 4090/5090 | 高 | 轻松 | 可把鞭毛丝拷贝数调到 300+ |

显存不是瓶颈（几十万实例只用几百 MB）。瓶颈是三角形数量（团块数 × 每个团块面数）和后期特效（AO、景深）。

## 2. 软件

| 项目 | 要求 | 说明 |
|---|---|---|
| 浏览器 | Chrome / Edge 最新版（需要 WebGL2） | Firefox 也可；Safari 未测 |
| 显卡驱动 | NVIDIA 最新 Studio / Game Ready（RTX 50 系需 R570+） | 驱动太旧时浏览器会把 GPU 列入黑名单 → 退化为软件渲染 |
| 网络 | 能访问 `models.rcsb.org`、`data.rcsb.org`、`files.rcsb.org`、`cdn.jsdelivr.net` | 前三个提供结构和小分子数据；最后一个提供 Three.js 库（0.160.0） |
| 可选：Python | 任意 3.x | 仅在需要本地服务器（`python -m http.server`）时用 |

不需要安装 Blender、ChimeraX、Node.js 或任何插件。

## 3. 设置（独显笔记本必须做）

1. Windows 设置 → 系统 → 屏幕 → 显示卡 → 添加 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）或 Edge → 选项 → **高性能**。
2. Chrome 设置 → 系统 → 打开“使用图形加速功能（如果可用）”，重启浏览器。
3. 地址栏打开 `chrome://gpu`：
   - “WebGL2: Hardware accelerated” 才对；
   - 页面下方 “GL_RENDERER” 应包含 NVIDIA 显卡名。若是 Intel 或 “Basic Render”，回到第 1 步。
4. 笔记本插电源，电源模式“最佳性能”；厂商控制中心（如 NVIDIA 控制面板 / 奥创中心）可开“独显直连”。
5. 在查看器里核对：控制台输出 `GPU: ... -> quality high`；面板帧率 ≥ 30。

## 4. 离线使用（可选）

查看器默认从 CDN 读 Three.js、从 RCSB 读结构。完全离线需要：
1. 下载 `three@0.160.0` 的 `build/three.module.js` 和 `examples/jsm/`（npm 包 `three@0.160.0` 里都有），放到 `viewer.html` 同目录的 `three/` 下；
2. 把 `<script type="importmap">` 里两个地址改成 `./three/build/three.module.js` 和 `./three/examples/jsm/`；
3. 结构数据：离线时用面板“导入本地文件”打开事先下载的 .cif/.pdb（小分子过程动画仍需联网下载理想构型）。
4. 离线时用 `python -m http.server` 打开（`file://` 下 ES 模块读本地文件会被拦截）。

## 5. 首次验证（新电脑上按顺序做）

1. 打开 `viewer.html`（默认自动加载“ATP 合酶（合成 ATP）”）。
2. 等状态栏出现 `完成：5,150 个残基团块，16 个小分子`；说明文字下方的 ATP / H⁺ 计数开始增加。
3. 点“鞭毛马达”：粉色 C 环、绿色定子、蓝色环、粉色钩、白色鞭毛丝、两层剖开的膜（约 15.5 万团块）。
4. 鼠标左键拖动旋转、滚轮缩放应顺畅；面板帧率符合 §1。
5. 输入 `4HHB` → 加载，应出现血红蛋白（574 个团块）。

# P0 桌面打包与真实产物验收

日期：2026-11-19。代码提交：`384cdcfa5029a87b46979ad9f4929aad5a751ea6`，本地构建时工作区干净。范围为执行计划 **4.0**；机器可读结果见 [运行记录](validation/2026-11-19-p0.json)，复验命令见 [发布验收方法](RELEASE_VALIDATION.md)。

## 结果

本地暂存目录与真正 portable EXE 各六例通过；远端 [platform-release-gate](https://github.com/Nimenta727/molecule-glow-viewer/actions/runs/44493471035) 的 `source`、`windows-artifact` 均成功。后者独立执行结构下载、暂存目录六例、Studio M3、Windows 打包及实际 EXE 六例。CI 上传候选和证据，不发布 GitHub Release。

完整官方插件目录随平台复制，包含机制目录及其依赖；入口依赖检查从暂存目录、提取后的 ASAR 内解析，不向仓库借模块。共享桌面入口/菜单模块取代打包时字符串替换。默认入口恢复经典 Viewer，新版和 Studio 保留菜单入口。版本帮助显示提交、工作区和内容哈希。

## 本地候选身份

| 项目 | 值 |
|---|---|
| 文件 | `MoleculeGlow-0.4.0-384cdcfa-win-x64.exe` |
| 字节数 | 78,924,302 |
| EXE SHA-256 | `53fa4858be86735881e6abc438f4ce1c87ba82f4c1e9f8b45c4a48ac457eb12d` |
| ASAR SHA-256 | `2dbe28dee92a6e09a3687207ede778960455ed117fed9e7818997a3c7b522f50` |
| 清单内容 SHA-256 | `946d21b78185e9f8db64bc29a94124015298fb9d39473d39f48330bd75f139a4` |
| 环境 | Windows 10.0.26300 x64；Node 26.13.1；Electron 33.4.11；SwiftShader |

这些哈希指向本地候选，不能用于标识 CI 独立构建的二进制。候选未签名，未覆盖已有公开下载版本，也未创建发行标签。

## 实际页面与文件回归

每例均检查真实 app 根目录、隔离用户目录和缓存、无页面错误；EXE 模式确认 `app.isPackaged=true`，运行中的 ASAR 哈希与预先校验的归档相同。保持 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。

| 案例 | 暂存 / EXE | 实测内容 | EXE 截图 |
|---|---|---|---|
| 经典默认入口 | 通过 / 通过 | 本地 PDB 四残基；v1 API 导出、重开；可见分子 | [常规](images/p0-exe-classic-normal.png) / [窄屏](images/p0-exe-classic-narrow.png) |
| Studio | 通过 / 通过 | 创建/编辑对象；保存工程产生真实文件，修改后重开恢复；导出真实 v2 ZIP | [常规](images/p0-exe-studio-normal.png) / [窄屏](images/p0-exe-studio-narrow.png) |
| 新 Viewer 本地结构 | 通过 / 通过 | 文件输入、表示、选择；保存按钮下载 ZIP、重开及镜头/选择恢复 | [常规](images/p0-exe-local-normal.png) / [窄屏](images/p0-exe-local-narrow.png) |
| ATP | 通过 / 通过 | 6ZPO、播放/暂停、4 示意秒 3 ATP / 8 H⁺、保存重开、插件停启 | [常规](images/p0-exe-atp-normal.png) / [窄屏](images/p0-exe-atp-narrow.png) |
| KcsA | 通过 / 通过 | 五套真实坐标、通量与平衡电位、播放/暂停、参数与状态保存重开、插件停启 | [常规](images/p0-exe-kcsa-normal.png) / [窄屏](images/p0-exe-kcsa-narrow.png) |
| AdK | 通过 / 通过 | 两态结构、域运动、手动/自动、播放/暂停、参数与状态保存重开、插件停启 | [常规](images/p0-exe-adk-normal.png) / [窄屏](images/p0-exe-adk-narrow.png) |

Studio 与新版保存检查真实桌面下载完成并校验所得文件；经典用 v1 API 字节回读，不冒称覆盖经典系统保存对话框。已人工查看全部十二张截图；窄屏现有面板需要滚动，最终布局和画风对齐仍待收尾。

## 数据与其他检查

- 八份原始 RCSB 坐标重新在线下载成功，逐份字节数与 SHA-256 匹配 [固定清单](../tools/fixtures/structures.json)。数据没有打进 EXE。运行案例预置各自隔离缓存并禁止外网回退，从而把在线获取与离线重放分开验证。
- 完整 Node 测试 **116 项通过**，含包安全及四项打包检查；负例验证遗漏机制依赖、越界路径、远程模块、CJS 辅助文件与篡改清单不能通过。
- 经典构建/副本一致性、15 个官方包的数据校验通过。后者不等于 15 包的全部机制已迁移。
- Studio M3 原有工程/场景/关键帧/证据/书签/导出回归通过；CI 同样执行。

## 仍需后续完成

P0 关闭的是本次打包阻断与产物回归缺口。敏感嵌入授权、经典 DOM 注入、桌面网络缓存及协议白名单继续列在 **4.1**；经典数值对照、科学验证卡、其余机制和最终视觉等价继续待验收。本次软件渲染不能证明真实 GPU 性能。

工作流已实际成功，但分支保护的 required checks 仍需维护者配置；本次未修改该设置。桌面没有现成的系统文件关联工作流，未声称验收操作系统文件关联安装。入口别名和默认页已有测试。不得将此记录称为全量迁移完成或正式发行。

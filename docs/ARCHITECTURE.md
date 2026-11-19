# 当前结构与制作链

```text
src/ --tools/build.mjs--> web/index.html + dev.html
                         |--> desktop 经典工作区
                         `--> skill/assets/index.html + viewer.html + dev.html
apps/viewer-web/ -------> packages/core + schema + plugin-host + render-three
       `---------------> plugins/structure + rcsb + mechanism-catalog
                          ATP synthase / KcsA / AdK 官方机制
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

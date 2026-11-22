# 2026-11-22 桌面版结构缓存 EXDEV 修复

## 起因
用户在 Windows 11 上运行 0.8.0 桌面版，所有场景都停在“载入失败：Failed to fetch”。用户提供的调试记录（直接启动、抓 stderr）找到根因：`desktop/response-cache.cjs` 把下载好的 `*.bin.part` 原子重命名为 `*.bin` 时，`fs.rename` 抛 `EXDEV`（跨设备链接），下载链路报错，页面看到的就是 Failed to fetch。网络、TLS、代理都不是原因。

## 改动
- `desktop/response-cache.cjs`：新增 `renameSafe`，遇到 `EXDEV` 降级为复制后删除，其余错误照常抛出；缓存提交的两处 `rename` 都改用它。
- `tools/test/response-cache-rename.test.cjs`：两条测试（EXDEV 回退、正常重命名并重抛其他错误）。

## 说明
- 用户的修复补丁只改了解压临时目录里的 asar，关闭后会丢；这次改的是仓库源码，**需要发新版桌面版才会对用户生效**。
- 该问题在 0.8.0 和 0.9.0 里都存在（源码相同）。

## 下一步
1. 下一次发版时带上（用户的症状只有这一个）。
2. 噬菌体作品继续（见 2026-11-22-phage-model-start.md）。

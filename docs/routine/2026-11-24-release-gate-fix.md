# 2026-11-24 发布闸门修复（Desktop 0.13.0）

## 做了什么
- 0.13.0 第一次发布运行（45309422211）在闸门 `gate / windows-artifact` 失败：`Timeout: ZIP reopened`。
- 原因：新加的“本地作品”功能在打开 .glow 后会把状态栏从文件名改成“已打开“标题”…并记入工坊的“本地””，而发布冒烟测试一直在等状态栏**恰好等于文件名**。软件本身没坏，是测试的判断太窄。
- 第一次修改（PR #45）只放宽了发布冒烟测试，重跑后下一个闸门 `Studio M3 authoring regression`（`tools/studio-smoke.cjs`）同样因等不到文件名而超时——几十处检查都依赖“打开后状态栏显示文件名”这个约定。
- 最终修改（改应用，不改测试）：`apps/viewer-web/main.mjs` 打开 .glow 后状态栏**保留文件名**，“已记入工坊的‘本地’”改为状态栏的悬停提示；只有记入失败时才改状态栏。`tools/platform-release-smoke.cjs` 恢复原样；`tools/local-works-check.cjs` 改为检查悬停提示，并不再写死 T7 作品名。
- 验证：`npm test` 756 项全过；`local-works-check`（用 KcsA 作品）打开、本地区显示名称、按名称导出、改名、从本地重新打开、删除全部通过。
- Studio 的“导入场景包”仍显示“已导入…并记入工坊的‘本地’”（没有检查依赖它）。

## 没做到的
- 本容器以 root 运行且没有显示服务器，Electron 冒烟无法在本地跑，修复由 CI 的 Windows 闸门验证。

## 下一步
1. 发布成功后触发 `works-release.yml`（tag `desktop-v0.13.0`），把 T7 完整模型与部件作品挂到发行页并核对。
2. 开始 T4：先放宽场景包/资源上限，再规划部件（5VF3 头部、EMD-6323 等）。

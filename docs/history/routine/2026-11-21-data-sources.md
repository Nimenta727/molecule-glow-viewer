# 2026-11-21 · A4 外部数据源客户端

## 做了什么

`plugins/sources/data-source.mjs`：受信的数据源客户端。取回函数、缓存、哈希簿都是**注入**的（浏览器传自己的，测试传假的）。
- 每个数据源写明：主机白名单、编号格式、URL、大小上限、是否 gzip、资源类型、授权、`verified` 标记。内置 `rcsb`（已对真实服务验证）、`alphafold`、`emdb`（**未验证**，带 `note` 说明）。
- `createSourceClient().load(source, accession, { signal, expectedSha256, allowUpdate })`：先校验编号与主机（只许 https 与白名单主机，重定向到别处也拒绝）→ 取回（边读边限大小，gzip 的在**解压后**也限大小；超时、取消都有明确的错误码）→ 算 SHA-256 → 若给了期望哈希必须相符 → 若之前记录过哈希而这次不同则拒绝（`changed-upstream`，除非明确 `allowUpdate`）→ **所有检查通过才写入缓存与哈希簿**（首次使用即记录，trust on first use）。
- 没有网络时：按记录的哈希从缓存读，**重新核对哈希**；缓存被改过就拒绝；从没见过就报 `offline`。
- `resourceFor`：按数据源的类型生成资源记录（结构 / 预测结构 / 体积）。

## 验证

- 单测 7 项（假取回函数）：首次记录与二次核对；坏编号、未知数据源、不在白名单的主机、非 https、被重定向到别处——都在请求之前或之时被拒；超大、解压炸弹（几百字节解压成十万字节）、HTTP 404、取消；gzip 解压后按解压的字节哈希；期望哈希、上游变化、失败时不写缓存；断网读缓存、篡改缓存被拒、从没见过则 `offline`；资源记录与 URL 形式。
- **真实**：`node tools/datasource-check.mjs`——通过客户端真的从 RCSB 取回 1OMP、1ANF：**哈希与 `tools/fixtures/structures.json` 里钉住的逐位一致**（331 434 与 356 558 字节）；模拟断网后从缓存读出相同的哈希；篡改缓存被拒；没缓存又断网报 `offline`；不存在的条目带原因拒绝。

## 如实说明

- **只有 RCSB 对真实服务验证过。** AlphaFold 数据库（alphafold.ebi.ac.uk）和 EMDB（ftp.ebi.ac.uk）在本环境被代理拦截，URL 形式（AlphaFold 的 `AF-<编号>-F1-model_v4.cif`、EMDB 的 `emd_<编号>.map.gz`）和授权（CC BY 4.0、CC0）都是我凭印象写的，**没有核对过**，数据库可能已换新的模型版本或文件布局，使用条款必须在启用前读过；
- trust on first use 意味着第一次取回的东西被当作基准：如果第一次就拿到了错的或被替换的文件，客户端不知道；想要更强的保证，要在调用时给 `expectedSha256`（例如工坊目录里记录的哈希）；
- 缓存与哈希簿的持久化（浏览器的 IndexedDB 等）没有做，现在只有内存版本；
- 没有接进 Viewer/Studio 的界面，也没有做 UniProt、相互作用数据库、蛋白质组丰度这几类数据源；
- 没有限速、重试、进度显示。

## 下一步

核对 AlphaFold 与 EMDB 的接口与条款后把 `verified` 改成真；做持久化存储与界面；把取回结果登记进资源库（A1/A2 的资源类型已就绪）。

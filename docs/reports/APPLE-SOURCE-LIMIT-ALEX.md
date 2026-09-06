# Alex：六项 Apple HTML 来源限制的独立核查

关联 [#11](https://github.com/zequnjiang/appeye/issues/11)，依据 `FULL-SCAN-2026-09-07.md` 的 FS-SU-01～07。**六项有限尝试均已终止为 failed，证据交 PM 判断本轮来源限制；未将资料取得记为成功。** 此现象与已修复的 [#14](https://github.com/zequnjiang/appeye/issues/14) Google Play 目录路由缺陷分开，整体采集仍未完结。

Alex 于 **2026-09-06T19:16:00.850Z** 对正式 SQLite 执行只读事务核查。脚本 `.artifacts/alex-apple-source-limit.mjs`，聚合证据 `data/batches/finance-2026-09-07-alex-apple-source-limit.json`，异常计数 **0**。未新增商店请求、未写真实数据库、未操作生产进程。官方重定向探测由 CEO 执行，Alex 检查其已保存的状态/Location/时间记录；不声称独立重复联网探测。

| App / 市场 / 商店 ID | 类型 | 任务 | 原累计尝试 → 最终累计尝试 | 最终 failed 时间 UTC |
| --- | --- | --- | --- | --- |
| 1060 / PH / 871608181 | privacy | 15128 | 3 → 6 | 19:15:20.478 |
| 1060 / PH / 871608181 | versionHistory | 15129 | 3 → 6 | 19:15:22.415 |
| 1060 / PH / 871608181 | inAppPurchases | 15130 | 3 → 6 | 19:15:24.324 |
| 1172 / PK / 1089271220 | privacy | 16024 | 3 → 6 | 19:15:26.273 |
| 1172 / PK / 1089271220 | versionHistory | 16025 | 3 → 6 | 19:15:28.171 |
| 1172 / PK / 1089271220 | inAppPurchases | 16026 | 3 → 6 | 19:15:30.082 |

## 原因证据与采集范围

运行时实际请求分别为 `https://apps.apple.com/ph/app/id871608181` 和 `https://apps.apple.com/pk/app/id1089271220`，国家/商店 ID 正确。六项新 attempt 4–6 的 HTTP ledger 全部保存 `fetch failed`，并带底层 `redirect count exceeded`。Node fetch 未返回最终 Response，因此 ledger 的 HTTP status/body 为 null；这里不能把该 null 解释为上游直接返回的状态码。

CEO 的独立有界探测文件 `data/batches/finance-2026-09-07-apple-url-probe.json` 保留官方域名的 301 自循环：

- PH，19:10:12.177Z：`/ph/app/myaccount%24/id871608181` 的 Location 等于自身。入口、canonical、`uo=4`、语言参数及浏览器请求头的有界检查未找到可返回 HTML 的官方入口。
- PK，19:11:40.270Z：`/pk/app/personal-loans-mobile-loans-up-to-%2435-000/id1089271220` 的 Location 等于自身；前一条官方入口响应指向该 canonical。

该诊断文件是原因证据，**没有作为成功响应写入采集资料**。结论只适用于上述两条 App、两个店面和三类依赖 HTML 的操作在本轮时间窗口的可取得性，不意味着 App 下架、资料不存在、永久不可用或整个 App Store 失效。

## 留存与有限恢复验证

runtime 4 在旧 3 次失败基础上设置 `recoveryAttemptBase=3`，六项实际执行新的有限预算 3 次，最终累计序号均完整为 1–6；没有 queued/running 的剩余尝试。每项原 3 条失败 attempt/HTTP/history 仍在，新 3 条分别追加，原失败发生在 runtime 4 之前，新错误发生在其后。原三条历史没有部署前逐字段散列快照，因此本项准确验证的是旧记录及时间/状态仍存在，不宣称做过不存在的逐字节前后比较。

每项保留 6 条失败 history、6 条 HTTP 记录，`full_scan_responses` 成功响应数为 0。当前资料仍 failed，data/raw/lastSuccessAt 为 null，最近尝试时间指向新失败记录。原来没有成功资料，因此不存在应保留却被清空的旧成功；没有以 empty/unsupported/succeeded 代替失败。失败来源保持各自国家的官方 URL；该 Apple HTML 接口不接收语言参数，`attemptRequestLanguage=null` 的范围说明保持准确。

两个 App 的详情任务仍各自 succeeded。该来源限制没有扩展为整个 App 不可获取，也未更改其他可用采集项的结果。最终应将这六项计入“已尝试、失败、所列来源限制”，不能计入“已成功取得”或“成功空”。

CTO 的 cause 诊断实现已由 Alex 的 2 项独立测试及最终全工程 110/110 验证；真实有限重试与本报告的只读审计完成后交 PM 判定 FS-SU 接受范围。批次其他未解决警告、排队和评论分页仍算未完成，本报告不构成整体完成验收。

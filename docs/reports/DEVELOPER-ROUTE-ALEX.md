# Alex 独立回归：数字开发者名称的 Google Play 目录路由

关联 [GitHub #14](https://github.com/zequnjiang/appeye/issues/14)；上层采集任务 [#11](https://github.com/zequnjiang/appeye/issues/11)。测试基线为 `2eaaccd` 加 CTO 的 `developer-route.ts`、full-scan provider/runner 修复及本报告对应测试工作树，最终提交由 CEO 统一记录。

**工程回归及两国真实恢复核查通过，交 PM 完成 #14 最终缺陷验收。** 路由变更单独 `npm run check` 为 108/108；随后加入独立错误诊断变更，于 2026-09-06 19:12 UTC 完成最后一轮 `npm run check`，**110/110 测试通过**，前后端类型检查、Vite 生产构建、服务端编译和迁移文件复制通过。最终结果包括此前 99 项、9 项路由测试和 2 项诊断测试，不代表整个 #11 采集任务已经完成。

## 范围与方法

Alex 独立维护 `tests/developer-route.test.ts`、`tests/transport-error.test.ts` 及本报告。测试只使用内存 SQLite 和注入 HTTP；目录解析调用实际安装的 `@mradex77/google-play-scraper`，响应为合成夹具。另以只读连接核对真实已保存的两国详情 HTML，不请求商店、不写真实库、不操作生产进程。未新增浏览器测试；既有后台来源字段的可显示性由未改动的 API/UI 路径承接，本轮验证到数据层成功来源、失败来源和历史记录。

| 验证项 | 结果 |
| --- | --- |
| 官方相对/绝对目录链接、重复同路径链接、保留前导零，冻结请求国家/语言优先 | 通过 |
| 外站、HTTP、异常端口、凭据、错误或重复 ID、fragment、错误路径、冲突双路径、仅脚本文字拒绝 | 通过 |
| 开发者 ID 只解码一次，空格、字面加号、百分号编码保持身份 | 通过 |
| 真实 SDK 的数字显示名 `/developer` 与数字 profile `/dev`，来源、HTTP 原文和单页自然结束 | 通过 |
| 无可靠链接时仍使用 SDK 原路径；404 不盲试另一目录 | 通过 |
| runner 的同批/详情任务绑定、应用身份、国家、语言、HTTP 200、官方来源与歧义检查，9 种场景 | 通过 |
| 失败资料冻结实际目录来源与 PH/en；显式恢复追加 attempt 4，旧 3 条 404、attempt 和 history 逐字段不变 | 通过 |
| 原人工 excluded 分类保留 | 通过 |
| 再次失败仅给予额外 3 次预算，总序号 1–6，终止 failed 可见且无假完成 | 通过 |

准备过程有两次测试夹具自身错误（SQL 使用了不存在的 `type` 列，以及对 void `retryFailed()` 返回值做计数断言），修正为真实契约后通过；未将它们登记为产品缺陷。

## 两国真实旧数据的独立只读证据

审计时间 **2026-09-06T19:11:15.905Z**。本地聚合文件 `data/batches/finance-2026-09-07-alex-developer-route-offline.json`，只读审计脚本 `.artifacts/alex-developer-route-audit.ts`，异常列表为空。两国使用各自保存的详情响应，未跨国借用证据。

| 市场 | 失败任务 / App | 成功详情任务 / HTTP | 原详情采集时间 UTC | 独立提取的新请求路径 |
| --- | --- | --- | --- | --- |
| PH | 14412 / 970 | 5903 / 1139 | 18:05:35.596 | `/store/apps/developer?id=059916517&gl=ph&hl=en` |
| PK | 15308 / 1082 | 6643 / 1449 | 18:08:39.398 | `/store/apps/developer?id=059916517&gl=pk&hl=en` |

两条详情均 HTTP 200，应用 ID 均为 `com.smartsave.budget.finance.book`，开发者字符串均为 `059916517`。两条任务在该只读时间均 failed、累计 3 次。PH 原失败 HTTP 为 6318/6373/6463，PK 为 6817/6861/6966，六次全部是错误 `/dev` 路径的 404；原尝试、历史及 HTTP SHA256 均已保存在本地审计快照，供修复后的恢复审计逐字段对照。

详情原文 SHA256：HTTP 1139 为 `473ea298108e97d1b23c7bbebd8cc0e50164d22ae9d32222a735385f34903f5e`；HTTP 1449 为 `8c8cdfefb5cfc74549791cfcf747ee9f48234982c37c2d96a31bde26493200f1`。这里证明链接证据与路由选择正确，**不证明目标目录当前联网必然返回成功**。

## 交接与未完成边界

同次受控发布另含 `transport-error.ts` 诊断小项，关联 #11、不是 #14 路由根因。2 项独立测试验证：无 cause 保留原错误信息（有界）；最多两层 cause 的 name/message/code 及各字段长度限制；不序列化 stack/body/其他属性；循环和抛错 getter 安全处理；注入 fetch 的错误原因真实进入内存 `full_scan_http.error`，HTTP status/body 保持 null，原 Error 对象原样继续抛出。该诊断不会把失败变为成功，也没有实际重试或替换线上历史。

CTO 已完成自检并交接冻结的路由修复，CEO 已受控部署 runtime 4 并显式恢复。以下为部署后的独立真实核查；工程测试未因数据恢复重复执行。

## runtime 4 真实恢复核查

**2026-09-06T19:14:41.613Z** Alex 以只读事务逐字段核对两国任务、HTTP、attempt、enrichment history 和当前资料；本地证据 `data/batches/finance-2026-09-07-alex-developer-route-recovery.json`，脚本 `.artifacts/alex-developer-route-recovery.mjs`，异常计数 **0**。

| 市场 | 任务 | 新 HTTP / 状态 | 原 HTTP 采集时间 UTC | 新成功资料时间 UTC | 结果 |
| --- | --- | --- | --- | --- | --- |
| PH | 14412 | 7390 / 200 | 19:13:41.051 | 19:13:41.706 | attempt 4 succeeded，目录 1 项、1 unique、0 warnings |
| PK | 15308 | 7394 / 200 | 19:13:48.444 | 19:13:49.132 | attempt 4 succeeded，目录 1 项、1 unique、0 warnings |

两次新请求均为 `/store/apps/developer`，ID 保留 `059916517`，市场分别 `ph`/`pk`，语言均 `en`。`raw.routing.listingSourceHttpId` 分别指向该市场的 1139/1449，当前成功/尝试来源、国家、语言和资料时间准确。新资料及新 history 的 data/raw 完全一致。

与部署前独立快照逐字段比较：旧 attempt 1–3、旧三条 history、旧六次 404 的原 URL/时间/内容哈希均不变；两条原详情 HTTP 的 SHA256 亦不变。新成功没有覆盖或改写旧失败，没有把原详情采集时间当成本次目录成功时间。

runtime 4 所列 7 个源码文件 SHA256 全部一致；`recoveryAttemptBase=3` 的恢复任务恰好是 CEO 部署前记录的 8 项（2 GP、6 Apple），未扩大范围。BCA 相关的 16108/16116 仍保持 attempt 1 与 `developer-degraded`，未被错误清零或误当 #13 可修布局恢复。

Alex 另调用本机后台 API，登录后读取 App 970 和 1082，均 HTTP 200；API 的来源、可用状态、目录条数、成功时间及 routing 原详情证据与只读数据库一致，随后退出测试会话。此项仅瞬时内存鉴权和读取，不改业务数据、不增加商店请求；未重复浏览器视觉验收。

Apple 应用的独立请求失败不属于 #14。整个批次的补充资料和评论采集仍需按固定分母完成；本报告不关闭 #11，不替代完整运营验收。

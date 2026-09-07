# 每小时监测与市场动态：Alex 独立测试

- 关联：[需求 #18](https://github.com/zequnjiang/appeye/issues/18)、[PR #19](https://github.com/zequnjiang/appeye/pull/19)、[HMA-AC-01–14](../requirements/HOURLY-MARKET-ACTIVITY.md)。#11 评论采集保持独立状态。
- 测试日期：2026-09-07。Alex 独立维护 `tests/hourly-fixtures.ts`、`tests/hourly-market.test.ts`、`tests/collection-coordinator.test.ts`、`tests/manual-coalescing.test.ts`；按新需求更新旧 API / migration 测试的 24/48 小时预期为 1 小时，其他旧数据保护断言保留。CTO 的 cohort 测试、CEO 的多语发布日期测试分别归原作者，纳入最终全套回归。
- 最终 Alex 结论：**工程与受控运行回归通过，正式交 PM 最终验收。** 精确提交 `a33cfb8`，172/172；真实迁移、索引维护、88 项证据合并、7 页恢复、双通道运行及 launchd 重启已验证。首周期与 #11 的 GP 评论仍在执行，未作全量完结结论。原工程/补修过程及初次审计误报完整保留。
- 原工程结论：**独立回归通过，可以进行已授权的受控部署。** CTO 正式自检冻结后，Alex 独立 `npm run check` 169/169、前后端类型、生产构建全部通过，无失败或跳过。真实切换/7页恢复/88任务合并尚待 CEO 操作后独立核对，PM 最终验收尚未代为完成。

## 独立验证环境与范围

新自动化测试使用内存/临时 SQLite、注入的双商店 provider、可控制的时钟、本机 HTTP 和临时子进程。无真实商店请求、无生产数据库写入、无生产进程控制。跨进程锁测试仅终止测试自己创建的临时子进程，以验证 OS 释放锁及死 PID 恢复；未删除任何真实活跃锁。

本机自动检查运行于 Node v25.9.0，项目要求 Node 24+；GitHub Node 24 CI 的结果由 CEO 单独记录，不能把本机版本写成 Node 24。

## 专项结果

`npx tsx --test tests/hourly-market.test.ts tests/collection-coordinator.test.ts` 初轮 22/22 通过；后续暂存首次发现场景及 `tests/manual-coalescing.test.ts` 六项增量分别通过，新专项共 29 项。最后增量包含真正协调器/worker联动、旧缓存评论保护及批次 skippedOlder 口径。最终统一检查结果下节单列。

| AC | 已执行的独立验证 | 工程结果 |
| --- | --- | --- |
| 01 | 六国 × 双店的全部已有应用，含人工 excluded；首次、59 分 59.999 秒、60 分钟三个时点；周期配置与 API 只接受 1 小时；新国家参与。 | 通过 |
| 02 | 临时文件库关闭/重开保持任务 ID、键及 payload；重复 tick 不入重；跨 5 小时只创建最新一期；已应用响应恢复不重复快照。 | 通过 |
| 03 | 暂停国家未执行任务 skipped，新增越南在活跃周期参与，关键词/语言保留；既有全量批次冻结配置不被小时发现修改。 | 通过 |
| 04 | 短退避和最大两次失败、原成功资料与 firstSeen 保持、下一周期再试；HTTP 超时迟到仍归原小时任务，不串下一批次任务。 | 通过 |
| 05 | 顺序 3 小时 / 1 批次 / 1 手动的有界轮转；空/异常通道释放；同一协调器不能重入；真实临时子进程、symlink 别名、进程崩溃及死锁恢复。 | 通过；见实际部署结果 |
| 06 | 小时只详情/发现，零评论和补充派生；strong 入库、insufficient 留暂存、原 excluded 保留；新小时应用不扩张已 seed 批次；精确 7 页恢复不会重试其他商店补充失败。 | 通过；见实际部署结果 |
| 07 | 独立浏览器验证三视图、组合筛选、20/28 分页、日期空态、详情联动；加载/错误专门注入仅引用 CEO 自检，Alex 未另造浏览器网络错误。 | 已验证范围通过 |
| 08 | firstSeen 与最早成功快照时间独立，无快照 observedAt 为 null；后续详情不重写首次来源；原 raw 未知字段保留。 | 通过 |
| 09 | 相同、首次、失败快照不造变化；1→null→1 恢复不算发布；更新说明/分数等与真正版本变化区分。旧→新→迟到旧→随后新始终以最新观测比较。 | 通过 |
| 10 | Asia/Shanghai UTC 16:00 日界、含起点/排除次日、非法日期/不支持时区拒绝；date-only 不补时间；`7 ก.ย. 2569` 经鉴权 API 精确进入 2026-09-07，前一天不入选。 | 通过 |
| 11 | 同包跨国为不同市场身份；同日多事件与去重应用数分开；分类按当前值过滤，分页正确；持久 response 重放一次，而同刻同内容的另一次真实响应独立保存。 | 通过 |
| 12 | 状态 GET 不创建周期/任务或修改状态；显示成功时间、排队、逾期和失败；firstSeen 事件取原快照来源。浏览器可读批次仍有 7 个评论失败的提示。 | 通过 |
| 13 | 未登录三个新数据接口 401，登录后成功，非法筛选 400；桌面及 390px 窄屏测试；合成脚本文本安全展示。 | 通过 |
| 14 | CTO→Alex 工程流转完成，独立 169/169、类型/构建及 CLI 严格类型通过；真实部署及 PM 最终验收单独留待后续。#11 未完成不隐去。 | Alex 通过，正式交 PM |

## 快照与响应边界复测

迟到的历史资料保存为独立快照及原观测时间，current 持久行（包括分类、分析、来源时间）逐字段不变，最新 raw 仍来自较新的快照；下一次新资料的变化从当前有效版本 3 比较到 4。同一时间另一次新快照按 ID 排序，4→5 正常保存。历史序列补入一个真实中间版本后，派生版本频率可以随完整时间序列变化；这不等于 current 资料被回滚。

批次详情第一次成功获得持久 response ID；模拟中断重放该 ID 不请求来源、不增快照。清除任务缓存以模拟另一独立真实请求，即使返回相同时间和相同内容，第二个 response ID 和第二个快照都保留，且相同内容不造变化。Store 回调主动抛错时，快照、变化、应用和收据一起回滚。

## 独立浏览器验证

使用 CEO 的纯合成预览 `http://127.0.0.1:3131`，内存演示库，不使用已登录的真实 3000 页面。通过原生 Chrome 界面操作登录；演示标识与 Asia/Shanghai 清晰可见。

- 桌面验证新发现 28 条：首页 20 条、次页 8 条；日期/国家/当前分类切换后列表与数量一致。商店发布页面有来源精度说明，不称某国首次上架。
- 更新视图中，同一应用的多次事件分别保留。展开 1,780 字的合成描述前后值，完整内容在容器内可滚动，字面 `<script>window.QA_INJECTION=true</script>` 显示为文本。
- 用 Chrome 设备工具实际设为 390 × 815，检查日期筛选、状态卡、列表与堆叠的前后值；无主要流程遮挡。切换到次日显示零结果，再回今天恢复。
- 打开采集状态显示小时排队/失败与逾期；批次 pending 为零但有 7 个评论失败时，仍明确显示未完成提示。进入应用详情后可查看版本与 Apple 下载量缺失说明。
- 完成后关闭设备模拟并恢复桌面。此次没有单独保存 Alex 的浏览器截图或注入网络错误，不把 CEO 截图/错误态自检冒称 Alex 执行。

## 旧批次审计范围适配

旧 Apple 已验收证据的脚本 SHA 保持不变。另建 ignored 工具 `.artifacts/alex-review-audit-cohort.mjs`，依据本批非空 detail.app_id 和冻结市场身份选成员；真实批次默认强制与 PM 部署前 2,024 成员 anchor 全等。后续小时新增的应用不进入旧批次分母，原 474 应用及旧评论身份仍核对。

`.artifacts/alex-review-cohort-smoke.ts` 于 08:25:06.545Z 通过：2 成员/4 页/3 seen、0 差异；额外小时应用排除、篡改 anchor 拒绝、所选商店 pending 拒绝、未选商店 pending 隔离、错误 fetchedAt 仍检出。未执行真实 GP 终态审计。

后续命令：`node .artifacts/alex-review-audit-cohort.mjs --store google-play`；独立来源工具仍为 `python3 .artifacts/alex-final-review-source-audit.py --store google-play`。current 评论仍严格等于该批最后持久响应；最终审计需暂停其他评论写入通道，或先建立每行更晚持久响应的证明，不能仅凭一个更晚时间放过差异。小时任务只详情，不会自身引起评论覆盖。


## 手动队列与较早评论响应

CEO 部署前只读发现 44 个旧评论及 44 个旧补充队列任务已经有较晚的成功批次证据。测试没有假定真实 88 项均满足；合并函数须逐项检查批次开始前的 queued 请求、应用/商店/国家、当前语言、持久成功响应与七类覆盖。四个双店正例不产生请求或新尝试；十个反例包括新请求、failed job、失败/部分评论流、缺响应、错身份/语言、缺一个补充 kind、开发者部分告警及补充失败，均保持原 job 全行不变。是否真实 88 项满足条件由部署后独立只读核对，不借用夹具结论。

新的手动响应以 job ID、attempt、市场身份、语言、源时间及完整对象写入 `manual_responses`，实际 HTTP 经 `monitor_http.job_id` 追溯。真实合成协调器联动中，评论已落库后模拟任务完成中断，下一次累计 attempt 2 从原响应恢复；provider 只调用 1 次，评论只写 1 次，原评论全行与持久响应保持。回调故障会将评论与 applied 收据一起回滚。

旧未应用的手动缓存若遇到更新的 current 评论，仍保留原 payload/时间并应用收据，返回 upserted=0、skippedOlder=1，不能回滚 current。批次相同情形保留该页 response 和 seen 身份，updated=0、skippedOlder=1。这两个独立场景通过，不能把跳过较早内容的行算成实际更新。

新 cohort 审计器对本批成员出现的已应用手动评论响应设置明确拒绝门槛：须先建立包含手动写入的完整时间序列，再校验 current、added/updated/skippedOlder；仅匹配更晚时间不足以验收。旧已覆盖任务的合并不会产生新的手动评论响应。该门槛不阻止合法产品操作，但阻止审计在证据未融合时误称全量通过。


## 最终工程交接

基线提交 `ad01410`。CTO 正式冻结交接后，Alex 独立执行 `npm run check`，退出码 0，169 项全部通过，0 失败、0 跳过，测试耗时约 10.074 秒；前后端 TypeScript、Vite 生产包、服务端编译和 SQL 迁移复制通过。日志 `.artifacts/hourly-alex-final-check.log` 完成时间 `2026-09-07T08:44:09.629395+00:00`，SHA-256 `9cbe7d8250546717200664ba817af868db6bb7dc561c57cf76e872c29f01b2ab`。两个运营 CLI 的独立 strict 类型检查与 `git diff --check` 也通过。

工程范围无待修阻断项，建议 CEO 按既定单 writer 停机/备份/维护/核对/重启流程部署。维护前后仍须证明只有国家周期迁移、新表索引与指定 7 个失败任务入队；旧成功响应、评论、快照、游标及人工分类保持。88 项覆盖合并在 coordinator 启动时另核原 job 稳定字段与全部成功证据，不混同迁移阶段。真实小时与批次两通道、鉴权 API、实际来源以及新锁所有者随后验证。

本结论不宣称服务已上线、不关闭 #18，也不代表仍在分页的 GP 评论或 #11 全量运营通过。新的手动评论若实际写入本批成员，最终评论审计须融合其完整持久写入时间线，现有独立工具会明确拒绝没有该证明的终验。

## 受控维护中的审计器复核（尚未作为运行放行）

CEO 报告于 08:45:49 UTC 停止旧 runtime 8，执行备份、物理前后捕获和 retry-only 维护；Alex 没有操作正式进程或数据库。逻辑核对首次因 Node SQLite 行为 null-prototype、JSON 基线为普通对象而在 deepStrictEqual 的 cohort 比较处失败，发生在非 7 个任务的全行 hash 已匹配之后。首次错误和修正说明单独保存在 `data/batches/finance-2026-09-07-hourly-deployment-verify-initial-error.json`，不改写为首轮成功。

Alex 于 08:54:19.388Z 独立静审并用内存 SQLite 复现：原比较确实只因对象原型不同拒绝；`{...row}` 保持全部 7 个测试列的键、值及 JSON 字节，逐列修改仍被严格比较拒绝。修正仅应用于 SQL get/all 返回行的表示，原 task 迭代 JSON hash 路径和字段比较没有删减。证据 `.artifacts/hourly-alex-prototype-audit-check.json`；此项是审计表示层修正，不是数据库内容缺陷，也不替代完整逻辑复跑。

08:55:30Z，Alex 独立比较 CEO 已生成的两个物理 manifest，未再次读取约 30 GB 数据文件：16 个受保护原表、20 个受保护原索引的完整元数据/页内容摘要相同；允许变更的国家、迁移记录、批次状态与任务表及关联索引另列。新增 8 表、12 索引与 006 的小时/manual 账本范围一致，0 个意外差异。`jobs` 此时属于保护表，应完全相同，88 项有证据覆盖合并尚未执行。

08:56:00Z，39 个源文件及 26 个编译文件 SHA 全部与 runtime 9 元证据一致，来源提交 `ad01410`。证据分别为 `.artifacts/hourly-alex-physical-manifest-comparison.json` 和 `.artifacts/hourly-alex-runtime-9-fingerprints.json`。以上是对既有捕获的独立比较，不能写成 Alex 重扫物理库或已验证服务上线；逻辑最终结果、新进程、真实队列与 API 仍待后续。


## 实际启动阻塞与最小索引补修

缺陷追踪：[Bug #20：旧任务证据合并缺少响应查询索引导致启动阻塞](https://github.com/zequnjiang/appeye/issues/20)。本节及下述实际运行复核构成该缺陷的 Alex 回归证据，最终关闭仍由 PM 验收后执行。

首次 launchd 服务在 coordinator 初始化的旧任务证据合并中持续阻塞，不能据此前 169 项工程通过宣称正常运行。CEO 控停正式进程；CTO 的只读现场诊断发现 full_scan_responses 没有按任务的索引，成功证明查询按响应 ID 在约 30 GB 数据库中反复扫描历史响应表。原覆盖判据本身未放宽，整笔合并在同一事务内。是否正式旧 88 项均未提交以 CEO 停机核对为准；Alex 对进程未作操作。

修复只在 ensureFullScanSchema 增加 `full_scan_response_task_time(task_id,observed_at,id)`，不改原查询、成功 attempt 关联、来源/时间/raw 等值比较、覆盖范围、限速或事务。Alex 新增三项独立测试：

1. 使用真实临时 SQLite 和约 5 MiB 干扰响应，EXPLAIN 从 `SCAN r` 变为 `SEARCH r USING INDEX full_scan_response_task_time`。原 SQL 前后返回完整 row 全等；更晚失败 attempt 不会冒充成功来源，错误时间和 payload 不匹配；全部响应行保持。
2. 新库、重复初始化及文件关闭重开后索引存在，完整 schema 和原国家配置不变。
3. 两个可覆盖 job 的第二个 UPDATE 触发模拟异常，首个 UPDATE 一并回滚；移除故障后两项正常合并。没有把部分更新误称完成。

CTO 隔离 8,000 行、约 265 MB 合成库的 352 次证明查询，三轮返回 SHA 全等，查询耗时由约 1,778–1,842 ms 至 25.17–25.79 ms；该数据由 CTO 操作，Alex 读取结果并独立验证查询计划与语义。它不是正式库启动耗时或吞吐提升测量。

CTO 正式补修冻结后，Alex 独立 `npm run check`：**172/172，通过，0 失败、0 跳过**，前后类型、Vite/server 构建与 SQL 迁移复制通过；`git diff --check` 通过。精确提交 `a33cfb8`（已包含本次单行 DDL 与三项回归），日志 `.artifacts/coalesce-startup-alex-check.log` 完成于 `2026-09-07T09:05:39.345745+00:00`，SHA-256 `3e144302d43fc3385778cdf3b76cabac2a634b61b76f5d2f44b67478058af2ba`。本次独立检查零正式库访问、零真实商店请求。

工程补修可以交 CEO 执行锁保护的索引维护和受控服务恢复。正式索引构建耗时/计划、运行就绪、88 项证据覆盖、7 个评论页续跑以及真实 API 仍需后续验证，PM 最终验收未代办。


## 最终真实部署回归与 PM 交接

**结论：HMA-AC-01–14 的 Alex 工程、浏览器及必要真实运行证据齐备，未发现待修阻断项，交 PM 最终验收。** 本节覆盖此前表格中等待部署的项目；不等待首周期全部应用刷新完毕，也不宣称 #11 评论已经完成。

- **维护与索引。** Alex 独立比较 CEO 的不可变逻辑前后记录：52,745 个非目标任务全行摘要、2,024 成员、全部历史高水位相同；7 个指定任务原身份/尝试/游标与其他稳定字段不变，仅从 failed 恢复 queued；国家仅周期变为1，批次参数不变。索引维护前后原 jobs、国家、cohort、任务计数、run 与高水位完全相同，schema 只新增目标索引。实际 DDL 由 CEO 于 09:06:14–17Z 执行，索引构建 2.317 秒；查询计划已用目标索引，此耗时与 CTO 合成基准分列。
- **覆盖合并与身份保护。** Alex 于 09:09:39.885–42.544Z 独立只读事务核对 88 项覆盖合并及全部 352 个真实成功 task/response/attempt 引用，原请求身份、createdAt、attempts 保持；其余 1,217 个旧 job 全行相同，manual_responses 为0。固定2,024市场身份及 firstSeen 保持，474 条 manual/legacy 分类全字段保护通过。未重新读取整个大库或重复物理页扫描。
- **双通道真实执行。** 同一快照已取得60个小时响应，54项详情完成，批次同期新增20条HTTP，其中19成功、1次受控重启中断。独立检查首12个已成功小时详情的 app/响应ID/applied receipt、原时间及完整 raw 与对应 snapshot 精确一致。只核查实际已完成的样本，不把尚在排队的详情写成采集成功。
- **7 个评论页真实恢复。** 任务49999–50005均为印尼 GP 第71页，attempt4成功，时间09:07:24.607–58.361Z。Alex于09:14:53Z逐条核验原21次失败attempt及21条HTTP的保存字段完全相同；原游标和第70→71→72页接续正确。7页共1,050条完整raw、规范字段、数据库内容、fetchedAt及seen身份严格相等，每页150 added、0 updated、0 skippedOlder。
- **独立原HTTP核查。** 于09:16:56Z复用原审计器的独立Python RPC解析函数，只检查7个实际HTTP200：每页150条原RPC身份顺序与SDK raw及规范化ID完全相同，nextCursor逐字相同，0来源问题。其他SDK字段投影的正确性仍由确定性测试覆盖；上述1,050行检查验证实际字段/raw/存储的完整传递，不冒称对全部GP字段另写了解析器。
- **launchd 重启。** CEO给旧PID84793发送SIGTERM后，launchd创建PID84987。Alex独立比较重启捕获：原2,381任务身份/payload、42个已成功任务完整记录、42个原响应及SHA、42条原HTTP、cycle1与nextDue `10:06:49.532Z`保持；小时新增18个响应，批次HTTP同时增加。42源文件及58编译产物指纹与精确提交相符，实际锁所有者PID84987存在。受控中断的task52759/page72保留HTTP42760/attempt1 interrupted，attempt2于09:09:21.945Z成功，未将中断当作来源自然结束。
- **实际 API / 界面归属。** CEO真实鉴权API smoke：未认证401，登录后三类动态、身份/snapshot来源时间、Asia/Shanghai日界及非法参数均通过。该鉴权操作归CEO，Alex读取证据并结合独立源库核对；Alex桌面/390px交互在纯合成3131验证，不能改称已登录真实3000浏览器。正式页面现在受保护登录，合成预览已由CEO停止。

真实证据（均为本地 ignored 脱敏摘要，不提交数据库或评论）：

- `data/batches/finance-2026-09-07-hourly-alex-logical-maintenance-verification.json`
- `data/batches/finance-2026-09-07-hourly-alex-live-stage-1788772182547.json`（本地详细证据含游标，仅报告聚合结果）
- `data/batches/finance-2026-09-07-hourly-alex-seven-review-recovery.json`
- `data/batches/finance-2026-09-07-hourly-alex-seven-rpc-source.json`
- `data/batches/finance-2026-09-07-hourly-alex-restart-verification.json`
- `data/batches/finance-2026-09-07-hourly-alex-restart-interrupted-page.json`

7页细审的两份初次拒绝记录保留为 `hourly-alex-seven-review-recovery-initial.json` 与 `-initial-2.json`：旧precheck对cursor采用JSON字符串摘要，对previousResponse采用解析后递归键排序的canonical JSON；新脚本起初分别按原UTF8和JSON字符串计算导致摘要表示不一致。Alex对维护前backup与当前原response逐字相等另核，再按历史同一编码重算，全部7项历史摘要一致；没有忽略、trim或删除来源字段，也没有业务数据变更。首次误报不会写成首轮全过。

09:09:42的评论状态快照仍有238个GP queued页、27,909个GP成功页，Apple保持3,803个成功页；这是该时点状态，不是最后采集数量。小时第一周期也有大量待执行详情。#18的通过代表持久小时调度、真实双通道及恢复机制已工作，#11仍需其固定成员的最终评论/来源审计，继续保持未完成。

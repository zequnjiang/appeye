# 六国财务应用扫描：Alex 独立测试报告

- 负责人：Subagent 测试工程师 Alex。
- 当前状态：**来源、详情与识别入库阶段独立核查通过；补充资料与评论仍在继续，整体部分完成。** 工程回归 92/92 通过；时间/语言恢复与空页分页缺陷均已修复复测，Apple 批量 lookup 独立回归通过。没有作出全任务完成或 PM 最终验收结论。
- 范围：六国双商店财务类扫描、信贷识别入库、所有入库应用的完整资料与评论分页采集、可核验批次覆盖证明。
- 文件所有权：Alex 仅修改 `tests/full-scan.test.ts`、`tests/full-scan-bulk.test.ts` 及本报告；经 CEO 后续授权在忽略目录保存只读审计脚本和摘要，不修改业务代码、真实库或 Git。
- 数据边界：准备阶段仅阅读源码、使用合成数据库；收到 CEO 授权后才只读核对真实结果，不把 fixture 当作实际市场数据。
- GitHub：[全扫描运营 #11](https://github.com/zequnjiang/appeye/issues/11)，实现分支 `codex/full-finance-scan`。

## 准备阶段源码发现

既有普通发现与定时采集排除 `classification=excluded`，评论窗口为 Google Play 最新 100 / Apple 第 1 页，`listApps()` 默认只返回 100 条。旧任务以 type/country/store/appId 去重，没有批次 ID；复用批次前排队任务不能单独证明本批次发生过实际尝试。批次 runner 需有自己的范围、分页结束和覆盖凭证，不能直接以队列清空、记录总数或 `lastFetchedAt` 是否非空作为完成证明。

## 独立测试矩阵

| 范围 | 计划独立验证 |
| --- | --- |
| 国家与商店 | 六国/双店/财务分类源均实际调用；新增配置按定义处理；保存每次搜索来源和抓取时间 |
| 分类保护 | 历史/manual confirmed、candidate、excluded 不被新分析覆盖；新 strong 与其他结果按规则入库或保留待确认，身份去重 |
| 全入库应用 | 初始全部记录与新入库记录均在范围；包括 excluded 和超过默认 100 条；某应用详情失败仍尝试其他可采字段 |
| 评论分页 | 自然空页、token/page 结束、重复 token、重复页、跨页重复评论；达到有限限制明确 partial；原始字段和评论来源保留 |
| 恢复 | 单页异常有限重试；成功页即时保存；中断重跑不丢旧页、不重复计数；游标/当前页可恢复 |
| 公平性 | 多应用评论按页轮转；单一应用持续返回大量评论不能阻止其他应用完成详情、补充字段和首评论页 |
| 补充数据 | 7 类独立尝试和状态；失败不擦掉旧成功数据/时间/来源；不支持与成功空区分 |
| 批次证据 | 每 app 每必需操作有实际尝试、状态和时间；无遗漏/无只因旧数据存在而跳过；失败/partial 不冒充成功 |
| 真实只读核查 | CEO 备份后确认批次范围与最终记录差集、人工分类变化、每app新尝试、原始数据和时间、失败汇总；不输出真实评论或凭据 |

CTO 已正式交接 [自检报告](FULL-SCAN-CTO-SELF-CHECK.md)。Alex 在 `tests/full-scan.test.ts` 独立实现并运行确定性测试，真实结果按下文时间点记录。回归涵盖初始 `7b027db` 后工作树及 runtime-2 最终实现（提交由 CEO 统一记录；运行代码以 `data/batches/finance-2026-09-07-runtime-2.json` 的四份 SHA-256 为准）；本机 Node v25.9.0。

CEO 已明确：财务类结果先保存 staging 与完整详情，strong/possible 进入主应用库，insufficient 留在 staging 作为扫描证据；既有应用包含 excluded 均尝试采集，原 manual/legacy 决定不覆盖。CEO 已完成备份并授权 Alex 对真实库只读核查，详见下文。

## 阶段性实际记录

`npm run check` 最新已独立通过：**92 项测试、0 失败、0 跳过**，包括本轮 **31 项新增测试**（23 项 runner 与 8 项 bulk），前后端严格类型、Vite 生产构建、服务端编译及迁移复制。时间/语言两项缺陷先有红测试、修复后转绿；空页继续及批量优化均在本次完整回归范围。覆盖 101 条已有应用（含人工 excluded、禁用的额外国家、两商店）均产生 9 个本批次操作；新 strong/possible 入库与 insufficient staging；三个应用评论逐页轮转；失败页恢复不重抓成功页；成功缓存重放不制造新时间/快照；重复页/token 区分自然结束；本地 cap 1 页保留 deferred 并可切至 0 继续；新增/既有评论写入计数；源语言保留；原生 Request；底层 HTTP 与批次 SQL 联调；超时取消与大目录完整性告警。

首次真实只读核查使用 `DatabaseSync(..., {readOnly:true})`：基线文件 `data/batches/finance-2026-09-07-baseline.json` 含 474 个应用，运行批次 `finance-2026-09-07`，创建时间 `2026-09-06T17:44:37.554Z`。发现阶段当时 sources 为 0，已有应用补齐任务均尚未执行，因此不能报告真实数据补齐通过。

这次核查发现内部 P0 缺陷 FULL-SCAN-01：`recordHttp` INSERT 声明 9 列却有 10 个占位符。Apple 任务报 `10 values for 9 columns`；GP 库把同一记录回调失败包装成网络错误。Alex 通知 CEO 暂停、交 CTO 修复，新增 provider→runner.recordHttp→SQLite 联调用例后通过。该错误是内部缺陷，不能记成上游不可达。后续已独立证实 140 条 HTTP 200 和 8,759 条来源成功保存，FULL-SCAN-01 已闭环。原生 Request 兼容加固另已回归，但不是本次已证实根因。最终业务覆盖仍待运行结束。

准备期间指出的另外几项边界已由 CTO 修复并纳入上述用例：坏结构响应不再污染后续重试（原响应留 ledger）；本地预算保留可恢复页，循环/重复/退化归 needs-review；评论 added/updated 分开；发现语言取原请求；developer warnings 进入待复核状态。本节仅代表这些确定性用例通过，不代替实际任务完成率。


## 追加边界审查

CLI 只读操作有实际子进程回归：缺文件不创建、旧无批次库不迁移、已 seed 库不改文件字节/任务/attempts。真实批次 `--status` 成功读取。Apple 搜索预算小于 4 页或大于 4 页被拒绝，避免将本地较小预算冒充 200 条公开上限。recover 后持久 run.status 恢复 running。以上用例包含在最终 92 项工程回归中。

| 编号 | 复现与状态 |
| --- | --- |
| FULL-SCAN-02 | 缓存评论页原响应固定于 `2026-01-03T04:05:06.000Z`，恢复后 fetchedAt 却变为恢复时刻。Store.saveReviews 使用 now()，未传原 response_at。**红测试复现后 CTO 修复，Alex 复测通过。** |
| FULL-SCAN-03 | 评论请求冻结 th，运行时国家配置改变后下一页实际请求 es，应持续使用 th。失败补充也应报告原请求上下文。**红测试复现后 CTO 修复，Alex 复测通过。** |

FULL-SCAN-04：实际 GP 库 `reviewPages` 只在缺少 token 时结束，旧 runner 遇空页就停止，可能丢掉仍有新 token 的可继续页。已交 CTO 修为“GP 空页有新 token 继续、无 token 才结束；循环仍保护”，独立 fixture 验证后续真实模拟评论可保存。该问题在真实评论阶段执行前修复，**已闭环**。

Apple 批量 lookup **8 项独立测试通过**，文件为 [full-scan-bulk.test.ts](../../tests/full-scan-bulk.test.ts)：

- 仅按 exact trackId 配对，反序、无关行不串 seller；保留每 ID 完整 iTunes 原记录和未知字段，HTTP 总响应单独保存，共享真实 HTTP ID/来源/获取时间，不把另 49 条全复制进每个快照。
- 缓存按 batch/country/configured-language 隔离，实际请求语言 en_us 明示；runner 只选同批次、同国家、同冻结语言、queued 的 Apple 详情，其他商店/批次不混入。
- 默认 50 ID 上限实测；重复返回 ID、缺少目标 ID、三类截图均空、503/坏 JSON/结构错误均回退 individual，并保留明确 fallbackReason 与已取得原始响应。
- 一条 bulk HTTP 成功形成两个 App 各自的 attempt/response/snapshot，观测时间等于真实公共获取时间；人工 excluded 不变；每 App 后续独立补充与评论均执行。
- 取消传播；纯 fake client 未注入 transport 不启用该路径，配置 0 可关闭，测试没有真实商店访问。

工程回归无已知未解决阻断缺陷，可以交 CEO 受控部署继续真实批次。其后的真实运行独立核查见下节。

## 真实只读事务快照

基线时间 `2026-09-06T17:44:21.980Z`；冻结备份 `data/backups/appeye-full-scan-start-2026-09-07.sqlite`；真实库 `data/appeye.sqlite`。以下为 **2026-09-06T17:51:43.221Z** 独立只读事务快照，运行仍在变化：

- 基线 474 条、现主库 474 条；逐 ID 原 classification 差异 0、缺失 0、人工/legacy override 丢失 0；quick_check=ok。
- 8,759 条来源覆盖全部 12 个国家/商店组合。JSON 无效、来源缺失、source/task 国家/商店/观测时间错配均 0。
- 140 条 HTTP 均 status=200、均绑定任务并保留 body；原 body 长度 219,898–1,894,056 字符。只统计，不输出原文。
- 榜单 54 项全部成功；搜索 86 成功、1 运行、3 排队。详情 6,412 排队，已有应用补充 3,318 排队，首评论页 474 排队。**当时尚未开始详情/补充/评论，来源阶段也未全部结束。**
- 当时 CLI 持久 run.status 仍为旧来源 helper 的 paused，但有 running 任务；已通知 CEO 正式 CLI 接管调用新版 recover。不能仅凭单一状态字段认定任务结束。

| 国家 | Google Play 来源行 / 去重身份 | App Store 来源行 / 去重身份 |
| --- | ---: | ---: |
| 泰国 | 365 / 287 | 1,006 / 673 |
| 墨西哥 | 366 / 294 | 1,026 / 709 |
| 菲律宾 | 530 / 442 | 1,011 / 637 |
| 巴基斯坦 | 530 / 468 | 1,018 / 803 |
| 印尼 | 372 / 289 | 1,033 / 624 |
| 阿根廷 | 531 / 459 | 971 / 712 |

GP 请求语言为 th/es/en/en/id/es；Apple RSS 为 und、搜索为 en_us。身份按国家/商店/externalId 去重。来源行不等于主库新增信贷数，也不代表全商店财务市场。


## runtime-2 真实批量核查（阶段 ready）

CEO 在 `2026-09-06T17:58:01.621Z` 保存 runtime-2 代码指纹并受控恢复原批次。Alex 于 **2026-09-06T17:59:17.073Z** 只读事务独立核对：

- 运行四文件当前 SHA-256 与 runtime-2 全部相同；持久 run.status=running。
- **145 个成功 bulk 详情任务共享 4 条真实 HTTP**，覆盖泰国 31、墨西哥 37、菲律宾 30、巴基斯坦 47 个详情任务。逐条验证 HTTP batch/country/请求 ID、规范 externalId 与 iTunes 原 record 一致，seller/未知字段随完整原 record 保留。
- 每个任务均有成功 attempt；145 个 admitted App 均有且仅有对应获取时间快照。`task.response_at`、详情 envelope.observedAt、raw 来源 fetchedAt、HTTP fetched_at、snapshot.observed_at 全部一致；快照 raw 与 HTTP 中该 ID 的完整原 record 逐条一致。**缺 HTTP、跨国/ID错配、原文差异、时间错配、快照或 attempt 缺失均为 0。**
- 原 474 条全部存在，逐条 classification 差异 0、override 丢失 0；此时主库 477 条，新增 3 条。
- 来源已为 54 榜单+90 搜索全部成功，8,892 条 source；全部 HTTP 483 条均200。详情480成功、1运行、6,028排队；七类补充3,339排队、首评论页477排队。此时尚未进入补充/评论阶段。

这项核查证实新批量路径已在真实库运行并正确留存所查 145 项，不能扩张为未执行的全部 6,509 个详情或后续评论均已完成。**Alex 工程与当前运行阶段报告 ready，交 PM 阶段复核；完整运营验收继续等待实际队列覆盖与终止原因。**


## 来源、详情与识别入库终态审计

**阶段结论：本轮已声明公开来源范围的发现、详情和识别入库通过 Alex 独立核查。** 这不是全商店枚举完成，也不是补充资料/评论全部完成；交 PM 对第一阶段验收。

审计使用独立脚本 `.artifacts/alex-full-scan-detail-audit.mjs`，只读事务从 **2026-09-06T18:23:08.073Z 至 18:23:41.154Z**。聚合证据保存在忽略目录 `data/batches/finance-2026-09-07-alex-detail-audit.json`；最终 errorCount=0，无真实库写入。来源与详情此时全部终态，不使用尚在创建过程中的瞬时覆盖分母。

| 项目 | 核查结果 |
| --- | --- |
| 来源计划 | 54 榜单 + 90 搜索任务全部成功；8,892 条原始来源行，6,495 个 country/store/externalId 身份。全部12国家/商店组合均有实际来源，来源上限沿既有说明，不宣称市场穷尽。 |
| 详情全集 | 6,509/6,509 成功，0 failed/queued/running；比本轮来源身份多的14条是原主库中本轮来源未命中的既有App，仍完整纳入。 |
| 源资料逐条留存 | 8,892 行与来源任务完整结果逐条核对；已入主库对应的3,308条 discovery 关联、原文、国家/语言与观测时间全部一致。 |
| 详情/分析 | 6,509 份完整规范详情和 raw 与任务返回、staging 逐条一致，身份/时间/成功 attempt/response 凭证完整；全部分析使用 `2026-09-07.1/heuristics-2`。 |
| 证据定位 | 13,316 条证据的 source 字段、start/end 和 text 与保存的源描述/标题/摘要逐条相符。此检查验证可追溯原文，不能说明模型识别准确率或许可合法性。 |
| 主库快照 | 2,024 个主库App均有且仅有对应本轮观测时间的快照，完整 raw 一致；仅 staging 的对象完整详情留在批次表，未要求生成主库快照。 |
| 全量 bulk 核对 | 全部4,167个成功bulk详情关联87条真实HTTP；逐条校验原始 iTunes record、country/trackId、HTTP与任务/envelope/raw的时间。入主库的1,023个bulk对象快照也一致；其余留staging。错配/丢字段/错误时间/缺attempt均0。 |
| 旧数据保护 | 原474条的全部基线字段（身份、classification/source/override、firstSeen）逐条一致；国家language/keywords/enabled一致，0变化。 |
| 后续分母/计划 | 最终主库2,024；2,024/2,024均具有每种七类补充恰好1项，共14,168项，以及首评论页恰好1项，共2,024项。无遗漏、无用旧数据跳过新任务。 |

最终来源及主库规模如下（跨国家/商店身份独立，不解释为全球唯一产品）：

| 国家 | GP 来源行 / 身份 | App Store 来源行 / 身份 | 最终主库 | 本轮新增 |
| --- | ---: | ---: | ---: | ---: |
| 泰国 | 365 / 287 | 1,006 / 673 | 299 | 226 |
| 墨西哥 | 366 / 294 | 1,026 / 709 | 458 | 361 |
| 菲律宾 | 530 / 442 | 1,011 / 637 | 338 | 274 |
| 巴基斯坦 | 530 / 468 | 1,018 / 803 | 244 | 157 |
| 印尼 | 372 / 289 | 1,065 / 632 | 283 | 226 |
| 阿根廷 | 531 / 459 | 1,072 / 802 | 402 | 306 |
| 合计 | 2,694 / 2,239 | 6,198 / 4,256 | 2,024 | 1,550 |

识别建议与实际分类分别核对：strong 649、possible 1,274 均入主库；insufficient 4,586 中，原有101条保留主库，**新4,485条只保留staging**。新增1,550条恰为 **407 auto confirmed + 1,143 auto candidate**；原474条继续 legacy candidate/override=true。新对象的实际分类/来源/覆盖逐条符合强弱入库规则，没有新insufficient被塞入主库，也没有强/可能信贷对象静默遗漏。

CEO 另提供独立操作证据 `data/batches/finance-2026-09-07-api-smoke.json`：18:07:01Z 对新bulk App567，未认证401、认证200，API rawDetail与SQLite最近快照raw完全一致，原lookup行/HTTP引用/描述/seller/分析均存在。本项明确引用CEO实际API操作，Alex自身完成的是上述全量存储核查。

阶段快照中补充资料为 **163 succeeded、1 running、14,004 queued**，评论首批 **2,024 queued**。这些排队项目不能算“已取得全部资料”；FS-AC-05/06/07及整体运行完成/恢复验收继续等待后续实际执行。没有重跑已通过的92工程测试来代替本阶段真实审计。

## 后续验收条件

工程与第一阶段真实核查已完成；真实 FS-AC-05/06/07、后续原始资料留存及整体运行结束/恢复、报告与 PM 最终验收仍需后续结果。FULL-SCAN-01 至 04 与批量优化已复测闭环，#11 暂不按整体完成关闭。

最终固定原清单加本轮新增的补齐分母，逐 App 核对详情、全部可继续评论页和 7 类补充本轮实际尝试。排队、running、deferred 或未尝试不能剩余而宣称完成；失败、重复页/游标保护和上游限制逐项解释，确认没有可继续页被静默丢弃、原分类/数据未破坏、运行设置恢复，再交 PM 验收。fixture、构建及来源阶段成功不能代替完整采集结果。


## 第二阶段解析修复补充

真实开发者续页发现的兼容缺陷[#13](https://github.com/zequnjiang/appeye/issues/13)已另行完成工程验证，见[DEVELOPER-CONTINUATION-ALEX.md](DEVELOPER-CONTINUATION-ALEX.md)：当前完整99/99测试通过，保存的两条真实HTTP离线解析得到33项、原20项和原HTTP不变。Alex没有额外真实网络/生产写入；其后18:35:31.989Z只读确认task602真实attempt2为33项/0warnings，旧20项历史及原HTTP保留，仅1项显式重排，见专报。后续全体补充/评论覆盖仍需继续核查，不改变第一阶段已验收结论。

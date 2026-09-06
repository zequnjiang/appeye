# 财务分类扫描：CTO 自检与测试交接

- 日期：2026-09-07（Asia/Shanghai）。需求：[FULL-SCAN-2026-09-07](../requirements/FULL-SCAN-2026-09-07.md)，GitHub [#11](https://github.com/zequnjiang/appeye/issues/11)。
- 范围：独立一次性批次采集器；不改原普通 worker、定时计划、用户国家配置和人工分类优先规则。
- 文件：`server/full-scan.ts`、`server/full-scan-providers.ts`、`scripts/full-scan.ts`。
- 状态：CTO 实现和自检完成，交 Alex 独立最终回归。真实批次尚在执行，本文不是“全量采集完成”报告。

## 来源能力核实

核对指定项目公开仓库及实际安装版本的代码，而非仅根据旧库同名接口猜测。源码分别为 `@mradex77/google-play-scraper@1.1.0` 与 `@perttu/app-store-scraper@2.1.0`。

| 来源 | 实际范围与终止边界 |
| --- | --- |
| GP Finance 榜单 | `TOP_FREE`、`TOP_PAID`、`GROSSING`，category=FINANCE。请求 num=500；一条 RPC，无公开续页游标，源码文档说明实际通常最多约 200 项。 |
| Apple Finance 榜单 | category=6015，iPhone/iPad 各免费、付费、畅销共六类；库将每榜 num 限为 200，无续页游标。部分榜单是否可用以真实结果或错误为准。 |
| GP 搜索 | 每个国家现有关键词，num=250；库内部翻页，并捕获 degradation/integrity 告警。250 是当前库验证的接口上限，不能宣称完整市场。 |
| Apple 搜索 | 每页 50 项，最多四个切片。实现是增加 limit 后本地 slice，不是真正服务端 cursor；请求总上限 200。 |
| GP 评论 | `paginate:true`，逐页保存 `nextPaginationToken`，直到无 token；空页如仍有新的 token 则继续。重复页/重复 token 是异常保护，批次记 needs-review。 |
| Apple 评论 | XML 公开评论页 1–10；库直接拒绝超出范围。第 10 页作为平台边界记录，不能称评论历史已全部取得。 |
| GP 开发者目录 | 移除常驻 provider 的 20 项窗口；库内部沿公开 token 读取，保留解析降级/循环告警与全部原文。不递归采集目录内的新应用。 |
| Apple 开发者目录 | 当前库忽略 num 且 lookup 没有传 limit；本批次 transport 明确追加 limit=200，保存原响应并说明没有公开续页游标。 |

参考：[GP 指定仓库](https://github.com/MrAdex77/google-play-scraper)、[Apple 指定仓库](https://github.com/plahteenlahti/app-store-scraper)、[Apple Search API 参数与频率说明](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)。Apple search/lookup 使用合法 `en_us` 参数，国家店面独立保留；不宣称评论或页面已按 th/es/id 语言返回。

## 实施与恢复语义

1. 同一 SQLite 追加独立 `full_scan_runs/tasks/attempts/sources/candidates/responses/review_seen/http` 表，启动即保存计划、现有应用任务和配置。正式应用、快照、评论与补充资料继续使用原有 Store 保存方法，后台可直接读取。
2. 先执行财务榜和关键词发现，再完成所有详情、所有七类补充资料，最后评论按 page/id 轮转。每个原库应用都进入批次，包括 excluded、停用国家和本轮发现国家之外的既有应用；绕过 listApps 默认 100 项截断。
3. 财务结果全部保留在来源和候选 staging。详情分析 strong/possible 才加入主应用库；insufficient 仅保留批次证据。既有应用继续保留人工/legacy 分类，不因自动分析改变。
4. 每个请求保存原 HTTP 响应、URL、方法、状态和时间；每个采集任务保存完整库返回值。成功返回先写缓存再应用，重启复用缓存和游标；错误原响应仍留历史，坏结构重试会重新请求。
5. 详情失败不阻止既有应用的评论和其他补充接口。各补充类型单独失败与重试，不清空旧成功资料；最后成功数据与最近失败尝试保持分离。
6. 评论按 app+稳定 ID 去重。每页分别记录 fetched、added、updated；批次 seen 数与新增数分开。已存评论仍可更新内容，不能遇到旧 ID 就提前宣称读完历史。
7. `--max-tasks`/`--max-minutes` 只暂停，待执行任务保留。可选评论预算触发时创建 deferred 下一页，保留 cursor；同 batch 使用 `--max-review-pages 0` 恢复。失败和循环不标成自然成功；平台限制显示 completed-source-limited，异常终止显示 needs-review。
8. 单 runner 进程写入，HTTP 全局默认至少 500ms 起始间隔；iTunes search/lookup 独立至少 3100ms。429 尊重 Retry-After，任务另有有限重试和指数退避。每次 HTTP 30s、整项操作默认 90s 超时，取消信号向下传播。

## 自检与真实联调

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 78/78 测试、全工程严格类型、Vite 生产构建、服务端编译通过；Alex 后续新增测试以独立报告为准。 |
| CLI 单独严格类型检查 | `tsc --ignoreConfig --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --esModuleInterop --skipLibCheck --resolveJsonModule scripts/full-scan.ts` 通过。 |
| CLI 帮助 | `npx tsx scripts/full-scan.ts --help` 实际执行通过，无真实库访问或网络。 |
| Alex 当前批次测试 | 覆盖 101 原库应用、三类 staging、人工优先、评论轮转/跨页更新、断点续传、坏响应重试、缓存重放、预算恢复、请求语言冻结、原 HTTP ledger 联调、Request 对象兼容及超时隔离。 |
| CTO 有界真实联调 | 内存 SQLite、真实 GP 泰国 Finance TOP_FREE 一次 POST 200，200 条来源/候选、1 条完整 HTTP 原文（1,317,945 字节）成功保存，0 失败；未操作正式数据库。 |

真实 source 首次启动发现 `recordHttp` INSERT 的九列误写十个占位符，导致采集回调失败；当时没有任何源结果或 HTTP 响应成功入库，原错误 attempts 保留。Alex 独立定位，CTO 修为九个占位符并完成上述真实联调；补充了 provider→runner 实际 ledger 回归。原生 Request 的 URL/方法/取消信号兼容也已加固并测试，但它不是本次已证实的故障根因。

## 运维命令与交接

先停止唯一常驻 worker、完成 SQLite native backup，再执行：

```sh
FULL_SCAN_WORKER_STOPPED=true npx tsx scripts/full-scan.ts --batch-id finance-2026-09-07 --serve --delay-ms 500
npx tsx scripts/full-scan.ts --batch-id finance-2026-09-07 --status
```

同 ID 自动恢复，显式 `--retry-failed` 只重排失败任务。`--status` 用 read-only SQLite，不建库、不迁移、不启动采集。CLI 拒绝 demo 数据集，使用进程锁避免两个批次 runner 同时写入。`--serve` 提供已有认证后台，不启动普通 worker。运行中状态原子更新至 `data/batches/<batch-id>.json`，原始评论正文与用户名仅保留在忽略提交的本地数据库中。

CTO 交 Alex 执行最终回归与 CLI 状态/恢复验证；CEO 负责真实批次执行、备份、进度与最终覆盖报告以及 GitHub 跟踪。PM 应在取得实际覆盖、失败与续跑结果后验收；源扫描阶段或一次运行切片均不能当作整个采集任务完成。

## 本批次 Apple lookup 复用与追加回归

为了减少同批次数千个单 ID lookup 的重复请求，新增保守的 50 ID 批量预取（CLI `--apple-batch-size` 默认 50、最大 100、0 关闭）。只有同 batch、同 country、同冻结请求语言且仍为 queued 的 Apple detail 任务参与；不从 search 原文替代 lookup，也不跨批次/国家复用。

批量调用固定的 Apple `/lookup`，完整原 HTTP 仍写 `full_scan_http` 一份。逐 ID 检查返回软件身份、重复 ID 和截图数据；合格记录通过指定维护库的公开 `app()` 在内存中解析该单条 lookup 响应，保持库字段映射一致。内存解析不是另一次网络请求，不伪造 HTTP 记录。原始未知字段和 sellerName 保存在该应用的 `_appeyeLookupRecord`；`_appeyeBulkSource` 引用公共 HTTP ID、URL、真实采集时间与上下文，不把同批所有应用的大响应复制进每个快照。

每个应用仍执行自己的 detail 任务、独立记录结果/来源、保存快照并识别，后续补充资料和评论完全不变。每项快照采用批量来源的真实 fetchedAt。未返回、重复 ID、解析失败、批量请求失败或三种截图数组全空时回退原 `app()`，保留其 HTML 截图补采。内存缓存不持久化；重启可以重取尚未完成项，已完成任务和持久的来源引用不丢失。不会删除已有资料或重启正在执行的真实进程，受控重启由 CEO 安排。

独立审查另外修复了三项可恢复采集口径：Store.saveReviews 新增可选 fetchedAt，缓存评论重放保留原 response_at；评论续页和失败补充沿用任务冻结语言；GP 空页带有有效新 token 时继续，而不是误判自然结束。普通 worker 未传新参数时仍采用当前采集时间。

追加验证完成：CTO 对最新服务端和 CLI 严格类型检查通过；Alex 独立最终 `npm run check` **92/92**、类型检查及生产构建通过，包含 23 条 full-scan 和 8 条 bulk 回归。批量测试覆盖逐 ID 原始未知字段/seller/公共 HTTP 引用、四种上下文隔离、50 ID 上限、重复 ID/缺 ID/缺图/503/坏 JSON 回退、取消、fixture 不触真实网络、逐应用独立 ledger 与原始观测时间，以及 queued peer 的批次/商店/国家/语言筛选。三项追加评论恢复缺陷亦已回归通过。

CEO 在记录 runtime-2 代码 SHA256 后优雅停止旧 CLI，并以同一批次标识受控恢复、启用批量路径；本次优化未新建第二个运行批次，没有由 CTO 操作真实数据库或重启生产进程。追加工程检查已完成，真实数据采集仍在继续，最终覆盖与错误结果由运营审计报告和 PM 验收确认。

## Google Play 开发者续页布局修复（#13）

2026-09-07，真实批次中的 task 602（阿根廷 Google Play 开发者目录）保留了初始 20 项和 `developer-degraded` 告警。只读调查确认：HTTP 2769 的初始页面和 HTTP 2770 的续页响应都已完整存入数据库；问题发生在指定维护库的解析阶段，并非原 HTTP 丢失。续页的 13 项位于紧凑布局 `[0][0][0]`，而库的开发者解析器仅接受旧布局 `[0][6][0]`，因此报 `cluster-page-parse`。此新增批次缺陷单独跟踪于 [#13](https://github.com/zequnjiang/appeye/issues/13)，不改变此前第一项产品需求的验收结论。

修复限定在 `server/developer-continuation.ts` 和 full-scan provider 边界：仅对已核对 RPC、容器、应用身份、详情链接、必要字段和 token 形状的紧凑布局创建内存兼容输入。原始 HTTP 在转换前落库，字节不变；返回资料中的 `raw.compatibility` 记录转换路径、条数、公共原 HTTP ID 与该响应真实 fetchedAt。旧布局完全不变，未知/坏结构继续暴露原解析告警；空列表仍带有效 token 时也不转换成假终止。未修改 node_modules、官方返回原文或已有生产记录。

用真实已存的两个 HTTP 响应进行完全离线重放：维护库经过该边界后返回 **33 项、33 个唯一应用 ID、0 告警**；原有 20 项的 JSON 结果完全一致，两个原 HTTP body 完全一致。CTO 与 Alex 均以只读数据库及注入 fetch 验证，**没有新增真实网络请求，没有写入真实数据库**。这证明已保存响应可以恢复完整解析，不代表运行中的旧进程已经完成重采。

新增显式 `--retry-warnings` / `runner.retryDeveloperWarnings()`：只选择同一 batch、Google Play、已成功但 `developer-degraded` 的开发者任务，且告警为开发者续页解析错误，最后一条续页原 HTTP 必须能被该补丁识别。仅早页可适配而末页仍未知的任务不会被误重排；评论循环、搜索告警、其他批次、终止失败和未知开发者布局均不受影响。旧完整响应、原 HTTP、attempt 和 enrichment history 全部保留；新尝试追加历史并采用独立的有限重试预算，失败仍显示之前成功的目录和原采集时间。此入口不会把旧尝试改写成成功，也不会将告警直接清零。

受控停止旧进程、记录新代码版本并恢复同一批次后，CEO 可执行：

```sh
FULL_SCAN_WORKER_STOPPED=true npx tsx scripts/full-scan.ts --batch-id finance-2026-09-07 --serve --delay-ms 500 --retry-warnings
```

CTO 自检包括完整 `npm run check`（99/99、全工程类型与构建通过）、CLI 单独严格类型检查，以及原响应离线重放。Alex 独立回归覆盖两种实际 SDK 布局、未知/坏结构与空页活 token、33 项完整解析、原文和来源引用、重试范围、历史保留与有限预算；最后续页筛选加固后的正式结果见 Alex 针对 #13 的独立报告。源码修复交接后由 CEO 安排 runtime-3 启用和实际任务复采，本文不将尚未执行的真实恢复写为完成。

## 数字开发者显示名的目录路由修复（#14）

真实 batch task 14412（app 970，菲律宾，Google Play）对开发者 `059916517` 的三次请求均使用 `/store/apps/dev` 并返回 404。只读核对同批详情 task 5903 / HTTP 1139（200）发现：应用 `com.smartsave.budget.finance.book` 的真实发布者锚点及 script data 都指定 `/store/apps/developer?id=059916517`。维护库会丢弃该链接的路径，仅保留开发者 ID，再用纯数字正则决定 `/dev` 路径；这是已定位的内部路由缺陷，不能把这三次 404 解读为开发者页面下架。单独跟踪于 [#14](https://github.com/zequnjiang/appeye/issues/14)。

修复仅适用于本批次 Google developer 补充采集。runner 从同 batch、同 app、同国家、成功详情任务中读取已保存的 HTTP 200；详情 URL 的应用 ID、国家及语言必须与当前冻结任务一致。`server/developer-route.ts` 只接受同开发者字符串 ID（保留前导零、只解码一次）的官方 origin 和 `/dev` 或 `/developer` 精确路径，拒绝重复 ID 参数、异站地址、身份不符或两种路径相互冲突。有效路径作为可选 `developerUrl` 和 `developerSourceHttpId` 传入 provider 并冻结进本次任务；没有可靠证据时保持库原行为，不做未验证的 404 地址猜测。

transport 仅将维护库初始目录请求的路径改为该真实链接提供的路径，ID 不变，国家/语言使用当前任务上下文；续页、限速、超时和取消机制不变。完整真实响应继续留存，成功资料在 `raw.routing` 记录原详情 HTTP ID、验证方式与实际目录来源。成功 `source` 和失败 `attemptSource` 均使用同一已验证路径，现有后台分别展示最近成功来源和最近尝试来源；旧失败的原 URL、HTTP、attempt 和 enrichment history 不修改。显式 `retryFailed()` 也保留累计 attempt 序号，并沿用 #13 的有限恢复预算，从而避免重试序号重新从 1 开始。

CTO 以真实已保存的 HTTP 1139 离线重放 `app()`，复现 developer/developerId 均为 `059916517` 且 developerUrl 缺失；以固定 name-layout HTML 注入维护 SDK，原路由复现 404，新边界成功访问夹具的 `/developer` 路径并解析数据，原响应不变、ID 保留前导零、PH/en 上下文准确、0 告警。该测试没有声称已联网验证目标目录的当前可用性。全过程 0 新真实网络请求、0 真实库写入、0 生产进程操作。

CTO 当前完整自检 `npm run check` 99/99、全工程类型和构建、CLI 单独严格类型均通过。针对 #14 的新专项由 Alex 独立补充并完成后报告；CEO 应核对当前失败列表、记录代码版本、受控重启同一 batch，再显式 `--retry-failed` 执行实际恢复，之后验证原三条失败历史保留及新尝试结果。工程修复不等于目标目录已真实重采成功。

## 独立诊断增强：保留传输错误底层原因（#11）

与 #14 路由修复分开处理：CEO 对 Apple 三个 `fetch failed` 补充任务做了有界的官方域名探测，记录于本地 `data/batches/finance-2026-09-07-apple-url-probe.json`，确认简称 URL 和真实 lookup 提供的 trackViewURL 均出现上游 301 自循环，未得到成功 HTML。因此没有更换店面、猜测其他数据来源或把该上游错误标为已解决。

为使后续失败保留诊断信息，新增 `server/transport-error.ts` 的 `describeTransportError()`，只改变 full-scan HTTP ledger 的 error 文本：保留原 message（最多 2000 字符），并追加最多两层 cause 的 name/message/code，分别限长 100/1000/100；数值 code 必须有限。不复制 stack、请求/响应 body 或其他任意字段；循环引用和不可读取属性不会中断错误记录。没有 cause 的普通错误仍保持原消息。provider 在记录后仍原样抛出原异常，不改变重试、限速、取消或任务成功/失败判断。

CTO 已做严格类型检查及完全注入的传输测试：`fetch failed` 保留两层底层原因，第三层、stack 和 body 不进入 ledger，status 仍为 null，调用者仍收到原失败；0 真实网络和真实库写入。Alex 将此诊断专项与 #14 的最终全回归一起验证，验收范围仍区分“内部路径已修复”和“上游自循环仅保留准确失败与可恢复记录”。

追加最终交接结果：Alex 对冻结源码独立执行完整检查，**110/110 测试、严格类型及生产构建全部通过**，包括 9 项 #14 路由回归与 2 项传输原因记录回归，见 [DEVELOPER-ROUTE-ALEX.md](./DEVELOPER-ROUTE-ALEX.md)。CTO 也只读核对同包的 PK 失败 task 15308：其本批详情 task 6643 / HTTP 1449 提供同一 `/developer?id=059916517` 官方路径，新 helper 可准确取证；PH 和 PK 使用各自国家的原详情证据，不跨国复用。源码保持冻结，由 CEO 执行一次受控 runtime-4 恢复并核对新的实际结果。

## source-5：开发者续页返回上游 RPC 错误，待有限重试

运行中的两项印度尼西亚 BCA 开发者目录 task 16108 / app 1182、task 16116 / app 1183 出现 `developer-degraded`。调查时，各自初始页面保留 10 项；续页 HTTP 7232 / 7236 虽为 HTTP 200，但 `qnKhOb` 的 payload 为 null，错误结构为 code 5、公开类型 `PlayDataError`、detail `[1]`，不存在任何可用于 #13 布局转换的应用数组。初始页面 HTTP 为 7231 / 7235。该现象与 #13 的已保存紧凑应用数组解析缺陷不同；不把未经公开核实的错误码业务含义解读为下架，也不把这 10 项视为完整开发者目录。

仅使用上述原响应进行离线重放，输出的 10 项 JSON 与当前已存部分资料逐字段相同，原 HTTP body 不变；维护 SDK 构造的续页 token 与原初始页面指定 token 逐字符相同，国家/语言均为 id/id，未发现取错 token 的证据。实际运行 ledger 没有保存请求 body，因此该比较明确属于当前安装 SDK 的离线请求构造验证，不能冒充实际请求体留存。此次调查 0 新真实网络、0 真实数据库写入、0 源码修改。

只含引用、时间、哈希、计数、类型、代码及验证结论的聚合证据保存在忽略提交的 `data/batches/finance-2026-09-07-developer-rpc-source-audit.json`；没有导出 token 或原响应正文至文档。当前状态保留部分成功资料及失败续页原文，继续标记需复核；#13 的限定重试入口正确排除本类错误。CEO 将先完成本轮全部补充采集、核对同类范围，再以唯一写入进程控制一次有证据的有限重试，追加新尝试而不修改旧记录。该问题尚未被新代码解决，也没有作为 unsupported 或空成功跳过。

## runtime-5 工程交接：定向恢复、响应幂等与索引

**source5 定向恢复（#11，FS-DR-01~07）。** 新增 `--retry-developer-source-errors` 和 `runner.retryDeveloperSourceErrors()`，默认不执行。它仅选择本 batch 的 Google developer `succeeded + developer-degraded` 任务，要求现有解析告警、最后一次官方 `qnKhOb` HTTP 200、null payload、明确 `PlayDataError` code 5，并核对国家/冻结语言。未知布局、其他错误码、普通成功、其他类型、其他 batch 和不一致来源均不重排；原 `--retry-warnings` 范围不变。

恢复复用原历史保护事务，payload 保存 reason、round=1、旧 sourceHttpId、previousResponseAt、queuedAt 及 recoveryAttemptBase。重复开关和中断恢复沿用同一轮，不自动开启无限新轮。旧 response/HTTP/attempt/enrichment history 和累计序号不修改；原响应缓存先归档，再重新取得初页及其新游标。再次返回部分目录和 source5 时仍保存 `succeeded + developer-degraded`，一轮到此结束，不能计入完整目录成功；只有网络异常使用现有最多三次新预算，最终失败保留旧部分资料及原成功时间。无告警返回则按原正常流程保存新资料。目录说明改为“沿公开游标尝试续页”，不再在有告警时声称自然读完。README 与 CLI help 已同步说明该入口不解决上游错误或保证完整性。

**同毫秒响应幂等（#15）。** CTO 回归发现既有 `app/kind/fetched_at` 判重会把同毫秒的失败后成功或两个真实部分响应误当作同一次重放；这是离线发现，没有已知线上数据损失。[#15](https://github.com/zequnjiang/appeye/issues/15) 的修复以持久 `full_scan_responses.id` 作为响应身份，result.appliedResponseId 记录该响应已应用。Store.saveEnrichment 增加可选同步 onSaved hook，在其原有事务提交前写标记，history、最新资料和标记原子提交；没有嵌套 BEGIN 或复制另一套资料写入 SQL。不同真实响应即便时间和内容相同也分别追加历史；同一缓存响应重放保留原观测时间并只应用一次，旧四参数调用不受影响。

**纯索引优化。** `ensureFullScanSchema` 仅新增 `full_scan_http_batch ON full_scan_http(batch_id)`，供现有按 batch 的 HTTP 计数使用。依据 Alex 的独立读查询测量：当前数据约 5ms，50,000 行合成样本约 11.65ms，索引后约 0.57ms；这些是本地观察，不作为线上性能保证。未新增计数器、改变状态查询频率、并发或任务调度。

CTO 自检：完整 `npm run check` **118/118**、全工程类型/构建、CLI 单独严格类型通过；新增测试继续由 Alex 独立完善并以其最终报告为准。完全冻结时间的内存实测确认：同毫秒同内容的新恢复产生两条独立历史，原历史不变；已应用响应的中断重放不增加采集调用或历史；source5 再次返回只产生一次新正常任务执行并保留告警。真实原响应 7232/7236 仅以只读方式验证严格解析器可正判，0 真实请求、0 真实数据库写入。源码交 Alex 最终独立回归后，由 CEO 在 phase2 范围核对后安排 runtime-5 单轮真实恢复；该交接不预先接受 source5 为来源限制。

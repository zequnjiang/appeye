# 每小时监测与市场动态：CTO 自检

- 关联：[需求 #18](https://github.com/zequnjiang/appeye/issues/18)、[PR #19](https://github.com/zequnjiang/appeye/pull/19)、[HMA-AC-01–14](../requirements/HOURLY-MARKET-ACTIVITY.md)。
- 日期：2026-09-07。后端由 CTO 实现；CEO 实现前端、本地日期解析及部署模板；Alex 独立回归后交 PM 验收。
- 自检环境：内存或临时 SQLite、注入商店客户端/时钟、本机 HTTP；CTO 未请求真实商店、修改生产数据库或重启采集进程。真实只读检查与模拟验证分别列明。

## 实现及边界

006 迁移将已有国家周期统一为1小时，保留国家启停、语言、关键词、应用、人工/legacy分类和全部历史。`monitor_*` 持久保存周期、任务、尝试、完整响应、来源及底层HTTP。首次运行立即安排，以60分钟为周期；活跃周期不再重复入队，停机错过多个小时只安排最新应执行窗口。暂停国家的未启动自动任务记 skipped；失败最多3次和指数退避，后续周期可再尝试。

小时发现按三个Google财务榜、六个Apple财务榜及本地关键词首搜索窗口取有限样本（GP最多250，Apple最多50），来源边界随结果保存。所有启用国家主库应用（包括 excluded）刷新详情；新 strong/possible 进入主库，insufficient 留周期暂存证据。每小时不派生历史评论和七类补充，人工判断不受自动刷新覆盖。

正常服务在打开主库之前取得独占锁，并用一个协调器分配最多3小时任务、1批次任务、1手动任务的循环槽位；空通道让出槽位。两店和所有通道共享唯一 fetch transport、全局起始间隔及iTunes至少3100ms限制。底层HTTP的异步上下文固定到原任务，超时后迟到的错误不会归到下一通道。Apple详情使用同周期/国家/冻结语言的50ID批量lookup，逐应用账本与原时间保留，周期结束释放缓存。

进程互斥由小型独立 `.full-scan.lock.sqlite` 上持有全生命周期的 `BEGIN EXCLUSIVE` 实现，不锁应用数据文件；进程死亡由OS释放。PID/nonce侧文件继续兼容旧CLI且只在取得原子所有权后接管死锁，数据库symlink路径先规范化。正常服务与独立CLI不能并行启动。

协调器只恢复已经seed的历史批次，绝不重新seed。#11原2,024成员保持；新小时应用不扩张旧批次。失败恢复新增明确的 kind/ID 限制以及只入队退出的 `--retry-only`，限定7个Google评论失败页时不会重开12个已确认来源受限的Apple补充任务；原response/HTTP/attempt和累计序号保留。恢复预算仍有界。

快照与响应收据在Store原事务中一起提交，避免中断重放重复变化和嵌套事务。较早预取结果仍保存独立旧快照，但不覆盖更晚current/分析、不制造拿旧资料比较未来的变化；读取最新资料及版本序列按observed_at与id排序，同一毫秒后写ID作为稳定次序。批次详情也按持久响应ID去重；升级前尚无响应身份的缓存，只能在时间、规范字段及完整raw全部一致时认领既有快照。

市场API固定Asia/Shanghai业务日界，含当日开始、不含次日开始。firstSeen事件时间和最早成功详情观测分开，更新说明/商店时间取对应快照；date-only released保留原值和日历精度、不补午夜。CEO提供六国语言日期解析，支持泰历与泰数字。版本空缺/恢复仍可审计资料变化，但不标为版本发布；应用计数与事件数、当前分类与市场身份分别明确。

`full-scan-audit.ts` 使用本批detail成员、本批其他任务/admission引用及独立baseline IDs核对覆盖，避免以当前全库作为旧批次分母。支持旧apps及冻结members格式；无baseline会明确初始成员不可完全验证，有冻结members时额外报告范围外成员。全库计数使用allDatabase*名称，保留与本批统计的差别。

## 验证记录

| 验证 | 实际结果 |
| --- | --- |
| 原有全量回归、前后端类型、构建 | 首轮136/136通过，Vite、server与SQL迁移复制通过；两项旧24/48小时期望由Alex按新授权改为1小时，其他保护断言保留。 |
| CTO单独时钟/队列自检 | 13项任务、双店2详情完成；重复schedule不增任务，跨5小时只增加一个周期，excluded保留，0评论/补充派生；3h/1b/1m顺序与date-only事件通过。 |
| 协调器与冻结cohort专项 | 9/9通过：实际多通道调度、迟到HTTP归属、进程崩溃/锁别名、限定7任务恢复、retry-only无请求及审计排除新hourly应用/检出遗失初始成员。 |
| 旧版本缓存兼容 | `interrupted cached success`专项通过，未重新请求、未改原观测时间、未重复快照。 |
| CLI类型与帮助 | `tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck scripts/full-scan-audit.ts scripts/full-scan.ts`通过；新恢复参数在`--help`可见。 |
| 前端实际自检 | 见[CEO前端自检](HOURLY-MARKET-ACTIVITY-UI-SELF-CHECK.md)：桌面/390px、分页组合筛选、1,780字完整内容、字面脚本安全文本、详情联动、失败面板、控制台0error；CTO集成构建通过，独立浏览器验收归Alex。 |

最终自检：`npm run check` **169/169通过**，无失败/跳过；前后端类型检查、Vite与server构建、迁移复制全部通过，完整输出保留于 ignored `.artifacts/hourly-cto-final-check.log`。另执行两CLI严格类型检查及 `git diff --check`，均通过。新增小时14项、协调器9项、手动来源6项由Alex独立编写，CTO纳入全量自检；后续仍由Alex独立最终运行并正式交PM。

接管前发现的旧手动任务通过严格证据合并：只处理batch创建前queued请求；同app/country/store、冻结语言相符，评论流已全部成功且首窗口有更晚持久响应，或七类补充均成功无warning。结果明确coalesced/sourceObservedAt/逐项task与response引用；原任务createdAt和attempts、批次响应/HTTP/历史不改。失败、部分、缺来源或较晚新请求保持原状。真实88项是否全部满足及合并后证据由CEO/Alex在受控启动时独立核验，不用fixture结果冒充真实合并。

后续手动app/reviews/enrich完整payload/raw写入新增manual_responses表，记录job/attempt/app/国家/请求语言/原时间；monitor_http继续保存固定job归属的原HTTP。应用receipt与Store原有事务一起提交，模拟资料写入后任务完成中断，恢复只读缓存、零新请求、零重复应用。旧未应用评论响应遇到更新current时仍保留raw与receipt，但upserted=0/skippedOlder=1；批次对应updated=0/seen=1，明确见过身份与实际写入不同。

firstSeen跨所有历史monitor_sources/full_scan_sources及已有discovery来源查最早真实观测；先前insufficient暂存、次日strong入库会归入旧发现日，既有main/legacy值不回写。以上新增回归和迟到评论两项均已通过。

新增006最终对象：monitor_state、monitor_cycles、monitor_tasks、monitor_attempts、monitor_responses、monitor_http、monitor_sources、manual_responses，以及对应查询索引；本轮最后新增索引为manual_responses_app_time、monitor_http_job、monitor_sources_first_seen。未运行生产迁移。

## 真实只读证据与受控部署

CEO通过DatabaseSync readOnly facade读取既有资料，未构造Store/迁移/请求商店：市场动态当日2,024首次发现、229个有变化应用/258事件、商店发布0；全国家首次发现约1.18秒、变化约0.93秒、TH发布约0.088秒。这些是特定时点查询耗时，不推断整体采集吞吐。证据：`data/batches/finance-2026-09-07-hourly-activity-readonly.json`。

CEO又对901个GP市场记录的商店原日期只读检查：893个有源日期全部能解析、8个来源缺失、0个有日期未解析。证据：`data/batches/finance-2026-09-07-hourly-release-date-coverage.json`。PM独立冻结2,024身份集合的证据位于`.artifacts/pm-hourly-batch-cohort-baseline.json`；上述本地真实证据不提交数据库、评论或凭证到GitHub。

Alex独立工程回归通过后，CEO可进行已授权的单writer受控部署：停止旧runtime8、备份、精确恢复7页、运行迁移、前后核对冻结cohort及旧历史、用同一正常服务继续小时任务与评论。部署运行证据及launchd实际安装由CEO另报，PM再最终验收；无需等待全部GP历史评论完成才上线#18，也不能以#18工程通过宣称#11完成。

长期运行要求平台保持Node进程与主机运行；部署模板见[本机服务操作](../operations/LOCAL-SERVICE.md)。本自检未安装系统服务，未宣称进程退出或主机休眠时仍能准时完成采集。

## 正式 CTO 交接

2026-09-07：#18后端、前端集成、CLI/cohort兼容及新增手动来源保护实现已完成，自检169项和全部类型/构建通过，源码冻结交Alex。无已知工程阻断项；待Alex独立最终检查后，可由CEO执行已授权受控部署。仍待真实迁移/限定7页恢复/88项覆盖合并/首小时运行及旧批次继续推进的证据，最终验收权属于PM。本工程交接不提前关闭#18或未完成的#11。

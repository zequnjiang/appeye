# Appeye 架构与数据说明

Appeye 首版是单主机、单管理员的 Node.js 24+ 应用。Express 5 提供 API 和构建后的 React 页面；同一服务进程内运行一个串行采集 worker。SQLite 使用 WAL、外键、参数化 SQL 和明确的 SQL migrations。源代码为 TypeScript ESM，不需要数据库服务或 Docker。

## 边界与目录

- `server/app.ts`：可注入 Store 的 Express factory、登录、输入校验、查询和任务创建。
- `server/db.ts`：同步 SQLite repository、事务、规范化持久化、去重、统计和任务状态转换。
- `server/providers.ts`：指定版本的 Google Play 和 App Store 采集适配器。
- `server/worker.ts`：可注入 provider 的单 worker、限速、超时、有限重试和周期排程。
- `server/migrations/*.sql`：按文件名排序的一次性迁移；已执行版本写入 `schema_migrations`。构建必须复制至 `dist/server/migrations`。
- `server/index.ts`：环境配置、正式/演示隔离检查、HTTP 监听和进程退出。
- `scripts/seed-demo.ts`：必须显式启用演示模式并使用独立 demo 数据库；已有数据时保留，不覆盖。

测试通过 `createStore(':memory:')`、`createApp(options)` 和 `createWorker({store, providers})` 注入确定性响应，不需要真实商店网络。

## 关系和数据口径

`countries → apps → snapshots / changes / reviews`，任务保存在 `jobs`，国家/商店的上次周期入队时间保存在 `schedule_state`。跟踪身份是 `country + store + external_id`，同一包名在两个国家分别保存。

`apps` 保存可索引的国家、商店、分类、名称、开发者、时间，以及当前规范字段 JSON。`snapshots` 每次成功采集均保存规范 JSON、完整原始响应和 ISO UTC 观测时间。`changes` 保留旧值、新值、观测时间和来源快照 ID；首次快照不生成更新事件。异常不覆盖最后成功数据，也不自动推断下架。原始 JSON 可能包含第三方评论用户名，应按团队数据访问范围保管数据库。

Google Play 安装区间是公开累计商店指标，不能代表所选国家的下载量。App Store 的安装字段在持久化层强制为 `null`。该库 App Store `reviews` 字段源于 Apple `userRatingCount`，映射为 `ratings`；Google Play 的文本评论数量单独保存为 `reviewCount`。App Store bundle ID、价格和币种在返回时保留。

`first_seen_at` 是系统首次发现；商店发布日期保存在 `data.releasedAt`。观察更新次数仅统计连续有效非空版本之间的变化；版本缺失再恢复同一版本不计更新，普通字段变化记录仍保留缺失与恢复过程。平均间隔至少需要两次版本变化，按这两次及后续变化的实际观测时间计算，不代表商店完整版本发布历史。

评论唯一身份是 `app_id + external_id`，国家已由 app_id 隔离；更改采集语言后仍更新同一行，语言保存为最新采集上下文。004 迁移对旧重复行保留最近采集的版本。缺失商店 ID 时，适配器以用户、标题、文本、评分、版本和时间生成 SHA-256 内容标识，原始 JSON 的 `_appeye.reviewIdSource=content-hash` 明示；内容变化可能形成新行，这是缺失真实 ID 的限制。Google Play 默认请求最新 100 条，国家/语言是请求上下文，不能证明作者国籍。App Store 默认取最新第 1 页，语言写为 `und`（未验证）。

## 采集任务

任务类型为 `discover`、`refresh`、`reviews`、`enrich`，状态为 `queued → running → succeeded`，失败自动返回 `queued`，达到上限后为 `failed`。领取任务和状态迁移使用事务，活跃任务通过部分唯一索引去重。单个应用的详情与评论独立执行；单关键词失败也继续其他关键词，并将部分失败和实际错误记录在发现任务中。

每个启用国家、每个商店按 `intervalHours`（默认 24 小时）创建发现任务，同时为未排除应用创建刷新任务。发现默认每个关键词取 20 个结果，写为候选，创建详情任务；详情成功后创建评论任务。人工/历史覆盖不被搜索或自动分析覆盖；新应用允许按明确证据自动识别，见 V0.2 说明。暂停国家停止后续周期入队，已入队任务继续，手动发现仍允许。`AUTO_SCHEDULE=false` 关闭自动排程，手动任务仍会执行。

worker 默认轮询 2 秒、请求起始时间最少相隔 1.5 秒、一次请求 30 秒超时，最多 3 次尝试，重试退避为 30 秒、60 秒。API 可重新排队最终失败任务。进程重启将遗留 running 任务恢复为 queued；若已达上限则标失败，防止无限尝试。两个新采集库均使用原生 fetch、AbortSignal 和底层请求超时；库内重试设为 0，由持久任务队列统一执行有限重试。采集器内部的多次请求也经过共享 fetch 限速器。关闭服务时等待当前任务最多 35 秒，否则由下次启动恢复。

仅支持一个活动服务进程/worker 访问一个数据库；不能开启多副本、多个独立 worker 或将 SQLite 放在网络文件系统。当前没有分布式租约。未来需要扩容时可将相同任务契约迁移到 PostgreSQL 与独立 worker。

## 登录与服务暴露

`ADMIN_PASSWORD` 从环境变量读取，不入库。会话用随机 ID、HMAC 签名及服务端到期表验证，cookie 为 HttpOnly、SameSite=Strict，12 小时过期。退出会在服务端撤销会话；服务重启使现有会话失效。密码摘要使用定长比较，登录有 15 次/15 分钟的限速。写请求检查 Origin 与 Sec-Fetch-Site；本机 Vite 开发源默认允许。

默认只监听 `127.0.0.1:3000`。生产模式无密码会拒绝启动，任何模式配置非空密码都至少需要 12 个字符。端口、请求间隔和超时时间会校验有限数值范围，避免错误配置形成无限或异常任务。跨机器公开服务时，使用 HTTPS 反向代理并设置 `COOKIE_SECURE=true`，将精确外部地址加入 `ALLOWED_ORIGINS`。不配置通配 CORS。不要把数据库、`.env` 或日志直接暴露为静态目录。

## 正式/演示隔离与备份

正式数据库默认为 `data/appeye.sqlite`，演示为 `data/demo.sqlite`。启动对文件名与 `DEMO_MODE` 一致性检查，同时数据库 `metadata.dataset` 持久标记 `live`/`demo`，不能简单改文件名切换数据集。演示模式不启动真实 worker，API 拒绝新增真实跟踪/采集/重试。页面收到 `dataset` 字段持续显示演示状态。

安全备份：优先停止唯一服务进程，确认进程退出后将 SQLite 文件及存在的 `-wal`、`-shm` 同名附属文件一并复制到受控备份目录；需要不停机备份时，使用 SQLite 的 online backup API 或 SQLite CLI `.backup`，不能只复制正在写入的主文件。恢复时停止服务，将整套备份恢复至独立目录，检查 `metadata` 和数据库完整性后再切换路径。不要提交实际数据库或备份到 Git。

## AI 友好查询示例

所有数据都是普通 SQL 表与合法 JSON，无 ORM 黑盒。以只读模式打开备份，可执行：

```sql
SELECT a.country, a.store, a.external_id, a.title,
       json_extract(a.data, '$.version') AS version,
       json_extract(a.data, '$.ratings') AS ratings,
       a.first_seen_at, a.last_fetched_at
FROM apps a WHERE a.classification = 'confirmed';

SELECT c.app_id, c.field, c.old_value, c.new_value,
       c.observed_at, c.snapshot_id
FROM changes c ORDER BY c.observed_at DESC LIMIT 100;
```

采集是公开页面/接口的有限观察，不提供商店官方 API 服务等级。指定 scraper 上游接口可能改变；实际错误应通过任务中心排查，不能用演示结果替代。


## V0.2 迁移与完整资料

生产依赖精确切换为 [MrAdex77 的 `@mradex77/google-play-scraper@1.1.0`](https://github.com/MrAdex77/google-play-scraper) 和 [plahteenlahti 的 `@perttu/app-store-scraper@2.1.0`](https://github.com/plahteenlahti/app-store-scraper)，两者 MIT。旧 scraper、request 链及其临时 overrides 已移除。库自带类型，无旧 ambient module 声明。适配器显式关闭库内重试，把超时/AbortSignal 传入原生 fetch；所有实际 HTTP 请求共享串行起始间隔，默认 1500 ms。`SCRAPE_TIMEOUT_MS` 同时传给 worker 和适配器，范围 100–120000 ms（符合 GP 客户端上限）。测试可注入 scraper client 或 fetch，缺补充方法时报告 unsupported，不回退访问真实网络。

005 migration 在事务中扩展 jobs 的 enrich 类型，并保留全部旧任务 ID/时间/状态；新增 discovery_observations、enrichment_history、enrichments，以及 apps 的分类覆盖和分析字段。所有旧应用迁移为 legacy 人工覆盖，连旧 candidate 也保留，因为历史数据库无法证明它是否曾被人工重置。

启动后仅将最近已有原始快照中的字段回填到当前 storeData，补充缺失的规则分析；没有新网络调用，不更改原快照、首次发现或成功观测时间，也不补造搜索或权限历史。离线维护命令为 `DATABASE_PATH=data/appeye.sqlite npx tsx scripts/backfill-v02.ts`；先停止唯一服务并备份。脚本比较升级前后 apps/snapshots/changes/reviews/jobs 数量并运行 quick_check。可加 --force-analysis 更新分析，仍不覆盖人工/legacy 分类。

完整库返回对象保存为规范数据的 storeData，并同时保留原始快照。App Store 原生 fetch 包装器会复制已经返回的 iTunes JSON，保留在 _appeyeTransport，无需额外 HTTP；从与 trackId 匹配的原响应获得 sellerName 等类型投影可能省略的字段。开发者显示名、GP 法律实体字段、Apple seller 以及描述中抽取的主体保持不同来源和角色。未知字段不丢弃，前端用 JSON 文本查看，不执行原始 HTML。

每一次搜索命中的行，包括已存在应用和重复关键词命中，都写入 discovery_observations，包含关键词、采集国家/语言、时间、来源和完整 data/raw。早期版本未留存的搜索响应不会伪造补齐。

详情成功后独立入队 reviews 和 enrich。enrich 包括 GP permissions/dataSafety/developer、Apple privacy/versionHistory/inAppPurchases/ratings/developer，其他组合为 unsupported。developer 只是商店公开开发者目录；GP 从详情取得的 URL 编码开发者 ID 在请求目录时解码，原字段仍完整保留。权限必须表述为商店声明/返回的权限，不能解释为用户实际授权、Manifest、动态行为或操作系统权限扫描。

每种补充资料保存当前成功数据和每次尝试历史。成功空结果与 failed/unsupported 不同；后两者保留先前成功数据、原成功时间及原上下文，并单独记录新错误、尝试时间与尝试上下文。部分失败不会将主详情标为失败，也不会阻止其余补充类型保存。没有采集记录时前端显示未采集，不使用空列表冒充成功。

规则引擎是带原文证据的启发式提取，不是法律裁定。new/auto 应用可因 strong 结果变为 confirmed，其余 candidate；manual/legacy 永不被规则覆盖。切换自动模式必须显式调用 classificationMode:auto。loanVerdict 筛选可查看旧应用的自动分析而不改动其历史判断。分析时间与原文观测时间独立保存，证据评分不宣称统计概率。

## 小时周期与全量批次协调（#18）

`server/index.ts` 在打开 SQLite 前获取与 CLI 共用的进程所有权锁，之后只有一个 `collection-coordinator` 调用三个执行通道：小时任务最多3项、全量任务1项、手动任务1项；没有可执行任务的通道让出槽位。全量 runner 只恢复已经 seed 的批次，不重新 seed；历史2,024个市场成员、响应、评论游标和限定恢复预算保持。新的小时成员归 `monitor_*` 表，不进入原批次分母。

唯一 `createFullScanProviders` 实例供三个通道共用。默认全局HTTP起始间隔500ms，iTunes search/lookup独立至少3100ms，429遵循Retry-After，所有原始HTTP按当前通道归档。Apple小时详情复用同周期/国家/冻结语言的50ID lookup；每条应用仍有独立任务、原始记录和实际返回时间，周期完成后释放该周期缓存。未启动第二个 legacy scheduler；保留手动任务原来的评论与补充语义。

006 migration 新增 monitor_state/cycles/tasks/attempts/responses/http/sources、manual_responses 与查询索引，并将现有国家 interval_hours 设为1。小时周期每60分钟持久安排，每个周期按国家/商店/来源或应用去重；存在活跃周期时不追加下一批，逾期可见，完成后只合并安排最新到期窗口。停用国家的 queued 自动任务记 skipped，运行中的一次请求允许完成。启用国家主库全部分类（含 excluded）刷新详情，不派生历史评论/七类补充。

发现使用公开有限窗口：GP三个财务榜、Apple六个财务榜、每个本地关键词的首搜索窗口（GP最多250，Apple最多50）；原始source/response/HTTP和窗口说明全部保留。新对象经过完整详情规则分析后 strong/possible 入主库，insufficient 只留小时账本；人工分类不变。任务默认3次尝试与指数退避，下一周期可再尝试失败项目。持久响应先写再应用；`saveObservation` 的事务内onSaved hook将快照与applied_response_id一起提交，避免中断重放重复变化及嵌套事务。

正常服务会自动恢复最近仍有 queued/running 工作的已冻结批次；FULL_SCAN_BATCH_ID 可显式选择。CLI的 --retry-kind/--retry-task-ids/--retry-only 允许单writer维护时精确恢复失败页，保留原attempt记录且用 recoveryAttemptBase 提供新的有限预算。查询 --status 在取锁/打开写连接之前执行，继续保持严格只读。

进程管理属于部署平台职责。进程退出或主机休眠时不会有后台执行保证；应用报告真实最后观测、队列与逾期，而不是宣称每个应用都已按时更新。

跨通道观察以源 observed_at 排序，同一毫秒以持久snapshot ID作为稳定次序。较早预取/缓存响应仍写独立原快照和收据，但不覆盖更晚当前资料或规则分析，也不产生与未来快照比较的变化。后续新响应仍以最新成功快照为差异基准。小时和批次详情均使用持久响应ID完成原子快照收据，不能将同一毫秒的两个不同响应合并。

采集进程锁在数据库真实路径旁的小型 `.full-scan.lock.sqlite` 使用持有整个进程生命周期的 `BEGIN EXCLUSIVE` OS锁，崩溃由操作系统释放；它不锁应用数据库。`.full-scan.lock` 的PID/nonce文件继续用于兼容旧CLI和运维查看，只有取得原子所有权后才能检查并清理死PID文件。

`full-scan-audit.ts` 的详情/七补充/评论覆盖不再遍历当前全主库：以批次detail成员、本批其他任务和admission引用，并联合独立baseline应用ID形成预期范围。`--baseline` 同时支持旧 `apps` 与冻结 `members` 格式；后者额外报告超出冻结成员的ID。无baseline时明确不能验证连全部批次引用都丢失的初始成员。全库总量改为 `allDatabaseMainApps/allDatabaseReviewsRetained/allDatabaseSnapshotsRetained`，避免把后续小时合法新增误当旧批次漏采。

旧手动评论/补充任务只有在请求早于批次，且同市场身份、语言、逐项更晚成功持久响应已完整覆盖时才合并。原created_at、attempts和所有批次历史保持，job.result记录coalesced、真实sourceObservedAt、task/response引用。缺失、失败、degraded、未完成或较晚手动请求不合并。评论引用首窗口依据，并要求整条批次流已成功终结；补充要求全部七类。

后续手动app/reviews/enrich的完整规范响应及raw先写manual_responses，附job/attempt/app/国家/实际请求语言/原observed_at，HTTP仍固定原job_id。Store现有事务内hook将资料与applied_at收据原子提交；崩溃重放保原时间，已应用响应不重复写。迟到评论仍保原响应和seen，但不覆盖更新的current，实际写入数扣除skippedOlder。小时新入库对象的firstSeen跨所有已存monitor/fullscan暂存来源取最早真实发现日，不回写现有主库首次发现。

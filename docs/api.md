# Appeye API（V0.2，兼容 MVP 1.0）

JSON 字段使用 camelCase；时间为 ISO UTC。除 health、session 和 login 外，接口必须携带登录 cookie。失败格式 `{ "error": "可读原因", "details": [] }`；details 仅输入校验时存在。状态码：400 参数错误、401 未登录/错误密码、403 来源拒绝、404 不存在、409 状态冲突或演示采集限制、429 登录限速、503 未设置管理员密码。

## 登录

| 方法和路径 | 输入 | 返回 |
| --- | --- | --- |
| GET `/api/health` | 无 | `{ok,dataset}` |
| GET `/api/auth/session` | 无 | `{authenticated,configured,dataset}` |
| POST `/api/auth/login` | `{password}` | `{authenticated:true,dataset}`，设置 HttpOnly cookie |
| POST `/api/auth/logout` | 无 | `{authenticated:false}`，撤销 cookie |

`dataset` 为 `live` 或 `demo`。浏览器写请求必须来自同源或配置的精确允许源，跨站来源被拒绝。

## 仪表盘、国家和应用

| 方法和路径 | 输入/查询 | 返回 |
| --- | --- | --- |
| GET `/api/overview` | 无 | `{stats,countries,recentDiscoveries,recentChanges,recentJobs,dataset,limitations}` |
| GET `/api/countries` | 无 | `{countries}` |
| POST `/api/countries` | `{code,name,language,keywords,enabled?,intervalHours?}` | 201 `{country}` |
| PATCH `/api/countries/:code` | 上述可选字段，不能修改 code | `{country}` |
| GET `/api/market-activity` | `date,timeZone,country,store,classification,type,limit,offset` | `MarketActivityResponse`（见下文） |
| GET `/api/collection/status` | 无 | `CollectionStatus`，实际小时队列、最新成功观测及批次状态 |
| GET `/api/collection/tasks` | `limit,offset` | 小时任务分页、有限重试和结果；不包含大 HTTP 正文 |
| GET `/api/collection/tasks/:id` | 正整数 ID | 任务、尝试、原响应及 HTTP 引用 |
| GET `/api/apps` | `country,store,classification,q,limit,offset` | `{apps,total}` |
| POST `/api/apps` | `{store,externalId,country}` | 201 `{app,job}` |
| GET `/api/apps/:id` | 无 | `{app,snapshots,changes,reviews,limitations}` |
| PATCH `/api/apps/:id` | `{classification}` | `{app}` |
| GET `/api/apps/:id/snapshots` | `limit,offset` | `{snapshots,total}` |
| GET `/api/apps/:id/changes` | `limit,offset` | `{changes,total}` |
| GET `/api/apps/:id/reviews` | `limit,offset,score,language,since` | `{reviews,total}` |
| GET `/api/changes` | 应用列表筛选项，加 `field,since` | `{changes,total}` |

分页默认 limit=100、offset=0，limit 为 1–1000。详情内嵌最近 50 个快照、100 条变化、50 条评论，需要更早记录时使用分页端点。`since` 是完整 ISO UTC 时间。

国家 code 是小写两字母，language 是 2–3 字母语言代码或 locale，keywords 为 1–20 个非空关键词，intervalHours 固定为 1（每60分钟）。`store` 为 `google-play`/`app-store`；人工 `classification` 为 `candidate`/`confirmed`/`excluded`。Google Play externalId 使用包名，App Store 使用数字商店 ID。重复手工添加不会产生第二个跟踪对象。

`stats`：apps、newApps7d、confirmed、candidates、changes7d、reviews、jobsFailed。国家行包含配置和上述按国家统计的 apps、confirmed、candidates、changes7d。

## 任务与导出

| 方法和路径 | 输入/查询 | 返回 |
| --- | --- | --- |
| GET `/api/jobs` | `status,type,country,limit,offset` | `{jobs,total}` |
| POST `/api/jobs` | 发现：`{type:"discover",country?,store?}`；应用采集：`{type:"refresh"或"reviews",appId}` | 202 `{jobs,job}` |
| POST `/api/jobs/:id/retry` | 无，只接受最终失败任务 | `{job}` |
| GET `/api/export/apps.csv` | 与应用列表相同筛选项 | 所有匹配应用的 UTF-8 BOM CSV，忽略分页 |

发现未指定国家时使用全部启用国家，未指定商店时使用两个商店。应用任务从 appId 解析国家和商店，提供矛盾参数会被拒绝。相同活跃任务合并。手动重试将 attempts 重置为 0，保留同一个任务 ID。CSV 对可能触发公式的单元格加引号前缀，附带 dataset 和 installsScope。

## 实体

权威 TypeScript 类型见 `server/types.ts`。应用包含规范信息（title、developer、icon、url、summary、description、version、score、ratings、reviewCount、installs/minInstalls/maxInstalls、releaseNotes、releasedAt、storeUpdatedAt、bundleId、price、currency、genre、developerWebsite、privacyPolicy），以及 id、store、externalId、country、classification、sourceKeyword、firstSeenAt、lastSeenAt、lastFetchedAt、lastError、updateCount、observedUpdateIntervalDays。不可获得的信息为 null。

- Snapshot：`{id,appId,observedAt,data,raw}`。
- Change：`{id,snapshotId,appId,field,oldValue,newValue,observedAt,title,store,country}`。
- Review：`{id,appId,externalId,country,language,userName,title,text,score,version,reviewedAt,replyText,fetchedAt,raw}`。
- Job：`{id,type,status,country,store,appId,attempts,maxAttempts,progress,result,error,createdAt,startedAt,finishedAt,nextRunAt}`。

正式 API 不估算日下载量或国家下载量。所有演示响应都有会话/overview 数据集标记，演示模式拒绝会产生真实采集的写接口。

## V0.2：完整商店资料、补充采集与自动识别

依赖切换为 `@mradex77/google-play-scraper@1.1.0` 和 `@perttu/app-store-scraper@2.1.0`。原接口继续可用，以下字段与路由为新增。

应用增加 `developerId`、`developerUrl`、`developerEmail`、`developerAddress`、`developerLegalName/Email/Address/PhoneNumber`、`sellerName`、`sellerUrl`、`screenshots`、`storeData`。`storeData` 保存整个库返回对象，未单独映射的新字段仍可读取。App Store 详情额外保留已获取的原始 iTunes JSON 于 `storeData._appeyeTransport`；`sellerName` 按 trackId 从该原始响应提取，不用开发者显示名推断。`rawDetail` 为最近一次真实成功快照的原始对象，旧观察不会伪装为新采集。

`GET /api/apps/:id` 额外返回 `rawDetail`、`enrichments` 和最近 20 条 `discoveries`。

| 方法和路径 | 输入/查询 | 返回 |
| --- | --- | --- |
| GET `/api/apps/:id/discoveries` | `limit,offset` | `{discoveries,total}`，每次搜索返回的原始行与请求上下文，包括重复发现 |
| GET `/api/apps/:id/enrichments` | 无 | `{enrichments}`，仅已尝试过的补充类型；空列表表示尚未采集 |
| GET `/api/apps/:id/enrichments/:kind/history` | `limit,offset` | `{history,total}`，包括成功、空、失败、不支持的每次尝试 |
| POST `/api/jobs` | `{type:"enrich",appId}` | 202 `{jobs,job}`，独立重采所有补充类型 |
| PATCH `/api/apps/:id` | `{classification:"candidate"或"confirmed"或"excluded"}` | 设为人工分类且 `manualOverride=true` |
| PATCH `/api/apps/:id` | `{classificationMode:"auto"}` | 明确解除人工/历史覆盖并应用最新规则分析；兼容旧 `mode:"auto"` 写法 |
| GET `/api/apps` | 原查询加 `loanVerdict=strong/possible/insufficient` | 按自动分析结论筛选，独立于人工有效分类 |

`kind` 为 `permissions`、`dataSafety`、`privacy`、`versionHistory`、`inAppPurchases`、`ratings`、`developer`。GP 支持 permissions/dataSafety/developer；Apple 支持 privacy/versionHistory/inAppPurchases/ratings/developer。其余明确为 unsupported，不制造 Android 或 iOS 权限数据。developer 是商店开发者目录返回资料，不是工商登记核验。

`Enrichment` 包含 `appId,kind,status,lastAttemptAt,lastSuccessAt,fetchedAt,source,requestCountry,requestLanguage,attemptSource,attemptRequestCountry,attemptRequestLanguage,data,raw,error,note`。其中：

- `status` 表示最近一次尝试：available（有返回）、empty（成功空返回）、failed（调用失败）、unsupported（当前适配器不支持）。
- `data/raw/source/requestCountry/requestLanguage/fetchedAt` 保留最近成功数据及其上下文；`fetchedAt=lastSuccessAt`。失败或不支持不会把旧数据清空，也不会更新成功时间。
- `lastAttemptAt/attemptSource/attemptRequestCountry/attemptRequestLanguage/error` 表示最新尝试，不能将旧成功数据当作本次新鲜结果。
- 没有成功记录时 data/raw/fetchedAt 为 null；没有任何尝试时该类型不在 enrichments 中。
- GP dataSafety 当前上游不传国家，`requestCountry=null`；Apple privacy/历史/评论等并不验证实际语言，相关补充 `requestLanguage=null`。

详情刷新成功自动排入独立 enrich 任务。补充任务逐类隔离异常，某类失败时其余类继续保存；最终补充任务显示部分失败并按队列规则有限重试。详情主任务及最后成功详情不被补充异常覆盖。

应用还返回 `classificationSource:'auto'|'manual'|'legacy'`、`manualOverride:boolean`、`effectiveClassification` 和 `loanAnalysis`。classification/effectiveClassification 都是当前生效值。所有 V0.1 旧记录迁移为 legacy+override，原分类完全保留；新记录默认 auto，只有 strong 应用 confirmed，其余 candidate。人工决定始终优先。

`loanAnalysis` 保存规则版本、真实分析时间 analyzedAt、原文观测时间 sourceObservedAt、证据评分 confidence（0–100，不是概率）、verdict、原文证据、披露、不同角色主体和来源。API 不把文字披露、名称或编号等同于持牌验证、法律合规或设备权限。规则详情见 `server/loan-identification.ts` 与版本化 `server/policy-catalog.json`。

## 每小时监测与市场动态（#18）

权威结构定义于 `server/market-activity.ts`。`type` 为 `all|firstSeen|storeRelease|observedUpdate`；默认分页50，最多200。固定 `timeZone=Asia/Shanghai`，不支持其他值；日期为有效 `YYYY-MM-DD`，缺省北京时间今天。响应包含 `dateMode:'business-timezone'`、实际 `date/timeZone/windowStart/windowEnd`，后端以含开始、不含结束的边界过滤。

`counts` 是不受所选 type 页签影响的各类型唯一应用数，`eventCounts` 是各类型事件数。两者同时受日期/国家/商店/当前分类过滤；`total` 和 `uniqueApps` 分别是所选类型的事件总数与唯一市场应用数。相同包在不同国家独立计数。变化事件按一次快照分组，`changes` 提供原值/新值、原 change ID，`snapshotId` 可追溯快照。

`firstSeen` 依据首次发现时间；`storeRelease` 只使用仍保留原值的商店 released/releaseDate。日历日期精度返回 `releasedAtPrecision:'date'` 和 `releasedAt:'YYYY-MM-DD'`，`eventAt:null`，不制造发布时间；有明确时区的发布时间按业务日界过滤。`releasedAtRaw` 保留原值，`observedAt` 是取得这条资料的观察时间。首次快照不产生更新；空值变化可审计，但 `versionChanged` 只标记不同的有效版本转变。

国家配置的 `intervalHours` 在006迁移时统一为1，API之后只接受1；语言、关键词、启停和人工分类保留。`CollectionStatus.lastSuccessAt` 是主库真实最后成功详情时间；排队和周期触发不更新它。`nextDueAt/overdue/overdueApps/activeCycle` 体现延迟。状态路由本身不调度、不迁移、不联网；没有同进程协调器时标识 external/disabled，演示标识 demo。

手动通道接管时，批次开始前排队的评论/补充任务，仅在同身份、请求上下文和更晚的完整持久响应能证明覆盖时合并。`job.result.coalesced=true`，附 `batchId`、`coverage`、原 `sourceObservedAt` 和逐项 `proofs[{taskId,responseId,kind,sourceObservedAt}]`；这不表示刚刚请求商店。新手动成功响应保存在 `manual_responses`，评论任务结果含 `responseId/sourceObservedAt/upserted/skippedOlder/replayed`。旧缓存不能覆盖更新的评论，`upserted` 为实际写入数，重放收据不重复应用。

新小时对象首次进入主库时，firstSeen追溯同国家/商店/外部ID全历史暂存来源的最早真实观测，包含早先insufficient阶段与旧批次发现；不能用首次strong或分析时间替代。已有主库firstSeen保持。首次发现事件的 `observedAt` 来自最早成功详情快照，尚无快照则null，与发现时间分开。

## 六小时扩展发现与包名诊断（#22）

以下 GET 沿用管理员会话鉴权，只读取已有账本，不隐式调度或请求商店。后台入口为 `#discovery`。

| 方法和路径 | 查询 | 返回内容 |
| --- | --- | --- |
| GET `/api/discovery/status` | 无 | `enabled`、`intervalHours:6`、下一周期及心跳、当前/最近周期的状态计数、各市场实际来源/详情请求数、候选总计、配置限制和覆盖说明。 |
| GET `/api/discovery/candidates` | `country,store,status,limit,offset` | `{candidates,total}`；状态可为 `pending,staged,admitted,failed`，含主库关联、首次/最近观测、来源数及分析判定。 |
| GET `/api/discovery/identity` | 必填 `country,store,externalId`，可选 `limit,offset` | 同一市场身份的主库/候选状态、分类、任务和分页来源；合并扩展、小时及旧批次来源，来源键带通道前缀。 |
| GET `/api/discovery/tasks/:id` | `limit,offset` | `{task,responses,responsesTotal,http,httpTotal}`；响应和完整HTTP各按同一分页参数读取，包含原文及真实错误。 |

已知包名仍通过 `POST /api/apps` 的 `{country,store,externalId}` 加入跟踪并排详情任务，同时保存 `known-id` 来源。重复身份复用主库记录；响应或候选的 `admitted` 只表示主库成员存在，真实成功须核对 `lastFetchedAt`、成功响应和识别结果。未知包名诊断的 `not-discovered` 不代表商店不存在。

来源限量、预算延期、失败及接口不支持，分别通过任务状态和停止原因记录，与自然结束分开。GP无公开恢复游标时从头去重；Apple搜索为200条请求窗口，实际返回数量可以更少。预算包括SDK内部续页/重试，部分来源失败仍保存已取得的行、完整响应及HTTP。历史目录使用原观测时间，新资料不改写既有人工分类或原2024批次成员。详细口径见[需求](requirements/EXTENDED-DISCOVERY.md)，本轮实际GP关联续页兼容问题另由[#24](https://github.com/zequnjiang/appeye/issues/24)追踪。

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
| GET `/api/apps` | `country,store,classification,q,limit,offset` | `{apps,total}` |
| POST `/api/apps` | `{store,externalId,country}` | 201 `{app,job}` |
| GET `/api/apps/:id` | 无 | `{app,snapshots,changes,reviews,limitations}` |
| PATCH `/api/apps/:id` | `{classification}` | `{app}` |
| GET `/api/apps/:id/snapshots` | `limit,offset` | `{snapshots,total}` |
| GET `/api/apps/:id/changes` | `limit,offset` | `{changes,total}` |
| GET `/api/apps/:id/reviews` | `limit,offset,score,language,since` | `{reviews,total}` |
| GET `/api/changes` | 应用列表筛选项，加 `field,since` | `{changes,total}` |

分页默认 limit=100、offset=0，limit 为 1–1000。详情内嵌最近 50 个快照、100 条变化、50 条评论，需要更早记录时使用分页端点。`since` 是完整 ISO UTC 时间。

国家 code 是小写两字母，language 是 2–3 字母语言代码或 locale，keywords 为 1–20 个非空关键词，intervalHours 为 1–720。`store` 为 `google-play`/`app-store`；人工 `classification` 为 `candidate`/`confirmed`/`excluded`。Google Play externalId 使用包名，App Store 使用数字商店 ID。重复手工添加不会产生第二个跟踪对象。

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

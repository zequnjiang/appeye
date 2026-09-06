# Appeye API（MVP 1.0）

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

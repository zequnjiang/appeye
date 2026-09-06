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

任务类型为 `discover`、`refresh`、`reviews`，状态为 `queued → running → succeeded`，失败自动返回 `queued`，达到上限后为 `failed`。领取任务和状态迁移使用事务，活跃任务通过部分唯一索引去重。单个应用的详情与评论独立执行；单关键词失败也继续其他关键词，并将部分失败和实际错误记录在发现任务中。

每个启用国家、每个商店按 `intervalHours`（默认 24 小时）创建发现任务，同时为未排除应用创建刷新任务。发现默认每个关键词取 20 个结果，写为候选，创建详情任务；详情成功后创建评论任务。人工分类永不被搜索覆盖。暂停国家停止后续周期入队，已入队任务继续，手动发现仍允许。`AUTO_SCHEDULE=false` 关闭自动排程，手动任务仍会执行。

worker 默认轮询 2 秒、请求起始时间最少相隔 1.5 秒、一次请求 30 秒超时，最多 3 次尝试，重试退避为 30 秒、60 秒。API 可重新排队最终失败任务。进程重启将遗留 running 任务恢复为 queued；若已达上限则标失败，防止无限尝试。Google Play 使用 AbortSignal 和底层请求超时；App Store 底层请求使用超时，无法保证取消已发送到商店的请求。关闭服务时等待当前任务最多 35 秒，否则由下次启动恢复。

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

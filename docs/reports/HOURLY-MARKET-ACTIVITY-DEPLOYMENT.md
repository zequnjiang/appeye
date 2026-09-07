# 每小时监测：实际部署记录

关联 [需求 #18](https://github.com/zequnjiang/appeye/issues/18)、[PR #19](https://github.com/zequnjiang/appeye/pull/19)。CEO负责正式进程、备份、迁移和部署；独立验证见 [Alex报告](HOURLY-MARKET-ACTIVITY-ALEX.md)，最终状态以 [PM验收](HOURLY-MARKET-ACTIVITY-PM-ACCEPTANCE.md) 为准。时间均为 UTC，页面业务日界为 Asia/Shanghai。

## 原数据保护与迁移

2026-09-07 08:45:49 停止旧运行8（PID71049，代码52cd7a8），确认正常退出0。没有重建或重新seed `finance-2026-09-07`。使用SQLite一致性备份API保存 `data/backups/appeye-before-hourly-2026-09-07.sqlite`：30,025,015,296字节，7,330,326页，08:45:58–08:46:45完成。真实数据库、原始商店响应、凭据和备份均保留在忽略目录，不进入Git。

停止写入期间保存全部其他52,745项任务的逐行JSON SHA-256、原2,024成员身份/人工分类/首次发现、国家参数、冻结批次配置及历史记录计数。运行006迁移，并且只为原7项网络失败评论任务重新排队：49999–50005（印尼Google Play第71页），保留原3次尝试和游标，添加明确恢复记录；没有重试12项已确认Apple来源失败。

08:53:25–08:54:39逻辑核对通过：52,745项其他任务完整字段不变，2,024成员不变，历史尝试/HTTP/响应/评论/快照/补充记录计数与高水位不变，国家仅周期改为1小时，原批次配置不变，精确7项重试字段符合预期。审计器初次遇到Node SQLite行的null原型与JSON普通对象不一致，修正为浅拷贝统一表示后完整重跑通过；没有忽略字段或改变值。Alex独立验证逐字段篡改仍会被拒绝。

同时对迁移前后30GB数据库进行物理页摘要比较：16个未授权变更的原表、20个原索引的页与内容SHA完全一致。允许变更的4表（countries、schema_migrations、full_scan_tasks、full_scan_runs）由上述完整逻辑检查覆盖。新增8表、12索引符合006定义。两次物理读取分别约192/188秒，08:54:52最终比较错误0。

本地原始证据（前缀均为 `data/batches/finance-2026-09-07-`）：`hourly-handover-start.json`、`hourly-backup.json`、`hourly-deployment-capture.json`、`hourly-deployment-verify.json`、`hourly-deployment-verify-initial-error.json`、`hourly-physical-pre-before.json`、`hourly-physical-post-before.json`、`hourly-physical-comparison.json`。初次表示错误和原证据均保留。

## 首次启动发现的实际性能问题（#20）

独立缺陷跟踪：[历史响应查询阻塞启动 #20](https://github.com/zequnjiang/appeye/issues/20)，关联HMA-AC-05/14；修复与真实回归纳入本需求PM验收后关闭。

运行9以ad01410业务代码、1fa0c9c报告版本构建，由 `com.appeye.collector` launchd启动，PID82967，08:55:57取得独占锁。启动核对88项历史手动任务时尚未监听HTTP；09:01:54只读检查仍88项queued、0个小时周期。实际SQL计划为 `SCAN r`，历史响应表无索引；CTO独立进程采样确认主要时间在SQLite反向读取，而非网络请求。

CEO于09:01:54用launchctl bootout停止该进程。合并事务未提交，未产生新商店请求。保留运行9及诊断证据，不将这次启动记为上线成功。修复范围限定为在全量采集表的幂等初始化中增加响应查询索引，保持原证明SQL、原始数据和事务语义；不改写已经执行的006迁移。

证据：`runtime-9.json`、`hourly-startup-diagnosis.json`、`coalesce-startup-plan.json`。以下为补修及重新启动的实际结果。

## 索引补修与正式上线

CTO自检及Alex独立检查均为172/172通过，类型/前后端构建/迁移复制通过。补修冻结提交 `a33cfb8ef421ee4fc770cc4b44f4bb4b05b6d147`，业务代码只有 `full-scan.ts` 一条 `CREATE INDEX IF NOT EXISTS full_scan_response_task_time ON full_scan_responses(task_id,observed_at,id)`；另增加3项索引结果等值、重开幂等和合并异常完整回滚测试。不把合成性能数字当成实际库性能。

09:06:14–09:06:17，CEO取得独占维护锁，仅执行幂等表结构初始化，没有构造runner或请求商店。正式索引构建 **2,317.37毫秒**。09:06:17–09:06:23只读核对通过：所有旧表/索引定义不变，只增加该索引；原国家、2,024成员、完整旧jobs、任务状态/尝试总和、冻结run及12类历史高水位保持，查询计划由SCAN变为按task_id/observed_at索引SEARCH。

运行10（PID84793）于09:06:46.517取得唯一采集锁，正常监听 `http://127.0.0.1:3000`。由本机launchd `com.appeye.collector` 保持进程，实际配置位于用户LaunchAgents目录，RunAtLoad/KeepAlive已启用；工作目录和Node/编译入口使用绝对路径，密码/会话密钥仅从忽略的.env读取。执行代码/编译产物/环境文件/服务配置摘要保存于 `runtime-10.json`，没有记录凭据值。首个持久周期09:06:49.532开始，下一次应调度10:06:49.532；六国均加入首周期，最初2,114项为2,024原主库详情+54榜单+36关键词窗口，后续发现候选可增加详情任务。

正式API smoke（09:06:50–09:07:04）通过：未认证401，正确认证后3个事件视图200，非法日期/时区/offset为400；业务日界明确为2026-09-06 16:00Z至2026-09-07 16:00Z。抽查40条有结果的事件，应用身份与实际snapshot/observedAt一致。当时2,024首次发现、商店披露当日发布0、229变化应用/258事件；这些为该时间快照，后续真实采集可以增加。查询耗时约1.91–5.23秒，期间采集并行推进，没有把空“商店发布”视图误称全市场没有新上架。

09:07:04逐项核对88旧queued任务：44评论、44补充，352条成功响应证明与原task/attempt/应用/国家/商店及时间对应；旧请求时间、身份、尝试数保留，另外1,217旧成功任务全行不变，manual响应与manual HTTP均为0。合并是有来源的已有工作覆盖，不冒称发出了88项新请求。

证据：`hourly-index-capture.json`、`hourly-index-application.json`、`hourly-index-verify.json`、`runtime-10.json`、`hourly-live-api-smoke.json`、`hourly-coalescing-live-audit.json`。[GitHub部署进展](https://github.com/zequnjiang/appeye/issues/18#issuecomment-5568219147)。

## 真实恢复与持续运行

09:08:47重启验证前，只读确认7项印尼第71页全部succeeded/attempt4；周期1已有42条成功持久响应、2,381个任务，小时发现/详情与原批次评论均有新成功HTTP。为验证常驻恢复，CEO于09:08:52.445向已核实的PID84793发送SIGTERM，保持launchd KeepAlive；保存原周期、下一调度时间、全部小时任务身份、成功响应摘要与HTTP、冻结批次成员及正在执行任务。

旧进程正常退出0；launchd自动启动运行11，PID84987于09:09:01.191取得新nonce独占锁，无人工重新入队。09:09:49只读恢复核对通过：仍为原周期1及原next_due_at，全部2,381任务身份/请求字段保持、已成功任务完整行不变、旧42响应逐条SHA和原HTTP元数据不变；没有重复周期或任务键，2,024冻结成员不变。新成功小时响应增至60，原批次HTTP高水位亦增加，证明两类工作都在恢复后继续推进。该核对不是只检查进程存在，也不宣称首个小时周期全部完成。

证据：`hourly-restart-before.json`、`hourly-restart-signal.json`、`hourly-restart-after.json`、`runtime-11.json`。精确补修提交 [CI 34104105818](https://github.com/zequnjiang/appeye/actions/runs/34104105818) completed/success。

Alex于09:14:53完成7页1,050条评论的独立只读入库细核，规范字段、raw、当前fetchedAt、seen全部对应；原21次失败尝试和21条HTTP元数据完整保留，原游标及70→71→72连续。09:16:56再以独立Python RPC解析核对7个真实HTTP200中的1,050个评论身份、顺序和nextCursor，与SDK raw及规范返回精确一致，错误0。其他SDK字段映射由确定性夹具覆盖，不能把本次身份/游标来源检查扩大为所有字段的独立RPC映射。证据为 `hourly-alex-seven-review-recovery.json`、`hourly-alex-seven-rpc-source.json`。

细审最初两次遇到历史摘要编码不同：旧cursor摘要来自JSON字符串，旧previousResponse摘要来自递归排序key的canonical JSON。Alex先以维护前备份证明原response逐字相同，再严格复现各自旧摘要编码并完整复跑；两个初始错误报告单独保留，没有改业务数据或忽略字段。

正式浏览器入口已恢复至 `http://127.0.0.1:3000/#market-activity`，显示既有认证登录页；已认证的实际数据验证由API smoke完成。桌面/窄屏交互证据来自独立合成库，不冒称浏览器已登录正式库。合成预览服务已停止。原批次的最新持续采集状态另记于 [#11进展](https://github.com/zequnjiang/appeye/issues/11#issuecomment-5568345533)，不混入本功能完成口径。

## 验收边界

本需求验收不关闭原 [全量采集 #11](https://github.com/zequnjiang/appeye/issues/11)。其六国发现/详情和Apple评论阶段已有独立报告，Google Play历史评论仍需继续到真实来源终点，再按冻结2,024成员进行最终审计。每小时调度不代表所有应用在一小时内全部刷新完成，页面必须显示实际成功、排队、逾期和失败。

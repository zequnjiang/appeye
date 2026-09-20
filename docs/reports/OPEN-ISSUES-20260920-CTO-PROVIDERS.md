# 开放 Issue：采集适配器 CTO 自检与运营诊断

- 日期：2026-09-20（北京时间）；分支 `codex/open-issues-20260920`。
- 需求：[本轮 PM 需求](../requirements/OPEN-ISSUES-20260920.md)；对应 [#24](https://github.com/zequnjiang/appeye/issues/24) OI24-01/02/03 与 [#11](https://github.com/zequnjiang/appeye/issues/11) OI11-01/02/03。
- 本报告是 CTO 自检与只读诊断，不能替代 Alex 独立验证、PM 验收、正式部署或运营终验。

## #24：真实根因与修改

原任务129/233/337/438/524的15条保存HTTP在正式数据库以只读方式取得。现安装`@mradex77/google-play-scraper@1.1.0`直接离线重放时，各自取得首50条，随后均报`similar continuation token response: 0.0.7: Invalid input: expected tuple, received null`。实际续页应用数组可正常识别，错误在明确为null的下一页token容器，不是应用数组路径变化。早期仅看数组路径曾推测与developer兼容相同；此推测被实际SDK异常否定，最终实现未采用路径搬移。

新增`related-continuation.ts`只对唯一`qnKhOb`响应、无源错误、已验证完整身份/标题/图标/开发者/官方详情ID链接的行数组及明确null token容器，将解析输入的`[0][0][7]`转为`[null,null]`。这保留“没有token”语义，不制造游标。缺失容器、已有tuple、未知/坏行、不匹配ID、不同RPC、歧义多帧及真实源错误均不按本兼容路径转换；歧义和源错误另带可见warning。全程先持久化原HTTP，转换仅供SDK解析；兼容元数据记录原HTTP ID、时间、转换路径和原值/新值。

`related`新增可选`onItem`，扩展runner接入与已有搜索相同的持久来源路径。因为官方similar没有iterator，在发下一次真实HTTP之前，使用当前方法已经记录的响应在纯内存中重放同一SDK解析器；遇尚未取得页仅以ParseError结束已知前缀。回放不发网络、不消耗来源预算、不另建HTTP观测、不虚构行。先持久化已经成功解析的首批，再发续页；同身份只回调一次，原SDK序列及所有原HTTP不删除。这样预算拒绝和20秒步骤中断仍能保留首50条候选与详情队列。超时后回调用原signal检查，不能落入后续任务。首50条使用对应真实cluster HTTP的时间，续页仅为新增身份使用续页HTTP时间，旧首批不会被移到较晚观测。异步持久化回调被等待，失败重抛原错误，不能被SDK包装为成功或继续发下一请求。

Google related仍保留SDK100条结果上限和原20秒/60次来源预算。HTTP中更多行全部保留，但规范SDK结果上限不变；不得称关联全集。

## 保存响应的五目标离线结果

| 原task / 市场 | 原续页HTTP | 原首批 | 续页原HTTP行数 | 修改后SDK返回 | 停止原因 |
| --- | --- | --- | --- | --- | --- |
|129 / ID|19|50|48|98|sdk-related-ended|
|233 / MX|23|50|13|63|sdk-related-ended|
|337 / PH|43|50|26|76|sdk-related-ended|
|438 / PK|48|50|60|100|sdk-related-result-limit|
|524 / TH|53|50|2|52|sdk-related-ended|

五项均3次保存响应重放、0次真实网络、修改后warning为0；15条原HTTP逐字一致。PK全部110行仍在原HTTP，100是SDK返回预算。证据本机忽略文件`.artifacts/issues-20260920/related-saved-replay.json`，包含原HTTP ID/真实时间/字节SHA、before异常和身份集合、after结果和身份集合及仅本次离线重放时间。可重复命令：`node --import tsx .artifacts/issues-20260920/replay-related-saved.ts`。脚本以readOnly打开数据库，只按5个task主键和15个HTTP主键点查，随后关闭连接；离线transport严格校验请求URL、方法和顺序，不允许未保存请求。离线重放中的适配器当前时间不是新的市场采集，未写入正式数据库，也未把原失败改成成功。

## 自检命令与实际结果

| 命令 | 结果 |
| --- | --- |
|`npx tsx --test tests/open-issues-provider-related.test.ts`|13 passed / 0 failed。真实安装SDK解析合成页面、五种续页数量、原字节、错误源/多RPC、重复token/身份、真实来源时间与异步callback、预算/超时后实际runner持久首50条。|
|`npx tsx --test tests/open-issues-provider-related.test.ts tests/extended-providers.test.ts tests/extended-discovery.test.ts tests/developer-continuation.test.ts tests/review-source-validation.test.ts tests/transport-error.test.ts`|58 passed / 0 failed。|
|`npx tsx --test tests/collection-coordinator.test.ts tests/review-source-validation.test.ts`|21 passed / 0 failed；含旧批次精确ID恢复、retry-only、三次有限预算与原资料保持。|
|`npx tsc --noEmit -p tsconfig.server.json`|通过。|
|`npx prettier --check server/full-scan-providers.ts server/related-continuation.ts server/extended-discovery.ts tests/open-issues-provider-related.test.ts`|通过。|
|`git diff --check -- server/full-scan-providers.ts server/related-continuation.ts server/extended-discovery.ts tests/open-issues-provider-related.test.ts`|通过。|

`server/extended-discovery.ts`最初为CEO所有，获得明确移交后仅添加related回调。其余修改为适配器、新独立helper及专项测试；未更改SDK版本、全量批次逻辑、生产数据或服务。

## #11：恢复前真实状态与安全路径

只读审计截至2026-09-20T03:42:10.633Z：原批次`finance-2026-09-07`页面1成员仍为2024（901 GP、1123 Apple），无queued/running。`completed-with-errors`不是运营验收完成：165个GP评论流在87–218页的某页网络失败，全部有原cursor、累计3次尝试。按最后HTTP底层cause计：ENOTFOUND 62、连接超时92、ECONNRESET 6、socket关闭1、步骤超时4；国家ID59/MX43/PH15/AR24/TH10/PK14。GP736流有自然终点，Apple1123流有已验收终点/公开第10页上限。原12个Apple补充失败和2个部分developer目录仍独立保留。

精确165任务恢复前私有快照已交CEO：`.artifacts/issues-20260920/full-scan-recovery-before.json`，mode600，含task IDs、原payload/cursor及SHA、attempt/末HTTP、状态分组和原2024身份。现有CLI支持停唯一worker、备份后使用`--retry-failed --retry-kind reviews --retry-task-ids <精确集合> --retry-only`；它不采集或seed，延续原attempt与cursor，额外有限3次预算。然后恢复唯一coordinator，不能泛化重试已验收的12项Apple限制。

CEO独立执行恢复后，本Agent只读查看代表任务53891–53894的最新HTTP64231–64234（03:51:09–03:51:53Z）：HTTP200、205/206字节，真实`UsvDTd` payload为null，错误`PlayDataError` code5。此时各累计5次、仍在新有限预算中；这明确是源拒绝而不是本地解析误报。code5公开业务含义未核实，不能断言游标过期、来源没有评论或App下架。建议CEO通过唯一正式coordinator为App1236（ID/GP/com.bm.main.fpl）仅新建一个manual reviews第一页，以同身份当前入口与旧cursor响应对照；保留独立来源，不重置原评论流或悄然从头重扫。后续真实结果由CEO/Alex报告，不用本中间快照冒充终态。

CEO随后反馈代表App1236的独立manual任务1318真实成功：fetched150/upserted150，response37，2026-09-20T03:56:07.729Z。新入口可正常返回评论，而原旧cursor收到code5；这支持区分旧cursor来源拒绝与通用本地解析失败，但不能单凭一个代表证明165流均可恢复。该证据由CEO采集及核对，本Agent没有额外发网；最终原批次终态仍交Alex审计。

## 待独立验证与部署

#24仍须OI24-03正式部署后有界实际复验。不得假设早期queued任务101061会留到新版本运行。已提供CEO维护脚本`.artifacts/issues-20260920/enqueue-related-verification.ts`：默认只读preview；显式`--apply`需取得唯一collector OS锁，校验当前已有running周期、5个历史task身份和父App，按每市场剩余至少3次来源HTTP预算插入5个独立similar诊断任务。payload保留`originTaskId`及稳定maintenanceKey；同周期重复执行不再插入、不改已有任务；原5条完整task哈希保持；无预算则如实延期，不能新建cycle或重置预算。当前周期仍由共享transport预算及唯一coordinator执行，不另开worker。隔离夹具自检3项通过：首次5条、重复0条、活动锁拒绝，结果见`.artifacts/issues-20260920/related-maintenance-selfcheck.json`。正式库只运行过preview，生产apply由CEO统一维护。

Alex已收到离线证据与冻结接口、负责独立边界测试和正式复验；PM据实际结果判定#24，当前自检不提前宣布线上恢复。没有新增retry API，也没有更改原失败记录。

#11不能凭有限失败归零或功能PR关闭：所有可继续流需有真实终态、来源限制应逐项有证据；Alex须全量核task→attempt→HTTP→response→评论/seen及页间cursor，区分并行更晚合法写入。现有`full-scan-audit.ts`为只读但含全reviews/seen统计与去重扫描，不适合100GB生产库的频繁快速检查；最终应在受控副本复用/完善独立审计脚本，不阻塞正式writer。本Agent未发任何额外真实商店请求。

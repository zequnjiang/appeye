# #22 扩展应用发现：Alex 独立回归

- GitHub：[扩展发现 #22](https://github.com/zequnjiang/appeye/issues/22)。
- 状态：**独立工程回归、目标真实补录及正式部署/重启核查通过，已交 PM 最终验收；5项关联来源解析失败按 #24 独立保留，原 #11 未完成。**
- 需求：[EXTENDED-DISCOVERY.md](../requirements/EXTENDED-DISCOVERY.md)，版本1，ED-AC-01–08。
- 文件边界：Alex 仅写 `tests/alex-*` 和本报告，不修改后端、依赖或正式数据。

## 已有只读诊断

阿根廷 Google Play 的原批次三榜/三词任务以及首个小时周期对应任务均已成功。原批次来源 531 行、459 个身份，小时来源 532 行、461 个身份，二者合并 469 个身份。

按 12 个确定 HTTP 主键检查共 14,041,688 字节，`com.creditouno.loan` 未出现在这些原响应、SDK 原始结果、规范化结果或来源记录中；各步返回身份全等。六份搜索 HTML 在已安装 SDK 中纯内存重放，各返回 30 条、无已识别续页游标，完整 raw 与保存结果相同。该证据支持发现覆盖缺口，不能推出应用下架或不在该国，也不能证明简单提高 `num` 就会找到目标。

旧 provider 将这些 30 条搜索统一写为 `search-interface-250-limit`；250 是请求上限，并非实际命中上限。后续必须按真实结果表达来源与停止原因。

## 待实施契约明确后的独立检查

| 范围 | 必要验证 |
| --- | --- |
| 已知包名与种子 | 官方包名/市场身份独立加入，不依赖三个通用词命中；详情成功与失败都保留真实来源及时间；不能用 fixture 成功冒充实际补录。 |
| 扩展预算 | 本地关键词、关联应用、开发者入口按最终需求的深度和预算执行；重复身份/环/无进展不会无限扩张；不同入口来源仍可追溯。 |
| 完整来源 | 每次成功 raw 未知字段保留，规范化身份不丢失；request limit、returned count、分页证据、错误和停止原因准确区分。 |
| 队列恢复 | 有限重试、进程恢复、已成功响应重放幂等；单项失败不阻塞其他入口；持久预算和已访问身份不会在重启时重置。 |
| 数据边界 | country/store/externalId 唯一；人工与 legacy 分类、原 firstSeen 和旧批次 cohort 保持；扩展不能默默修改原批次验收分母。 |
| 正式运行 | 仅在 CEO 部署与目标补录后进行授权只读核查；记录实际来源/时间/身份/分类/入库证据，不把“发现范围扩展”写成“全市场覆盖”。 |

## 正式独立工程回归

收到 [后端自检交接](EXTENDED-DISCOVERY-CTO.md) 与前端/采集适配器自检后，Alex 新增 `tests/alex-extended-discovery.test.ts`，8/8 通过：

1. 每期仅一个来源/一个详情预算，跨3个持久周期依次推进 search、similar、developer；详情先处理老候选，未处理候选保留 pending。
2. 一次已启动来源请求在国家暂停后完成并保存，暂停时不为其新建详情任务；已排其他来源延期，候选下期恢复处理。
3. 旧持久详情在重启后不请求网络，保存独立旧快照而不回滚较新 current、人工 excluded 或 firstSeen；同一响应再次恢复只应用一次。
4. 来源超时后原预算和逐项回调拒绝继续操作，即使下一任务已运行也不串入；迟到 HTTP 仍绑定原 task。
5. 已知ID占位记录的终态采集失败显示 failed，不伪装正在排队；同ID不同国家不误认。
6. 连续4期都有新候选，旧失败候选仍先完成三次有限尝试，之后老 pending 获得详情机会。
7. 连续12期都添加新 confirmed 标题，既有关键词仍会重访，也能服务其他来源。
8. 仅存在于历史小时通道的暂存身份，诊断显示 staged、原 source/raw/时间与复合来源ID，GET不新建任务；跨国隔离保持。

初次暂停用例有一个过严断言：要求暂停后新产生的候选也必须拥有 `deferred` 详情任务。实际实现按需求“不为暂停国家新增自动任务”，保存 pending 候选而不创建该详情。Alex 将断言改为验证 pending、无新详情、其他已排任务延期及下期恢复；未修改业务实现，最终通过。

### 公平性缺陷闭环

适配器 CTO 只读审阅发现：若 unserved 的 `last_served=NULL` 永远排前，持续加入的新候选/标题可能让旧失败项长期得不到重试。CEO 在 #22 内修复为持久 `created_at` 与 `last_served` 合并排序。Alex 的第6、7项为修复后的独立跨期回归，证明新条目持续增加时旧项仍推进；不能只用一个无新增的静态队列证明公平。

### 整体结果与发布边界

Alex 独立 `npm test`：**221/221 通过，0失败、0跳过，42.100504秒**；`npm run typecheck` 与 `git diff --check` 均通过。包括上述8项、真实transport预算/两商店适配器专项、旧数据/队列原回归，以及前端浏览器诊断场景。日志与SHA见 `.artifacts/alex-silent-discovery-engineering.json`。全部临时数据库/fake provider或浏览器拦截，没有正式商店请求，也没有正式数据库写入。

CEO/CTO已提供隔离生产构建通过的证据；Alex依照正式静态服务仍读取 `dist` 的限制，不执行写该目录的 `npm run check/build`。发布提交与最终产物由CEO统一构建/指纹，部署后另核。

ED-AC-02–07 的确定性工程范围通过。下面追加 ED-AC-01 真实目标和 ED-AC-08 正式运行的授权只读结果；PM 最终判定另行记录，#11保持独立未完状态。

## 正式目标与来源核查

发布提交 `e356bb323309dbb4e332b3bf941b314c9de6987f`，[CI 34138027098](https://github.com/zequnjiang/appeye/actions/runs/34138027098) 由 CEO 确认通过。Alex 于 **2026-09-07 15:34:08.192–15:34:09.392 UTC** 执行 `.artifacts/alex-extended-live-audit.mjs`：退出码0、`errors=[]`。全部数据库访问只读；原 HTTP 注入已安装 SDK 做内存重放，没有新的商店请求。

| 核查对象 | 独立实际结果 |
| --- | --- |
| 唯一市场身份 | `ar/google-play/com.creditouno.loan` 仅1条主库记录，ID2053，Credito Uno，版本1.2.0，商店开发者显示名 Spechtl Digitale Apps。 |
| 真实详情与识别 | HTTP1932/1937各为该包 `gl=ar/hl=es` 的官方详情HTTP200，分别绑定job1306/1309。各自离线SDK重放只调用1次注入fetch；全部raw与manual response1/10逐字段相同。原观测为15:27:49.859与15:27:57.512，snapshot4671/4672分别保留原data/raw/time与已应用收据，最新current一致。分析为strong/auto confirmed，规则 `2026-09-07.1/heuristics-2`，sourceObservedAt对应真实详情。 |
| 时间口径 | firstSeenAt为15:27:47.880；两个known-id来源各保留接受/处理时间。商店releasedAt另存，不将这次首次收录称为今日上架，更不从商店公司名推断放贷主体或牌照。 |
| 七类补充 | permissions为available/8项，dataSafety为available，developer为available/3项；当前data/raw/原成功时间与各自最新history一致。其余privacy/versionHistory/inAppPurchases/ratings明确unsupported，无伪造成功时间。dataSafety请求国家为null，因为该接口不提供国别参数；不能错标AR专属。 |
| 评论边界 | 当前3条去重样本；本次仅核样本数量，不作该应用全部评论采集验收。 |

两次独立详情对应原HTTP完整正文均留库，本机证据记录HTTP/raw SHA而不复制正文到Git。后台 `admitted` 表示已进入主库；是否有成功详情须结合成功时间/任务状态判断。目标本次已用上述成功响应实际证明，不是仅有占位记录。

## 旧数据、运行与恢复

CEO 在停止旧writer后，以一致性备份API保存33,663,987,712字节数据库并完成007迁移；维护证据 `before/backup/migration/installed.json` 和 [部署报告](SILENT-DISCOVERY-DEPLOYMENT.md) 保留。Alex 独立复核27个旧业务表的维护前后计数/高水位证据，当前2024冻结成员的身份、firstSeen与分类逐项不变，其中474个manual/legacy；国家配置和原批次config不变。维护中的全应用行摘要、54133个旧任务关键字段及schema比较归属 CEO，Alex没有重新读取33GB数据库或对445万旧评论正文重新哈希。

40个正式源文件与发布提交、61个正式部署文件与隔离产物，Alex逐字节核对相同。15:34快照已覆盖六国双店12个市场的63次真实HTTP，40个成功或staged任务的response/applied receipt匹配，1601条来源留存。市场身份和实际HTTP参数一致；每市场60来源/60详情预算未越界。

CEO于15:30:12.729冻结重启前证据并受控SIGTERM，15:30:34.894新PID3848接替3342。Alex于 **15:39:09.904–15:39:10.505 UTC** 执行 `.artifacts/alex-extended-restart-audit.mjs`：退出码0、`errors=[]`，独立重读生产核对：

- 原1353条source的冻结字段SHA一致；仅排除允许之后建立关联的app_id/discovery_id，原身份、时间、data/raw及来源关系字段全部纳入。
- 原20条response全行SHA一致；cycle1与nextDue `21:27:01.296Z`不变，12市场身份相同，预算/轮转位置未归零，当前预算仍未越界。
- 新PID3848存活；扩展HTTP已至86，小时HTTP2168，原批次HTTP44310，三通道均在重启后继续；原2024分母保持。
- task1075的受控中断记录保留，未把被中断的详情伪装为完成或删除旧尝试。

真实证据目前只到首个扩展周期及一次重启，不声称已实际跨越多个6小时周期。跨期合并/轮转由确定性时钟测试覆盖；周期频率也不保证所有任务在6小时内完成。

## 限制、证据与 PM 交接

15:34独立快照存在**5项 GP similar 解析失败**（ID/MX/PH/PK/TH）。它们有已解析部分结果和原HTTP，任务明确failed，不计为完整来源成功；后续兼容由 [#24](https://github.com/zequnjiang/appeye/issues/24) 跟踪。审计 `errors=[]` 表示所检查不变量没有差异，不表示所有真实采集任务成功。发现扩展是有界公开样本，不承诺商店全量。原 [#11](https://github.com/zequnjiang/appeye/issues/11) 的待采与失败评论未被本次部署清理或验收。

本机忽略证据为 `data/batches/extended-2026-09-07-alex-live-audit.json`、`-alex-restart-audit.json`，后者含原before/after与live证据的SHA；脚本仅写本机审计摘要。工程221项、真实目标、旧资料保护和重启范围均已完成独立核查，Alex将 ED-AC-01–08 的上述实际覆盖及 #24 限制正式交 PM 判定；未替代 PM 关闭需求。

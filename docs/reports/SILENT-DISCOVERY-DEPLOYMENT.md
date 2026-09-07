# 静默刷新与扩展发现：正式部署证据

关联：[前端 #21](https://github.com/zequnjiang/appeye/issues/21)、[扩展发现 #22](https://github.com/zequnjiang/appeye/issues/22)、[PR #23](https://github.com/zequnjiang/appeye/pull/23)。业务提交 `e356bb323309dbb4e332b3bf941b314c9de6987f`，精确[CI 34138027098](https://github.com/zequnjiang/appeye/actions/runs/34138027098)通过。以下时间均为UTC；业务日按北京时间。

## 工程关卡

CTO前端/适配器和后端自检后，Alex独立执行221/221测试、前后端类型与diff检查，全部通过；包含真实Chrome两次15秒轮询、1280/390px返回状态、请求取消/乱序及跨周期预算轮转。部署前生产构建写入隔离`.artifacts/release`，没有提前替换运行中的静态文件。构建日志`.artifacts/release-build.log`。

## 停止、备份与迁移

停止原launchd服务后，首次维护命令因旧PID84987仍在正常退出期间被保护检查拒绝，没有写数据库；确认进程退出后才继续。15:24:59.900冻结2052个主库记录、原2024成员、54133个原批次任务及业务表计数/高水位、应用完整行摘要、任务关键字段、国家与原批次配置。

15:25:10.293–15:25:37.403使用Node SQLite一致性备份API保存`data/backups/appeye-before-extended-2026-09-07.sqlite`，33,663,987,712字节、8,218,747页。备份和真实数据库均忽略，不提交Git。

15:26:58.527完成007迁移及幂等索引初始化与核对（16.6秒）。**错误0**：原27个业务表计数/高水位、应用完整行摘要、2024成员、原任务关键字段、run/countries和原表定义保持。原评论4,458,151条、快照4,670条、补充历史14,597条未改变；新增独立discovery账本，不向原批次追加成员。

安装已验证的隔离产物，保留旧产物副本，沿既有`com.appeye.collector`配置启动PID3342。原小时、批次、手动任务及新扩展任务共享同一协调器、传输层和进程锁。

证据前缀`data/batches/extended-2026-09-07-`：`before.json`、`backup.json`、`migration.json`、`installed.json`。执行器`.artifacts/extended-deploy.mjs`包含禁止带活跃writer维护及拒绝覆盖备份保护。

## 目标应用实际采集

15:27:47.404经认证API提交AR/Google Play的`com.creditouno.loan`，主库ID2053、首个任务1306。15:27:49.859首次真实详情成功，现有规则`2026-09-07.1/heuristics-2`判为strong、自动confirmed：**Credito Uno，版本1.2.0，开发者Spechtl Digitale Apps**，完整1480字符描述与原始详情保留。重复按同一身份提交仍只有一条主库记录；第二次成功观测独立保留。

随后两个详情、两个评论和两个补充任务均succeeded。权限、dataSafety、developer有实际成功数据；其余四种补充能力明确unsupported；评论为3条样本，不能称全量。首次发现采用实际提交/观测时间，商店发布日期单独保存，未将该应用标成今日商店新上架。

`live-smoke.json`记录认证只读接口、提交、排队与真实完成的区别。Alex随后独立将两个原HTTP1932/1937用已安装GP SDK在内存离线重放，分别核对manual response1/10、snapshot4671/4672及当前raw/来源时间/strong；未额外请求商店。

## 重启和实际运行

15:30:12.729保存扩展cycle1、下一应调度时间21:27:01.296、旧来源/完整响应摘要及市场预算；向已验证PID3342发SIGTERM，由launchd自动恢复。15:30:34.894新PID3848，**仍cycle1、nextDue不变、旧来源/响应摘要一致、预算未归零、原2024成员保持，错误0**。扩展HTTP从25增至29，原批次HTTP亦继续增加；稍后小时HTTP也继续增加。未重新seed原批次或手工清理错误任务。

重启证据`restart-before.json`、`restart-after.json`及只读执行器`.artifacts/extended-restart.mjs`。来源摘要排除允许后续建立关联的app_id/discovery_id，保留身份、原观察/处理时间、raw/data与父来源等不可改写字段。

Alex于15:34:08–09独立实际核查：40个源文件对应精确业务提交，61个部署文件与隔离产物逐字一致；原2024身份/firstSeen/分类逐项不变，含474个manual/legacy对象；六国双店12市场已有真实HTTP，63请求/40成功响应、1601条来源，预算未越限。正式只读证据`alex-live-audit.json`，错误0。

Alex于15:39:09.904–15:39:10.505再次独立核对重启：原1353条来源（除允许后续绑定列）及20条完整响应摘要与重启前一致，cycle1及nextDue不变，12市场预算单调且未越界，PID3848存活。扩展HTTP86、小时HTTP高水位2168、原批次HTTP高水位44310证明三个通道继续；原2024成员保持。证据`alex-restart-audit.json`，错误0。

## 已知来源边界

本轮真实GP关联来源有5项`cluster-page-parse`/ParseError续页告警（ID/MX/PH/PK/TH）。每项已解析的50条结果、完整partial response与HTTP保留，任务明确标failed；不能把它们计为完整来源成功。它们不阻断其他来源和候选详情，后续兼容由独立议题[#24](https://github.com/zequnjiang/appeye/issues/24)追踪。一项详情deferred来自上述受控重启，保留中断记录和待续工作。

“每小时/每6小时”是持久调度频率，受请求限速、预算及队列影响，不保证整个市场在该窗口完成，也不保证公共接口覆盖全部应用。原全量运营#11保持OPEN。[静默刷新PM验收](SILENT-REFRESH-PM.md)及[扩展发现PM验收](EXTENDED-DISCOVERY-PM.md)已逐项通过全部14项AC；允许最终文档发布和PR检查通过后合并并关闭#21/#22，保留#11/#24继续追踪。

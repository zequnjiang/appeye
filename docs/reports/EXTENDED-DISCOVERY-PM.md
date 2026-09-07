# 扩展发现与漏收诊断：PM最终验收

- 关联：[需求 #22](https://github.com/zequnjiang/appeye/issues/22)、[ED-AC-01–08](../requirements/EXTENDED-DISCOVERY.md)，原 [全量运营 #11](https://github.com/zequnjiang/appeye/issues/11) 保持独立。
- 审阅日期：2026-09-07；业务/测试基线 `e356bb323309dbb4e332b3bf941b314c9de6987f`。
- 最终结论：**ED-AC-01–08按已批准的有界公开发现、失败可见范围全部通过，允许CEO完成最终报告/CI后合并PR #23并关闭#22。** 目标已真实补录并自动confirmed/strong，正式运行与重启保持通过。5项GP关联续页解析兼容问题仍由[#24](https://github.com/zequnjiang/appeye/issues/24)保持OPEN，不计为完整成功；原#11也继续OPEN。下方工程阶段待办是历史状态，最终以文末判断为准。

## 审阅范围与独立证据

PM读取 [后端自检](EXTENDED-DISCOVERY-CTO.md)、[采集适配器自检](EXTENDED-PROVIDERS-CTO.md)、[前端自检](SILENT-REFRESH-CTO.md) 及 [Alex正式独立回归](EXTENDED-DISCOVERY-ALEX.md)，检查007迁移、扩展runner、共享传输预算、协调器、已知ID写入、统一最早来源、诊断API/界面及相关测试。src/server/tests与包清单相对基线无差异；未操作正式数据库、迁移、采集进程或商店请求。

Alex于15:25:23.306Z完成独立 **221/221 tests，0失败/跳过**，前后端类型及diff检查通过。PM读取日志并重算SHA，测试日志为 `f32bc740b8332588c82f4f0d943b14b51753e0bd07fc92fb10ceb8a501f798e9`；类型日志 `19e07d2c67005f03c4bde155153a98c6509cc7e0278733456e4b332aec4d8d4b`，均与 `.artifacts/alex-silent-discovery-engineering.json` 相同。运行环境Node v25.9.0；隔离生产构建由CEO/CTO报告，Alex未改正式dist，PM未重复运行测试。较早215项整体自检不替代最终221项独立结果。

## ED逐项阶段判定

| 标准 | 工程判定 | 依据与剩余证据 |
| --- | --- | --- |
| ED-AC-01 | 路径通过，实际目标待验 | POST/apps沿既有身份去重，并记录known-id来源、原请求时间及刷新任务；新身份使用最早可信来源。占位/排队/终态失败可以诊断；正式AR目标必须有成功详情、完整raw/来源与strong分析，尚未据夹具宣称已补录成功。 |
| ED-AC-02 | 通过 | 持久6h状态/周期/任务/attempt/响应/来源，与原hourly/batch/manual共同调度；11槽1扩展，单writer/共同限速维持。暂停请求收尾、无新详情、下期恢复及错过多周期合并通过。正式运行/原冻结成员另核。 |
| ED-AC-03 | 通过 | 发起真实transport前原子计入当前市场60来源/60详情，SDK内部请求和失败重试不能绕过；20秒及1000结果限制明确。来源类型/市场/候选持久轮转，limited结束、deferred接续；跨3/4/12期及持续新条目回归证明旧项不被永久挤出。 |
| ED-AC-04 | 通过 | GP安装SDK迭代器合成源30→260、1000截止、无公开游标重放、坏布局/重复token告警通过；Apple200/page1窗口、非详情HTML/被SDK吞掉的错误、关联语言与unsupported边界通过。旧统一250提示已换为真实请求量/返回量及SDK停止原因，不回写旧响应。 |
| ED-AC-05 | 通过 | 部分逐条来源在超时前保存，迟到预算/回调拒绝，迟到HTTP仍归原task。原目录使用enrichment_history的原fetchedAt/requestLanguage/raw/warning并另记processedAt；新增discovery_sources纳入统一最早firstSeen计算，旧响应/收据重放和较新current保护通过。 |
| ED-AC-06 | 通过 | strong/possible正常准入，insufficient保留完整暂存分析；跨国身份、人工excluded和legacy、已有firstSeen、旧缓存不覆盖较新current及响应只应用一次通过。扩展新成员不写入原full-scan成员；真实007维护保护仍待核。 |
| ED-AC-07 | 通过 | 鉴权GET只读，无商店副作用；诊断关联extended/hourly/batch/manual，legacy小时暂存不误判从未发现，复合来源键、完整字段及证据分页可查。状态/预算延期/失败/停止原因分开，危险链接和原文安全显示。 |
| ED-AC-08 | 工程部分通过 | 开发者自检→Alex221项独立回归→PM审阅完成；真实部署、AR目标成功、正式扩展/小时/原批次持续推进及旧资料保持还需CEO执行、Alex只读核查后PM最终验收。 |

## 已审阅问题与解释

**公平性问题已修复并回归。** 初始若last_served=NULL的条目始终优先，持续新标题/候选会挤出旧失败项。当前排序使用created_at与last_served合并时间，Alex验证连续4期新候选下旧项仍获得三次有限尝试，连续12期新confirmed标题下旧词仍能重访。不能只用静止队列的轮转测试替代该证据。

**主库成员与采集成功分开。** PM指出已有known-ID占位被扩展来源再次遇到时，候选列表可以为admitted。CEO和Alex核实界面该词为“已入应用库”，表达主库身份存在，不表示已成功抓详情；identity另按lastFetchedAt和任务状态显示pending/failed及最近成功资料。页面明示排队不等于成功，ED-AC-01仍必须以真实成功详情和strong判断，不能拿此标签验收目标修复。现有两层语义可接受，无需因此扩大任务。

**扩散为每周期有界一层。** 周期创建时冻结种子，不在同一期把新发现立即递归展开；下期已confirmed应用可以成为下一期种子，仍受12关键词/10关联/10开发者与60+60HTTP限制。它是持续有界发现，不是承诺全历史只处理一代或全市场枚举。旧目录回收最多按当前实现选择20个已保存catalog条目，不发新网络请求，仍保存其原来源时间与已有部分告警。

**来源结束准确表达。** Apple关联方法取得的是同页应用链接，记录same-page-links，不夸称经过语义验证的推荐目录；GP类似目录100条是SDK聚合边界。SDK结束、local limit、预算中断、失败、unsupported分别留存，已有错误/部分返回不能改成自然空结束。

## 受控部署与最终证据清单

允许CEO继续用户已经批准的受控部署。最后实证需覆盖：

- 停旧writer、备份及007前后核对；新表/索引符合迁移，原2,024批次成员、旧任务/HTTP/响应/游标及人工分类保持。当前全库可以因已授权小时发现超过2,024，不能混用两种分母。
- 正式运行来源提交、源码/构建指纹、唯一锁owner及鉴权入口；扩展与原小时/批次都实际推进，60+60按真实传输留存，延期不伪装来源完成。首次6h调度和重启可以结合确定性时钟边界验收，不必等待每个来源或全批历史评论结束。
- AR目标身份的真实POST来源、成功详情HTTP/response/snapshot、规范/raw、分析strong、有效分类及原时间；重复身份不新增，其他市场/人工分类不被顺带修改。
- Alex正式只读交接后PM逐项作最终判断，CEO再提交报告、检查精确发布CI并关闭对应议题。当前阶段#21/#22与原#11均不因本报告提前关闭。

PM此轮仅写本报告及静默刷新阶段报告，不修改实现或他人测试报告；真实上游失败不能用合成成功替代。

## 真实交付证据的PM独立复核

PM正式接收 [Alex最终实际报告](EXTENDED-DISCOVERY-ALEX.md)，读取 [CEO部署记录](SILENT-DISCOVERY-DEPLOYMENT.md) 及本地 `data/batches/extended-2026-09-07-` 前缀的before、backup、migration、installed、live-smoke、restart-before、restart-after、alex-live-audit、alex-restart-audit产物。没有重新运行221项测试、请求商店、写生产数据或控制采集进程。

**迁移与身份。** PM独立深比较27个旧表的维护前后计数/高水位，相同；维护前2,052是当时主库总量，2,024才是原#11固定成员。PM将before的2,024市场身份逐项与此前独立 `finance-2026-09-07-pm-before-hourly-cohort.json` 比较，相同；备份文件stat与33,663,987,712字节记录一致，没有读取整份备份正文。CEO迁移程序逐项对比旧apps完整行摘要、54,133个任务关键字段摘要、run/countries和原表定义，errors为空；PM审阅了实际比较代码与结果，不将其夸为自己重哈希445万条评论。Alex在正式库又逐项核对原身份/firstSeen/分类，包含474条manual/legacy，未有差异。

**发布对应。** PM于 **15:43:37.649Z** 独立确认40个src/server文件与业务基线逐字节相同，61个dist文件与隔离发布产物相同；读取 [CI 34138027098](https://github.com/zequnjiang/appeye/actions/runs/34138027098) 确认为该精确提交completed/success。迁移、安装、Alex真实审计和重启产物SHA与Alex保存的关联值相同。

**目标真实成功。** Alex实际只读及原HTTP注入安装SDK离线重放证明：`ar/google-play/com.creditouno.loan`唯一主库ID2053，Credito Uno、版本1.2.0。HTTP1932/1937分别关联job1306/1309、manual response1/10、snapshot4671/4672，两个完整raw/规范资料/原观测时间与收据对应；真实观测为15:27:49.859、15:27:57.512，当前strong/auto confirmed，规则 `2026-09-07.1/heuristics-2`。PM核对产物中的两份独立观测及规则结论，未另外联网重抓目标。

目标的firstSeen为实际已知ID跟踪请求时间15:27:47.880；商店releasedAt独立保留，不称今天新上架。8项权限、dataSafety、3项开发者目录为实际available；其余privacy/versionHistory/inAppPurchases/ratings明确unsupported。dataSafety接口不提供国家参数，requestCountry保持null，不能称AR专属安全声明。评论为3条去重样本，本轮不验收该App全部历史评论；开发者显示名不等于已验证放贷主体或牌照。

**三通道与重启。** 正式扩展cycle1于15:27:01.296开始，nextDue21:27:01.296。PM独立比较15:30:12.729与15:30:34.894的捕获及Alex15:39:09–10复核：新PID3848替换3342，完整cycle/nextDue相同，原1,353来源冻结字段SHA、20个完整response SHA不变，12市场身份相同，source/detail预算及last-served均未回退。来源app_id/discovery_id允许随后建立关联，原身份、原观察/处理时间、父来源、raw/data等仍在冻结摘要中。扩展、原批次HTTP在重启后增加，稍后小时HTTP亦增加；各市场仍未超过60+60。原2,024成员不扩张，受控中断task1075明确保留deferred/attempt记录，不当成功。

实际15:34快照为六国双店12市场、63次HTTP、40个成功或staged任务的响应及已应用标记、1,601来源，另有排队/中断/失败；15:39扩展HTTP达到86。上述是不同观测时点，不相加、不称第一周期全量完成。跨3/4/12期公平性由确定性时钟回归证明，真实证据截至首期和一次重启，未冒称已经现场跨越多个6小时。

本次PM复核返回未解释差异0。关键输入文件SHA：migration `826aa7e212b2635b6951ca9274e51342cc0da51acee66f5c5a928cb57844fd3b`，installed `1856e101768a7af8c26200a1c5d153e7a5c7aed938194c7bb50451fe6bf577a7`，alex-live-audit `59e78d05b2877b6c1e99766b684f5405b677eaff854c9f7ffb90338e8c466d5c`，alex-restart-audit `10b9e41614fb8c89c398ab5ec8d76f962c6154b568fae4d45804d2160c0a3c1f`。原始HTTP/评论和数据库仍留忽略目录，不放入Git报告。

## 已知限制#24的产品判定

Google Play similar任务129/233/337/438/524（ID/MX/PH/PK/TH）存在`cluster-page-parse`/ParseError续页告警。CEO记录各已取得50条部分结果，来源、partial response及HTTP保留；Alex独立确认这5项保持failed/source-error，没有冒称完整来源。PM已读取[#24](https://github.com/zequnjiang/appeye/issues/24)并确认OPEN，后续需按保存HTTP离线复现兼容问题再走自检/测试/验收。

**此处通过的是已批准的有界来源与真实失败处理，不是续页兼容修复通过。** 两店关键词搜索、其他来源、候选处理和目标补录已经实际运行，5项失败不会阻断其他任务；本轮范围没有承诺所有公开入口必定完整取得或全商店覆盖。因此它不作为#22当前交付的未解决P0，但须保留公开限制及独立后续问题，不写为五项成功、每个目录只有50个App，或商店明确拒绝了该来源。审计errors为空只表示检查不变量无差异，不表示采集任务全部成功。

## ED逐项最终判定

| 标准 | 最终判定 | 结论依据 |
| --- | --- | --- |
| ED-AC-01 | **通过** | AR目标唯一ID2053，两份真实详情/raw/来源/快照及strong/auto confirmed闭环；不是空占位或只排队。 |
| ED-AC-02 | **通过** | 六国双店首期真实执行，保留小时/批次通道；11槽公平及跨期调度回归通过，实际重启仍cycle1/nextDue/原成员，未重新seed。 |
| ED-AC-03 | **通过** | 60来源+60详情实际预算无越界、重启不清零，20秒/1000结果及limited/deferred行为回归通过；持续新增条件下老任务跨期获得机会。实际首期未结束，不伪称所有预算路径均在生产耗尽。 |
| ED-AC-04 | **通过（保留#24限制）** | GP迭代/Apple窗口/旧目录/一层扩散按真实覆盖说明；规范字段及来源流程已运行。5项GP类似续页仍failed且部分留存，符合失败不冒充自然完整结束的标准，兼容本身未解决。 |
| ED-AC-05 | **通过** | 原始来源与时间、历史回收、独立response/收据及current保护回归通过；实际两目标观测与原1,353 source/20response重启保持。旧目录处理时间不充当商店发布日期。 |
| ED-AC-06 | **通过** | 目标自动确认、insufficient暂存和人工优先口径正确；原2,024身份/firstSeen/分类含474manual/legacy保持，新增扩展对象不扩张#11。 |
| ED-AC-07 | **通过** | 已鉴权诊断接口及实际目标状态可用，候选/来源/任务/完整证据可定位；查询不隐式采集，已知ID写入明确。未发现、占位、失败、入库和最近成功时间分开，合成桌面/窄屏验证通过。 |
| ED-AC-08 | **通过** | CTO/实施者自检、Alex221项及正式只读源/部署/重启、PM独立审閱、精确CI齐备；#24和#11限制明确，最终报告发布由CEO执行。 |

**允许CEO在最终报告提交及最新PR检查通过后合并[PR #23](https://github.com/zequnjiang/appeye/pull/23)，关闭#22；#21依其独立最终报告关闭。** PM不直接操作GitHub关闭。#24与#11继续OPEN，每小时/每6小时是持续调度频率，不能承诺同一窗口内完成所有App或得到完整市场名单。

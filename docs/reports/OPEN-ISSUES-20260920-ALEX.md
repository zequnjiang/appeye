# 2026-09-20 开放 Issue：Alex 独立验证

对应 [PM 需求](../requirements/OPEN-ISSUES-20260920.md) 中的 15 项 Issue。Alex 仅维护 `tests/alex-open-issues-{backend,provider,ui}.test.ts`、本报告和忽略目录中的审计材料；未修改产品源码、正式数据库、调度进程或 GitHub。

**最终Alex结论（2026-09-22）：16项可交PM最终验收。** 正式源码`7e2d7455010a3517feb00c32a5e4e2120ec2780f`、218产物逐文件核对一致。13项功能及正式11项页面流程通过；#24五项真实来源恢复通过；#11按明确外部来源限制限定接受，保留165 failed、494个RPC code5及受控中断，不称全商店评论完整成功。**#49最新65秒窗口满足原2秒门槛：14/14正确200、最大829.71ms、0超时，同一collector实际推进。** 原三轮失败全部保留。最终关闭和发布仍以PM验收及CEO精确HEAD CI为准。

最新Alex独立受影响组合122/122及typecheck通过；CEO最终全套333/333（52.544秒）、types和隔离build通过，执行归属分开。9月22日当前只读增量确认原2024成员、165终态、旧495attempt/HTTP和所有新增来源保持；73493只有两次完成RPC5加一次无HTTP受控中断，按有限来源判据单列，不虚报三次完成。

本轮Alex独立全套最初305/305（47.31秒），其后#46补修独立28/28、#49三模块99/99、应用库补修43/43及最后夹具修正4/4，相关typecheck均通过。CEO最终全套323/323（51.25秒）是CEO执行结果，未冒称Alex重复全套。以下保留各阶段初始失败、修正和真实运行证据，不用历史中间通过覆盖当前门禁。本文不授权关闭尚未通过PM的Issue。

## 独立测试与发现闭环

新增 16 项针对性用例（后端 8、provider helper 3、浏览器 5），包括：

- APR 中文 `到` 范围、实际含重复数值的年度括号说明、准确 offset；前置 `Loan customers` 的储蓄 APY、SAVE/BORROW 顺序以及月利率与费用区分。
- 离线重分析审计插入失败时整个事务回滚；原始观测时间为 null 时不补造；分析指向旧时间时选择对应旧快照；快照不存在则列出 `unavailableSourceIds` 并逐字保旧；人工 excluded 和全部快照保持。
- 手动任务的关联 ID 与市场不一致时不泄露另一市场名称；失败缺少时间仍 null；本周期与跨周期失败分母明确。
- 实际隔离 HTTP/SQLite 中客户 CSV 导出完整 23 行，三类枚举与标签/来源、公式转义、逗号/换行、Apple 缺失安装量和有效 0；后续分类改变不修改旧冻结 CSV，跨会话和撤权拒绝。
- related 仅修复已证明的 null token 容器；错身份、外站、重复 ID 参数、字段缺失、竞争布局、错误 RPC 和歧义多帧不伪装正常结束；原顺序、重复行和原文保留。
- 隔离真实浏览器：817 第二页中部任务锚点/展开状态返回、后台 503 保留；诊断旧慢响应不覆盖新查询；跨年真实观测排序、null/0、单点/无点、当前隐私优先；更新说明普通比较文本和不执行源标记。

独立发现并闭环的实现缺陷：

| 缺陷 | 初始实证 | 最终行为 |
| --- | --- | --- |
| #32 中文范围取下限 | `32% 到 40%` 被取 32 | max 40、min 32、原文 offset 一致 |
| #32 必要括号语义被截断 | 重复数字导致 `in a year for a loan` 丢失 | 保留完整相关括号上下文 |
| #45 APY 接受者被前置 Loan 干扰 | `Loan customers earn 15% APY on savings` 进入借款成本 | 15% 属非借款储蓄证据，后续 APR 保留 |
| #32/#45 原未知时间被补造 | maintenance 将 sourceObservedAt null 换成 current 时间 | 原 null 保留；旧时间选旧 snapshot，缺源不改 |
| #33 普通比较文本消失 | 浏览器将 `a<b and c>d` 显示成 `ad` | 原样显示，HTML/实体仍仅展示为纯文本 |

初次失败日志全部保留。另有独立夹具自身修正：JSON 稀疏数组应按序列化 null 比较；日期使用原 date-only 连字符；空趋势文案定位；原文断言需向夹具 `rawDetail` 提供原字段；真实 CSV 的字段有合法双引号。上述不计为产品缺陷，没有删减业务断言。

## 逐项功能覆盖

| Issue / AC | 独立验证范围 | 最终Alex判定 |
| --- | --- | --- |
| #27 OI27-01/02 | 实际 API 错市场保护；817 任务第二页第32条展开、详情返回坐标误差 <4px；503 保留旧结果、全为 GET；全套另覆盖无关联/名称缺失 | 通过；正式必要核对已完成 |
| #28 OI28-01/02 | 全套浏览器覆盖筛选空/全空/503区别、查看全部；独立503不变空态 | 通过；正式必要核对已完成 |
| #29 OI29-01/02 | 全套事件历史2012年/date-only/非法日期、负时区；真实副本在 America/Mexico_City 查看历史日期 | 通过；正式必要核对已完成 |
| #30 OI30-01/02 | 真实 TH ihappyloan 原文 `10 ส.ค. 2564` → 2021-08-10/date；无原文与待解析边界及非法值回归 | 通过；正式必要核对已完成 |
| #31 OI31-01/02 | 原小时窗口和跨年窗口、乱序观测、null/0/单点/空、390；北京时间显式 | 通过；正式必要核对已完成 |
| #32 OI32-01/02 | 两商店 easypaisa 原描述及真实 offset、32–40 上限40；详情与比较共享证据，重分析源时间/事务边界 | 通过；OI32-03正式维修与源时间核对完成 |
| #33 OI33-01/02 | 真实 ID Kredivo 原更新说明与纯文本展示 SHA 分开；br/实体/Unicode/普通比较/恶意标记不执行，原 raw 可见 | 通过；正式必要核对已完成 |
| #34 OI34-01/02 | 来源21–40展开、未提交 draft、侧栏返回；独立快慢 query 竞态不回填旧身份；无采集写请求 | 通过；正式必要核对已完成 |
| #41 OI41-01/02 | 两周期同 app 不合并，null 失败时间不造；UI current 与 recent-cross-cycle 分明、详情返回 | 通过；正式必要核对已完成 |
| #44 OI44-01/02 | 真实 PH PeraMoo 20变化字段；390 与817、桌面夹具旧/新/评分人数、null/0/对象/未知字段和对齐 | 通过；正式必要核对已完成 |
| #45 OI45-01/02 | 真实 Maya 15% 为 non-loan，贷款条款不含储蓄；SAVE/BORROW、APY 和周期反例 | 通过；OI45-03正式维修与源时间核对完成 |
| #46 OI46-01/02 | 真实 PK Apple6746167029 当前null、2026-09-06历史成功隐私链接和来源可见；当前链接优先/错市场/错app/无成功/危险URL拒绝 | 通过；正式必要核对已完成 |
| #47 OI47-01/02 | 客户隔离HTTP/SQLite冻结全行CSV；真实副本 GCash 五市场1997字节文件成功下载，unknown/待细分/来源明确 | 通过；正式必要核对已完成 |

全套同时保留原鉴权、租户隔离、只读、缓存范围撤销、15秒仅检测、冻结清单/CSV、历史返回和评论解析回归。本轮不以截图替代服务端权限测试。

## 实际资料副本浏览器

CEO建立的**只读生产资料抽样副本**，不是生产服务，也不是重新采集：5174→3001、3561 apps、112目标快照等，范围见 `.artifacts/issues-20260920/sample.json`。Alex 在独立 Chrome headless context、America/Mexico_City 时区执行，阻断非本地外部资源请求；不访问商店/隐私网站，不发采集任务。登录/退出仅本地会话。

2026-09-20 **04:02:34.446–04:02:38.211Z**，11 项聚合检查通过，页面 JS error 0，业务交互请求均 GET。目标 id 373/1076/1000/1177/116/2089/1807，加 GCash999 的 CSV 实际下载；各详情从诊断进入并返回保原查询。390 的隐私/变化页面 documentWidth=viewportWidth=390，另有817目标截图。已亲看关键390截图，变化前后标签和历史来源说明可读，未将外部截图加载被阻断误报为源缺失。

证据：`.artifacts/issues-20260920/alex-real-sample-ui.json`、同名 `.mjs`、`alex-sample-*-{817,390}.png`。首轮 CSV 引号断言错误独立保留为 `alex-real-sample-ui-initial.*`，最终按实际合法 CSV 引号修正断言后通过。

## #24 离线正式源复核

CTO正式交接后，Alex审阅并独立执行受限只读重放：5个历史 task（129/233/337/438/524），15个 `discovery_http` 主键点查后关闭库；所有SDK请求仅允许完全相同的已存URL/方法/顺序，未知网络请求硬拒绝。

原 SDK 五项均50条后报 `cluster-page-parse`；适配后分别 **98/63/76/100/52** 条、无告警。100项标 `sdk-related-result-limit`，没有称全商店目录。15原HTTP逐字保留；回调去重后的身份顺序与SDK结果一致；首50及续页新身份各使用对应记录时间。报告区分**原真实历史时间**和**本次离线重放时间**，未将重放当作新采集。

证据：`.artifacts/issues-20260920/alex-related-saved-replay.json` / `.log`。该执行复用已审阅CTO离线脚本，独立helper边界另由Alex三项测试完成。只有工程/离线通过；**OI24-03仍等正式部署后的有界真实恢复核对**。

## #11 维护前历史来源审计

使用CEO停机/checkpoint后APFS独立clone：`data/backups/appeye-before-2026-09-20-issues.sqlite`，107,005,800,448字节。它保留165失败末端，不含之后的恢复请求和新manual response。Alex未对live建立长事务。

2026-09-20 **04:00:42.343–04:04:35.654Z** 完成全历史源解析：

| 范围 | 成功页 | 全部HTTP | 检查200 | 已应用源行 |
| --- | ---: | ---: | ---: | ---: |
| Google Play | 48,779 | 49,441 | 48,784 | 7,251,695（独立核身份/顺序/cursor） |
| App Store | 3,803 | 3,804 | 3,803 | 126,616（独立XML全字段投影） |

**未解释差异0**。GP历史5个无效200（3个缺少/歧义UsvDTd、2个明确源错误）均未应用成成功；657个GP非200/transport错误、1个Apple历史非200/中断均保留。Apple933合法空终止、GP49合法空终止，另有1条来源字节证明的CRLF保留差异，沿用严格解释，未全局忽略空白。

证据：`.artifacts/issues-20260920/alex-review-sources-before.json`、`.http.jsonl`（只引用/哈希，不含评论正文/作者/游标）、独立审计器 `.artifacts/alex-final-review-source-audit.py`。当前HTTP表没有task索引，旧逐任务查询会重复全表扫描；仅审计器改为一次流式轻量元数据映射→主键逐body读取，并避免排序携带大response。该变化已跑独立正反合成审计用例；无生产索引或数据修改。

这只证明维护前全部成功页的源合法性，**不是#11最终验收**。task/response/raw/seen/current时间线审计正在另行执行，已固定原2024成员；后来manual必须用持久receipt+原HTTP+完整规范/raw证明，不能仅因fetchedAt更晚放行。165恢复结果及维护后增量仍须另验；有queued/running/deferred时不关闭#11。

## #46 PM补充边界：最终增量

未缩小OI46-01。独立真实SQLite/HTTP依次保存旧安全available、更近javascript、错市场、未知市场和最新成功empty：API只返回同app/同market最近安全历史的原time/source/historyId，当前仍明确empty/null；同商店ID但不同国家的另一个app没有串用。调用前后所有history逐字段保持，未认证401。

独立390浏览器确认新的服务端 `historicalPrivacy` DTO在empty时显示旧成功时间与历史编号；服务端显式null或foreign appId时，不能退回旧current enrichment中的链接。CTO受影响用例补充current安全URL仍优先。两条新增Alex回归通过后，最终28组合与types再通过；不拿补修前305替代这次检查。

测试文件已冻结。正式发布后还需核实际DTO的历史时间/URL，不能强制它等于当前enrichments时间，因为它可能引用更早历史。

## 正式部署：产物核对与首轮运行阻断

2026-09-20 04:19:46Z，Alex逐文件核对正式 `dist` 与CEO隔离release的 **216个产物SHA全部一致**，revision为`bd5c171991f450976af10d95fb13fad414412dca`。独立审阅维护脚本及已保存证据：第二次停机备份107,135,963,136字节；3563条分析重新计算，原资料/人工分类/私有研究哈希和冻结2024成员不变，网络请求0；5条related另建恢复任务且原任务/周期设置不改。这里是对CEO维护证据的独立复核，没有另扫107GB或冒称Alex执行了维护。记录为`alex-deployment-proof.json`，errorCount=0。

正式页面首轮尚未通过：04:22窗口在任何凭据提交前，IPv4首页30秒超时；保留`alex-formal-ui-initial-timeout.*`。第二轮04:25:30–04:26:09Z通过实际`index-DFVfwQzx.js`身份门、登录及App373真实APR范围检查，随后App1076的PK/GP发现诊断超过10秒仍显示“正在查询已保存来源”，未取得查看详情按钮；保留`alex-formal-ui-second-diagnostic-timeout.*`与截图。此时没有页面JS错误，但不能将errors空数组写成整个回归通过。

为排除磁盘审计干扰，Alex仅暂停自己的只读clone审计进程，未操作服务：04:18:48–04:22:39Z以及04:24:29–04:28:04Z。第二窗口暂停期间首页曾200/0.128秒，此后又3秒超时，不能仅将实际服务阻塞归因于审计竞争。CEO正在定位服务同步SQLite调用；Alex没有降低断言、延长等待来掩盖，也没有将该问题当作夹具错误。正式功能最终运行结论仍待稳定后的有界复测。

## #11 维护前全量入库与时间线审计完成

2026-09-20 **04:07:16.641–04:28:23.560Z**（含上述两段暂停），对同一一致性clone完成全部规范化响应、raw、持久receipt/attempt、页/游标接续、结束理由、去重与最终库值核对，**errorCount=0**。审计进程已退出，临时SQLite工作库已清理，没有把评论正文加载成全量内存数组。

- 分母严格为外部锚点固定的2024市场身份，1536个后来入库App不扩入批次；成员SHA与PM原锚点一致。
- 共52,747页，其中52,582成功、165失败。7,378,311页内规范化/raw记录全部对应；7,378,102批次seen身份均在库，内容、raw和fetchedAt逐项等于持久成功写入时间线。
- 原27,003评论身份全部存在且原row ID保持。批次added=7,351,236、updated=27,075；updated是每页已存在身份写入次数，不是去重后的“评论改动人数”。
- 唯一维护前manual评论收据29/job1316/app509的150条已加入真实应用时间线（11新增/139更新），并独立核其HTTP3096的UsvDTd身份顺序；不能仅靠current时间更晚接受来源。
- 流结束理由：687无next-token、982合法空页（GP49+Apple933）、190个Apple第10页接口上限、165失败。失败不转换为空/自然结束。

证据：`alex-review-timeline-before.json`、`alex-manual-review-source-before.json`；忽略目录审计器`alex-review-audit-timeline.mjs`及独立正反合成记录`alex-review-timeline-{base,manual}-smoke.*`。综合前述全HTTP源审计，维护前成功历史的OI11-04证据已覆盖；**维护后新增HTTP、manual37及165条有限恢复终态仍是后续增量，#11保持未终验**。

04:32:33Z又完成有界维护后增量只读核对（约0.7秒）：165授权恢复任务的原身份/游标/创建信息保持，**495旧attempt及495旧HTTP逐字段不变**；此时49 failed、116 queued、52,582 succeeded，维护后新增batch response为0。新manual37/job1318/app1236的150条实际返回均由原HTTP独立解析证明，当前库150行字段/raw/fetchedAt逐项相等；请求100不裁掉实际返回150。

增量记录为`alex-review-recovery-increment.json`、`alex-manual-review-source-live.json`。首版审计把累计attempt7机械视为超过3次新预算的误报保留为`alex-review-recovery-increment-initial-interruption-accounting.json`：task63014的新attempt6是04:15停机中断，4/5/7才是本轮三次实际失败；按持久attempt状态区分后error0，没有修改任务或抹掉中断。该时点仍有116待处理，继续不作#11终验。

正式受控trace期间第三次保持原超时阈值复验（04:32:11.613–04:33:22.249Z）：两个PK easypaisa的32–40范围均通过，下一PH Maya诊断仍10秒loading而未完成。记录`alex-formal-ui-trace-timeout.*`，未称第三轮通过。大审计此前已自然完成，因此该次复现不与持续大审计竞争混同。新增发布阻断按[#49需求](../requirements/ISSUE49-RUNTIME.md)的RUN01–04继续处理；初步索引/IO猜测不是最终根因。

## #24 正式恢复：独立来源闭环通过

CEO另建的5条恢复任务113299–113303已实际成功，分别 **100/68/63/100/49** 项，14条真实HTTP、380条持久来源。两个100保持`sdk-related-result-limit`，不声称全目录；TH本次真实49项只有2次HTTP、没有续页，不要求它等于历史离线52项。

Alex另写并执行`alex-related-live-replay.ts`：主键/任务索引点查后关闭正式数据库，再将这14条原HTTP按精确URL/方法/顺序输入实际SDK离线重放，任何未知网络请求硬拒绝。**全部380项的规范化字段、raw、来源身份、来源行内容和真实HTTP观测时间逐项一致，warnings为空**；四个当前null-token兼容引用也对应原HTTP时间。离线运行时间未充当实际采集时间。

原5个失败任务全行SHA、15个历史HTTP原字节/时间/status保持。证据`alex-related-live-replay.json` / `.log`及provider的`related-live-verification.json`互相对应。OI24-03独立实际来源核对通过，可交PM按该接口范围判定；#49服务响应和#11完整评论运营仍分别待验。

## #49 独立工程回归（等待正式自检完成）

目前新增`tests/alex-open-issues-runtime.test.ts` **4/4**：既有seen精确初始化、多batch与同ID不同App、重复初始化和文件重开、INSERT OR IGNORE不增数、DELETE/跨batch UPDATE与冲突拒绝、业务事务回滚、首建计数失败时表/trigger原子回滚，以及summary全对象等值/不写库/不再扫描seen表。日志`alex-runtime-counter-tests.log`。这只是当前实现的独立有界测试，尚不替代CTO最终冻结/完整受影响回归和RUN03正式65秒采样。

三模块CTO正式冻结后，Alex独立最终受影响组合 **99/99**（3.523秒）、`npm run typecheck`及owned diff检查通过：`alex-runtime-final-affected.log` / `alex-runtime-final-typecheck.log`。包含4项Alex新计数边界、市场3项/诊断5项/summary1项，以及原批次、小时、manual、权限/快照和只读status检查。另审阅诊断metadata分页→仅页内raw读取、旧/新全返回等值oracle、市场全范围精选/各国最近事件、JSON原类型及首快照来源的实现，未发现新语义差异。

**#49工程阶段已交“可受控部署”**；正式同collector65秒完整响应采样和诊断→详情→返回仍待RUN03/04，不将隔离数据的速度改善或99工程通过写成正式运行通过。Alex未覆盖正式dist、未操作collector。

## #49 首次修复后的正式实测

cb6ff99的**217个正式产物SHA与隔离release逐一一致**。独立审阅本次停机维护：107,490,242,560字节完整clone；初始化+独立原seen全COUNT校验共17.406秒（不是API耗时），结果7,378,102与Alex此前全量审计一致，重复初始化0.661毫秒；apps完整字段、国家、私有研究、2024成员和原历史高水位核对不变。Alex未重复扫描整个库，证据`alex-runtime-deployment-proof.json`。

正式页面 **04:45:26.155–04:45:45.934Z，11项全部通过**，保持原10秒交互/30秒请求阈值。七个实际目标依次从诊断进入正确市场详情再返回，之前失败的PK GP1076和PH Maya1000均通过；两店APR上限40、储蓄非借款、历史隐私history8624原时间、Thai2021-08-10及原文、更新说明纯文本、20条前后变化均正确。390页面doc/viewport均390，实际冻结GCash CSV1997字节，页面错误0，业务操作均GET。关键390截图已独立查看；外部图片资源被测试context阻断，不当作源缺失。证据`alex-formal-ui.json`和`alex-formal-*.png`。

**RUN03仍未通过**。并行同一collector PID93190的65.010秒窗口（04:45:25.187–04:46:30.200Z）中，每5秒交错14次首页/health：13次正确200；第4号首页请求04:45:45.191Z触及2秒硬中止（2003.8ms），恰与上述真实应用库搜索/CSV操作相邻。其余成功样本最慢1202.75ms。采样期间heartbeat推进，batch HTTP增加44、monitor HTTP增加2、discovery HTTP增加20，未停止collector。`alex-runtime-sampler-initial-library-overlap.*`保留整个失败窗口，不将其写成0超时；已交CEO定位剩余同步路径，不能由页面11项通过替代性能门禁。

### RUN03剩余应用库读取补修：独立工程通过

CTO再次冻结`libraryRows`补修后，Alex独立受影响组合 **43/43**（2.478秒）、前后端typecheck及owned diff检查通过。代码先按原国家/商店/类别/Unicode搜索语义筛选轻量身份，再只投影已入选行的展示字段；原贷款分析缺键undefined与显式null分别保留，原文发布日期/legacy fallback和固定CSV快照范围不改。独立复核了CTO旧模块全返回等值证据，未确认语义回归。

日志`alex-runtime-library-affected.log` / `alex-runtime-library-typecheck.log`。已交可code-only受控发布结论；仍须在相同2秒硬阈值下重新取得包含真实应用库/CSV操作的65秒正式窗口，首轮超时不覆盖、不改写。

## 最新正式版本52ca92b：RUN04通过，RUN03仍有一次超时

CTO全套新增用例的国家负例原写死mx，偶然与fixture实际国家相同；只修为从明确fixture国家选择另一国家，产品源码未变。Alex独立再次运行市场4项全部通过（0.923秒），日志`alex-runtime-library-fixture-final.log`；旧失败日志由CTO保留。随后CEO323/323全套通过并code-only发布，不再做数据库维护。

Alex独立比较`library-installed.json`、隔离release和当前dist，**217文件全等、error0**，见`alex-runtime-library-deployment-proof.json`。正式浏览器于**04:58:31.538–04:58:42.797Z**完成同11项诊断→正确市场详情→返回/390/GCash冻结CSV检查，全部通过、JS error0。原cb6的通过文件另保留`alex-formal-ui-cb6-pass.*`，没有覆盖先前失败证据。

但并行RUN03在**04:58:30.526–04:59:35.542Z，65.011秒**仍未通过：第一条首页完整响应在**2005.4ms**被2秒硬中止；其余13条200，最大924.2ms，完整样本均保留。PID97262、nonce前后相同，heartbeat由04:58:23.736推进至04:59:35.431；monitor HTTP增加52、discovery HTTP增加8。本次未产生新的batch评论HTTP，因为该批次此时已全部终态，不将其误写为collector停止。

原始记录`alex-runtime-sampler-final.*`，另存不可混淆副本`alex-runtime-sampler-library-second-failure.*`。这一条发生在浏览器初始访问/登录首页时段，尚未进入最后GCash CSV，不能未经定位断言仍是CSV原因。已交CEO/CTO继续定位，Alex未调高超时或自行重启/停止collector。

## #11 165流最终有限恢复与逐源诊断

**04:55:03.418–04:55:04.301Z**，独立只读增量确认165个授权流全部failed，52,582成功页保持，queued/running/deferred均0；本轮无新增batch response。原165身份、页码、请求语言、cursor与创建信息保持，**495原attempt和495原HTTP逐字段一致**。新manual37/job1318实际150条仍由独立源解析、完整raw/current/fetchedAt和持久receipt证明，未把该第一页替代任何旧续页流。记录`alex-review-recovery-final.json`与`alex-manual-review-source-final.json`。

之后另以主键/索引读取495份新增HTTP和165个前序页，并关闭数据库后离线调用实际SDK，记录`alex-review-recovery-source-final.json` / `.log`：

- 六国流数：ID59、MX43、PH15、AR24、TH10、PK14，共165。
- **494份HTTP200**均从原body独立解析到唯一`UsvDTd`、payload为null、数值code **5**、`PlayDataError` detail `[1]`。这不是仅匹配task.error文案；没有混入未知布局、普通网络错误或伪合法空页。
- 另**1份无status的aborted HTTP**明确归属task63014的受控中断attempt6；该流attempt4/5/7各为一次RPC5失败，共3次真实完成。没有删掉中断历史。
- **164流各完成3次新失败**；task73493/app340/PK page217只有attempt4及6两次RPC5，attempt5于04:43:14.666–14.696受控中断且没有HTTP。累计attempt6不等于三次已完成请求；本报告明确列为2次来源拒绝+1中断，交PM决定此有限来源接受边界，不擅自补采或称165×3全部完成。
- 每条新HTTP官方origin/path、POST、gl/hl、batch/task及attempt时间区间对应；每个失败页cursor与维护前原值、前一成功页nextCursor严格相同。安装SDK离线逐165输入确认生成UsvDTd请求含准确package和原cursor，URL/方法与已存HTTP相同，所有未知真实网络硬拒绝。
- 历史HTTP journal未保存POST的`f.req`请求正文，因此这里明确区分“持久原上下文+真实URL/响应+离线SDK构造证明”与“历史POST字节抓包”，不冒称后者存在。未证实源端code5的具体业务含义，不能说应用下架或游标必然过期。

逐源审计**未解释差异0**，全部成功历史的52,582页/7,378,102 seen/27,003原身份和完整写入时间线已在前述clone全量核对通过；此次只补维护后小增量，没有重扫107GB。可将#11交PM评估限定来源终止，不可宣称获取商店全部评论。最终整体验收仍须等待#49通过。

### OI11-05 六国双店终态矩阵

从已通过的逐流全量审计直接汇总；维护后无新增batch成功页，165失败保原身份/页码。自然终止分为无next-token与合法空，不能与source拒绝合并。表中“失败”均为本轮仍保failed的RPC5续页来源限制；此前补充采集的2个partial和12个失败另见已验收补充报告，未被评论阶段覆盖成成功。

| 国家/商店 | 流 | 全部页 | 成功页 | 无next-token | 合法空终止 | Apple10页上限 | failed流 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AR / Apple | 206 | 575 | 575 | 0 | 180 | 26 | 0 |
| AR / GP | 196 | 7748 | 7724 | 164 | 8 | 0 | 24 |
| ID / Apple | 141 | 681 | 681 | 0 | 93 | 48 | 0 |
| ID / GP | 142 | 11791 | 11732 | 72 | 11 | 0 | 59 |
| MX / Apple | 258 | 999 | 999 | 0 | 202 | 56 | 0 |
| MX / GP | 200 | 14757 | 14714 | 148 | 9 | 0 | 43 |
| PH / Apple | 196 | 639 | 639 | 0 | 171 | 25 | 0 |
| PH / GP | 142 | 6735 | 6720 | 122 | 5 | 0 | 15 |
| PK / Apple | 155 | 273 | 273 | 0 | 149 | 6 | 0 |
| PK / GP | 89 | 4299 | 4285 | 68 | 7 | 0 | 14 |
| TH / Apple | 167 | 636 | 636 | 0 | 138 | 29 | 0 |
| TH / GP | 132 | 3614 | 3604 | 113 | 9 | 0 | 10 |

全局7,378,102去重身份按(app_id, external_id)核对；页内7,378,311记录不是去重用户人数。后续小增量原有identity未删、manual37完整150响应已单独对齐，不将两种分母相加冒充新增评论量。

### #49 新定位的version读取/receipt增量

CEO随后提供真实trace：enqueueDetails全候选UPDATE单次2.392/2.586秒，版本历史读取冷查询1.050/1.154秒与逐发现receipt重复getApp叠加。010新增与原表达式相同的snapshot版本覆盖索引，recordDiscovery只做原有存在性校验；Alex独立受影响14/14（0.612秒）通过，日志`alex-runtime-version-affected.log`。索引null排除、0/false/对象类型、同观测时间id顺序和原完整返回均保持；当前只代表工程验证，正式构建/维护/同collector RUN03仍待后续。

## 2026-09-22 恢复工作：原证据完整性复核

06:54:28Z，仅以已存文件与9月20日SHA锚点交叉复核，不连接正式库、不重新扫描107GB、不发商店请求。最终recovery、逐源code5诊断、manual源审计、完整时间线四份JSON均与原部署proof哈希相同；全历史HTTP引用jsonl哈希也与其原审计声明一致，error0。

165终态、494份原UsvDTd/null/code5与1aborted、164流各3次完成和73493两次完成加无HTTP中断的边界均完整保留；旧495attempt/495HTTP及manual29/37证据互相一致。此处核实的是**9月20日实际审计记录的完整性**，没有将历史状态冒称为9月22日重新读取的运行状态。新记录为`.artifacts/issues-20260920/alex-resume-sep22-review-evidence.json`。

仍等待enqueueDetails补修的CTO冻结交接，随后独立验证010/recordDiscovery及队列同步受影响组合；正式部署后按原2秒、65秒、同collector推进条件再验RUN03。两次已发生的超时继续保留，尚不放行#49。

随后在CEO恢复无trace原配置、服务ready后，**2026-09-22 06:57:25.456–06:57:26.031Z**完成当前只读小增量（0.575秒），证据`alex-sep22-review-checkpoint.json` / `.log`：

- 原2024成员逐身份及batch candidate集合完全一致；165授权流仍全部failed，完整批次52,582成功、165失败，0 queued/running/deferred。
- 495旧attempt、495旧HTTP逐字段不变；496新增attempt及495新增HTTP的来源、时间、状态、内容哈希与9月20日终审一致（包括两条受控interrupted记录，其中一条无HTTP）。
- full_scan_responses高水位仍为73394，未新增batch成功页；manual29/37原收据hash/observedAt/appliedAt不变，id37之后没有新的已应用manual评论收据。
- error0。正式库只做任务/HTTP/attempt/App主键核对及batch覆盖索引小聚合；旧attempt轻量metadata仅从不可变clone读取，未扫描评论正文或大response表。因而旧全量审计加本次增量可连续衔接，不冒称重新全扫208GB现库。#11仍按已说明的源限制交PM，#49运行门禁未被豁免。


### 9月22日最终冻结：Alex受影响组合通过

CTO正式冻结候选同步和轻量任务选择后，Alex独立代码/测试审核及受影响组合 **118/118（2.968秒）**、前后端typecheck、owned diff检查通过。命令包含`runtime-discovery/runtime-version/runtime-market/runtime-diagnostic`、Alex runtime/backend、原extended与Alex扩展发现、collection coordinator、hourly、fullscan、manual和研究空间API/快照/CSV权限测试；日志`alex-sep22-runtime-affected.log`和`alex-sep22-runtime-typecheck.log`。

核实候选同步对null/wrong app关联、所有原状态、暂停国家和`last_fetched_at=''`仍保持原`IS NOT NULL`语义；第二次无变化写入为0。任务选择只延后读取完整payload，原COALESCE创建/轮转时间、ID tie-break及161条完整出队顺序均与原查询一致，source/detail和预算行为未更改。010版本索引与receipt存在性查询也纳入此次组合。**工程无已知阻断，可受控部署；尚不替代正式RUN03/04。**

CEO另报告最终全套329/329（48.167秒）和隔离218产物构建通过，属于CEO操作证据；Alex没有重复全套或写正式dist。后续浏览器复验改用独立`sep22/`证据目录，保留9月20日既有文件及其SHA锚点。


## 9月22日正式1cf0eea：页面通过，RUN03保留阻断

CEO受控维护的完整COW备份为208,853,356,544字节，010实际初始化25.361秒；已验证version查询使用`COVERING INDEX snapshots_app_version_time`。Alex审阅维护脚本对全apps字段/分类、countries、私有研究、2024cohort和各历史高水位的前后严格hash比较，均保持；这里是独立核查CEO维护证据，没有冒称Alex重扫208GB。正式218文件与staged的**raw-byte SHA逐一相同**，`alex-sep22-deployment-proof.json` error0。

该proof同时保留一次审计编码纠正：CEO安装摘要的serverHash/clientHash由`sha(Buffer)`实际经`JSON.stringify(Buffer.toJSON())`计算。Alex初次按raw-byte比较会失败；随后按原脚本精确重现该编码一致，218逐文件仍另用真实raw-byte SHA，不跳字段也不改正式文件。

正式浏览器 **07:05:57.123–07:06:19.029Z**：同11项检查全部通过，JS errors 0、业务请求全部GET，817/390目标详情返回保持正确国家/商店/身份；两店32–40上限、储蓄非借款、history8624原成功时间、泰国原文发布日期、说明纯文本和20项变化前后值均正确。两390页面均documentWidth=viewportWidth=390，历史隐私截图已亲看。CSV实际2345字节，保留当前冻结范围与unknown标签断言；当前持续新增市场资料，未机械要求等于9月20日1997字节。证据独立保存在`sep22/alex-formal-ui.json`及截图，未覆盖先前任何通过/失败文件。

**RUN03仍未通过**：并发窗口 **07:05:56.372–07:07:01.385Z，共65.007秒**，每5秒14次交错请求。第1号health（约07:06:01）在2001.34ms超时，第4号首页（约07:06:16）在2001.85ms超时；其他12条正确200，最大942.75ms。样本0是首页正常41.37ms，不能将后续两个超时解释成首请求未ready。PID49023及nonce全窗相同，heartbeat从07:05:52.177推进至07:07:01.290，monitor HTTP/response各增加37；batch终态及当前discovery高水位未变。

记录`alex-runtime-sampler-sep22.json` / `.log`。两个超时分别邻近初始市场页/首次诊断和应用库CSV热点；仅说明时间相关，不未经追踪归因。已交CEO/CTO继续定位，未延长原2秒、未停collector、未用前端页面通过替代运行门禁。当前不得最终关闭#49或据此宣称全部16项已交付。

### 最后两个schedule空目标guard：独立工程回归

CEO/CTO再次正式冻结后，Alex受影响组合**122/122（2.992秒）**及前后端typecheck通过，日志`alex-sep22-pause-guard-affected.log` / `alex-sep22-pause-guard-typecheck.log`。只在原事务内逐次查六国表是否存在enabled=0；有暂停国家仍执行原UPDATE及原跨cycle范围，running不改；没有缓存国家状态。全enabled时不访问大任务队列；恢复再暂停即时生效，事务失败仍回滚heartbeat和任务写入。

该增量无DDL、不改调度预算或采集结果。CEO使用独立临时clone的无匹配UPDATE计时是隔离证据，不能替代正式2秒门槛。工程无新阻断，已交可code-only受控部署；正式复测仍待ready，前三次运行失败都保留。


## 最终正式验收交接：7e2d745

两个空目标guard发布后，Alex最后独立核查218个正式产物、staged及CEO安装manifest的**raw-byte SHA逐一一致**；精确源码HEAD为`7e2d7455010a3517feb00c32a5e4e2120ec2780f`。正式监听`127.0.0.1:3000`的IPv4进程与collector锁均为PID52666，原单writer配置恢复、没有SQL trace。另一个已知无关IPv6通配3000服务仍在，因此核查按明确IPv4端点+真实Appeye资源/JSON判定，没有将其算作第二个Appeye进程或向其提交凭据。初次不分监听family的唯一PID断言误报及其精确选择说明保留在proof。

### RUN03 最终原门槛通过

**2026-09-22 07:15:25.421–07:16:30.435Z，共65.009秒**。每5秒交错GET首页与health，各7次共14次，全部200且Appeye身份正确，**完整响应最大829.713ms、0超时**，原2秒硬中止未更改。PID52666及锁nonce整窗不变；heartbeat由07:15:25.225推进至07:16:29.397，monitor HTTP增加24、持久response增加443，分别报告而不把HTTP和收据当相同分母。原batch已终态、discovery当前无新增HTTP，不声称所有通道在本窗口都发了请求。

证据`alex-runtime-sampler-sep22-pauseguard.json` / `.log`。采样与下面的正式市场首页、七个身份诊断/详情、应用库与CSV路径并行，覆盖实际已定位热点；没有暂停collector、扩大超时或只测空闲。前面三个失败窗口继续原样保留，不被本轮通过覆盖。本结论适用于本次规定窗口，不宣称永久响应上限或商店来源恢复。

### RUN04 正式流程及产物通过

**07:15:26.081–07:15:36.621Z**，正式浏览器11项检查全部通过，JS errors 0、业务交互全GET，登录/退出只用于本地会话。七目标均经真实发现诊断进入正确国家/商店详情并返回；APR范围/原offset、储蓄非借款、历史隐私真实time/source、Thai原文与date-only、原说明纯文本、20个变化字段前后值均正确。817与390视口、实际冻结CSV下载继续通过，无延长原10秒交互/30秒请求等待。

本轮路径为`sep22-pauseguard/alex-formal-ui.json`与相应截图；9月20日和9月22日先前证据都未覆盖。最新CSV仍按当前冻结清单校验，不要求持续采集期间与旧日期的字节数相同。外部图片由隔离浏览器阻断，未将其当作商店截图源失败。

最终汇总证据`.artifacts/issues-20260920/alex-final-sep22-proof.json`包含218文件SHA和19份关键证据SHA，error0；同时保留安装摘要Buffer编码与监听family两项审计器断言纠正，不把它们当产品缺陷或静默跳过字段。010受控维护及后续code-only安装归CEO执行，Alex独立审阅其前后逻辑hash/计划与实际产物，不冒称重复208GB整库扫描。

| 最终范围 | Alex结论 | 明确边界 |
| --- | --- | --- |
| 原13项功能 | 工程及必要正式发布核对通过 | 独立夹具、真实资料副本、正式运行证据按执行者和时点分列 |
| #24 | 原5失败证据保护、5新收据/14HTTP/380来源通过 | 两个100是SDK上限，不称全目录；离线SDK重放不算新采集 |
| #11 OI11-01–05 | 原全历史审计+维护后源诊断+9月22日当前增量可按来源限制接受 | 165仍failed；494明确code5+1abort，73493两完成+一中断；不将第一页fresh150或code5误称全部抓完/游标必然过期 |
| #49 RUN01–04 | 最后122独立工程、语义等值/维护、65秒与正式11流程通过 | 三轮原超时保留；不扩大为无限负载或永久性能保证 |

Alex已正式交PM最终判定；无需再扫评论巨表、重跑无变化页面或改写生产状态来获得通过。

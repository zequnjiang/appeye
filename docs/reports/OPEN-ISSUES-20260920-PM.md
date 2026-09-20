# 开放 Issue 独立 PM 验收（2026-09-20）

- 当前状态：**正式核对发现运行阻断，13项功能仍待最终验收；#24来源复验、#11运营终验分别未完成。本报告尚未放行关闭任何 Issue。**
- 原需求：[OPEN-ISSUES-20260920](../requirements/OPEN-ISSUES-20260920.md)，15项现有Issue、36项AC保持不变；新增独立发布阻断[#49需求](../requirements/ISSUE49-RUNTIME.md)，4项RUN AC。本轮矩阵共16项Issue。
- 初次实现预审基线：`98b43863ae813620ac76bcc45977e00109c7c8ad`；#46补修及正式发布基线：`bd5c171991f450976af10d95fb13fad414412dca`。[PR #48](https://github.com/zequnjiang/appeye/pull/48)，分支 `codex/open-issues-20260920`；不把先前提交的检查当作最终提交检查。
- PM 本轮只读审阅需求、实现、CTO 报告与本地聚合证据；没有改业务代码、操作正式库、重新采集、重跑大库审计或执行 GitHub 关闭。

## 预审证据与结论边界

已独立阅读 [UI 自检](OPEN-ISSUES-20260920-CTO-UI.md)、[后端自检](OPEN-ISSUES-20260920-CTO-BACKEND.md)、[采集适配器自检](OPEN-ISSUES-20260920-CTO-PROVIDERS.md)，并按需求检查任务身份/返回状态、日期与趋势、纯文本转换、变化前后、APR/储蓄语境、保存分析修复、CSV冻结值及关联续页适配实现。

CTO/CEO 各自已记录 UI 专项8/8与旧浏览器回归、后端50/50、provider13/13及相关58/58、类型和隔离构建；CEO另交接首次全套299/299。这些是对应执行者的自检，不写成 PM 或 Alex 重跑结果。

Alex随后正式交接[独立阶段报告](OPEN-ISSUES-20260920-ALEX.md)：新增14项专项，独立全套305/305和类型通过，真实资料副本及五目标离线重放通过。PM已阅读其逐Issue工程判定与范围。该结果早于下述#46历史空返回补修，不覆盖补修；正式运行核对与#11完整审计仍未交接。CEO告知98b43863的两项CI已通过，也不视作之后补修提交的CI结果。

PM已亲读以下忽略的本地证据摘要：

- `alex-real-sample-ui.json`：2026-09-20 04:02:34–04:02:38 UTC，5174→3001 隔离真实公共资料样本，11项检查、`errors=[]`。包括 PK APR两样本、Maya非借款收益、PK隐私、Kredivo更新说明、泰文日期、PeraMoo变化、GCash冻结CSV与390布局。浏览器执行归Alex，不称正式3000已部署。
- `alex-related-saved-replay.json`：04:05:21 UTC，5个原目标的已存HTTP离线重放；保留原异常、原15个HTTP字节与时间。SDK修复后结果及来源范围仍待正式部署后有界复验，离线解析不算新的商店观测。
- `alex-review-sources-before.json`：04:00:42–04:04:35 UTC，备份上的双商店来源审计，48,779个GP成功页加3,803个Apple成功页，共52,582个已应用来源页，`errorCount=0`。历史已拒绝错误单列，1处Apple字面CRLF等价已解释。该文件验证来源，**不代替评论/seen/写入时间线与冻结成员最终审计，也不证明165个失败流已恢复或终验完成**。

上述文件位于 `.artifacts/issues-20260920/`，只在报告保留聚合结论和定位，不提交原始评论、游标、真实数据库或客户资料。

## 逐 Issue 待验收矩阵

“待最终验收”表示已有实现/自检支持进入受控部署与独立验证，不表示该 Issue 已通过或可以关闭。

| Issue | AC | 预审判断 | 关闭前剩余证据 |
| --- | --- | --- | --- |
| [#11](https://github.com/zequnjiang/appeye/issues/11) | OI11-01–05 | **运营未完成，保持打开。** 原2024成员不随主库增长。165个原网络失败任务只获有限新预算；已观测的旧cursor返回HTTP200/RPC code5不是自然空结束。 | 实际有限恢复终态；逐流来源限制诊断；全量cohort/task/attempt/HTTP/response/raw/规范评论/seen/页间cursor及更晚合法写入时间线审计；六国双店终态矩阵。仍有queued/running则不终验。 |
| [#24](https://github.com/zequnjiang/appeye/issues/24) | OI24-01–03 | 待最终验收。独立保存响应重放支持“已验证App行+显式null token容器”的具体兼容修复；未知结构/RPC错误仍保留失败，部分结果先保存。 | 唯一正式coordinator执行历史同类5目标的有界复验；实际HTTP/来源行/预算/停止原因/旧失败保留，由Alex核对。不能仅凭离线绿称线上恢复。 |
| [#27](https://github.com/zequnjiang/appeye/issues/27) | OI27-01–02 | 待最终验收。后端身份联接含国家/商店；UI显示名称/外部ID并保存任务筛选、页码、展开与返回位置。 | Alex正式任务往返、缺失/错误市场身份、复制只读及正式版本确认。 |
| [#28](https://github.com/zequnjiang/appeye/issues/28) | OI28-01–02 | 待最终验收。筛选空、真正空、越页、接口错误和手动任务范围分别表达。 | Alex空态/清筛选/错误复验及发布版本确认。 |
| [#29](https://github.com/zequnjiang/appeye/issues/29) | OI29-01–02 | 待最终验收。新旧动态与详情使用完整年份；date-only不附会午夜，缺年文本不猜测。 | Alex实际历史发布样本、负时区/跨年边界及发布版本确认。 |
| [#30](https://github.com/zequnjiang/appeye/issues/30) | OI30-01–02 | 待最终验收。规范日期优先；有原文而未规范化时显示待解析，真正无来源才显示未提供。隔离真实泰文样本已验证。 | Alex正式映射/非法日期反例结论及发布版本确认。 |
| [#31](https://github.com/zequnjiang/appeye/issues/31) | OI31-01–02 | 待最终验收。图面和下方直接展示实际观测小时范围及Asia/Shanghai，仍是最近50次成功观测。 | Alex同日/跨年/单点/空/0与390可读性正式结论。 |
| [#32](https://github.com/zequnjiang/appeye/issues/32) | OI32-01–03 | 待最终验收。完整范围与offset保留；明确最高APR取上限。维护脚本只改版本化分析、保存旧新审计，缺原来源不猜测。隔离真实两样本已核。 | 正式备份/停唯一writer后的受控重分析；两目标保存结果及原观测时间、manual/legacy、原raw/历史/私有引用不变；Alex独立核对。 |
| [#33](https://github.com/zequnjiang/appeye/issues/33) | OI33-01–02 | 待最终验收。格式标签/实体只作纯文本展示，原证据不变。Alex发现的普通比较符被误删已补修，不能归为测试错误。 | Alex原红例独立复测、真实Kredivo同字段展示及最终版本确认。 |
| [#34](https://github.com/zequnjiang/appeye/issues/34) | OI34-01–02 | 待最终验收。已提交身份与输入草稿分离，来源/记录分页、展开与返回状态外提保存；新查询不继承旧身份结果。 | Alex21–40页往返、迟到响应、身份切换/权限清理与只读行为正式结论。 |
| [#41](https://github.com/zequnjiang/appeye/issues/41) | OI41-01–02 | 待最终验收。失败项给真实结束时间、cycle身份/计划/启动时间；最近20条跨周期历史与当前周期计数明确区分。 | Alex多周期/缺时间/往返实测、正式API归属与发布版本确认。 |
| [#44](https://github.com/zequnjiang/appeye/issues/44) | OI44-01–02 | 待最终验收。共用中文字段与前后标签，桌面三列、窄屏仍各值有方向，null/0/对象保留。隔离真实PeraMoo已核。 | Alex桌面/390正式结论与实际发布版本确认。 |
| [#45](https://github.com/zequnjiang/appeye/issues/45) | OI45-01–03 | 待最终验收。储蓄收益单列non-loan且权重0，不用于借款成本或对比；混合产品中的贷款证据仍独立。隔离真实Maya已核。 | 正式旧分析维修与Maya保存证据、原资料/分类保护、Alex独立核对；不将规则建议变化当人工分类变化。 |
| [#46](https://github.com/zequnjiang/appeye/issues/46) | OI46-01–02 | **边界补修工程已闭环，待正式运行最终验收。** 现在按同App/市场读取最近含安全链接的available历史，即使最新补充empty仍可发现，原时间/来源/historyId不改。 | Alex已独立通过available→empty、危险/错市场/未知市场、390及显式null拒绝fallback；待正式服务实际历史DTO/页面最终核对。不访问外部网站推断有效性。 |
| [#47](https://github.com/zequnjiang/appeye/issues/47) | OI47-01–02 | 待最终验收。明确loanCategory枚举、中文标签和来源，从已授权冻结全集取值；保留原category兼容列。原category本来即信贷细分，不沿用Issue中的误诊。 | Alex冻结后分类变化/跨会话拒绝/多页与空值公式边界、真实GCash下载及正式版本确认。 |
| [#49](https://github.com/zequnjiang/appeye/issues/49) | RUN01–04（独立增量） | **发布阻断，待定位/修复/独立实测。** 同collector运行时首页/诊断请求长时间等待；暂停审计后仍复现。 | 完整热路径定位、语义等值修复、正式ready后至少60秒的双端点响应门禁、实际任务推进与原失败页面往返；Alex→PM→最终HEAD CI。 |

## 预审提出的有限差距

**#46 历史资料的范围。** 98b43863的 `historicalPrivacy()`读取详情返回的最新 `enrichments`。该表在失败时保留上次成功资料，但之后收到一次成功 `empty` 时会更新为该次空数据；较早链接只留在 `enrichment_history`，当前辅助不会发现。原Issue具体样本的补充仍为available，因此该样本已覆盖；OI46-01“存在成功历史补充”的完整承诺仍需处理这一分支。

PM交接后，CEO明确**保留完整AC，不收窄需求**，决定补服务端同App/市场最近含安全链接的available历史读取，由CTO消费展示、Alex独立回归后再部署。当时将该差距保留待闭环，没有将未覆盖分支改写为通过，也没有因此要求重做无关功能。

增量结果：bd5c171已补服务端只读历史查询及明确的历史DTO，PM亲读实现确认同app、同requestCountry、available及HTTP(S)筛选，原始history不修改；前端显式null/不匹配身份不沿用别的旧值。Alex正式增量报告确认独立受影响组合28/28、类型通过，其中新增2项专门验证此缺口。CEO最终全套309/309、类型/隔离构建与audit 0另列执行归属。该差距的工程部分已闭环，未收窄需求。

## 正式发布证据预核

已读[CEO受控发布](OPEN-ISSUES-20260920-DEPLOYMENT.md)。2026-09-20 04:15:49Z第二份完整备份为107,135,963,136字节、0600、独立APFS inode，采用业务表摘要及首/中/末字节样本验证，不宣称全文件SHA。04:16:13Z保存分析维修记录为3,563/3,563、缺失原来源0、网络0，应用事实/分类、私有研究、国家设置和原2024成员保持；随后发布bd5c171，新前端资源`index-DFVfwQzx.js`。

PM独立读取`release-evidence.json`、`production-api.json`及`alex-deployment-proof.json`，并实际重新计算后者引用的10份证据SHA和`dist`/暂存release各216个产物文件SHA，**0差异**；未重复扫描107GB备份。正式八目标API已显示heuristics-3、两商店32–40最高40、Maya15%为非借款、泰文日期及历史隐私DTO；CSV待细分和手动任务真实身份由CEO实际核对。Alex部署产物核对为04:19:46Z、`errors=[]`，正式浏览器/运行最终报告尚待交接。这些证据不代表所有浏览器流程均在正式环境重新执行。

bd5c171的[CI两项成功](https://github.com/zequnjiang/appeye/actions/runs/35488680910)由CEO核对；包含最终报告的新HEAD仍须另行通过CI。

### 正式运行新增阻断：采集推进时服务请求长时间等待

上述产物与资料保留证明仍有效，但不能替代运行可用性。Alex正式浏览器先遇首页30秒超时；第二次在新版资源、登录和PK Apple APR实际通过后，PK GP身份诊断超过10秒仍在loading。`alex-formal-ui.json`记录`passed=false`；页面JS `errors=[]`不表示完整流程通过。原失败完整保留。

Alex和CEO暂停审计后仍复现正式首页超时；CEO随后报告collector网络返回后的`Store.all`同步SQLite读取阻塞。准确热路径与补修正由开发诊断，PM不据此提前断言所有延迟均由某一索引导致。**13项功能不作最终通过，等待运行问题修复和Alex正式复验；不通过延长探针超时或停止collector取得验收绿灯。**

CEO已注册[#49](https://github.com/zequnjiang/appeye/issues/49)并采纳PM四条最小增量标准，正式为[RUN01–04](../requirements/ISSUE49-RUNTIME.md)：定位实际SQL/执行计划；业务结果等值且不改采集语义/历史；正式已ready后同一collector实际推进中至少60秒有界交错请求首页和health、每次2秒内正确200且无超时；Alex核对产物/队列恢复并重走曾失败的诊断详情往返。原36项AC未改。初测候选336ms、来源8ms、批次任务15ms、快照版本10ms均不足解释超过30秒的阻塞，尚不将任何单项猜测认定根因。

Alex另已交接维护前完整timeline聚合：2026-09-20 04:07:16–04:28:23Z，原2024成员、52,582成功页/165失败、7,378,311原始/规范行、7,378,102 seen/current、27,003原ID及旧manual response 29（job1316、150行）的写入时间线核对，未解释差异0。PM已读取该聚合文件确认其manual范围。该备份不含之后恢复与新manual37；它补足维护前OI11-04证据，仍不能用于关闭#11或解除#49。

## 最终放行条件

1. Alex按冻结代码提交独立正式报告，明确各项自动回归、实际浏览器、真实公共资料副本、离线SDK及正式运行的范围；新发现须闭环，不用总数替代失败详情。
2. 正式部署/重分析/五目标来源复验保留完整备份、唯一writer、原市场身份与manual/legacy/冻结cohort/客户私有资料保护证据；部署产物与最终源码相符、正式API和常驻调度正常。
3. #46边界收口后按实际最终行为判定；#32/#45不能仅部署新规则而遗漏已保存分析维修；#24必须报告真实复验的成功、结果上限或确切失败。
4. CEO核对包含最终业务与报告的精确提交CI后，只关闭PM明确放行的Issue。**14项功能可以在各自证据完备后独立上线/合并；#11是否完成须另行运营终验，不因PR合并或新入口评论成功而关闭。**

本预审不推断code5表示游标过期、无评论或应用下架；manual任务1318的新入口150条成功仅作为与旧cursor拒绝的有限对照，不并入原评论流、不重置原流或改写原失败原因。

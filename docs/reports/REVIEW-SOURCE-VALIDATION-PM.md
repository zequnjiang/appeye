# 评论来源响应校验：PM局部验收

- 结论：**RSV-01至08通过，#16的工程及runtime-6真实部署验收通过。允许CEO发布最终报告、确认最终CI后关闭该缺陷；#11及PR #12整体仍未完成。**
- 范围：[缺陷 #16](https://github.com/zequnjiang/appeye/issues/16)、[局部需求](../requirements/REVIEW-SOURCE-VALIDATION.md)，属于[运营 #11](https://github.com/zequnjiang/appeye/issues/11)的评论来源校验，不是全部评论终态验收。
- 代码：`522d86e04d0ebcee14ff7728f11ed200caab10fb`，runtime-6记录于`2026-09-06T20:13:41.814Z`；日期均为UTC的2026-09-06，对应北京时间2026-09-07。
- 角色证据：[CTO自检](REVIEW-SOURCE-VALIDATION-CTO.md) → [Alex独立工程与部署核查](REVIEW-SOURCE-VALIDATION-ALEX.md) → 本PM验收。PM仅读源码/证据和只读数据库，未启动采集、注入真实错误、修改生产数据或重排任务。

## 工程判断

PM独立审阅`review-source-validation.ts`、批次评论provider和正式交接报告。原HTTP先按状态、完整body、真实时间与task/batch写入账本；随后读取响应作校验，语义错误不篡改原HTTP200或原文。两家SDK可能包装fetch错误，provider仅透出已知的来源校验错误，其他异常不被统一误归为来源错误。

GP通过实际请求`f.req`辨认UsvDTd，再核对应帧的明确非零数值错误，包含有部分payload的错误；URL的rpcids标签不代替实际请求内容。null、空数组或缺token本身不导致拒绝，非目标RPC隔离。缺失或破损envelope仍由原SDK处理，本补丁不声称覆盖所有未知GP错误布局。

Apple用本地XML解析及Atom feed根节点校验，合法空和元数据feed可通过；没有额外要求title/id/updated/self/entry必填。错误HTML、非预期根/namespace及破损XML失败，不能仅因提取不到评分entry而报告自然空。该范围是语法与根结构校验，不是schema/DTD或独立XML安全审计。

Alex独立完成**12项专项与完整132项测试**，前后端类型检查、生产构建全部通过。专项含真实安装SDK的内存响应、原始HTTP保留、合法空/空加token、错误源、两商店runner有限重试/耗尽/中断恢复及旧评论时间保护。PM没有重复执行整套测试，也不将fixture错误响应描述为实际商店本轮已返回的错误。

## 历史与真实部署证据

已证问题是静态误判路径，检查范围内没有本轮真实错误页被当空的实例。CTO在20:10:09.454–20:10:10.705Z核对当时901个成功GP页/901个UsvDTd帧，含49个空且无token，0明确错误或无法解析；其更早649页/30空是当时工具输出的回溯记录，不冒称有独立旧文件。Alex另在20:07:53.532–20:08:00.836Z用独立Python XML解析核对725个成功Apple页/HTTP，524非空、201合法空、18,024条字段投影与SDK raw一致，0误判。分母有各自时间边界，不能覆盖之后尚未取得的页。

CEO干净停止runtime-5，冻结旧结果后用原batch/serve/delay参数启动runtime-6，没有retry flag或成功页重排。Alex正式部署证据为：

| 项目 | 时间UTC | 实际范围与结果 |
| --- | --- | --- |
| 旧结果保持 | 20:13:56.722–20:14:01.584 | 2,220个旧成功task与2,220条旧HTTP完整行哈希不变；144,551条旧评论身份/完整字段/raw/fetchedAt不变；144,414个seen保留，异常0。 |
| 新GP页 | 20:14:54.357–20:14:54.683 | 全部67页、9,804条评论；65页继续、2页无next正常结束。独立源帧、ID/数量/游标、HTTP/response/评论时间和字段一致。 |
| 新Apple页 | 同上 | 全部57页、1,324条评论；31页继续、26个合法空feed结束。独立XML/Atom根、ID/数量、source大小写及存储对应一致。 |
| 新来源与运行文件 | 同上 | 124页及11,128条规范评论对应检查异常0；96个继续页有后继检查点；runtime-6全部10个文件SHA-256匹配。 |

该部署实证没有新GP空页或来源校验错误实例。GP合法null/空/空加token与错误拒绝由确定性回归验证；真实合法空页实证来自26个Apple feed。没有向商店注入错误来补齐测试。

PM在**20:16:18.358Z至20:16:23.535Z**另开只读事务，独立复核：

- 10个运行文件与runtime-6指纹一致，原2,220个成功task和2,220条HTTP完整行哈希均不变。
- 原144,551条评论身份全部保留，144,549条完整行仍不变；另外**2条已经由之后真实新页合法更新**，其全部字段/raw/fetchedAt逐项对应最新持久response。不能将更早Alex快照的“144,551条全不变”写成永久不变要求。
- 原144,414个seen全部保留，冻结reviews/seen证据文件自身SHA与基线一致；原474个App所有基线字段差异0。
- 按Alex冻结的124个新来源引用，逐条直接核对task/HTTP原body SHA、成功attempt、持久response、实际时间、数量和stopReason；96个继续页的后继任务及GP游标对应均正确。
- 此时已有277个部署后成功新页，但独立来源逐项复核分母仍是上述124页，未把其余新页默认为已审计。上述检查errorCount=0。

本地证据为`data/batches/finance-2026-09-07-runtime-6.json`、`finance-2026-09-07-alex-runtime-6-before.json`及其reviews/seen JSONL、`finance-2026-09-07-alex-runtime-6-after.json`、`finance-2026-09-07-alex-runtime-6-new-sources.json`；PM自身聚合为`.artifacts/pm-review-source-validation.json`。真实正文与身份明细留在忽略目录，本文只公开统计。

## RSV逐项结论

| 条件 | 结论与主要依据 |
| --- | --- |
| RSV-01 原始HTTP | 通过。账本先写、来源校验后读；内存错误用例原HTTP200/body不变，真实旧2,220条哈希与新124条引用均可核。 |
| RSV-02 GP明确错误 | 通过。实际f.req与UsvDTd范围正确，明确非零错误拒绝，合法null/空/code0和非目标RPC隔离；SDK真实内存调用及67个部署后真实页佐证。 |
| RSV-03 Apple合法feed | 通过。严格XML/Atom根，合法空/元数据空不过度拒绝；错误文档回归通过，独立725个历史feed及57个新增feed正确。 |
| RSV-04 分页状态 | 通过。失败不假自然结束、空加token继续由runner联动测试确认；新页96个后继检查点、2个GP无next与26个Apple空结束来源匹配。 |
| RSV-05 有限重试与历史 | 通过。两商店失败→耗尽→显式恢复的累计attempt/旧页/时间用例通过；实际干净重启旧task/HTTP/评论身份/seen保持，合法新更新有来源。 |
| RSV-06 范围控制 | 通过。runner/DB/CLI与原批次范围不改，无成功页重排；历史检查未发现需修复对象，没有假定事故后批量重抓。 |
| RSV-07 独立回归 | 通过。CTO自检后Alex12专项/132完整检查均通过，fixture与真实源核查分别记录。 |
| RSV-08 验收证据 | 通过。提交、runtime指纹、干净部署、历史/新增真实页及Alex→PM各自只读核查齐备。最终报告发布和CI由CEO回填。 |

PM快照中评论仍有1,218个queued任务与1个running，2,497页succeeded只是当前页计数。全部可继续评论流、最终源结构全集审计、原数据保持及运行设置恢复仍待完成。**本结论仅允许关闭#16，不允许关闭#11或将PR #12视为运营整体交付。**

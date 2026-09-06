# 十二项Apple资料：PM本轮来源限制验收

- 结论：**初始6项与后续MX/PH新增6项均接受为本轮`source-unavailable`限定终止，共12项、4条市场记录、2个不同Apple商店ID；它们仍是已尝试但失败、未取得资料，不是成功或成功空。#11整体未完成。**
- 关联：[运营 #11](https://github.com/zequnjiang/appeye/issues/11)、[FS-SU-01至07要求](../requirements/FULL-SCAN-2026-09-07.md#已证公开来源不可获取的终止口径)。与Google Play[#14路由修复](https://github.com/zequnjiang/appeye/issues/14)无共同根因；BCA目录告警及其余采集任务不在本次接受范围。
- 运行基线：初始6项为runtime-4的有界错误cause记录和有限重试，当时110项工程回归由Alex完成；后续runtime-5沿用该诊断能力，最新工程检查120项通过，新增市场按原3次预算结束。PM没有启动采集、联网探测或真实库写入。
- 证据：初始[Alex独立核查](APPLE-SOURCE-LIMIT-ALEX.md)、`data/batches/finance-2026-09-07-alex-apple-source-limit.json`；新增范围见[Alex Apple全量阶段](FULL-SCAN-ALEX.md#第二项阶段结果apple-七类补充全量核查)、`data/batches/finance-2026-09-07-alex-apple-supplements.json`。两次errorCount均为0。CEO保存的三个官方探测文件与PM直接只读复核见下文。

## 初始六项接受范围

| 市场记录 / 商店ID | 资料类型 | 任务ID | 最终状态 / 累计尝试 | 最终失败时间UTC |
| --- | --- | ---: | --- | --- |
| App1060 / PH / Apple871608181 | privacy | 15128 | failed / 6 | 19:15:20.478 |
| App1060 / PH / Apple871608181 | versionHistory | 15129 | failed / 6 | 19:15:22.415 |
| App1060 / PH / Apple871608181 | inAppPurchases | 15130 | failed / 6 | 19:15:24.324 |
| App1172 / PK / Apple1089271220 | privacy | 16024 | failed / 6 | 19:15:26.273 |
| App1172 / PK / Apple1089271220 | versionHistory | 16025 | failed / 6 | 19:15:28.171 |
| App1172 / PK / Apple1089271220 | inAppPurchases | 16026 | failed / 6 | 19:15:30.082 |

日期均为UTC的2026-09-06，对应北京时间2026-09-07。仅这两条市场记录的三类HTML依赖操作受本次结论覆盖；详情/lookup仍成功，不将整个App或整个店面判为不可获取。

## 原因与PM直接复核

CEO在同一运行时间窗口对实际官方域名有界探测。PH的无slug入口跳到`/ph/app/myaccount%24/id871608181`，该地址于19:10:12.177Z返回301且Location等于自身；官方lookup的`uo=4`、解码slug、语言参数及浏览器请求头检查未取得HTML。PK的入口跳到`/pk/app/personal-loans-mobile-loans-up-to-%2435-000/id1089271220`，其于19:11:40.270Z同样301指向自身。PM核对的是CEO保存的直接HTTP状态/Location链，未声称亲自重复联网；这些探测没有作为成功资料写入采集结果。

六项实际runtime-4 attempt4至6均保留底层`redirect count exceeded`。Node fetch因重定向循环没有返回最终Response，实际采集HTTP ledger的status/body为null；null不代表商店实际发送了“null状态”，也不代表返回空资料。官方301来自另行保存的直接探测，二者证据不能混为一条成功入库响应。

Alex于`2026-09-06T19:16:00.850Z`完成独立只读核查。PM于`19:17:20.659Z`另开只读事务逐项复核，摘要保存在`.artifacts/pm-apple-source-limit-audit.json`：

- 六项全部failed、attempts=6、recoveryAttemptBase=3，序号1–6完整且均失败；每项6条HTTP和6条失败history均在，最后3条HTTP均有重定向次数超限cause。
- 每项实际URL、当前attempt source和国家均匹配本店面/ID；此Apple HTML接口没有语言参数，attemptRequestLanguage保持null，没有将冻结en冒称为实际请求参数。
- 每项成功response数0，当前data/raw/lastSuccessAt均null，最后尝试时间对应最新失败；没有改成empty、unsupported或succeeded。
- 旧1–3次记录和时间仍存在，新4–6次另行追加。原三次没有部署前逐字段/字节指纹，验收不声称做过不存在的“旧记录字节不变”比较。历史中原无成功资料，当前null没有清空一份应保留的旧成功。
- 两个App的详情任务仍succeeded。CEO探测文件SHA-256与Alex核查引用一致。

## 初始六项FS-SU逐项判断

| 条件 | 结果与依据 |
| --- | --- |
| FS-SU-01 范围明确 | 通过；精确到上述6个任务及两个店面/ID/HTML方法，不泛化到其他App。 |
| FS-SU-02 上游证据 | 通过；官方canonical真实301自循环，来源URL核对与有界变体探测有时间戳，诊断与入库响应分开。 |
| FS-SU-03 排除内部原因 | 通过；真实请求ID/国家/官方路径正确，实际fetch底层原因与直接官方循环一致；#14为另商店的路由缺陷，不据此猜测改写Apple路径。当前没有已知可执行的内部修复能消除该官方循环。 |
| FS-SU-04 有限真实重试 | 通过；原3次加新有限3次全部完成，累计1–6可核；此6项已无queued/running的剩余尝试，未无限重置预算。 |
| FS-SU-05 状态与原资料 | 通过；保留failed、无成功资料与成功时间，详情仍可用，不伪造空/不支持。 |
| FS-SU-06 独立验证 | 通过；CTO诊断变更、CEO有限执行/直接探测、Alex及PM各自只读核查齐备，发生/诊断/重试时间分开。 |
| FS-SU-07 完成表达 | 接受限定表述：“本轮上述6项因已证官方页面循环未能取得，有限采集尝试已终止。”必须继续显示6项失败，不称6项资料采集成功。 |

## 新增MX/PH六项终态与FS-SU验收

**新增六项来源限制通过。** 这些任务不是最初6项的再次恢复，而是同一个Apple ID在另外两个市场的独立采集。原三次已具备原因记录，实际全部结束后按FS-SU-04审查，不为凑次数再执行到六次。

| 市场记录 / 商店ID | 资料类型 | 任务ID | 最终状态 / 累计尝试 | 最终失败时间UTC |
| --- | --- | ---: | --- | --- |
| App1638 / MX / Apple1089271220 | privacy | 19752 | failed / 3 | 19:33:16.278 |
| App1638 / MX / Apple1089271220 | versionHistory | 19753 | failed / 3 | 19:33:18.214 |
| App1638 / MX / Apple1089271220 | inAppPurchases | 19754 | failed / 3 | 19:33:20.457 |
| App1819 / PH / Apple1089271220 | privacy | 21200 | failed / 3 | 19:43:12.148 |
| App1819 / PH / Apple1089271220 | versionHistory | 21201 | failed / 3 | 19:43:14.172 |
| App1819 / PH / Apple1089271220 | inAppPurchases | 21202 | failed / 3 | 19:43:16.187 |

日期仍为UTC的2026-09-06。CEO分别保存`data/batches/finance-2026-09-07-apple-mx-url-probe.json`和`data/batches/finance-2026-09-07-apple-ph-loans-url-probe.json`。实际官方入口均先301到本国canonical地址，再301到自身：MX于19:33:04.744Z，PH于19:43:21.551Z。PM直接读取这两份已保存链，核对country与`id1089271220`；没有借用PK或另一PH应用的链，也没有把诊断探测当成功采集响应。

三份证据文件的SHA-256与Alex全量报告逐一一致，初始文件未覆盖：原PH/PK文件`43e5f5bfa1803f097d259baab261d6cccb0222855c4250e649aa231afbd05149`；MX文件`a1c2ee4d9856c21aa575dafcd8923798db3199b83f3408e2375f2ed5e1bbd6e6`；新增PH文件`0b4ab5c659200d8cda38d91276bfa3cf91bc4a3d864dfa9c07d2ec78455e2aa7`。

Alex于19:53:31.286Z至19:53:39.774Z完成独立全量核查。PM于19:56:32.774Z至19:56:48.801Z另开只读事务，直接复核全部12个失败任务、54条attempt、54条HTTP及54条失败history，逐条任务顺序、时间区间、来源ID/国家和错误匹配；诊断增强后的36条HTTP均含`redirect count exceeded`，初期18条原始`fetch failed`仍在。新增6项各3条序号1–3完整，初始6项仍各6次，原PM已存的当前失败字段与尝试数不变，没有再试。自身摘要为`.artifacts/pm-apple-supplements.json`，errorCount=0。

新增范围的FS-SU-01至07均满足：任务/市场/类型/时间固定；两国各有真实官方自循环链；实际URL和底层cause一致且无已知可用内部修复；原有限3次预算全部结束；仍failed、无成功response/data/raw/lastSuccessAt；CTO/CEO执行证据经Alex及PM分别核对；结论仅限本轮六项未能取得。四条受影响市场记录的详情、ratings及developer任务各自仍succeeded，未将整个App判为不可获取。

## 后续统计与边界

在最终运营报告中，这12项计入“已尝试”“失败”“PM已接受的本轮来源限制”，不计入“成功取得”“成功空”或“商店不支持”。范围是4条country/store/externalId市场记录、2个不同Apple商店ID，不能写成4个不同产品。保留全部身份、URL、失败历史及诊断文件，后续若官方页面恢复或出现可靠新入口，可重新安排明确批次采集；本判断不意味着永久无资料、App下架、无隐私政策或无IAP。

这项接受仅使本轮已证外部限制可解释，不允许直接修改任务为成功或清空错误。全部2,024市场记录的七类补充处理已另行通过[阶段验收](FULL-SCAN-PM-ACCEPTANCE.md)，BCA两项仍按[部分目录限定结论](DEVELOPER-SOURCE-ERROR-PM.md)保留告警。全部可继续评论流仍须执行与审计；本结论不能覆盖未尝试页或尚可恢复的分页。**十二项来源限制通过，整体#11和PR #12仍未最终验收。**

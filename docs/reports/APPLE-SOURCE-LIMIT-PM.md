# 六项Apple资料：PM本轮来源限制验收

- 结论：**接受下列6项为本轮`source-unavailable`限定终止；它们仍是已尝试但失败、未取得资料，不是成功或成功空。#11整体未完成。**
- 关联：[运营 #11](https://github.com/zequnjiang/appeye/issues/11)、[FS-SU-01至07要求](../requirements/FULL-SCAN-2026-09-07.md#已证公开来源不可获取的终止口径)。与Google Play[#14路由修复](https://github.com/zequnjiang/appeye/issues/14)无共同根因；BCA目录告警及其余采集任务不在本次接受范围。
- 运行基线：runtime-4的有界错误cause记录和有限重试，最终110项工程回归由Alex完成。PM本次没有启动采集、联网探测或真实库写入。
- 证据：[Alex正式独立核查](APPLE-SOURCE-LIMIT-ALEX.md)、`data/batches/finance-2026-09-07-alex-apple-source-limit.json`（errorCount=0），及CEO保存的`finance-2026-09-07-apple-url-probe.json`。PM已分别读取并核对这些证据。

## 精确接受范围

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

## FS-SU逐项判断

| 条件 | 结果与依据 |
| --- | --- |
| FS-SU-01 范围明确 | 通过；精确到上述6个任务及两个店面/ID/HTML方法，不泛化到其他App。 |
| FS-SU-02 上游证据 | 通过；官方canonical真实301自循环，来源URL核对与有界变体探测有时间戳，诊断与入库响应分开。 |
| FS-SU-03 排除内部原因 | 通过；真实请求ID/国家/官方路径正确，实际fetch底层原因与直接官方循环一致；#14为另商店的路由缺陷，不据此猜测改写Apple路径。当前没有已知可执行的内部修复能消除该官方循环。 |
| FS-SU-04 有限真实重试 | 通过；原3次加新有限3次全部完成，累计1–6可核；此6项已无queued/running的剩余尝试，未无限重置预算。 |
| FS-SU-05 状态与原资料 | 通过；保留failed、无成功资料与成功时间，详情仍可用，不伪造空/不支持。 |
| FS-SU-06 独立验证 | 通过；CTO诊断变更、CEO有限执行/直接探测、Alex及PM各自只读核查齐备，发生/诊断/重试时间分开。 |
| FS-SU-07 完成表达 | 接受限定表述：“本轮上述6项因已证官方页面循环未能取得，有限采集尝试已终止。”必须继续显示6项失败，不称6项资料采集成功。 |

## 后续统计与边界

在最终运营报告中，这6项计入“已尝试”“失败”“PM已接受的本轮来源限制”，不计入“成功取得”“成功空”或“商店不支持”。保留全部身份、URL、失败历史及诊断文件，后续若官方页面恢复或出现可靠新入口，可重新安排明确批次采集；本判断不意味着永久无资料、App下架、无隐私政策或无IAP。

这项接受仅使本轮已证外部限制可解释，不允许直接修改任务为成功或清空错误。其余2,024市场记录的补充/评论仍按既定范围继续，未解决BCA警告、未尝试项或可继续分页不能借用本结论。**仅六项来源限制通过，整体#11和PR #12仍未最终验收。**

# BCA开发者源错误与响应幂等：PM阶段验收

- 结论：**FS-DR单轮恢复工程通过；两条BCA目录接受为“部分已取得、续页来源受限”的本轮限定结果，保留告警；#15修复通过PM验收，可在报告/最终CI通过后关闭。#11整体仍未完成。**
- 范围：[运营 #11](https://github.com/zequnjiang/appeye/issues/11)的FS-DR-01～07、[#15响应与重放一致性](https://github.com/zequnjiang/appeye/issues/15)，不缩减2,024条市场记录的补充/评论范围。
- 修复基线：`baa6e98089fcae09a84449c4cc8ee2dd19ca3a94`；runtime-5记录时间`2026-09-06T19:29:28.326Z`，PM核对七个运行文件SHA-256全部一致。
- 证据：[CTO自检](FULL-SCAN-CTO-SELF-CHECK.md)、[Alex正式工程与真实回归](DEVELOPER-SOURCE-ERROR-ALEX.md)，及下述独立只读证据。PM没有采集网络请求、修改生产数据、运行恢复开关或重启服务。

## 单轮恢复的实际结果

这两条印度尼西亚Google Play记录的开发者目录初页确实返回10项；旧续页与恢复后的新续页均为HTTP200，但`qnKhOb`数据payload为null、源错误类型为`PlayDataError`、code5，没有可继续解析的应用数组。#13已修复的是“有应用数组但布局不同”，本次源错误不具备同一内部恢复条件。此前CTO与Alex验证初页token同源、以已保存响应离线走实际SDK仍各10项和1条告警，不能靠改解析布局制造缺失数据。

Alex真实只读审计于`2026-09-06T19:30:24.574Z`完成，聚合文件`data/batches/finance-2026-09-07-alex-developer-source-recovery.json`为errorCount=0。PM于`19:32:02.287Z`另开只读事务，独立核对部署前基线和当前数据；摘要为`.artifacts/pm-developer-source-audit.json`。

| 项目 | task16108 / App1182 | task16116 / App1183 |
| --- | --- | --- |
| 市场/商店 | id / Google Play | id / Google Play |
| 新attempt ID / 累计序号 | 17964 / 2 | 17965 / 2 |
| 新response / appliedResponseId | 17837 / 17837 | 17838 / 17838 |
| 新资料观测时间UTC | 19:29:33.490 | 19:29:34.510 |
| 新HTTP初页 / 续页 | 8836 / 8837，均200 | 8838 / 8839，均200 |
| 新续页真实获取时间UTC | 19:29:33.362 | 19:29:34.366 |
| 新结果 | 10项、10 unique、1 warning、source code5 | 10项、10 unique、1 warning、source code5 |
| 保留状态 | succeeded + developer-degraded | succeeded + developer-degraded |
| 单轮marker原HTTP引用 | 7232，round=1 | 7236，round=1 |
| 旧资料观测时间UTC | 19:11:17.667 | 19:11:19.861 |

日期均为UTC的2026-09-06。PM直接核对旧attempt/history逐字段不变，原response全文及时间仍在，四条旧HTTP7231/7232/7235/7236的元数据及SHA-256匹配部署前基线。新response的task/attempt/observedAt与appliedResponseId一致，当前资料和新history的data/raw一致。新原HTTP完整保留，续页只正判源code5；不将HTTP200误解为该RPC数据成功。

本批有单轮marker的任务仅16108/16116，恢复原因、原HTTP引用、旧资料时间和排队时间齐备；重复源错误没有自动开启下一轮。既有六项Apple失败仍为failed/attempts6且结束时间未变；Alex另核对其所有原HTTP及attempt/history数量不变。此次没有重复它们的有限恢复。

## FS-DR验收

| 条件 | 判断 |
| --- | --- |
| FS-DR-01 严格候选 | 通过。工程覆盖13种任务/来源/最新HTTP/国家/语言等边界；真实只选两条末页严格符合qnKhOb/null/PlayDataError5的本batch记录。 |
| FS-DR-02 独立显式入口 | 通过。新开关与旧retry-warnings隔离，持久round=1；普通继续执行没有再次重排。 |
| FS-DR-03 历史保护 | 通过。旧response/HTTP/attempt/history均保留，新原文及来源时间另存，marker可审计。 |
| FS-DR-04 有限恢复 | 通过。实际每项只追加一次有效但部分的返回即停；三次网络失败保旧成功、预算耗尽终止由独立用例验证，本次真实没有走网络失败分支。 |
| FS-DR-05 部分语义 | 通过。10项和1条warning继续可见，succeeded只代表部分返回已保存；developer-degraded未清，不记为完整目录或自然结束。 |
| FS-DR-06 正常/未知分支 | 通过。完整无告警13项、未知结构拒绝、网络失败等分支由实际SDK夹具回归验证；本次实际为重复源code5，不借完整夹具声称真实完整。 |
| FS-DR-07 独立流转 | 通过。CTO自检→Alex120项工程回归及实际只读→PM源码/实际只读复核完成；整体仍按原清单继续。 |

PM据已有原响应与新一轮实际响应确认：在本轮已使用的公开目录方法下，没有可解析的续页数据，合理有限恢复已执行。接受这两条为**“部分目录已取得，续页来源受限”**，而不是失败空值，也不是完整成功。它们在最终统计中应从“完整取得”中单列，继续保留warning/stop_reason及目录实际条数；不得清告警、推断该开发者全球只有10个产品，或对未公开核实的code5解释成下架/限制地区等业务结论。

## #15响应幂等修复验收

Alex独立完整检查为**120/120通过**，包括本次10项专项，前后端类型与生产构建通过。#15关键回归冻结同一毫秒：不同真实新attempt的相同或不同payload均写入各自history；同一持久response中断重放不新增HTTP/response/history，保留原观测时间；注入标记写入异常时，当前资料、history和应用标记一起回滚。PM引用Alex实际测试，没有重复宣称亲测120项。

PM源码复核确认应用身份采用持久的`full_scan_responses.id`，不再只按App/类型/fetchedAt判断。`appliedResponseId`通过Store.saveEnrichment既有事务内的回调与资料/history一并提交，没有新增嵌套事务。真实两条恢复响应17837/17838与对应attempt、资料、history和应用标记均一致，旧历史没有被同时间判断吞掉。

因此#15满足不同真实响应独立保存、同响应幂等重放、时间/原资料保护及原子性要求，**允许CEO在发布证据与最终CI通过后关闭#15**。该缺陷来自离线快速恢复测试；真实运行的应用标记核对证明修复路径正常，不宣称线上此前确有数据丢失，也不声称本次真实恢复复现了同毫秒碰撞。

本次HTTP batch覆盖索引优化由Alex的EXPLAIN和独立性能记录验证，不改变范围或计数语义。其通过不能替代完整数据采集验收。

## 整体边界

第一项发现、详情分析与信贷入库仍已通过。第二项现在有已单独接受的六项Apple完全不可取失败，以及这两项BCA部分目录续页限制；这些是精确逐任务例外，不自动覆盖后续相同App在其他国家的失败。其他排队资料、评论分页和未解释异常继续执行，最终整体验收仍须固定分母、实际结果汇总、原数据/分类保护和运行恢复证据。**本报告不批准关闭#11或将PR #12视为整体任务完成。**

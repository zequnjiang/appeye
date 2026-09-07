# Google Play 开发者目录续页：Alex 独立回归

- 关联：[缺陷 #13](https://github.com/zequnjiang/appeye/issues/13)、[全扫描运营 #11](https://github.com/zequnjiang/appeye/issues/11)。
- **工程及真实恢复核查结论：通过。冻结实现已独立完成 `npm run check`，99/99 测试、0 失败/跳过，前后端严格类型、Vite 生产构建和服务端编译通过。**
- 基线：`7654d8c` 后 CTO 冻结的工作树；新增 `server/developer-continuation.ts`，以及 full-scan provider/runner/CLI 的相应边界。最终提交由 CEO 统一记录。
- 流转：CTO 已在 [自检报告](FULL-SCAN-CTO-SELF-CHECK.md) 正式交接，Alex 完成以下独立回归后交 CEO 受控恢复、PM 验收。
- 本报告包含工程、离线重放及后续真实恢复的独立核查；**不代表全量补充资料/评论已完成。** 第一阶段完整数据审计仍见 [FULL-SCAN-ALEX.md](FULL-SCAN-ALEX.md)。

## 已确认缺陷

真实批次 `finance-2026-09-07` 的 task602 / App57 / ar / google-play / developer，HTTP2769 首页面含20项，HTTP2770续页另含13项。后者使用紧凑容器 `[0][0]`，而安装 SDK 的 developer 续页读取 `[0][6]`，导致只输出首20项并产生 `developer-degraded`。

两条原 HTTP 已持久化；这是“已保存原响应但部分内容未结构化解析”的内部兼容问题，不能归为网络失败、自然目录结束或商店仅提供20项。修复只在识别出有效 qnKhOb 紧凑布局时生成 SDK 的内存解析输入，原始响应正文保持不变。未知布局仍显式留待复核。

## 确定性回归

新增 [developer-continuation.test.ts](../../tests/developer-continuation.test.ts) **7 项**测试，包含实际安装的维护版 SDK，所有请求均为注入的合成响应，不访问真实商店。

| 验证范围 | 结果 |
| --- | --- |
| 两种已知布局 | legacy 与 compact 都通过完整 SDK 链路读取合成初始20项+续页13项，输出33个不同ID，顺序正确、0 warnings、恰好2次注入请求，终止后无额外请求。 |
| 紧凑布局适配 | 仅目标 qnKhOb、旧容器缺失、有效行和token结构可转换；转换不改行字段，记录 fromPath/toPath、条数及原HTTP引用。legacy原字节不变。 |
| 未知/不合法结构 | 无关RPC、无效JSON/行/令牌容器、未知布局不被伪装为成功。空页仍有有效token也不转为SDK的假终止；无效续页通过SDK保留20项并产生明确warning。 |
| 原始证据 | journal正文与注入原body逐字相同；compatibility指向原 sourceHttpId/sourceFetchedAt，明确 originalHttpPreserved，非转换后正文。 |
| 只重试可修任务 | 当前batch、GP、developer、succeeded/developer-degraded、developer/cluster-page-parse告警，且**最新**qnKhOb原HTTP能被识别的任务才重排。相同任务“早页compact、末页未知”不重排。其他batch、search/review警告、独立失败及未知developer保持原状态和结果。 |
| 历史留存 | 显式重试后旧full_scan_responses、attempts、enrichment_history及HTTP逐字段不变；新增响应/历史另存，目录20→33。其他任务不被重复执行。 |
| 有限失败恢复 | 恢复尝试预算为2时只发起2次合成失败，历史attempt序号保留为1/2/3；最终failed、无pending，前次成功目录和lastSuccessAt保持，旧成功响应不删除。 |

这次修复不改变目录排序或新增跨页去重算法。33个唯一ID是本次夹具和真实保存响应的实际结果，不能推断所有开发者目录都不会有重复项。

## 已保存真实响应的独立离线重放

Alex 于 **2026-09-06T18:31:18.842Z** 使用 SQLite `readOnly:true` 读取 task602 与 HTTP2769/2770，随后关闭数据库，将这两条保存的原响应注入当前 provider 与实际 SDK。禁止发起额外网络请求，未写生产库、未操作服务。

| 项目 | 独立结果 |
| --- | --- |
| 原来源时间 | HTTP2769：2026-09-06T18:24:11.703Z；HTTP2770：2026-09-06T18:24:12.203Z。 |
| 结果 | 20→33项，33个唯一appId，0 warnings。 |
| 前20项 | JSON持久字段与旧task成功响应逐项完全相同。 |
| 原HTTP | 两条body逐字节相同；原SHA-256写入本地摘要。 |
| 适配证据 | 仅一次适配，指向原HTTP2770。 |
| 外部副作用 | 额外真实网络0、真实库写入0；只在内存中解析。 |

可复核脚本为本地忽略目录 `.artifacts/alex-developer-replay.ts`；聚合证据为 `data/batches/finance-2026-09-07-alex-developer-replay.json`。完整HTML、游标和目录原文未复制到Git。重放沿用过去观测，不能当成新一次市场采集或用重放时刻改写真实fetchedAt。

## 受控真实恢复的独立核查

CEO完成runtime-3受控重启并显式恢复告警任务后，Alex于 **2026-09-06T18:35:31.989Z** 使用单个SQLite只读事务核对，errorCount=0。未改生产代码/数据库、未发额外真实网络、未重跑99项工程测试。

- runtime-3保存于18:34:22.835Z，五个运行文件SHA-256全部相符；恢复前快照只有task602一项developer告警。当前batch中带recoveryAttemptBase的任务也**只有task602**，base=1，与CLI记录的重排1项一致。
- task602为attempt2 succeeded、stop_reason=NULL、目录33项/33个唯一ID、warnings=[]。原attempt1（id7134）完整保留；新attempt2（id8846）另存，没有重置或覆盖原尝试。
- 原20项带告警响应及enrichment_history仍对应 **18:24:12.394Z**；新33项响应及history对应 **18:34:31.528Z**。旧/新历史data、raw分别与各自完整任务响应逐字段一致；当前目录与新响应一致，lastAttemptAt和lastSuccessAt均指向新观测，country=ar、language=es、error为空。
- 原HTTP2769/2770均仍在，所属batch/task、状态200、原获取时间保持；SHA-256与先前离线摘要逐一完全相同。
- 新HTTP3776/3777均200且归属同batch/task；获取时间分别为 **18:34:30.568Z / 18:34:31.328Z**。compatibility唯一一条记录明确适配13项、fromPath0.0→toPath0.6、sourceHttpId3777、sourceFetchedAt18:34:31.328Z、originalHttpPreserved=true。新任务观测时间晚于源HTTP获取时间，二者没有混淆。

只读审计脚本：`.artifacts/alex-developer-recovery-audit.mjs`；脱敏聚合：`data/batches/finance-2026-09-07-alex-developer-recovery-audit.json`。本节仅确认这次单项修复真实闭环；其他继续运行的普通任务不属于此次显式developer告警重排范围。

## 恢复与验收边界

**工程、离线解析及真实单项恢复均已通过Alex核查，交PM对缺陷#13最终验收。** 真实新attempt、33项目录、compatibility引用、旧历史及原HTTP完整保留已核对。未知布局、循环等其他告警不能随此补丁清零或误写成自然结束。

本报告不关闭整体运营 #11，也不替代PM最终验收。固定2,024个App的七类补充和评论流仍按原执行清单继续。

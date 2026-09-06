# 扫描统计索引：Alex 独立回归

- 关联：[优化 #17](https://github.com/zequnjiang/appeye/issues/17)、[采集 #11](https://github.com/zequnjiang/appeye/issues/11)、[PM 验收标准](../requirements/SCAN-SUMMARY-INDEX.md)、[CTO 自检](SCAN-SUMMARY-INDEX-CTO.md)。
- 工程基线：`6a632a3` 加本次单索引 DDL 和测试；最终部署提交由 CEO 记录。日期为 2026-09-07（北京时间），测量时间使用 UTC。
- 当前结论：独立 `npm run check` **136 / 136 测试通过**，前后端类型检查、Vite 生产构建、服务端编译及迁移复制通过。工程范围通过，实际部署与性能证据待下面追加；不是评论全集或 #11 整体验收。

## 独立验证

新增 `tests/scan-summary-index.test.ts` 的 4 项测试全部通过，均使用内存或临时合成 SQLite，不访问生产或商店。

| AC | 验证 | 结果 |
| --- | --- | --- |
| SSI-01 | 三个 batch（包含空 batch）、不同 kind/status、null result、缺字段、零值；失败 / 排队 / 其他 kind / 其他 batch 的大值不混入成功评论 SUM；索引前后直接调用原 `runner.summary()`，全部字段与类型深比较 | 通过 |
| SSI-01/03 | 原 counts / reasons / SUM 的 EXPLAIN 均使用 `COVERING INDEX full_scan_summary_covering`；状态和 result 的真实写入后统计反映新值 | 通过 |
| SSI-02/05 | 全部业务表在添加索引、重复初始化及文件重开后逐字段不变；同名索引只有一个，人工 excluded / override 保留 | 通过 |
| SSI-02 | 真实 `--status` CLI 读取缺少新索引的旧批次，数据库文件字节完全不变，索引仍不存在 | 通过 |
| SSI-02/04 | 合成旧库含非法 JSON 时明确建索引失败，原数据不变且没有虚假已建索引 | 通过 |

旧 #15 原子回滚测试使用了非 JSON 临时 marker，本次改为 `JSON.stringify({ syntheticMarker: true })`。仍在写 marker 后主动抛出原中断异常，并验证 current / history / result 同时回滚；相关 10 项回归全部通过。业务代码没有为夹具放宽 JSON 或吞错。新增测试准备时另修正了一个括号笔误，以及补齐合成 app 的 `storeData`，以避免既有启动补齐逻辑影响纯索引重开对照；不是生产缺陷。

源码审阅确认服务端只增加 3 行 DDL，未修改原统计 SQL、summary 调用频率、分页、轮转、限速、任务重排或 CLI。覆盖索引不含大的 response；`reasons` 仍出现临时 B-tree 分组，不能称为消除了所有排序。索引仍有插入及 status/result 更新时的维护成本。

## 性能证据边界

Alex 的 13 行固定合成数据中，五次完整 `runner.summary()` 调用：索引前约 **0.068–0.093ms**，后约 **0.066–0.082ms**。这些差异是小数据下的噪声，不据此宣称提速。测试只断言统计等值与覆盖计划，没有脆弱的速度阈值。

CTO 的隔离大载荷基准使用 29,496 行真实 metadata，另添加 375MiB 明确标注的合成 response；SUM 约 53–62ms → 0.31ms，reasons 约 19ms → 1.9ms。该结果及索引大小 / 构建耗时在 [CTO 报告](SCAN-SUMMARY-INDEX-CTO.md) 中，由 CTO 执行。本报告引用而不冒称重新测量；其中三项查询合计不是完整 summary，更不是生产吞吐或整体采集速度。

## 受控部署的证据准备

为避免再次解码约 80 万条真实评论，准备了 ignored `.artifacts/alex-index-page-checkpoint.py`。它仅在 writer 停止且无非空 WAL 时运行，通过 SQLite `dbstat` 枚举所有旧业务表页、overflow 页和已有索引页，再顺序读取主文件作 SHA256。索引 DDL 后，同一旧对象的 root / SQL / 页数 / 页号与页内容哈希必须全等；只允许新增 `full_scan_summary_covering`。数据库 header、`sqlite_schema` 及新增索引页属于预期变化，不与旧数据混淆。

脚本不解码业务 JSON、不联网、不写生产。会拒绝非空 WAL、读取期间主文件变化、重复覆盖 before 文件及 runtime-6 路径。默认新前缀为 `data/batches/finance-2026-09-07-alex-runtime-7-index`，保留所有 runtime-6 证据。所需步骤为停止原 writer → capture → 唯一维护 writer 调用当前源码的 `ensureFullScanSchema` 并正常 close → verify / 同冻结状态统计与计划 → 恢复原采集。

独立合成烟测 `.artifacts/alex-index-page-checkpoint-smoke.py` 已通过：覆盖 **178** 个业务 / overflow 页及 **2** 个原索引；只建新索引时全部旧页不变，故意修改评论内容可检测，非空 WAL 与 before 覆盖均被拒绝。临时库运行后删除。这里只证明校验方法可用，实际部署页哈希与真实耗时尚待 CEO 的受控停止点产生并由 Alex 复核。

当前没有生产性能提升声明。实际部署后将追加统计等值、旧页保持、实际计划 / 时间和单 writer 恢复证据，再交 PM 作局部验收；不因此终止尚未完成的评论采集。

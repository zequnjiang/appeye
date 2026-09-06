# 扫描统计覆盖索引：CTO 自检

- 关联：[优化 #17](https://github.com/zequnjiang/appeye/issues/17)、[采集 #11](https://github.com/zequnjiang/appeye/issues/11)、[PM 验收标准](../requirements/SCAN-SUMMARY-INDEX.md)。
- 日期：2026-09-07（北京时间）；测量时刻以下统一使用 UTC。
- 当前阶段：CTO 自检完成、源码冻结并交 Alex 最终独立回归；待 CEO 受控部署。本文不声称已提升生产采集速度。

## 变更范围

仅在 `ensureFullScanSchema()` 现有初始化入口追加一条幂等 DDL：

```sql
CREATE INDEX IF NOT EXISTS full_scan_summary_covering ON full_scan_tasks(
  batch_id,kind,status,stop_reason,
  json_extract(result,'$.added'),json_extract(result,'$.updated')
);
```

原统计 SQL、字段及类型、分页/轮转、限速、每页发布 summary 的频率、队列、分类、CLI 和只读 `--status` 路径均未更改。没有新增计数器或数据迁移，没有操作生产 writer。

索引直接存两个 JSON 表达式的值，避免求和时读取大 `response` 后面的完整 `result`，也避免在索引中重复保存 result 中的来源/游标等字符串。`counts`、`reasons`、`reviewWrites` 在 SQLite 3.51.3 的实际计划均使用覆盖索引。`reasons` 仍可能使用临时 B-tree 做分组，不声称消除全部排序。

表达式要求非 null 的 `result` 是有效 JSON。错误 JSON 将明确导致 DDL/写入失败，没有跳过坏数据的逻辑。隔离基准的 29,496 行真实 metadata 成功建索引；另在 `2026-09-06T21:13:00.185Z–21:13:01.383Z` 对生产全表只读检查：**29,635** 个任务、**28,944** 个非 null result、**0** 非法 JSON。该检查覆盖当时全部 batch，耗时 1,197.808ms，未修改数据。

## 真实只读诊断

`2026-09-06T21:08:51Z`，Node SQLite 3.51.3、4KiB page、默认 2MiB SQLite cache；生产仍有单个 collector 活动。按 runner 原 SQL 连续两轮独立查询，数据可能在两轮间增长，没有将不同轮统计当作等值证明。

| 原查询 | 首轮 ms | 第二轮 ms | 当时主要计划 |
| --- | ---: | ---: | --- |
| counts | 5.217 | 5.533 | 原 app/pages 覆盖索引，另行分组 |
| reasons | 54.360 | 117.404 | batch 唯一索引 + 读任务表 |
| reviewWrites SUM | 291.821 | 158.927 | task_queue 非覆盖索引 + 读任务表 |
| review_seen count | 16.206 | 25.869 | 原覆盖索引 |
| HTTP count | 0.471 | 0.431 | 原 HTTP batch 覆盖索引 |
| **全部 11 项 summary SQL 合计** | **373.469** | **316.632** | 包括其余 pending/deferred/failures/candidates/sourceRows/nextRunAt |

另对 `21:07:33.156Z–21:09:52.661Z` 的最近 **240** 个成功评论 attempt 及对应 HTTP 时间只读检查（取元数据查询约22ms）：

| 区间 | 中位 ms | P95 ms | 解释 |
| --- | ---: | ---: | --- |
| HTTP 请求开始 → response 可用 | 264 | 504 | 含网络、读 body、HTTP 落账、校验与 SDK 解析，不能称纯网络时延 |
| response 可用 → attempt finished | 26 | 33 | 含响应、评论、seen、检查点等本地处理 |
| 上一 attempt finished → 下一 attempt started | 229 | 248 | 含 summary、报告写盘、取任务与 claim 等，不等于纯 summary 时间 |

这一窗口约 1.72 页/秒；稳定本地开销和来源等待同时存在，不能宣称全部慢速由 summary 引起。最大页间间隙 471ms 与本次只读基准时段重合，也不将受诊断 I/O 影响的该点当作日常值。另一个 315 页只读大小样本中 response 中位 165,287 bytes、P95 376,398 bytes，支持使用大载荷隔离库验证。

## 固定隔离基准

可复现脚本为 ignored `.artifacts/cto-summary-index-bench.mjs`，聚合证据为 `data/batches/finance-2026-09-07-cto-summary-index-bench.json`。测量时间 `21:11:23.449Z–21:11:27.872Z`。从单个只读事务冻结 **29,496** 行真实任务 metadata；不复制真实 response 内容，为其中 **2,000** 行添加每行 **192KiB** 合成载荷（共 **375MiB**），保留大 response 位于统计列之前的存储布局。隔离库使用 WAL/FULL，查询缓存设置与上面相同。

| 隔离配置 | counts 三轮 ms | reasons 三轮 ms | SUM 三轮 ms |
| --- | --- | --- | --- |
| 既有索引 | 4.896 / 4.591 / 4.834 | 19.941 / 19.177 / 19.300 | 52.954 / 61.777 / 53.287 |
| 完整 result 覆盖索引（未采用） | 2.067 / 1.981 / 2.030 | 2.905 / 3.147 / 3.276 | 4.055 / 4.112 / 4.055 |
| **采用的表达式覆盖索引** | **0.971 / 1.009 / 1.028** | **1.897 / 1.930 / 1.954** | **0.315 / 0.316 / 0.309** |

这里是受影响的三项查询，**不是完整 summary 合计**；三项原合计 77.791 / 85.545 / 77.421ms，表达式索引后 3.183 / 3.255 / 3.291ms。其余 summary 查询未改变。三项全部统计逐值排序后 SHA256 全等，重新打开持久隔离库的原 SQL 结果也一致。

表达式索引占用 **1,617,920 bytes**、构建 **74.367ms**；完整 result 索引为 **9,908,224 bytes / 88.886ms**。这只是固定隔离数据，不是预计生产构建时间/索引大小。每种配置各 20 次含运行/成功状态及 result 写入的事务周期，均值原1.023ms、表达式0.595ms；受顺序与缓存影响，只能报告未见明显写入退化，不能说索引使写入更快。新索引仍有正常 B-tree 维护成本。

隔离大库和临时 metadata/result 已删除；仅保留脚本与不含评论、作者、游标的聚合证据。0 真实网络请求、0 生产数据库写入。

补充完整调用层证据：Alex 的固定小型多 batch 夹具对原 `runner.summary()` 全字段比较，并测量五次完整调用，索引前约0.068–0.093ms、索引后约0.066–0.082ms；这是小数据下的噪声范围，不声称提速。该组用于说明完整调用未退化及结果一致，与上表375MiB载荷下的目标查询基准分开。

## 自检与交接

- 最终 `npm run check` 通过：**136/136 测试、前后端 typecheck、Vite 构建、server TypeScript 构建及 migrations copy**。日志为 ignored `.artifacts/cto-summary-index-check.log`，包含原132项及本次4项有行为意义的回归。
- 内存库中三个固定 batch（含空 batch）、多个 kind/status，成功 result 缺字段、零值、SQL null，以及失败/排队中较大计数不进入成功 SUM 的行为均通过。创建索引前后直接调用原 `runner.summary()` 的全部字段/类型/值完全一致。
- 连续两次 `ensureFullScanSchema()` 后同名索引恰好一个；SUM 的 EXPLAIN 明确使用 `COVERING INDEX full_scan_summary_covering`。
- 首次完整回归发现旧 #15 原子回滚测试暂存非 JSON 的 `synthetic-marker`。新索引会在主动中断之前拒绝该非法值；Alex 已将夹具标记改为有效 JSON，继续保留原主动中断、数据/history/result 全回滚断言，10项该组测试全部通过，没有更改业务实现。
- 新增 `tests/scan-summary-index.test.ts` 4项已在上述完整自检通过：多 batch 全统计等值与三个查询覆盖计划；全部业务表在 DDL/重复初始化/文件重开后逐字段保持；真实 CLI status 对旧无索引库保持字节不变且不建索引；非法 JSON 明确失败且不改数据。Alex 最终独立检查及部署后证据另见其报告。

部署前不得把隔离结果称为生产加速。真实 DDL、版本/检查点标识、单 writer 停止/恢复及部署后计划与耗时由 CEO 统一执行，Alex 核查旧证据保持后交 PM 验收。本项通过也不代表全部评论或 #11 完成。

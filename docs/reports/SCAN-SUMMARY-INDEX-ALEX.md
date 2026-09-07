# 扫描统计索引：Alex 独立回归

- 关联：[优化 #17](https://github.com/zequnjiang/appeye/issues/17)、[采集 #11](https://github.com/zequnjiang/appeye/issues/11)、[PM 验收标准](../requirements/SCAN-SUMMARY-INDEX.md)、[CTO 自检](SCAN-SUMMARY-INDEX-CTO.md)。
- 工程及部署基线：`52cd7a8`（`52cd7a85e53ecfb548b1d314bfa11306b8945980`），此前需求基线为 `6a632a3`。日期为 2026-09-07（北京时间），测量时间使用 UTC。
- 当前结论：独立 `npm run check` **136 / 136 测试通过**，前后端类型检查、Vite 生产构建、服务端编译及迁移复制通过。工程与实际部署 QA 通过，交 PM 局部验收；不是评论全集或 #11 整体验收。

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

独立合成烟测 `.artifacts/alex-index-page-checkpoint-smoke.py` 已通过：覆盖 **178** 个业务 / overflow 页及 **2** 个原索引；只建新索引时全部旧页不变，故意修改评论内容可检测，非空 WAL 与 before 覆盖均被拒绝。临时库运行后删除。下节记录 CEO 在受控停止点运行该校验器后的实际证据与 Alex 独立复核；Alex 没有重复扫描同一 12.75GB 数据库。

## 实际部署与独立复核

CEO 于 `2026-09-06T21:21:12.592Z` 正常停止 runtime-6（PID 29629），确认锁释放及 WAL 无待合并内容。维护程序 `.artifacts/runtime7-summary-index.ts` 从当前 `summary()` 精确提取 11 个原 SQL，只用唯一的 `DatabaseSync + ensureFullScanSchema` writer 建索引，未运行 `createStore` 的其他补齐逻辑或普通 worker。`52cd7a8` 的 [CI 34060805946](https://github.com/zequnjiang/appeye/actions/runs/34060805946) 成功由 CEO 提供；Alex 的本地独立 136 项检查见前文。

Alex 独立阅读维护程序及保存的 before / build / after 文件，重新比对 SQL 定义和当前、原 runtime-6 的整个 `summary()` 源码片段，逐字一致；10 个 runtime 文件哈希匹配。所有 11 个查询在前后三轮、共六轮的结果、字段及类型完全相同，未仅采用报告内的布尔结论。停止点仍为 8,826 个成功评论页、653 个待处理页、857,498 个 seen 身份及原 12 个补充失败。

| 实际证据 | 时间（UTC） | 结果 |
| --- | --- | --- |
| 原页 capture（CEO 执行 Alex 校验器） | `21:21:16–21:22:01` | 顺序读取 12,749,983,744 bytes，45.446 秒；不解码业务 JSON |
| 维护 writer 建索引 | `21:24:20.990–21:24:21.537` | DDL 543.875ms；新增索引 404 页 / 1,654,784 bytes，复用原 40 个空闲页；checkpoint busy/log 均为 0 |
| 原页 verify（CEO 执行 Alex 校验器） | `21:24:28–21:25:14` | 45.447 秒；全部 20 张旧表的 3,063,971 个页、26 个旧索引的 48,773 个页及定义全等，0 异常；唯一新增对象为目标索引 |
| Alex 独立比对上述产物 | `21:26:56.246` 完成 | 重新深比较每个旧对象的 root / SQL / 页数 / 页号及内容 SHA256，全部一致；不重复 12GB 物理读取 |

这些旧业务表页包含 task、attempt、response、HTTP、review 身份 / raw / fetchedAt、seen 和人工分类，物理等值覆盖索引 DDL 期间的旧数据保持。header、`sqlite_schema`、原空闲页和新增索引页的预期变化与旧业务数据分开记录。准备阶段两轮 20–60 秒只是估算，实际两轮约 **90.893 秒**，本报告采用实测。

真实停止点的三轮 SQL 合计如下，均为 **11 项 SQL 的执行耗时之和**，不包括完整采集流程、网络或磁盘报告写入：

| 同冻结状态 | 第一轮 ms | 第二轮 ms | 第三轮 ms |
| --- | ---: | ---: | ---: |
| 索引前，`21:24:09.291–21:24:15.530` | 3,835.103 | 2,009.202 | 369.658 |
| 索引后，`21:24:25.242–21:24:25.670` | 361.129 | 32.009 | 26.063 |

索引后 counts / reasons / SUM 均采用覆盖索引；SUM 三轮 0.388 / 0.412 / 0.395ms，reasons 2.011 / 1.963 / 1.908ms，仍有临时分组。顺序测量经历完整文件读取、SQL、建索引，OS 与 SQLite 缓存热度不同；第一轮中的其他未改查询也明显波动。因此可以确认统计等值、访问计划改善及记录的实际耗时，**不能计算整体采集吞吐的提速倍数，也不能将全部耗时变化只归因于索引**。

## 实际恢复检查

Alex 在 writer 仍 paused / 0 running 时，于 `21:25:27.061Z` 只读保存轻量 checkpoint：全部 8,826 个旧成功 review ID，653 个 queued task 的 app / page / payload 哈希 / cursor 哈希 / attempts，以及 attempt 高水位 29,787。没有复制评论正文，也没有重新解析全库评论。CEO 于 `21:25:35.538Z` 恢复 runtime-7（PID 35101），仍为原 batch / serve / delay 命令，没有 retry flag。

`21:26:56.046–21:26:56.245Z`，Alex 独立只读复核：

- 8,826 个旧成功页仍全部 succeeded，高水位后的新 attempt 中没有任何旧成功 ID；没有成功页重抓。
- 653 个原待处理页的 app、页码、完整 payload 哈希保持，因而原游标和语言参数保持；其中 150 页已成功、1 页运行中。
- 151 个新 attempt 全部为 reviews，均从原 queued 集合继续；首项 attempt 29,788 / task 29,648 / page 10，实际开始时间 `21:25:36.397Z`。该时点尚未开始新增 successor 的 attempt，不虚称已经验证其抓取完成。
- 原 29,787 条 attempt 仍在；锁指向 PID 35101。总体为 8,976 个成功评论页、596 queued、1 running，评论最终失败仍为 0，原 12 个补充失败保留。

独立复核脚本及摘要：`.artifacts/alex-summary-index-deployment-review.mjs`、`data/batches/finance-2026-09-07-alex-runtime-7-deployment-review.json`。摘要记录所有输入产物 SHA256，明确物理读取由 CEO 执行、逐对象产物比对与恢复查询由 Alex 执行。轻量基线为 `finance-2026-09-07-alex-runtime-7-checkpoints-before.json`；物理证据使用独立 runtime-7 前缀，runtime-6 文件未覆盖。

#17 的工程及实际部署 QA 通过，交 PM 局部验收。新页可以按真实新来源更新旧评论，其最终 raw / 获取时间对应关系仍在完整评论审计中核实；没有把持续运行中的评论采集或 #11 标为整体完成。

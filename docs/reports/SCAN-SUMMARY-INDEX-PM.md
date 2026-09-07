# 扫描统计索引：PM局部验收

- 结论：**SSI-01至07通过；#17工程、统计等值、受控建索引及原检查点续跑验收通过。CEO发布本报告并确认最终CI后可关闭#17；#11和PR #12整体仍未完成。**
- 关联：[优化 #17](https://github.com/zequnjiang/appeye/issues/17)、[采集 #11](https://github.com/zequnjiang/appeye/issues/11)、[本次AC](../requirements/SCAN-SUMMARY-INDEX.md)。角色交接：[CTO自检/实测](SCAN-SUMMARY-INDEX-CTO.md) → [Alex独立回归/部署核查](SCAN-SUMMARY-INDEX-ALEX.md) → PM。
- 验收代码：`52cd7a85e53ecfb548b1d314bfa11306b8945980`，runtime-7；CEO已提供该提交[CI 34060805946成功](https://github.com/zequnjiang/appeye/actions/runs/34060805946)。本文日期为北京时间2026-09-07，以下时刻均为UTC的2026-09-06。
- PM未改业务源码、真实库或任务，未重建索引、重启worker、重新执行12GB物理扫描或发出商店请求。

## 实现与工程判断

PM独立查看提交差异，服务端仅新增3行幂等索引DDL：`full_scan_summary_covering`依次包含batch_id、kind、status、stop_reason及result内added/updated的JSON表达式。原统计SQL、summary调用频率、计数含义、分页/轮转/限速、任务队列和CLI均未改变，没有另设缓存计数器。索引不复制大的response字段。

Alex独立完整检查**136/136测试通过**，前后端类型及生产构建通过；本次4项有行为意义的回归覆盖三个batch（含空batch）的原summary全字段等值、JSON缺项/null/零值、失败和排队不混入成功SUM、索引幂等重开、全部业务表保持，以及真实只读`--status`不创建索引或改文件。非法result JSON使DDL明确失败而不改原数据；真实维护前全部30,300个任务中29,635个非null result、0非法JSON。

旧#15测试仅将临时非JSON marker改为合法JSON，继续主动抛出原异常并核对事务原子回滚，未改业务容错逻辑。PM依赖Alex正式测试结果，没有冒称亲自重复运行136项。表达式索引有正常维护成本，reasons仍使用临时分组B-tree，不宣称无排序或无写入成本。

## 冻结等值与旧数据保持

CEO于21:21:12.592Z正常停止runtime-6，确认锁释放、WAL无待合并内容；按Alex提供的物理校验器先capture旧对象，再由唯一维护writer调用`ensureFullScanSchema`建索引，随后verify与统计对照。未调用会做其他补齐的createStore，也未启动普通worker。21:25:35.538Z以PID35101恢复原batch、serve、delay命令，无retry flag；暂停约4分23秒包含证据核查和准备，不能把它写成543.875ms的DDL耗时。

PM于**21:27:12.830Z**独立读取并逐项比较保存产物：

| 固定状态检查 | 结果 |
| --- | --- |
| 原11项统计 | before/after全部字段、类型和值完全一致；前后各三轮、共66个查询结果及其SQL定义逐一一致，不只读取statisticsDeepEqual布尔值。 |
| 固定分母 | 8,826个成功评论页、653待处理、857,498个seen、830,632 added/27,015 updated、19,811 HTTP及原12补充失败保持。seen、写入次数和全库评论总数不能互换。 |
| 原20张业务表 | root、SQL、3,063,971个页的页号/内容组合摘要全等，含overflow，覆盖task/attempt/response/HTTP/review/raw/fetchedAt/seen/分类等原数据。 |
| 原26个索引 | 定义、root、48,773个页的页号/内容组合摘要全等。 |
| 唯一新增对象 | `full_scan_summary_covering`，404页、1,654,784 bytes；其中复用原40个空闲页。 |
| 实际DDL | 21:24:20.990–21:24:21.537Z，543.875ms；正常close/checkpoint，busy/log/checkpointed均0。 |
| 运行代码 | runtime-7记录的10个文件SHA-256与当前文件一致。 |

原物理capture/verify由CEO在停止点运行Alex校验器，各约45.446/45.447秒；Alex与PM分别深比较已保存的每个对象和哈希，**没有再次读取12.75GB主文件**。header、sqlite_schema、原空闲页及新增索引页属于预期变化，未用整个数据库字节不变来否定正常DDL。此证据证明索引维护时旧业务数据保持，不代替后续所有新评论的最终来源审计。

PM冻结比较摘要为`.artifacts/pm-summary-index-frozen.json`，errorCount=0。输入为`data/batches/finance-2026-09-07-runtime7-summary-index-{before,build,after}.json`、`finance-2026-09-07-alex-runtime-7-index-{before,after}.json`及runtime-7记录；真实资料留在忽略目录。

## 性能结论与边界

隔离证据来自CTO：29,496行真实metadata加375MiB明确合成response，目标SUM三轮约52.954/61.777/53.287ms降为0.315/0.316/0.309ms，reasons约19ms降为1.9ms；三项目标查询合计不等于完整summary。Alex小夹具的完整summary约0.07ms、前后差异在噪声范围，仅用于等值和调用验证。两者均与以下真实停止点测量分开。

同一实际冻结状态、相同原SQL，由CEO维护工具记录：

| 实际SQL耗时ms（第1/2/3轮） | 索引前 | 索引后 |
| --- | --- | --- |
| counts | 4.732 / 21.323 / 5.801 | 1.224 / 1.230 / 1.201 |
| reasons | 2,180.142 / 1,358.467 / 77.105 | 2.011 / 1.963 / 1.908 |
| reviewWrites SUM | 1,283.392 / 293.101 / 253.637 | 0.388 / 0.412 / 0.395 |
| 全部11条SQL之和 | 3,835.103 / 2,009.202 / 369.658 | 361.129 / 32.009 / 26.063 |

索引前测量为21:24:09.291–21:24:15.530Z，后为21:24:25.242–21:24:25.670Z。三个目标查询在每轮after均采用覆盖索引，计划改善可证。顺序操作经历文件扫描、SQL和建索引，缓存热度不同；未修改的candidates/seen也在首轮波动。**可确认统计等值、访问计划改善及这些实际耗时，不计算整体采集吞吐加速倍数，不认定全部慢速由本地统计造成。** SQL之和不包含网络、完整页处理或报告写盘。

## 续跑独立复核

Alex在21:26:56.046–21:26:56.245Z核对：原8,826成功页无新attempt，653个原queued的app/page/完整payload哈希不变，151个新attempt均来自原queued，其中150成功、1running；旧29,787个attempt记录仍在，PID35101。正式证据为`data/batches/finance-2026-09-07-alex-runtime-7-deployment-review.json`及`finance-2026-09-07-alex-runtime-7-checkpoints-before.json`。

PM于**21:28:16.190–21:28:16.500Z**另开只读事务复核：

- 全部8,826个旧成功页仍succeeded，无旧成功页重试；653个原待处理页身份、页码、完整payload哈希和原尝试基数保持，其中303成功、1running。
- 高水位29,787之后有304个新attempt，全是reviews并来自原queued；首项仍为attempt29788/task29648/page10、21:25:36.397Z。此快照尚无新建后继页的attempt，不声称已经验证其抓取完成。
- 原29,787条attempt仍在；目标索引恰好一个且定义正确；counts/reasons/SUM当前EXPLAIN仍采用覆盖索引，reasons仍有临时分组。
- 七个部署证据文件的SHA与Alex记录一致，10个运行文件指纹一致；锁仍PID35101；原474个App所有基线字段及国家配置差异0。

PM自身结果为`.artifacts/pm-summary-index-resume.json`，errorCount=0。没有新增生产基准或物理扫描。该时点评论9,129页succeeded、549 queued、1 running；这是阶段页任务数，不能据此判断全部评论已结束。

## SSI逐项结论

| 条件 | 验收结果 |
| --- | --- |
| SSI-01 完全等值 | 通过：三batch fixture及真实固定状态11字段/六轮结果/原SQL全部一致，无第二套计数器。 |
| SSI-02 仅必要索引 | 通过：唯一幂等DDL，summary及采集行为不改；真实只读CLI不写的独立测试通过。 |
| SSI-03 隔离性能 | 通过：合成大载荷、完整小夹具、计划/结果/重复耗时与索引大小分别记录，不混称生产结果。 |
| SSI-04 受控部署 | 通过：停止点单维护writer、构建/校验/正常关闭、原batch单writer恢复；非法JSON失败行为明确。 |
| SSI-05 数据恢复 | 通过：所有旧业务/overflow/索引页保持，原成功页无重试，原queued游标与上下文保持，实际新attempt继续。 |
| SSI-06 性能表达 | 通过：真实三轮逐一报告，缓存与不同采集时间范围明确，未声称网络或整体吞吐按相同比例提速。 |
| SSI-07 角色交接 | 通过：CTO→Alex工程/实际部署→PM冻结与运行复核齐备，#17可局部关闭；整体#11继续。 |

全部可分页评论的来源/数据终态审计、原数据最终保护及原运行设置恢复仍待完成。索引优化通过不会缩减这些义务，也不把本轮已接受的12项Apple资料失败或2项GP部分目录改成完整成功。

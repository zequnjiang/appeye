# 2026-09-20 开放 Issue：后端实现与自检

- 角色：CEO 承担后端实现，自检与 Alex 独立验证分开；分支 `codex/open-issues-20260920`。
- 对应需求：[本轮 PM Ready](../requirements/OPEN-ISSUES-20260920.md)，[工作流](../workflow.md)。
- 交接范围：#27/#41 API、#32/#45 证据抽取与受控旧分析修复、#47 冻结 CSV。UI 和关联续页适配有独立 CTO 报告。

## 实现

| Issue / AC | 行为与边界 |
| --- | --- |
| #27 OI27-01 | `/api/jobs`及单任务读取按 `app_id + country + store` 联接名称和商店 ID。不存在或错误市场关联返回 null；不借其它市场补身份。原筛选、分页、任务进度及重试流程不变。 |
| #41 OI41-01/02 | 最近失败按实际 `finished_at` 排列，返回 failedAt、cycleId、cycleDueAt、cycleStartedAt，明确 recent-cross-cycle 与20条范围；当前周期总数单独统计。时间缺失仍为 null，不从当前周期推算。 |
| #32 OI32-01/02 | 百分比区间整体抽取（含各类连接符和中文“到/至”），同时保存 numericMin/Max；明确“最高”字段才以区间上限给出 numericValue。一般区间没有虚构单值；APR/普通利率、费用、周期仍独立绑定。括号中重复区间不截断其年度上下文，offset仍对应原文。 |
| #45 OI45-01/02 | 基于当前语句、最近储蓄/借款语境及明确APY/收益接受对象区分储蓄收益，保存为 non-loan/savingsYield、权重0，不贡献贷款利率证据家族。混合产品的其它贷款APR仍独立保留。 |
| #32/#45 OI32-03/OI45-03 | 识别版本升为 heuristics-3；提供 `scripts/refresh-loan-evidence.ts --apply` 单写者锁保护维护入口，零网络请求，原分析与新分析原子写入本地审计，幂等。原观测时间未知保持未知；若旧分析绑定旧快照，则用原快照而非当前描述。缺原快照时保留旧分析、报告未修身份。只修改分析字段，分类/manual/legacy、首次发现、快照、HTTP、评论、私有引用不改。正式执行及目标样本复验另在发布记录中确认。 |
| #47 OI47-01/02 | 保留旧 category 兼容列（原本即信贷细分类），添加 loanCategory、loanCategoryLabel、loanCategorySource。取同一已授权冻结全集；不知道分类时输出 unknown/待细分，客户与平台仍遵守session/query/expiry/撤权检查。Apple安装缺失、0、CSV公式防护及快照时间不变。 |

## 自检

2026-09-20，在当前实现上：

- `npx tsx --test tests/open-issues-backend.test.ts tests/v02-identification.test.ts tests/hourly-market.test.ts tests/research-workspace.test.ts tests/api.test.ts`：**50/50通过、0跳过**，耗时1.900秒，原输出本地 `.artifacts/issues-20260920/ceo-backend-tests.log`。
- `npx tsc --noEmit -p tsconfig.server.json`：退出0。
- 新增测试覆盖范围/相邻字段、六国原识别回归、保存分析维护幂等与历史保护、任务身份、跨周期分母、冻结全集 CSV/缺值/0/公式。
- Alex 早期独立边界指出中文连接符、APY后置语境、括号年度说明，以及未知来源时间填充问题；现均修正。其独立测试和最终结论见 Alex 报告，本自检不替代独立验收。

## 真实样本与正式运维区分

只读从正式库提取所有3,561项当前应用和8个目标身份的有限历史，在隔离样本中已运行新规则：3,561项分析更新、0缺原始来源，原分类不变，无商店HTTP。样本含112快照/201变化/56补充、80手动任务；不包含客户账号或私有研究，不是完整备份/全量评论审计。样本与正式执行、真实上游成功分开记录。

#11另使用现有已验收CLI维护：停止唯一正式服务、checkpoint后建立107,005,800,448字节独立APFS完整备份（0600），165个指定评论网络失败任务重新获有限尝试预算。原2024成员、应用身份与分类、HTTP/response高水位及游标/累计尝试保留；retry-only没有网络请求。恢复后的结果及可关闭性由运营报告/Alex/PM判定，不能因重排成功称扫描完成。

## 后续交接

交 Alex 进行独立API/浏览器/真实样本验证；完成最终构建与总回归后再发布。既有正式分析需在备份及唯一服务停机保护下执行受控修复，并核对 PK/Apple1227725092、PK/GP pk.com.telenor.phoenix、PH/Apple991673877实际保存结果。#11真实源终点、#24上游兼容及各页面验收不由此报告提前放行。

## PM 预审补修：完整历史隐私来源

PM 发现 #46 的最后补充值在后续成功 empty 时会被清空，但历史成功记录仍在。保持原 AC：详情 API 新增 `historicalPrivacy`，从同 app、同请求国家的 available privacy 历史中按观测时间倒序选取最近安全 HTTP(S) 链接，附原始时间、来源、历史 ID；危险/非法链接跳过并继续查更早记录。不读取无关原响应，不改当前隐私字段或历史。

补修自检：`npx tsx --test tests/open-issues-backend.test.ts` **6/6 通过（541.8ms）**；覆盖 available→empty→危险 URL→错市场后仍返回原安全链接、原历史逐字不变和未找到时 null。`npm run typecheck` 通过。Alex 与前端增量回归单独记录，不用此前 299/305 套件数字替代最终版本结果。

## #49 运行阻断：精确评论计数与汇总索引

正式复验记录首页与诊断超时，暂停大审计后仍复现。临时诊断只记录 SQL 文本、调用栈及耗时，不记录参数/结果；正式 `summary` 的候选聚合读取实测 1.9 秒，市场多次重复读取及来源排序亦为秒级。进一步对一致性真实库副本逐条计时发现：每 15 秒进度汇总的 `COUNT(*) full_scan_review_seen WHERE batch_id=?` 需遍历 7,378,102 个索引身份，单次 **7,912.45ms**；来源计数7ms、写入量SUM42ms、HTTP计数34ms均不足解释主阻塞。不以某一较小查询或审计并发单独解释全部超时。

修复：`full_scan_seen_counts` 首次由原seen准确汇总，表/触发器/初始化一个事务；后续真实身份新增、删除、跨批次移转与计数同事务提交/回滚，ignored重复不增加。周期summary只按batch主键读精确派生计数，不再全扫千万级身份；非估算值。新增候选汇总覆盖索引、跨批次来源/候选身份索引；009迁移为诊断添加候选任务及来源task_id覆盖入口。任务、游标、HTTP、采集公平性和预算不改。

CTO相关测试 `runtime-summary / full-scan / scan-summary-index / manual-coalescing` **37/37**、1.525秒通过，覆盖已有身份首建、重复初始化、事务回滚、去重、移转、空batch及覆盖计划；Alex独立测试另行报告。真实副本初始化/查询性能与正式发布60秒运行验证仍需单独记录，不用这些确定性测试代替运行验收。

真实维修前完整库的独立 APFS 副本测试（04:38:19–04:38:29Z）：新增索引及精确计数首建共10.524秒；原7,378,102个seen与派生计数一致。5次主键计数读取 **0.003–0.014ms**；候选聚合 **0.736ms**，计划使用覆盖索引、无TEMP排序。该测量属隔离副本，不当作正式环境响应时间。证据 `runtime-summary-benchmark.json`，不提交真实数据库副本。

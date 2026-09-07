# Alex：开发者 RPC code 5 有限恢复及 #15 回归

关联 [#11](https://github.com/zequnjiang/appeye/issues/11) 的 FS-DR-01～07，以及 [#15](https://github.com/zequnjiang/appeye/issues/15) 的同毫秒新响应幂等缺陷。**工程回归和 runtime 5 的有限恢复留存核查通过；部分来源限制交 PM 判定。** CTO 正式自检交接后，Alex 于 2026-09-06 19:28 UTC 独立执行冻结源码的 `npm run check`，**120/120 测试、前后端类型检查、生产构建、服务端编译及迁移复制均通过**，其中本次专项 10/10。真实恢复后仍是部分目录和显式 warning，不代表取得完整目录或整个采集任务完成。

测试基线为 `4a2a8b3` 加 CTO source-5、响应身份幂等及 HTTP batch 索引工作树。Alex 仅维护 `tests/developer-source-error.test.ts` 和报告/被忽略的审计文件；测试使用内存 SQLite 与注入响应。没有真实商店请求、生产写入或进程操作。

## 独立专项

| 检查 | 结果 |
| --- | --- |
| 仅单条 qnKhOb、null payload、数值 code 5、准确 PlayDataError 类型正判；其他 RPC/code/类型/非空 payload/重复帧/坏 JSON 拒绝 | 通过 |
| 实际安装 SDK 解析合成初始 10 项及 source-5，保留部分目录、显式 warning、两条原 HTTP，不自动循环 | 通过 |
| 13 种 task/warning/batch/商店/最新 HTTP/状态/官方域名/国家/语言/重复 rpc 参数边界；旧布局恢复开关不接收 code 5 | 通过 |
| 新 marker 一轮幂等，持久记录原因、旧 HTTP ID、原资料时间、排队时间 | 通过 |
| 再次部分 10 项保留 succeeded + developer-degraded + needs-review；完整 13 项才清 warning；两者都追加响应和历史 | 通过 |
| 新一轮 3 次网络失败终止 failed，仍保留旧部分成功 data/raw/lastSuccessAt | 通过 |
| 中断后原 round 恢复，累计 attempt 为成功 1、interrupted 2、成功 3；marker 不重置 | 通过 |
| #15：冻结同毫秒，真实新 attempt 的相同与不同 payload 均新增独立 history | 通过 |
| #15：同一个已持久响应重放不新增 HTTP/response/history，保留原采集时间 | 通过 |
| #15：存储 marker 时注入异常，当前资料、history 和 marker 一起事务回滚 | 通过 |

范围矩阵首轮有一个测试夹具外键错误（未创建另一个 batch 即迁移测试 task），补充有效内存 batch 后通过；没有把它登记为产品错误。#15 来自 CTO 离线检查，Alex 使用冻结时钟和原子回滚回归验证修复；没有证据声称已发生线上丢失。

## 真实旧响应的只读与离线复核

**2026-09-06T19:27:31.782Z**，只读保存 task 16108/App 1182 和 16116/App 1183 的旧 task/response/attempt/history，以及 HTTP 7231/7232、7235/7236 哈希。两者均印度尼西亚 GP，attempt 1，succeeded + developer-degraded。每项初始 10 条，续页 HTTP 200 但包含准确的 qnKhOb/null/PlayDataError code 5。

关闭只读数据库后，把各自两个已存原响应注入实际 SDK 重放：各 10 项 JSON 与旧资料完全一致，各有 1 条 warning；两条原 HTTP body 均不变，未发额外商店请求。新纯函数均正确识别 code 5。此结果证明当前已存页可保持完整解析，并不证明开发者目录全部取得，也不推断 code 5 的未公开业务含义。

脚本 `.artifacts/alex-developer-source-before.ts`，本地聚合与恢复前基线 `data/batches/finance-2026-09-07-alex-developer-source-before.json`，异常计数 0。文档不复制续页 token、请求参数会话值或原响应正文。

## 性能与边界

独立性能实证见 [FULL-SCAN-PERFORMANCE-ALEX.md](./FULL-SCAN-PERFORMANCE-ALEX.md)：HTTP batch COUNT 在合成 50,000 行时由表扫描约 11.65ms 改为覆盖索引约 0.57ms；索引在本次 CTO 工程变更中加入。该优化不减小采集范围，不修改评论上限或源错误语义。

Alex 另执行 CLI `--help`，确认新开关存在并明确“一次带 marker 的恢复、部分结果继续保留 warning、无完整保证”，未触发 DB 或采集。以本次真实 schema 初始化内存库后，EXPLAIN 确认 HTTP 计数使用 `full_scan_http_batch` 覆盖索引。未为低风险索引变更添加镜像单元测试，也未修改线上索引；实际部署仍由 CEO 受控进行。

本报告不把 10 条部分目录当完整，不把 code 5 当空成功/unsupported，也不把旧 #13 开关扩大到未知源错误。整个批次的评论与其他未完成项仍需继续。

## runtime 5 真实恢复核查

CEO 记录 runtime 5 于 **2026-09-06T19:29:28.326Z** 受控替换旧进程，仅启用 `--retry-developer-source-errors`。Alex 于 **19:30:24.574Z** 独立只读事务核对，脚本 `.artifacts/alex-developer-source-recovery.ts`，聚合证据 `data/batches/finance-2026-09-07-alex-developer-source-recovery.json`，异常计数 **0**，没有新增商店请求或写入生产数据。

| 任务 / App | 新 attempt ID / 累计序号 | 新 response ID / appliedResponseId | 新资料时间 UTC | 新 HTTP | 结果 |
| --- | --- | --- | --- | --- | --- |
| 16108 / 1182 | 17964 / 2 | 17837 / 17837 | 19:29:33.490 | 8836、8837 | 10 项、10 unique、1 warning；续页 code 5 |
| 16116 / 1183 | 17965 / 2 | 17838 / 17838 | 19:29:34.510 | 8838、8839 | 10 项、10 unique、1 warning；续页 code 5 |

四条新 HTTP 均 200，官方目录与续页请求的国家/语言均 id/id；新续页原文仍被严格识别为 qnKhOb/null/PlayDataError code 5。两个任务保留 `succeeded + developer-degraded`，并未清除 warning；它们是成功保存部分响应，不是完整目录成功。

每个 task 新增一个 response 与 history，`result.appliedResponseId` 准确对应新 `full_scan_responses.id`，其 attempt_id 和 observed_at 对应新尝试及新资料时间。当前 enrichments 与新 history 的 data/raw 完全一致，lastSuccessAt/lastAttemptAt 指向新资料时间。旧 attempt、旧 history、旧 response 逐字段/全文不变，四条旧 HTTP 的哈希与部署前独立快照一致。

本批仅 16108/16116 两条 task 带 `developerSourceErrorRecovery`，round 均为 1；marker 分别引用旧续页 HTTP 7232/7236、旧响应时间和该轮排队时间。重复部分结果没有自动开第二轮，累计尝试为 2。网络失败才使用新三次预算的分支由确定性测试覆盖，本次实际未发生网络失败。

先前已验收的六条 Apple 失败仍 failed/attempts 6，结束时间、全部既有 HTTP 记录及 attempt/history 数量均与先前独立审计一致。runtime 5 的七个源码文件 SHA256 全部匹配；正式库 EXPLAIN 已使用 `full_scan_http_batch` 覆盖索引。

以上证据交 PM 按 FS-DR 判断本轮部分来源限制，并完成 #15 的工程验收。没有据此关闭 #11，也没有减少后续评论范围。

# 评论来源响应校验：CTO 自检与交接

- 关联：[缺陷 #16](https://github.com/zequnjiang/appeye/issues/16)、[完整采集 #11](https://github.com/zequnjiang/appeye/issues/11)。需求为 [REVIEW-SOURCE-VALIDATION.md](../requirements/REVIEW-SOURCE-VALIDATION.md)。
- 日期：2026-09-07（北京时间）；下述采集证据时间使用 UTC。
- 范围：仅批次评论 provider 的来源校验、新增本地 helper 及测试。原 runner、分页/轮转/退避、CLI、数据库结构及数据没有修改；未联网、未重启真实采集，也没有执行历史任务重排。
- 问题性质：静态代码确认的误判风险；目前检查范围内没有本轮真实错误响应被当成空评论的证据，不声称已发生线上数据损失。

## 实现

`server/review-source-validation.ts` 增加两项只读校验，`server/full-scan-providers.ts` 只在本次 `reviewsPage` 的 transport 使用：

1. Google：识别官方 batchexecute 的实际 `f.req` 中 `UsvDTd`，检查对应 `wrb.fr` 帧的明确非零数值错误码；即使带部分 payload 也拒绝。其他 RPC 错误不归因于评论页；null、空数组、缺少 next token 本身不被拒绝。SDK 请求 URL 的 `rpcids=qnKhOb` 与 body 中真正评论 RPC 不一致，因此不能只按 URL 字段识别。原 SDK 继续负责缺失/破损 RPC envelope。
2. Apple：用固定版本 `saxes@6.0.0` 作本地 XML 解析及 Atom feed 根节点校验。真实空 feed、有评论 feed、仅元数据/应用元数据的 feed 均可通过，不要求 title/id/updated/self/entry 等字段必须存在。HTTP200 错误 HTML、错误根文档及破损 XML 返回明确错误。
3. 原 transport 先保存实际 HTTP 状态、完整 body、时间及 task/batch 关联，校验随后只读取原 body；不替换 Response、不伪造空 feed。语义失败保留 HTTP200 与原文，任务失败原因明确区分 RPC 或 XML 来源校验。两家 SDK 会包装 fetch 异常，因此 provider 透出本次已知的 `ReviewSourceValidationError`，其余异常不改写成来源错误。
4. 失败在 SDK 返回评论数组之前发生，原 runner 处理其既有有限重试、失败页游标和人工重试。不会写成成功空页或创建虚假自然结束；已完成页、评论和观测时间继续保留。Apple `source` 的 `sortby=mostRecent` 同步为 SDK 实际请求的大小写。

XML 范围是实际评论 Atom feed 的本地语法/根节点校验，不是 schema、DTD 或 XML 安全审计；没有加载远程 DTD/实体的行为。`saxes` 上游已归档，不宣称积极维护。依赖由 CEO 精确安装并报告 `npm audit` 为 0；两家商店 SDK 版本未改。

## CTO 自检

- TypeScript 前后端 `npm run typecheck` 通过。
- 确定性 helper 自检通过：Google 合法 null/空/空带 token、非目标 RPC、带空或非空 payload 的明确错误；Apple 合法空/元数据 feed、错误 HTML/根/破损 XML/空文本。
- 安装的真实 Google SDK 经注入 fetch 运行：合法 null 成功空、空加新 token 保留游标、明确错误抛具体 `ReviewSourceValidationError`；每次只有一份原 HTTP，状态 200、body 逐字不变、HTTP `error` 为 null。所有请求均为内存夹具，无真实网络。
- Apple 新校验器于 `2026-09-06T20:10:35.387Z` 对真实库一个只读事务取得的 **1,031** 个成功任务的最新评论 HTTP 本地校验，**0** 拒绝。此项是新校验器与已存源兼容性检查，不代替 Alex 的独立 XML/字段投影审计。
- 独立回归文件由 Alex 维护：`tests/review-source-validation.test.ts`，包括 provider → 原 HTTP 账本 → runner 的重试/耗尽/恢复，不写真实库。正式完整检查结果在交接时补记。

## 有时间边界的真实历史核查

Google 审计保存到被 `.gitignore` 排除的 `data/batches/finance-2026-09-07-cto-google-review-source-audit.json`。本次新事务：`2026-09-06T20:10:09.454Z` 至 `20:10:10.705Z`；范围为该批次所有当时成功的 Google 评论任务各自最新已存 HTTP。

| 指标 | 数量 |
| --- | ---: |
| 成功 Google 评论任务 / 最新已存 HTTP | 901 / 901 |
| 空评论且无 next token | 49 |
| 解析到的 UsvDTd 帧 | 901 |
| 无法解析 / 明确非零错误帧 | 0 / 0 |
| 真实网络请求 / 真实数据库写入 | 0 / 0 |

证据文件仅导出 refs、时间、SHA256、国家/语言、页号、数量及错误码；不包含评论、作者或游标。此前 `20:03:53.535Z` 的 649 页 / 30 空页 / 0 错误来自当时工具输出，没有当时已保存的文件；新 artifact 明确将其标为回溯记录，并以本次新事务数为主要证据。

Apple 独立审计由 Alex 完成，文件为 `data/batches/finance-2026-09-07-alex-apple-review-source-audit.json`：`20:07:53–20:08:00Z` 的 725 个成功任务及 HTTP，524 非空、201 合法空；独立严格 XML/Atom namespace/请求上下文通过，18,024 条 XML 字段投影与 SDK raw 一致，0 已证错误文档假空。本报告引用 Alex 的测量，不将其称为 CTO 独立重做。

上述时点没有已证历史修复对象。批次持续运行，分母不会代表后续全部任务；修复部署和新页/合法空页运行验证由 CEO 与 Alex 在受控部署后记录。工程回归通过不代表全部评论或 #11 已完成，最终需求验收交 PM。

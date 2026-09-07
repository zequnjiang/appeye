# 扩展发现采集适配器 CTO 自检与交接

- 日期：2026-09-07；关联 [需求 #22](https://github.com/zequnjiang/appeye/issues/22)、[PM 需求](../requirements/EXTENDED-DISCOVERY.md)。
- 范围：ED-AC-03/04/05 的采集适配器与传输预算边界；本报告不能替代调度、正式补录、Alex 测试或 PM 最终验收。
- 所有权：`server/full-scan-providers.ts`、`server/providers.ts`、`tests/extended-providers.test.ts`。未修改数据库、线上进程或历史批次。

## 实现与接口

`ScanProvider.extendedSearch` 使用当前指定 Google Play SDK 的公开 `searchIterator`，逐条调用 `onItem` 后再读取下一条，最多 1,000 条。实际自然结束、结果预算和 SDK 降级/令牌循环分开表达。迭代器不公开可恢复游标，coverage 明示从头重放并按身份去重；不把没有公开 token 当作已证明没有续页。Apple 使用 `num=200,page=1` 的单次公开窗口，保留所有 SDK 返回行。

`ScanProvider.related` 使用两个 SDK 的 `similar`。Google SDK 的 100 条聚合上限明确记录。Apple 接口从应用页面收集所有应用链接，标为 `same-page-links`，不冒称为经过语义校验的推荐应用；HTTP 200 内容不能识别为详情页面时，空解析结果记为来源错误。混合语言请求不统一伪标本地语言，实际 HTTP URL 保留各次请求语言。

`FullScanProviderOptions.beforeRequest` 在共享限速等待与取消检查之后、实际传输之前调用，每个 SDK 内部 HTTP 均经过同一路径。预算拒绝不会生成虚构 HTTP 记录。每次方法调用隔离保存传输失败和预算/取消原因，即使 SDK 包装或吞掉错误也恢复原错误；Apple similar 的失败不再变成成功空数组。普通详情及开发者采集同样不能吞掉预算拒绝，原批量详情失败后正常 fallback 行为保持。

普通 GP 搜索不再统一标为“250 条上限”：实际不足 250 条显示 `sdk-search-ended`，实际达到请求值显示 `local-result-limit`，同时记录请求量、返回量及不可公开的 token 边界。旧来源响应与历史报告未改写。

扩展搜索/关联发生 SDK 降级时抛出 `ScanSourceError`，`partial` 保留完整已解析行、原 SDK 数据、warnings、source 与 coverage；GP 行已先经过持久回调。CEO 所有的 runner 负责将 partial 关联到来源/尝试并解释 limited、deferred 与失败。

## 验证证据

| 命令 | 真实结果 |
| --- | --- |
| `npx tsx --test tests/extended-providers.test.ts` | 最终 17 passed，0 failed。 |
| `npx tsx --test tests/extended-providers.test.ts tests/full-scan.test.ts tests/full-scan-bulk.test.ts tests/developer-continuation.test.ts tests/developer-route.test.ts tests/developer-source-error.test.ts tests/review-source-validation.test.ts tests/transport-error.test.ts` | 增加最后 3 个独立测试前执行，85 passed，0 failed；之后新增的开发者预算、GP 关联语言、限速期间取消三项包含在上方最终 17 项通过中。 |
| `npx tsc --noEmit -p tsconfig.server.json` | 通过。 |
| `npx prettier --check server/full-scan-providers.ts server/providers.ts tests/extended-providers.test.ts` | 通过。 |
| `git diff --check -- server/full-scan-providers.ts server/providers.ts tests/extended-providers.test.ts` | 通过。 |

17 项确定性验证包含：安装的 GP SDK 解析真实形状的初始页面及后续 RPC，从 30 条延伸至 260 条；1,000 条主动截止；下一页预算被拒绝时首 30 条回调已经完成；坏布局与重复 token 显式失败；Apple 200 条窗口参数；安装的 Apple SDK 吞网络/503/预算异常的恢复；HTTP 200 非详情页面识别；同页链接经带国家的 lookup 解析；unsupported；详情包装异常恢复；开发者内部多次 HTTP 计费；GP 关联混合语言；限速等待期间取消不消耗下次预算。

首次新夹具执行 11/14 通过：两项 GP 正常样例漏写官方 RPC 路由表，另一个坏布局样例改字符串后破坏了 RPC 帧长度。修正夹具为 `lGYRle → ds:4` 路由和正确帧长度后通过，未放宽生产的完整性检查。所有以上测试均使用合成源，不是商店实时采集，也不代表目标包已经补录。

## Alex 交接与剩余工作

CEO 负责扩展 runner 的预算和轮转、partial 的持久留存、后台入口及已知包名正式补录。Alex 需独立验证 provider 与真实 runner 集成，重点检查 60+60 次实际 HTTP 预算、20 秒中断后候选留存、错误/延期标识，以及旧批次 fallback 和开发者历史保持。实时双商店 smoke 与 `com.creditouno.loan` 正式成功入库由 CEO 统一执行后另行记录，未在本适配器自检中假定通过。

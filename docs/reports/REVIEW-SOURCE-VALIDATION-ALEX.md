# 评论来源校验：Alex 独立回归

- 关联：[缺陷 #16](https://github.com/zequnjiang/appeye/issues/16)、[完整采集 #11](https://github.com/zequnjiang/appeye/issues/11)、[PM 验收标准](../requirements/REVIEW-SOURCE-VALIDATION.md)、[CTO 自检交接](REVIEW-SOURCE-VALIDATION-CTO.md)。
- 测试日期：2026-09-07（北京时间）；下面的审计时间均为 UTC。
- 工程及实际部署基线：`522d86e`（此前 `b61242d` 加本次 `review-source-validation.ts`、评论 provider、`saxes@6.0.0` 及锁文件调整）。Alex 独占 `tests/review-source-validation.test.ts` 与本报告，未修改业务实现、真实数据库或 Git。
- 当前结论：12 项专项回归及完整工程 132 项测试、前后端类型检查与生产构建通过；runtime-6 旧数据全量对照与部署后双店新页验证通过，交 PM 作局部验收。此缺陷来自静态审阅，目前历史审计没有发现本批次错误页被当成空评论，不能表述为已发生数据丢失。#11 评论全集仍在运行。

## 确定性回归

`npx tsx --test tests/review-source-validation.test.ts`：**12 / 12 通过**。两家已安装 SDK 通过注入的内存 HTTP 运行；runner 联动使用内存 SQLite。所有测试均无真实网络和生产数据库写入。

| 验收范围 | 真实验证行为 | 结果 |
| --- | --- | --- |
| RSV-01 原 HTTP | 原状态 200、完整 body、获取时间先保存；来源错误不制造第二份 HTTP。写账本失败保持存储异常，不误标来源错误 | 通过 |
| RSV-02 GP 错误边界 | UsvDTd 明确非零数值错误，含非空 payload，均失败；合法 null / 空 / code 0 保留；其他 RPC 隔离 | 通过 |
| RSV-02 请求边界 | 安装 SDK 的 URL 虽为 qnKhOb，仍按实际 UsvDTd body 校验；原生 Request 克隆后原 body 可读，其他 RPC 不误判 | 通过 |
| RSV-03 Apple feed | 有评论、合法空、应用元数据空、最小 Atom feed 通过；HTML、错误文档、错误根 / namespace、破损或多根 XML 失败 | 通过 |
| RSV-03 数据保留 | 安装 Apple SDK 的评论字段、实体解码与语言 `und` 保留；有效元数据 feed 解析为空数组 | 通过 |
| RSV-04 自然终止 | GP 合法空加新 token 继续下一页；无 token 的真实空才结束。来源失败页不产生自然结束或第三页 | 通过 |
| RSV-05 耗尽与恢复 | 两商店均验证：成功第一页 → 第二页语义失败 → 重建 runner 后预算耗尽 → 显式重试 → 合法空成功；保留累计 attempt 1 / 2 失败及 3 成功 | 通过 |
| RSV-05 旧数据 | 失败及恢复期间，第一页任务逐字段不变且未重抓，旧评论身份 / raw / fetchedAt / seen 保留；错误 HTTP 留存，失败页无伪造成功 response；空恢复新增 / 更新均为 0 | 通过 |
| RSV-06 范围 | 实现只作用于本次评论 transport；runner、DB、CLI 及采集范围未改。没有批量重排成功页 | 源码复核与上述联动通过；实际部署另验 |

专项准备期间两次失败来自测试夹具：重建后的 HTTP 回调仍绑定旧 runner，以及把既有 `retryFailed()` 的 void 返回值误当数量。修正夹具后重新执行全部专项通过；未据此虚构业务缺陷。XML 用例验证解析与根节点边界，不声称完成独立 XML 安全审计。

## Apple 历史来源全量只读核查

独立脚本 `.artifacts/alex-apple-review-source-audit.py` 使用 Python 标准库 `xml.etree.ElementTree`，不调用本次新增校验器，也不使用生产 SDK 来作判定。一个只读事务的时间为 **2026-09-06T20:07:53.532Z 至 20:08:00.836Z**。

| 指标 | 数量 |
| --- | ---: |
| 当时全部成功 Apple 评论任务 / 实际 HTTP200 | 725 / 725 |
| 有评论的合法 feed / 合法空 feed | 524 / 201 |
| XML 独立字段投影与完整 SDK raw 逐字段核对 | 18,024 条 |
| 空终止与有效空 feed 对应 | 201 / 201 |
| XML / Atom 根与 namespace / 请求身份国家页号 / feed id 与 self-link / 原始字段及行数异常 | 0 |
| 错误页被当成空的已证实例 | 0 |
| 真实网络请求 / 生产写入 | 0 / 0 |

国家分母：AR 130、ID 84、MX 171、PH 110、PK 100、TH 130，共 725。元数据应用 entry 在本次真实分母中为 0，其合法性另由 fixture 验证。所有有效空页来自真实无评论 entry 的 Atom feed，不靠“SDK 返回空数组”反推有效性。审计同时比对持久 response 及获取时间；不输出评论正文、作者、评论 ID 或游标。

本地脱敏摘要与逐 HTTP SHA256：`data/batches/finance-2026-09-07-alex-apple-review-source-audit.json`，受 `.gitignore` 排除。实际 HTTP 的 `sortby=mostRecent` 与旧 task 声明 source 的 `mostrecent` 属已知标签差异，核查同一官方路径、国家、应用 ID 与页号时容许该大小写差异，没有改写任何历史来源。

该时点是全部**已成功 Apple 页**的全量检查，不是所有尚未取得的页，也不是评论全集验收。后续来源仍可能失败。CTO 对另一时点的 GP 901 页 / 49 空 / 0 明确错误，以及 Apple 1,031 个已存 HTTP 对新校验器 0 拒绝的检查，属于 [CTO 报告](REVIEW-SOURCE-VALIDATION-CTO.md) 的独立执行证据，本报告不将其计作 Alex 重做。

## 完整检查与部署验证

独立执行完整 `npm run check`：**132 / 132 测试通过**，前后端 TypeScript 检查、Vite 生产构建、服务端编译及迁移文件复制均通过（退出码 0）。部署前后只读对照脚本为 `.artifacts/alex-review-runtime-checkpoint.mjs`，记录旧成功任务与 HTTP 的完整行哈希、评论身份 / 获取时间 / 完整行哈希及 seen 集合。新页允许真实更新旧评论，但更新必须逐字段对应新的持久 response 与实际获取时间；不能要求当前记录永远停留在旧观测。

CEO 于 `20:13:15Z` 干净停止 runtime-5，部署 `522d86e`；runtime-6 记录为 `data/batches/finance-2026-09-07-runtime-6.json`。该记录的实际命令只有原 batch / serve / delay 参数，没有成功重排或 retry flag。以下由 Alex 独立只读验证，未发商店请求：

| 核查 | 一致快照时间（UTC） | 分母 / 结果 |
| --- | --- | --- |
| 部署前后历史对照 | `20:13:56.722–20:14:01.584Z`；CEO 执行 capture 的基线起点为 `20:13:18.760Z` | 2,220 个旧成功任务与 2,220 份旧 HTTP 完整行哈希全等；144,551 条旧评论身份 / 字段 / raw / fetchedAt 完全不变；144,414 个旧 seen 身份全部保留；0 异常 |
| 实际运行文件 | `20:14:54.357Z` | runtime-6 记录的全部 10 个文件 SHA256 与磁盘文件一致 |
| 部署后新增 GP 页 | `20:14:54.357–20:14:54.683Z` | 67 页、9,804 条评论；65 个继续、2 个无 next token 正常终止。原 HTTP 的 UsvDTd 帧独立解析、错误码 / ID / 数量 / cursor 与 response 一致，0 异常 |
| 部署后新增 Apple 页 | 同上 | 57 页、1,324 条评论；31 个继续、26 个合法空 feed 终止。原 HTTP 严格 XML / Atom 根 / ID / 数量及新 source 精确大小写一致，0 异常 |
| 新页存储与接续 | 同上 | 全 124 页的 HTTP / 成功 attempt / 持久 response 及来源时间可追溯；11,128 条规范化评论字段 / raw / 当前获取时间一致；继续页均有正确后继 checkpoint，0 异常 |

此次部署后的 GP 分母中没有新的空页，不能声称实测了“新 GP 空页”；合法 GP null / 空 / 空加 token 由安装 SDK 的确定性回归验证，部署后的合法空页实证来自 26 个 Apple feed。部署后没有来源校验错误实例，也没有制造真实错误流量来测试失败。错误处理与有限重试结果来自上方明确分开的内存测试。

本地证据：`data/batches/finance-2026-09-07-alex-runtime-6-before.json` 及其 `reviews.jsonl` / `seen.jsonl`，`finance-2026-09-07-alex-runtime-6-after.json`，`finance-2026-09-07-alex-runtime-6-new-sources.json`。对照脚本写出身份与哈希，不复制正文。新来源脚本为 `.artifacts/alex-review-runtime-6-source.py`。

本项工程与实际部署 QA 通过，交 PM 局部验收。评论仍有待处理分页；最终验收将重新核查届时全部 GP 来源帧和全部 Apple feed，不能沿用本报告 901 / 725 的历史时点分母代表最终所有页。#11 整体仍未验收。

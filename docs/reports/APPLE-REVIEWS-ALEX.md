# Apple 评论阶段：Alex 独立全量审计

- 关联：[运营 #11](https://github.com/zequnjiang/appeye/issues/11)、[评论来源校验 #16](https://github.com/zequnjiang/appeye/issues/16)、[本轮需求](../requirements/FULL-SCAN-2026-09-07.md)、[来源校验需求](../requirements/REVIEW-SOURCE-VALIDATION.md)。
- 批次：`finance-2026-09-07`；运行基线为 runtime-7 / `52cd7a8`。日期为北京时间 2026-09-07，下列实测时间均为 UTC。
- 结论：**Apple 评论阶段独立 QA 通过，交 PM 验收。** 六国 1,123 个应用市场记录的公开评论流全部终态，原文、分页、入库身份和获取时间审计无未解释差异。Google Play 评论仍在采集，本报告不批准双店整体完成，也不关闭 #11。
- AC 范围：FS-AC-03/04 的 Apple 身份、分类及分母；FS-AC-05/06 的全部 Apple 评论流、去重及计数；FS-AC-08/09/10 的原文、时间、恢复及阶段报告；RSV-01/03/04/05/08 的 Apple 来源、合法结束及实际历史证据。FS-AC-11 的 PM 流转仍待产品经理独立批准，未据本报告提前关闭需求。

## 范围与方法

本次只读当前 SQLite 和冻结基线备份，无生产写入、无商店网络请求。应用范围为所有 Apple 主库记录，不按当前分类缩小；1,123 个市场记录对应 **873 个不同的 App Store ID**，同一 ID 的不同国家分别审计。命令为：

```sh
node .artifacts/alex-review-audit.mjs --store app-store
python3 .artifacts/alex-final-review-source-audit.py --store app-store
```

第一份审计按页处理原始与归一化响应，在临时 scratch SQLite 中独立推导身份、先前是否存在、最后一次观测和预期内容，然后核对真实 reviews / seen。第二份使用独立 Python XML 解析，不调用生产 SDK 或生产校验函数，检查所有已存 HTTP，逐字段投影全部有评分的 Atom entry。每份仅接受所选商店已无 queued / running / deferred；默认仍审计双店。既有合成验证覆盖两个方向的商店范围隔离、所选商店未完成时拒绝、未选商店的错误来源不污染结果。

| 实际执行 | UTC 时间 | 结果 |
| --- | --- | --- |
| 评论流、响应、入库、seen、原身份全量核对 | `21:31:54.065–21:32:00.508` | 0 差异 |
| 首次全量 HTTP / 独立 XML 投影 | `21:33:55.335–21:34:52.041` | 1 处换行投影差异；先暂停阶段放行，见下文 |
| 保留源 CRLF 语义后的全量来源复跑 | `21:37:14.065–21:38:12.457` | 1 处有原文字节证明的换行保留，0 未解释差异 |
| 原应用分类及本轮未见旧评论补充核查 | `21:37:41.398–21:37:41.600` | 0 差异 |

## 全量结果

全部 **3,803 页 succeeded**，无 Apple 评论 queued / running / deferred / failed。1,123 个流从第一页连续推进，无页码缺口或无后续处理的可续页；最终为 **933 个合法空 feed 结束**和 **190 个公开第 10 页上限结束**。上限与自然空结束分别保留，没有将第 10 页上限称为商店全部评论。

| 国家 | 应用市场记录 / 流 | 成功页 | 合法空 feed 结束 | 第 10 页上限 |
| --- | ---: | ---: | ---: | ---: |
| 阿根廷 | 206 | 575 | 180 | 26 |
| 印度尼西亚 | 141 | 681 | 93 | 48 |
| 墨西哥 | 258 | 999 | 202 | 56 |
| 菲律宾 | 196 | 639 | 171 | 25 |
| 巴基斯坦 | 155 | 273 | 149 | 6 |
| 泰国 | 167 | 636 | 138 | 29 |
| 合计 | **1,123** | **3,803** | **933** | **190** |

全量持久化核对结果：

- 返回及保存的原始 / 归一化评论行 **126,616**；每页按稳定 ID 去重后仍为 126,616，本轮跨页 / 市场身份集合 `seen` 为 **126,407**，独立推导集合与库内集合完全相同。
- 按每页写入前身份是否存在，新增写入 **119,832** 次，已有身份写入 **6,784** 次，和 task.result 累计值相同；新增不同身份也是 119,832。已有身份写入数不是正文发生变化的不同评论数量，同一身份可在多页再次出现。
- 对全部 **126,407** 个本轮身份逐字段比较当前规范化内容、完整 raw 和最后一次来源响应时间；`fetchedAt` 对应持久 response 的观测时间，不是审计时间、评论发表时间或重启时间。
- 冻结基线的 **6,707** 个 Apple 评论身份及原行 ID 均保留。本轮没有再次返回的 **132** 条旧评论，另外逐字段核对其完整行及获取时间，全部不变。当前 Apple 共 **126,539** 条评论，即原有 6,707 加新身份 119,832。
- 原 **245** 个 Apple 应用的 store / country / external ID / classification / manual override / classification source 全部与冻结备份一致。
- 每个成功页的持久 response、实际 attempt、观测时间、原 HTTP 引用和冻结 country / page / app ID 上下文均核对。Apple 评论 language 保持 `und`，请求国家不表示作者所在地或已验证的评论语言。

来源全量审计检查 **3,804 条 HTTP 历史**：3,803 个 HTTP 200 全部是有效 Atom feed，其中 **2,870 个非空 feed**、**933 个空 feed**；另 1 条是受控停机中断，见后文。全部 126,616 条评论的 ID、作者字段、版本、评分、标题、内容、更新时间及投票字段由原 XML 独立投影，与持久 raw 比较。没有发现错误 HTML、破损 XML、错误根被应用为成功或空结束。所有 933 个空结束均有实际合法空 feed 证据。

## 首次投影差异及复核

首次来源审计报告确有 1 处差异，不能记成首次就全零：task **29909** / HTTP **20073** / app **569**，泰国第 10 页，50 条中的第 25 条 `text`。Python ElementTree 按 XML 行尾规则将一个字面 CRLF 转为 LF，投影为 194 个 Unicode 码点；实际 SDK 的 Cheerio 解析及持久 raw 保留原 CRLF，为 195 个码点。其他行和字段完全一致。

Alex 核对原 HTTP 确实包含完整保存字符串，且换行归一化后全文严格相同。CTO 另用实际安装的 SDK、注入已存 HTTP 离线重放该页，**全部 50 条 raw 与持久响应完全相同**；SDK 重放没有真实网络。CTO 对指定原 entry 另核其身份匹配、1 个字面 CRLF、无单独 CR 和无数字字符引用。上述 CTO 操作属于独立协作证据，不冒称由 Alex 执行。

审计器只对 `text` 中这个类型的差异作显式判定：保存值必须含 CRLF 且无单独 CR，仅将 CRLF 转为 LF 后与独立投影逐字相等，并且完整保存值在原 HTTP 中有字面证据。没有泛化 trim、忽略字段或放宽其他空白。合成正反例证明无原字节佐证、修改文本、修改其他字段、额外字段、单独 CR 均不能借此通过。

全量复跑明确统计 **1 条源 CRLF 保留、0 条未解释差异**。初次 JSON 和逐 HTTP 证据保存为 `*-final-review-sources-initial.*`，没有覆盖；再次逐条比较 3,804 条初次与复跑 HTTP 证据，除新增的这一解释标记外全部相同。未修改生产代码、评论、raw、HTTP 或获取时间，也没有为此重新请求源站。

## 中断与恢复的历史

多出的那一条非 200 HTTP 不是评论最终失败，也不是本轮 Google 的 ECONNRESET：Apple task **23042** / app **239** / 墨西哥第 2 页，HTTP **13202** 的 status 为 null。首次 attempt **23178** 于 `20:13:15.375–20:13:15.377Z` 在 runtime-6 切换时标记 interrupted；第二次 attempt **23179** 于 `20:13:46.800–20:13:47.483Z` 成功，实际 response 时间为 `20:13:47.480Z`，合法空 feed 结束。原中断 HTTP / attempt 仍保留，成功后没有删除历史或用失败响应伪造空页。

## 现有后台抽查与证据保存

CEO 于 `21:33:08.864–21:33:08.984Z` 另执行现有 API 抽查，未认证 401、认证成功后读取 Apple app **7**（印尼）及另一 Google 样本。Apple 的完整详情 raw / storeData、七类补充 data / raw / 时间与 SQLite 深比较一致；评论 offset 50、limit 50 的 50 条 id / external ID / raw / fetchedAt 逐行一致，总数 498。CEO 随后退出内存会话，没有业务写入。该证据仅是现有 API 的样本核查，不替代上述全量存储和来源审计，也不是新的浏览器视觉验收。

本地 ignored 证据均不含评论正文、作者或原游标的报告导出；原始业务数据仍在 SQLite：

- `data/batches/finance-2026-09-07-alex-app-store-reviews.json`：全量流 / 响应 / 入库 / seen 结果。
- `data/batches/finance-2026-09-07-alex-app-store-final-review-sources-initial.json` 及 `.http.jsonl`：首次严格投影结果和原始逐 HTTP 哈希证据。
- `data/batches/finance-2026-09-07-alex-app-store-final-review-sources.json` 及 `.http.jsonl`：最终独立来源结果及显式 CRLF 解释计数。
- `data/batches/finance-2026-09-07-alex-app-store-review-final-supplement.json`：245 原应用、132 未再次返回旧评论及中断恢复核查。
- `data/batches/finance-2026-09-07-alex-apple-projection-difference.json`、`finance-2026-09-07-cto-apple-projection-29909.json`：脱敏差异与真实 SDK 离线重放证明。
- `data/batches/finance-2026-09-07-api-sample.json`：CEO 的现有 API 样本证据。
- `data/batches/finance-2026-09-07-alex-app-store-review-final-manifest.json`：上述产物及独立审计脚本 SHA256、初次 / 复跑证据逐条一致性。

本阶段没有业务改动，未重复运行已通过的 136 项工程测试。仅补充和执行独立审计器的必要合成正反例，然后对 Apple 全量真实数据复跑。**QA 通过的范围是本批次六国 Apple 公开评论接口已能返回的全部分页数据；190 个流仍受第 10 页接口上限约束。Google Play、双店最终汇总及 #11 整体验收继续等待。**

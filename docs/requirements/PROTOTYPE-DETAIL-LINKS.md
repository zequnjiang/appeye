# 原型详情外链

- 状态：**PM 最终验收通过（2026-09-09），PDL-AC-01–04 均通过；待 CEO 提交、精确 HEAD CI 通过后合并并关闭 #39。** 版本 1.0；见 [PM 报告](../reports/PROTOTYPE-DETAIL-LINKS-PM.md)。
- 跟踪：[Issue #39](https://github.com/zequnjiang/appeye/issues/39)，分支 `codex/prototype-detail-links`；仅 4173 独立 mock 原型，沿用 [原型边界](RESEARCH-PROTOTYPE.md)，不修改生产或采集。

| 编号 | 验收标准 |
| --- | --- |
| PDL-AC-01 | 详情标题下“应用 ID · 商店”可点击，在新标签打开当前应用、当前国家的商店页面：GP 对应 `play.google.com/store/apps/details?id=<externalId>&gl=<country>`；Apple 对应 `apps.apple.com/<country>/app/id<externalId>`，ID 正确编码，不沿用另一身份。分别核对双店及不同市场；原型身份虚构，链接目标正确不等于该条目实际存在。 |
| PDL-AC-02 | 基本信息中新增“官网”和“隐私协议”，绑定当前应用 `websiteUrl` / `privacyUrl`，可在新标签打开。本轮最终示例地址分别为 `https://example.com/#demo-website`、`https://example.com/#demo-privacy`，明确不是该应用实际官网或法律文本。字段缺失明确“未提供”，不得猜测开发者网站或展示可点击占位；不安全/无效地址不作为链接。 |
| PDL-AC-03 | 三类外链仅允许有效 HTTP(S)，使用 `target="_blank"` 与 `rel="noopener noreferrer"`。点击不会替换当前原型文档或重置详情；返回应用库时原筛选、排序和页码保留。实际浏览器验证新标签/原页保留，外部页面可用性与原型链接功能分别记录。 |
| PDL-AC-04 | 模拟新增及候选收录生成新身份时，官网/隐私字段明确清空或有该身份专属示例值，不能继承上一应用地址。除本次链接相关字段/说明外，身份、时间、指标及既有事件口径不变。SourceInfo 原“不打开为真实商店资料”改为一致说明：可打开来源路径，但虚构包名/ID 可能没有商店条目；持续保留 mock 标识。 |

CTO 实现并自检 → Alex 独立回归 → PM 写入 `docs/reports/PROTOTYPE-DETAIL-LINKS-PM.md` 验收；CEO 负责浏览器与 GitHub。无新页面、后端或真实采集范围，验收前不关闭 #39。

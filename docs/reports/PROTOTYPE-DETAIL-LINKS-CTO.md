# #39 原型详情外链：CTO 自检

- 日期：2026-09-09，Asia/Shanghai。
- 关联：[Issue #39](https://github.com/zequnjiang/appeye/issues/39)、[PDL-AC-01–04](../requirements/PROTOTYPE-DETAIL-LINKS.md)。
- 状态：实现和 CTO 自检完成，JavaScript 已冻结，正式交 Alex；CEO 浏览器验证与 PM 验收另行记录。
- 修改：独立原型 `src/App.jsx`、`components.jsx`、`data.js`、`utils.js`，以及两项必要 URL 边界检查 `tests/cto-detail-links.test.mjs`。CEO 管理 CSS 与外链浏览器验证。本次没有修改正式系统或发起商店采集。

## 实现

| AC | 最终行为 |
| --- | --- |
| PDL-AC-01 | 标题下应用 ID / 商店为锚点，使用现有 `storeSource(currentApp)`，GP 带编码 ID 与 `gl`，Apple 带国家路径和编码 ID，不使用旧来源字段替代当前市场链接。 |
| PDL-AC-02 | 基本信息的介绍后、版本前显示紧凑“官网”“隐私协议”两行，取当前应用 `websiteUrl` / `privacyUrl`。正常示例链接为 `https://example.com/#demo-website` 与 `https://example.com/#demo-privacy`，邻近文案明确不是实际官网/法律文本。TH19 两值缺失显示“未提供”，AR22 故意无效示例显示“地址不可用”。 |
| PDL-AC-03 | 三类链接共用 `AppExternalLink` 与 `safeExternalUrl`，仅有效绝对 HTTP(S) 生成锚点，统一 `target="_blank"` 和 `rel="noopener noreferrer"`。没有更改路由、筛选、分页或返回状态逻辑。 |
| PDL-AC-04 | 模拟新增和新候选收录显式清空官网/隐私地址，禁止从原示例身份继承。既有身份、时间、指标和事件未改。来源说明更新为可在新标签导航，但虚构包名/ID 可能没有商店条目。 |

样式契约交 CEO：`.store-app-link` 内文字 `span` 与 14px `ExternalLink`，以及 `.app-resource-links`、`.app-resource-link-row`、`.resource-external-link`。新标签外部页面是否存在和原型链接是否正确分别判断，不把示例路径称为真实资料。

## 实际自检

按构建在前的顺序执行：

- `npm run build --prefix prototypes/research-workspace`：通过。
- `npm test --prefix prototypes/research-workspace`：**28/28 通过**，即既有 26 项与新增 2 项。
- 新增 URL 检查验证有效 HTTP/HTTPS、空值、相对路径、无效地址、JavaScript（含混合大小写及换行）、data/file/mailto 均按允许协议正确处理。
- 新增身份检查验证双店、TH/AR 两市场、包含 `&` 和 `/` 的 ID 编码、GP 参数边界、官网/隐私示例片段、TH19 缺失、AR22 非法，以及 pending 和全部 12 候选新身份的空 URL。
- `git diff --check`（本次源文件及测试）：通过。

日志：ignored `.artifacts/prototype-detail-links-cto-build.log`、`.artifacts/prototype-detail-links-cto-test.log`。没有发送测试外部网络请求。新标签是否打开、原详情是否保留及返回应用库上下文由 CEO/Alex 实际浏览器验证，静态协议检查不替代浏览器行为。

已交接 Alex 并通知 CEO JS 冻结。未提交或推送，验收前不关闭 #39。

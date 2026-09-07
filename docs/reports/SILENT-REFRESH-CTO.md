# #21 静默刷新与 #22 发现诊断：CTO 前端自检

- 时间：2026-09-07 15:20 UTC。
- 引用：[缺陷 #21](https://github.com/zequnjiang/appeye/issues/21)、[需求 #22](https://github.com/zequnjiang/appeye/issues/22)。
- 需求：[SILENT-REFRESH.md](../requirements/SILENT-REFRESH.md)，SR-AC-01–06；[EXTENDED-DISCOVERY.md](../requirements/EXTENDED-DISCOVERY.md)，ED-AC-07 及来源展示部分。
- 状态：**前端实现与 CTO 自检完成，正式交接 Alex 独立回归；尚未 PM 验收。** 不以本报告确认正式部署、目标包真实采集或六小时运行成功。

## 实现结果

原应用库因工作区统一定时版本更新而进入整表加载态，进入详情又卸载本地筛选状态。现在每个读取资源使用同一会话内的完整 query key，内存缓存最多 20 项，同键请求合并。后续请求保留现有 DOM；成功自动应用，失败保留最后成功资料并提示后续重试。初次无缓存仍显示加载。每个已挂载资源每 15 秒检查一次，隐藏页不发起新的定时请求，恢复可见补一次；未完成请求不会被周期不断取消重建。

列表筛选、输入与提交搜索、页码保存在 Workspace。切换条件与页码 0 一次更新，详情返回先恢复同查询缓存，再后台刷新。阅读记录由可见 app ID、各行相对视口位置及焦点键组成。新行、重排、行高变化后以仍存在的锚点恢复；锚点消失时选择最近邻居，同距优先后邻居，全部失效才回到列表起点。结果减少造成末页失效时转到有效页。无列表来源的详情返回默认查询；详情本身即使尚未加载或失败也保留返回入口。定时更新不抢正在编辑控件的焦点。

API 正文阶段的 AbortError 原样传播，非法 HTTP 200 JSON 拒绝为错误；缓存同时校验请求世代、会话世代、条目身份与取消信号，防止晚到结果覆盖新查询或新会话。登出、会话失效与重新读取会话均清理缓存。缓存只在内存中，不写 localStorage。详情、评论与原始观察历史复用这一读取机制，稳定记录键保留展开状态。

新增独立“发现诊断”导航，支持 `#discovery` 入口：展示每六小时状态、预算、延期/失败及实际覆盖说明；候选按国家、商店、状态分页。包名查询仅在表单提交后读取已有数据，不因输入字符发起查询，也不隐式采集。已知 ID 的“加入跟踪并采集详情”明确执行 POST 并进入现有详情，排队与成功资料分开。未发现不等于商店不存在，暂存与失败分别解释。

身份来源支持 extended/hourly/batch 的复合字符串键，分别展示原观测时间、处理时间、父来源、分析、完整返回字段和原始数据。扩展任务提供原始 JSON 链接及页内响应/HTTP 证据分页，停止原因保留服务器原文。来源链接只允许 http/https；未知数据与 HTML 文本通过 React/FieldTree 展示，不解释为页面代码。

## 有效验证

所有浏览器 API 被隔离夹具拦截。Vite 使用随机本机端口，未读取生产数据库、调用商店或操作采集器。浏览器使用本机 Chrome headless；CI 使用 Playwright Chromium，已由 CEO 加入安装步骤。

| 命令 / 检查 | 实际结果 |
| --- | --- |
| `npx tsx --test tests/frontend-browser.test.ts tests/alex-api-lifecycle.test.ts` | 11/11：8 个浏览器场景 + 3 个 Alex API 场景；39.6 秒。 |
| `npx tsx --test tests/alex-query-cache.test.ts` | 3/3，验证单飞、旧会话/旧请求、失败保留、缓存 20 项上限、淘汰与 StrictMode 生命周期。 |
| 最新任务证据分页增量：`npx tsx --test --test-name-pattern='discovery diagnostics' tests/frontend-browser.test.ts` | 1/1，含桌面/窄屏两次执行、提交查询无写、明确 POST、原始字段安全显示与 HTTP 第二页。 |
| `npm run typecheck` | 前后端类型检查通过。 |
| `npx vite build --outDir .artifacts/frontend-build` | 生产客户端构建通过，未写正式 `dist/client`。 |
| `git diff --check` | 通过。 |
| 静态检查 | `src/` 无 `dangerouslySetInnerHTML`、`location.reload()` 或页面跳转式返回。 |
| CEO 整体工程检查 | CEO 独立执行 `npm test`，215/215 通过；整体隔离构建成功。正式独立 QA 结论仍由 Alex 出具。 |

浏览器场景覆盖：

1. 连续两轮**真实计时**的 15 秒自动刷新，表格 DOM 不卸载且新内容自动显示，503 时旧行/DOM 保留。
2. 桌面 1280×900 与窄屏 390×844：国家、搜索、第二页、阅读锚点与入口焦点在详情返回后恢复；返回请求被刻意延迟时缓存立即可读。
3. 自动插入新行的锚点保持；新国家筛选没有出现“新国家 + 旧 offset”的请求。
4. 删除锚点使用幸存邻居；末页减少转有效页；合法空结果不无限刷新。
5. 可控浏览器时钟下，慢请求跨三个周期仍只有一个有效请求；隐藏不发新请求，重复可见事件只补一个在途请求，搜索焦点保持。隐藏状态通过确定性的 visibility 事件夹具控制，不冒称 OS 标签切换的人眼测量。
6. 评论与采集历史原始字段展开及 DOM 标记在刷新后保持。
7. 发现诊断读取/明确写入边界、错误来源链接只作文本、HTML 原文不执行、任务原因/证据分页、桌面与窄屏无全页横向溢出。
8. 尚未加载或失败的详情仍可返回缓存列表。

本地忽略截图 `.artifacts/frontend/discovery-desktop.png` 与 `discovery-mobile.png` 已生成并检查，未提交含生产数据的图片。自检修正了锚点消失时同距邻居优先选择屏外前行的问题；最终选择后邻居并通过浏览器回归。

## 交接与限制

源码边界为 `src/`、前端依赖与 `tests/frontend-browser.test.ts`。CEO 持有后端、GitHub、正式部署；Alex 持有独立测试及验收证据。前端业务源码在本报告交接时冻结，之后仅处理独立 QA 的必要缺陷。

#22 后端真实运行、六小时轮转预算、旧批次保护与 `com.creditouno.loan` 的真实补录不属于本前端夹具证明范围，分别由后端报告与 CEO/Alex 正式运行证据确认。#21 仍需 Alex 独立回归及 PM 按 SR-AC 逐项验收后才能关闭。

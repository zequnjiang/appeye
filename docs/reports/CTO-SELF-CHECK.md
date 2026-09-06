# CTO 自检与测试交接

- 角色：Subagent 开发工程师（CTO）
- 本地日期：2026-09-07（Asia/Shanghai）
- 仓库：[zequnjiang/appeye](https://github.com/zequnjiang/appeye)
- 需求：[MVP 1.0](../requirements/MVP.md)
- 状态：后端自检通过，正式交接 Alex 独立回归；最终集成构建、UI 检查和 PM 验收由对应角色记录。

## 实现范围

实现 Node.js/TypeScript ESM 后端、双商店真实适配器、SQLite WAL migrations、六国及扩展配置、候选与人工分类、详情/原始快照/变化/评论、持久任务队列、单 worker 周期调度、请求限速与超时、有限退避重试、重启恢复、管理员会话、来源校验、登录限速、CSV、正式与演示数据库隔离。

数据库规范字段可用普通 SQL/JSON 查询。工程结构、数据口径、采集边界和备份方式见 [architecture](../architecture.md)，接口和错误语义见 [api](../api.md)。API/worker/store 均有 factory 导出，测试可注入采集器。

## 已执行自检

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 本地运行环境 | Node v25.9.0，目标为 Node 24+ | `node --version` |
| 后端严格类型检查 | 通过 | `npx tsc --noEmit -p tsconfig.server.json` |
| 后端正式编译 | 通过 | `npx tsc -p tsconfig.server.json` |
| 数据库迁移构建复制 | 通过 | `node scripts/copy-migrations.mjs`，编译后入口可打开新/已有数据库 |
| 核心自动化测试复跑 | 27/27 通过，0 失败/跳过 | `npm test`，涵盖 store/worker/api/provider；测试由 Alex 编写，CTO 自检复跑 |
| 演示 seed | 通过 | 显式 `DEMO_MODE=true DATABASE_PATH=data/demo.sqlite npm run seed:demo` 创建 18 个虚构应用、54 个快照、36 条评论 |
| 编译后 HTTP 启动 | 通过 | 独立本机端口 3002，`/api/health`=200、登录=200、鉴权 `/api/overview`=200；统计 18 apps、12 confirmed、6 candidates、36 reviews；smoke 服务已停止 |
| 正式数据库保护 | 通过实现与自动化测试 | demo API 禁止采集；启动检查数据库文件名和持久 `metadata.dataset`；seed 必须显式指定演示 |

完整前端集成构建由主 Agent 的统一 `npm run check` 和 Alex 最终报告提供；本报告不把尚未进行的 UI 验收记为通过。

## 真实商店 smoke（未写入正式数据库）

真实调用使用项目锁定的 `google-play-scraper@10.1.3` 和 `app-store-scraper@0.18.0`。所有响应来自商店接口，未使用 fixtures 或 demo 回退。时间为 UTC；本地为 2026-09-07 00:30–00:32。

| 时间（UTC） | 商店/上下文 | 实际结果 |
| --- | --- | --- |
| 2026-09-06 16:30:05 | GP，th/th，关键词 loan，结果上限 2 | 成功返回 2 项，包括 `com.aavelo.flowfund`（Loan Hub–สินเชื่อถูกกฎหมาย） |
| 2026-09-06 16:30:08 | App Store，th/th，关键词 loan，结果上限 2 | 成功返回 2 项，包括 `6748000182`（Kredivo - ใช้ก่อน จ่ายทีหลัง） |
| 2026-09-06 16:31:17 | GP 详情，th/th，`com.aavelo.flowfund` | 成功：version 1.0.5，score 4.86152，ratings 14841，installs 100,000+ |
| 2026-09-06 16:31:17 | GP 评论，th/th，`com.aavelo.flowfund`，smoke 限 5 条 | 成功返回 5 条，采集语言上下文 th |
| 2026-09-06 16:31:18 | App Store 详情，th/th，`6748000182` | 成功：version 2.1.0，score 3.92262，ratings 1008，installs null |
| 2026-09-06 16:31:18 | App Store 评论，th，`6748000182`，最新第 1 页 | 请求成功、空数组。仅说明该次店面 RSS 样本无返回，不能证明没有评论 |

App Store 禁止跟随重定向后，再次执行搜索、详情和评论请求，搜索 1 项、详情成功、评论仍为空；兼容性复查通过。真实 smoke 只验证本次泰国样本，不代表六国全部关键词、每个应用或以后长期可用。其他国家参数传播及异常处理由独立 deterministic tests 验证。采集样本的贷款属性不在此技术检查中作出结论。

## 修复和剩余边界

Alex 准备验证发现 ALEX-01：缺失商店评论 ID 会导致整批评论失败。现已改为稳定内容 hash 标识，原始 JSON 明示生成方式；回归测试通过。另补充 `changes.snapshot_id`、App Store 评分数量正确映射、bundleId/价格/币种保留。

App Store 上游依赖旧 `request`。适配器只从固定商店端点和结构化参数构建 URL，并禁用 `followRedirect` 与 `followAllRedirects`；不接受用户指定采集 URL。依赖审计和兼容性 overrides 由主 Agent 统一处理。未修改指定 scraper 版本。禁止重定向不等于消除上游所有漏洞，后续仍需迁移或维护上游依赖。

评论受店面/语言和有限页数约束，App Store 评论语言为 und；观察频率不等于完整发布历史；失败不自动判定下架。服务只支持一个活动 worker/数据库，不宣称多副本容错。

## 正式交接

Alex 请基于当前后端独立执行 `npm test`、最终类型/构建与 UI 回归，并将结果交 PM。测试入口为 `createStore`、`createApp`、`createWorker`；不可使用真实网络作为自动测试前提。主 Agent 负责 GitHub 需求、实现 PR、报告链接及合并交付，PM 验收前不得关闭需求。

# Appeye

面向信贷行业的应用市场观察后台。用 Node.js 与 `@mradex77/google-play-scraper`、`@perttu/app-store-scraper` 发现和持续跟踪应用，比较版本、基本信息、评分、安装量与评价样本。

初始市场：泰国（TH）、墨西哥（MX）、菲律宾（PH）、巴基斯坦（PK）、印度尼西亚（ID）、阿根廷（AR）。国家、语言、关键词与采集周期均可在后台增改。

## 快速启动

要求 **Node.js 24+** 与 npm；不需要 Docker 或额外数据库服务。

```bash
npm ci
cp .env.example .env
# 编辑 .env，为 ADMIN_PASSWORD 设置至少 12 位的独立密码
npm run dev
```

打开 [本机后台](http://127.0.0.1:5173)，用 `.env` 中的管理员密码登录。开发 API 地址为 `http://127.0.0.1:3000`；Vite 会代理 `/api`，页面与 API 共享认证。密码和真实数据库不会提交到 Git。

正式数据初始为空。默认 `AUTO_SCHEDULE=true`，启动并设置密码后，worker 根据启用国家的周期创建任务。希望先查看配置再采集时，将 `.env` 的 `AUTO_SCHEDULE` 设为 `false`，在后台点击“发现应用”。这只暂停自动排程，不妨碍手动任务执行。

## 演示后台

```bash
DEMO_MODE=true DATABASE_PATH=data/demo.sqlite npm run seed:demo
npm run dev:demo
```

演示库包含 **18 个虚构应用、54 个合成快照、36 条模拟评论**，页面持续显示演示标识。演示可以查看、筛选和编辑人工分类/市场配置；真实采集、手动添加和重试被拒绝，避免把真实数据写进演示库。演示和正式服务不能同时占用相同端口，切换前先停止已有服务。使用相同 `.env` 的管理员密码。

正式数据默认 `data/appeye.sqlite`，演示数据 `data/demo.sqlite`。数据库自身还有 `metadata.dataset` 标记，不能靠重命名文件绕过隔离。程序不会在采集失败时使用模拟数据兜底。

## 生产构建与启动

```bash
npm run check
# .env 中设好管理员密码；生产环境按需配置 HTTPS 与 COOKIE_SECURE
npm run build
NODE_ENV=production npm start
```

生产服务在 [本机 3000 端口](http://127.0.0.1:3000) 同时提供后台与 API；迁移随构建复制，在启动时执行。默认监听本机。长期运行需要保持 Node 进程与数据目录，建议交给 systemd 等进程管理器；本项目尚未部署到云服务器。只支持一个服务进程/worker，不能用集群模式同时打开同一数据库。对外提供访问时，用 HTTPS 反向代理，并配置精确的 `ALLOWED_ORIGINS` 和 `COOKIE_SECURE=true`。

## 后台能力

- 市场概览：国家覆盖、自动或人工确认分类、近期变化和采集运行情况。
- 应用库：国家/商店/分类/识别证据过滤，名称/开发者/ID 搜索，手动添加应用，CSV 导出。
- 详情：公司与开发者、商店完整字段、权限与隐私、版本历史、评分分布、截图、评论原始信息，以及可翻页的快照、搜索发现和补充采集历史。
- 信贷识别：六国语言启发式规则，展示描述原文、主体声明、APR/利率/费用/期限证据、适用政策与版本。人工分类优先，可明确切回自动模式。
- 市场设置：扩展国家、当地语言关键词、启停和采集周期。
- 任务中心：持久队列、进度、错误、有限重试、手动重试与重启恢复。
- 管理员认证：HttpOnly 签名会话、服务端撤销、来源检查和登录限速。

## 数据口径

**首次发现不等于新上架。** `firstSeenAt` 是本系统首次观察时间，`releasedAt` 是商店披露的发布日期，两者分别保存。更新频率仅反映本系统监测以来的版本变化，不代表商店完整发布历史。

**Google Play 的安装量是商店公开累计指标，不能当作某个国家的日下载量。App Store 不公开下载量，保持空值。** 不会用评分人数估算下载量，也不会用零代替未知。

关键词搜索形成候选集合，不能保证全市场覆盖。新应用在有信贷服务意图和至少两类独立数值披露时自动归入已确认信贷；弱证据保持待确认。纯计算器与指南不能仅凭示例数字确认为信贷服务。识别分数不是概率，披露命中不是合规、公司或牌照认证。V0.1 历史分类均锁定保留，可由管理员明确启用自动分类。评价来自有限的公开返回窗口：Google Play 默认最新 100 条，App Store 第 1 页。国家和语言代表采集上下文，不能证明用户所在地；App Store 评论实际语言标为未验证。失败不会被自动解释为下架。

采集库：[MrAdex77/google-play-scraper](https://github.com/MrAdex77/google-play-scraper) → `@mradex77/google-play-scraper@1.1.0`；[plahteenlahti/app-store-scraper](https://github.com/plahteenlahti/app-store-scraper) → `@perttu/app-store-scraper@2.1.0`。已移除旧库和 request/uuid 依赖链。

[政策来源](docs/policy-sources.md) 单独版本化。泰国与菲律宾的描述披露要求分别处理；印尼与巴基斯坦的材料要求不推断为已验证牌照；墨西哥与阿根廷不套用其他国家规则。Google Play 披露规则不作为 App Store 义务。权限来自公开商店声明，并非已授予权限或 APK 静态分析。补充接口失败时保留最近成功数据、时间与真实错误；旧版未采到的字段只能通过后续采集补齐。

## 数据库与 AI 查询

SQLite WAL + 明确 SQL 迁移，规范字段和原始 JSON 并存。表名：`countries`、`apps`、`snapshots`、`changes`、`reviews`、`jobs`、`schedule_state`、`discovery_observations`、`enrichments`、`enrichment_history`。国家/商店/应用 ID 的唯一约束和快照来源关系便于 AI 直接通过 SQL 分析及追溯。

[架构与 SQL 示例](docs/architecture.md) 包含数据模型、采集节奏、备份和后续迁移 PostgreSQL 的边界；[API 文档](docs/api.md) 描述所有接口。优先对只读副本做分析，避免 AI 查询阻塞工作库。需要安全备份时停止唯一服务，再复制主文件及存在的 WAL/SHM 文件；不停机请使用 SQLite online backup，不能只复制正在写入的主文件。

## 一次性财务扫描与完整采集

批次采集覆盖六国两个商店的财务榜单、配置关键词、所有原库应用及本轮新增信贷应用。新增 strong/possible 进入主库，证据不足的新对象保留在批次暂存。每个主库 App 刷新详情、七类补充及可继续取得的评论页；原有人工/legacy 分类保持不变。公开榜单和搜索有来源上限，不代表整个应用市场的枚举。

先停止普通服务/worker并备份数据库，再运行批次；`--serve` 会提供已有认证后台，不启动普通worker：

```bash
FULL_SCAN_WORKER_STOPPED=true npx tsx scripts/full-scan.ts --batch-id finance-2026-09-07 --serve
```

同一 `--batch-id` 恢复未完成任务；`--retry-failed` 重试失败项，`--retry-warnings` 仅重试原始响应可被已验证布局适配恢复的 Google Play 开发者目录告警，保留原尝试和数据历史。`--max-tasks` / `--max-minutes` 仅暂停，不代表完成。Google Play 评论沿下一页 token 继续，App Store 受公开第10页边界限制。Apple详情默认按50个同国家ID批量lookup，仍保存每个App的原文、真实观测时间与来源；缺项或缺截图回退单项请求，`--apple-batch-size 0` 可关闭优化。批次结束后，用 `NODE_ENV=production npm start` 恢复普通服务。

`--retry-developer-source-errors` 是单独的显式恢复入口：仅对本批次已保存的最后一次续页满足 HTTP 200、`qnKhOb` 空 payload、`PlayDataError` code 5 的 Google Play 部分开发者目录开启一轮恢复。任务保存本轮标识、原因、旧 HTTP 引用与累计尝试序号；重复启动同一开关不会自动开启第二轮。若再次取得部分目录和同一来源错误，保留 `developer-degraded` 告警并结束本轮；网络异常仍使用既有有限重试预算。这不是对上游 code 5 的修复，也不保证获得完整目录，不扩大 `--retry-warnings` 的原范围。

```bash
npx tsx scripts/full-scan.ts --batch-id finance-2026-09-07 --status
npx tsx scripts/full-scan-audit.ts --batch-id finance-2026-09-07 --baseline data/batches/finance-2026-09-07-baseline.json --output data/batches/finance-2026-09-07-audit.json
```

状态和审计命令只读已有SQLite。批次账本使用 `full_scan_*` 表，完整HTTP响应、来源、暂存、尝试和分页断点留在本地，不能提交真实数据库或评论到GitHub。本轮范围、真实进展及验收以[需求 #11](https://github.com/zequnjiang/appeye/issues/11)、[需求文档](docs/requirements/FULL-SCAN-2026-09-07.md)和[执行报告](docs/reports/FULL-SCAN-EXECUTION.md)为准。

## GitHub 与 Agent 流转

[需求 #1](https://github.com/zequnjiang/appeye/issues/1) → [后端 #2](https://github.com/zequnjiang/appeye/issues/2) / [后台 #3](https://github.com/zequnjiang/appeye/issues/3) → [测试与验收 #4](https://github.com/zequnjiang/appeye/issues/4)。

CEO 负责调度和最终交付；PM 编写需求与验收标准；CTO 实现并自检；Alex 独立回归；最后由 PM 验收，之后才能关闭需求。角色规范在 [AGENTS.md](AGENTS.md)，完整流程见 [工作流](docs/workflow.md)，验收口径见 [MVP 需求](docs/requirements/MVP.md)。GitHub Actions 在 PR 与 main 上运行类型检查、测试、构建和高危依赖审计。

交付证据保存在 `docs/reports/`，真实商店 smoke 与夹具测试分开记录。后续国家、指标或功能通过 Issue 模板进入相同流程。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 真实数据 API + React 开发服务器 |
| `npm run dev:demo` | 隔离演示数据后台 |
| `npm run typecheck` | 前后端 TypeScript 校验 |
| `npm test` | 注入商店夹具的确定性自动测试，不访问网络 |
| `npm run build` | 生产前后端与迁移构建 |
| `npm run check` | 类型检查、测试和生产构建 |
| `npm start` | 启动生产构建 |

若商店采集失败，先在任务详情查看错误，再检查网络、国家配置与上游接口。不要运行 `npm audit fix --force` 自动降级用户指定采集库。

V0.2 需求与验收：[需求 #7](https://github.com/zequnjiang/appeye/issues/7)、[依赖迁移 #5](https://github.com/zequnjiang/appeye/issues/5)、[完整信息 #8](https://github.com/zequnjiang/appeye/issues/8)、[信贷识别 #9](https://github.com/zequnjiang/appeye/issues/9)。范围及验收标准见 [V0.2 需求](docs/requirements/V0.2.md)。

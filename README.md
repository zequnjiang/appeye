# Appeye

面向信贷行业的应用市场观察后台。用 Node.js 与 `google-play-scraper`、`app-store-scraper` 发现和持续跟踪应用，比较版本、基本信息、评分、安装量与评价样本。

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

- 市场概览：国家覆盖、人工确认分类、近期变化和采集运行情况。
- 应用库：国家/商店/分类过滤，名称/开发者/ID 搜索，手动添加应用，CSV 导出。
- 详情：基本信息、商店发布日期、首次发现时间、历史趋势、字段差异、版本观测频率、评论样本和原始快照。
- 市场设置：扩展国家、当地语言关键词、启停和采集周期。
- 任务中心：持久队列、进度、错误、有限重试、手动重试与重启恢复。
- 管理员认证：HttpOnly 签名会话、服务端撤销、来源检查和登录限速。

## 数据口径

**首次发现不等于新上架。** `firstSeenAt` 是本系统首次观察时间，`releasedAt` 是商店披露的发布日期，两者分别保存。更新频率仅反映本系统监测以来的版本变化，不代表商店完整发布历史。

**Google Play 的安装量是商店公开累计指标，不能当作某个国家的日下载量。App Store 不公开下载量，保持空值。** 不会用评分人数估算下载量，也不会用零代替未知。

关键词搜索形成候选集合，不能保证全市场覆盖；人工确认后才归入已确认信贷。评价来自有限的公开返回窗口：Google Play 默认最新 100 条，App Store 第 1 页。国家和语言代表采集上下文，不能证明用户所在地；App Store 评论实际语言标为未验证。失败不会被自动解释为下架。

采集库接口说明：[google-play-scraper](https://github.com/facundoolano/google-play-scraper)、[app-store-scraper](https://github.com/facundoolano/app-store-scraper)。

## 数据库与 AI 查询

SQLite WAL + 明确 SQL 迁移，规范字段和原始 JSON 并存。表名：`countries`、`apps`、`snapshots`、`changes`、`reviews`、`jobs`、`schedule_state`。国家/商店/应用 ID 的唯一约束和快照来源关系便于 AI 直接通过 SQL 分析及追溯。

[架构与 SQL 示例](docs/architecture.md) 包含数据模型、采集节奏、备份和后续迁移 PostgreSQL 的边界；[API 文档](docs/api.md) 描述所有接口。优先对只读副本做分析，避免 AI 查询阻塞工作库。需要安全备份时停止唯一服务，再复制主文件及存在的 WAL/SHM 文件；不停机请使用 SQLite online backup，不能只复制正在写入的主文件。

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

若商店采集失败，先在任务详情查看错误，再检查网络、国家配置与上游接口。App Store 依赖含遗留 `request`：已覆写修复可兼容的高危传递依赖，并禁止重定向；剩余审计项和真实调用验证见验收报告。不要运行 `npm audit fix --force` 自动降级用户指定采集库。

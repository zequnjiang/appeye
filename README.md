# Appeye

面向信贷行业的应用市场观察后台。用 Node.js 与 `@mradex77/google-play-scraper`、`@perttu/app-store-scraper` 发现和持续跟踪应用，比较版本、基本信息、评分、安装量与评价样本。

初始市场：泰国（TH）、墨西哥（MX）、菲律宾（PH）、巴基斯坦（PK）、印度尼西亚（ID）、阿根廷（AR）。国家、语言、关键词及启停可在后台增改；启用国家统一每 60 分钟安排发现和详情刷新。

应用库保持当前显示清单，每15秒后台检测已保存数据；有变化时提示，点击“更新清单”或顶部刷新按钮后才应用。详情返回保留原清单、待更新提示、查询、分页及阅读位置。此行为按[#25用户最新选择](docs/requirements/LIBRARY-REFRESH-REGRESSION.md)替代原先自动应用新清单的方式。后台另外每6小时执行扩展发现：本地贷款词表、同市场开发者目录及关联应用；每市场默认60次来源HTTP和60次候选详情HTTP，未完成工作持久延期。小时刷新与扩展发现均指调度周期，不保证全部应用在周期内采集完毕。

「发现诊断」可按国家、商店、包名/数字ID查询未发现、待处理、暂存、失败及已入库状态，查看原始来源和预算停止原因。已知包名可通过「添加应用」直接跟踪，绕过搜索排名；创建记录不等于详情采集成功。公共接口的有限结果不代表全市场，历史目录回收也不等于今日新上架。配置见 `.env.example` 中 `EXTENDED_DISCOVERY_ENABLED` 与 `DISCOVERY_*`。

## 快速启动

要求 **Node.js 24+** 与 npm；不需要 Docker 或额外数据库服务。

```bash
npm ci
cp .env.example .env
# 编辑 .env，为 ADMIN_PASSWORD 设置至少 12 位的独立密码
npm run dev
```

打开 [本机后台](http://127.0.0.1:5173)，选择平台运营入口并用 `.env` 中的管理员密码登录。开发 API 地址为 `http://127.0.0.1:3000`；Vite 会代理 `/api`，页面与 API 共享认证。密码和真实数据库不会提交到 Git。

正式数据初始为空。默认 `AUTO_SCHEDULE=true`，启动并设置密码后，产品内协调器立即安排一次发现和详情刷新，后续每 60 分钟安排。`AUTO_SCHEDULE` 是自动调度总开关，设为 `false` 同时暂停小时与六小时扩展任务；手动任务和已经冻结的全量批次仍可执行。总开关启用时，`EXTENDED_DISCOVERY_ENABLED=false` 可单独关闭扩展发现并保留小时监测。暂停国家会跳过尚未开始的自动小时任务，已进行的单次请求可以完成。

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

生产服务在 [本机 3000 端口](http://127.0.0.1:3000) 同时提供后台与 API；迁移随构建复制，在启动时执行。默认监听本机。长期运行应由所在平台的进程管理器保持 Node 进程运行（Linux 可用 systemd，macOS 可用 launchd）；本项目没有安装系统服务或部署云服务器。进程停止、机器休眠或断网期间不能保证准时采集；恢复时合并错过的周期，并展示排队与逾期状态。CLI 与服务共享数据库旁 `.full-scan.lock`，不能以集群或双进程同时采集。对外提供访问时，用 HTTPS 反向代理，并配置精确的 `ALLOWED_ORIGINS` 和 `COOKIE_SECURE=true`。

## 后台能力

- 市场概览：国家覆盖、自动或人工确认分类、近期变化和采集运行情况。
- 市场动态：按北京时间自然日分别查看系统首次发现、商店披露发布和实际观测变化，区分应用数与事件数，提供完整前后值与采集时间。
- 应用库：国家/商店/分类/识别证据过滤，名称/开发者/ID 搜索，手动添加应用，CSV 导出。
- 详情：公司与开发者、商店完整字段、权限与隐私、版本历史、评分分布、截图、评论原始信息，以及可翻页的快照、搜索发现和补充采集历史。
- 信贷识别：六国语言启发式规则，展示描述原文、主体声明、APR/利率/费用/期限证据、适用政策与版本。人工分类优先，可明确切回自动模式。
- 市场设置：扩展国家、当地语言关键词及启停；统一 60 分钟详情监测。
- 任务中心：持久队列、进度、错误、有限重试、手动重试与重启恢复。
- 账号与权限：平台运营、客户管理员、研究员和只读成员；带盐 scrypt 密码、HttpOnly 持久会话、服务端撤权、同源检查和登录限速。

## 研究工作台与客户账号

正式工作台沿用已验收原型的今日市场、应用库、我的关注、研究空间与运营二级入口。独立原型仍在 `prototypes/research-workspace/`，其中的虚构应用、图例和演示角色不进入正式库。需求与接口见 [正式需求](docs/requirements/RESEARCH-WORKSPACE-PRODUCTION.md) 和 [API 契约](docs/requirements/RESEARCH-WORKSPACE-API.md)。

第一次使用客户研究功能时，平台运营在客户管理创建空间，生成首位客户管理员的邀请链接，由管理员复制分享。接收者打开链接、设置至少 12 位密码后登录；已有邮箱必须使用原账号密码接受，不覆盖账号密码。邀请默认 7 天、一次性，可撤销或重新生成；不会发送邮件，也不宣称验证了邮箱所有权。客户管理员继续邀请本空间研究员或只读成员，不能提升平台权限或移除最后一位有效管理员。

`ADMIN_PASSWORD` 仅用于平台运营，不能读取客户备注、集合、关注或导出。客户账号使用邮箱与各自密码，用户只能切换自己的有效成员空间；停用空间或移除/降权成员后旧会话立即失效。只读成员不写关注、研究或已读状态。客户会话持久保存 12 小时，登出撤销；设置 `SESSION_SECRET` 时旋转该值会使原会话不可用。对外部署仍需要 HTTPS 和 `COOKIE_SECURE=true`。

客户市场只包含已确认信贷，默认“个人现金贷及待细分”。已有 confirmed 不代表已核对个人现金贷，初始细分类为“待细分”；平台可记录原因后人工细分，保留原信贷识别与人工决定。可切换严格个人现金贷、其他信贷、待细分或全部已确认。九字段排序在服务端对整个查询执行，默认公开累计安装下限倒序、缺失末位；商店发布在最近更新之前，App Store 下载仍为未知。

应用库查询快照冻结有序身份和列表显示值，按会话隔离、SQLite 持久、12 小时有效、每会话最多 20 份；翻页继续同一快照。每 15 秒仅检测当前查询是否变化，点击后才替换清单。过期、淘汰或权限变化明确提示重新读取，不静默切换实时 offset。退出/切换空间清除浏览器范围缓存。快照只保存紧凑列表行，不复制商店原始 HTTP 大对象。

关注分组、集合、备注和带来源的摘录在本客户空间共享，个人已读按成员隔离；并发编辑备注用版本冲突返回 409，防止覆盖别人的修改。摘录由服务端验证来源记录属于该应用，固定原文/字段/记录 ID/来源时间；后续市场变化不改写既有引用。应用失去公共可见性时，原空间保存的研究仍保留，但不能据此访问受限详情。Markdown 导出提供完整空间或集合下载响应；浏览器预览/复制可作补充。

客户提交包名收录申请后，平台核对并排入原有真实持久采集队列。排队/占位只表示处理中，须有本次成功详情且 confirmed 才为客户可用；失败、拒绝、待确认分别展示。原采集限速、小时/六小时调度和 #11 固定批次不因新工作台改变。

规则管理的在线开关仅为“强信贷证据自动确认”，配置有独立版本；影响之后采集/分析，显式重新分析使用已有资料和原观测时间，保留人工/legacy决定。官方政策事实、规则词表和正则仍通过代码与 GitHub 审核管理，页面不提供无约束政策编辑。

新增 SQLite 表以 `research_` 为前缀，包含用户、空间、成员、邀请、会话、分组/关注、集合/条目、个人已读、收录申请、细分类、配置、查询快照和审计。数据库同时包含客户私有研究和认证材料，备份需按私有数据管理，不能提交 Git 或作为不受控 AI 的公开数据源。升级/回滚操作见 [工作台升级说明](docs/operations/RESEARCH-WORKSPACE-UPGRADE.md)。

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

同一 `--batch-id` 恢复未完成任务；`--retry-failed` 重试失败项，`--retry-warnings` 仅重试原始响应可被已验证布局适配恢复的 Google Play 开发者目录告警，保留原尝试和数据历史。`--max-tasks` / `--max-minutes` 仅暂停，不代表完成。Google Play 评论沿下一页 token 继续，App Store 受公开第10页边界限制。Apple详情默认按50个同国家ID批量lookup，仍保存每个App的原文、真实观测时间与来源；缺项或缺截图回退单项请求，`--apple-batch-size 0` 可关闭优化。

要让小时监测与未完成的批次共同运行，停止独立 CLI 后启动 `NODE_ENV=production npm start`。服务自动恢复最近已有待执行任务、已冻结范围的批次；可用 `FULL_SCAN_BATCH_ID` 指定既有批次。协调器最多执行 3 个小时任务后给已就绪批次 1 个任务，再给手动队列 1 个任务；空队列让出槽位。所有路径共用全局 HTTP 限速和 iTunes 至少 3100 ms 的额外间隔。小时详情不自动派生评论或七类补充，小时发现也不扩张旧批次成员。

精确恢复特定失败页时，先停止服务并备份，使用带范围的维护命令。它保留旧尝试序号、响应和历史，仅给所选失败任务新的有限尝试预算；成功任务不重排，其他批次或错误类型的 ID 会拒绝：

```bash
FULL_SCAN_WORKER_STOPPED=true npx tsx scripts/full-scan.ts --batch-id finance-2026-09-07 --retry-failed --retry-kind reviews --retry-task-ids 49999,50000,50001,50002,50003,50004,50005 --retry-only
NODE_ENV=production npm start
```

`--retry-only` 不发采集请求，执行后退出并释放锁；它是显式的一轮维护操作，不应加入周期命令。独立 CLI 的 `--serve` 仅提供查询后台，小时监测由正常服务内的协调器运行。

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

每小时监测的本机常驻部署、launchd示例与停止/恢复步骤见[本机服务操作](docs/operations/LOCAL-SERVICE.md)。模板本身不代表已安装服务；实际运行状态以部署报告和产品监测状态为准。

静默刷新与扩展发现分别通过[#21](https://github.com/zequnjiang/appeye/issues/21)和[#22](https://github.com/zequnjiang/appeye/issues/22)跟踪。[正式部署证据](docs/reports/SILENT-DISCOVERY-DEPLOYMENT.md)、[前端PM验收](docs/reports/SILENT-REFRESH-PM.md)和[扩展发现PM验收](docs/reports/EXTENDED-DISCOVERY-PM.md)记录独立测试、目标真实补录及已知来源限制。

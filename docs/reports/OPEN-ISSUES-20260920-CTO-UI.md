# 开放 Issue 前端 CTO 自检（2026-09-20）

状态：**实现与 CTO 自检完成，交 Alex 独立验证；尚不是 PM 验收或发布证明。**

需求：[OPEN-ISSUES-20260920.md](../requirements/OPEN-ISSUES-20260920.md)。本报告覆盖 #27、#28、#29、#30、#31、#33、#34、#41、#44、#46，以及 #32/#45 的前端证据展示。#11/#24 采集运营、#32/#45 已存分析维修和 #47 CSV 后端由 CEO 单独交接。

源码首次冻结于 **2026-09-20 04:01 UTC（北京时间12:01）**；文末 #46 增量补齐后于 **04:13 UTC（北京时间12:13）再次冻结**。仅修改 `src/**`、`tests/open-issues-ui.test.ts` 与本报告；未操作真实数据库、采集进程、3000 端口或生产 `dist/`，没有提交/推送 Git。自检使用隔离 Vite 与浏览器 API 夹具，不将夹具结果冒充真实商店或真实数据库联调。

## 修改与 AC 映射

| Issue / AC | 最终行为与覆盖 |
| --- | --- |
| #27 OI27-01–02 | 手动任务显示关联应用名称、外部 ID、国家、商店及内部编号，提供复制与精确详情入口；无关联发现任务明确无 App。正式 Workspace 与旧入口均保存筛选、页码、展开项和返回阅读位置。读取与返回不派发采集。使用后端新增 `appTitle/externalId`，缺失关联不伪造名称。 |
| #28 OI28-01–02 | 状态筛选空显示“没有匹配的手动采集任务”与查看全部，真正全局空才显示创建引导；分页越界有回首页入口。接口错误不是空态。页面明确仅统计手动任务。 |
| #29 OI29-01–02 | 新旧市场/所选动态、详情共用完整年份与北京时间展示；date-only 校验后原样保留。缺年、非法日和无明确时区的非标准文本保留原值并标待解析，避免浏览器自动补年/回卷。发布、观测、首次发现分别展示。 |
| #30 OI30-01–02 | 详情优先可信规范发布日期；没有规范日期但 `releasedAtRaw/storeData/rawDetail` 有原文时显示“已取得原文，日期待解析”和原文。仅真正无值显示商店未提供；没有改来源值或精度。泰文规范化沿用服务端可信映射，本次不在客户端再猜日期。 |
| #31 OI31-01–02 | 趋势仅使用有效数值及真实观测时间，按时间排序；图面及窄屏可读范围直接显示完整日期/小时分钟、北京时间 Asia/Shanghai，不必悬停。保留零值、实际窗口和最近50次口径。 |
| #33 OI33-01–02 | 统一 `sourceToText` 为详情、版本历史、所选变化中的更新说明提供纯文本换行/段落/实体转换；不将原文插入 DOM、不生成来源链接，不修改 raw/证据 offset。只识别明确格式标签与合法属性，普通 `a<b and c>d` 保留。 |
| #34 OI34-01–02 | 发现诊断的输入草稿与已提交身份分离。Workspace 保存提交查询、来源页码、展开项、完整采集记录分页和阅读位置；详情返回恢复原上下文，提交新身份重置有效页。错误和迟到请求仍走既有缓存/世代隔离。 |
| #41 OI41-01–02 | 失败列表明确为跨周期最近失败，显示每项真实失败时间、cycleId/计划/启动时间、市场、类型、尝试与错误，标识当前/其它周期；缺值显示未提供。当前周期计数没有冒充跨周期分母，详情往返保展开。 |
| #44 OI44-01–02 | 统一 `ChangeComparison`：中文字段名加技术原名，变化前/后各自标注。桌面三列对齐，窄屏堆叠；零、null、对象和长文本完整可读，保留快照/来源/观测时间。 |
| #46 OI46-01–02 | 当前隐私链接缺失时，仅从同 appId、相同请求国家且具有上次成功时间的 privacy 补充显示历史链接、成功时间、来源与跳转入口；明确当前缺失及未核验历史有效性。HTTP(S) 以外不链接，无成功证据不补造。当前字段优先。 |
| #32 OI32-01–02；#45 OI45-01–02（展示部分） | 详情与对比共享证据卡，展示完整 numericMin/numericMax 范围、明确声明的上限、原句/来源/offset。`non-loan/savingsYield` 另列“非借款证据”，不会进入借款条款对比。真实旧分析维修执行证据由 CEO 报告负责。 |

关键实现为 `src/display-evidence.tsx` 的纯展示辅助、`ResearchUI.time` 的日期精度处理，以及 Workspace 持有的 Jobs/Discovery/Monitor 视图状态。没有改变应用库15秒仅检测、点击才应用冻结清单的行为，没有改变鉴权与空间清理边界。

## 验证命令与实际结果

| 命令 | 结果与本地证据 |
| --- | --- |
| `npx tsx --test tests/open-issues-ui.test.ts tests/frontend-browser.test.ts` | **25/25 通过，52.172s**。8项本次专项加17项已有浏览器回归，含两轮真实15秒检测、固定清单、返回、撤权与导出。日志 `.artifacts/open-issues-ui-regression.log`。此轮早于最后的普通比较符号补修。 |
| `npx tsx --test --test-name-pattern='OI30/31/33/46' tests/open-issues-ui.test.ts` | **1/1 通过，2.531s**，补入 `Keep a<b and c>d; amount < 30.` 与带合法属性的格式标签后验证。日志 `.artifacts/open-issues-ui-text-preservation-recheck.log`。 |
| `npx tsx --test tests/open-issues-ui.test.ts` | **最新8/8通过，6.618s**，包括最终文本补修；日志 `.artifacts/open-issues-ui-final-test.log`。 |
| `npm run typecheck` | 最终前后端 TypeScript 均通过；日志 `.artifacts/open-issues-ui-typecheck-final.log`。 |
| `npx vite build --outDir .artifacts/open-issues-ui-client` | 最终隔离构建通过，1853 modules，213ms，JS `index-DHSGDrHG.js`；日志 `.artifacts/open-issues-ui-build-final.log`。未写生产 dist。 |
| `git diff --check -- src tests/open-issues-ui.test.ts` | 通过。 |

8项专项覆盖：817任务非首页/展开/详情往返/多种空态/错误；诊断21–40来源、未提交输入与提交身份隔离；390详情原始日期/安全更新说明/小时轴/历史隐私；1280与390所选事件旧新值及历史年份；跨周期失败；真实 `classifyLoan` 输出的 APR 范围与储蓄收益分离；隐私同身份/失败保旧/危险URL反例；缺年和非法日期不猜测。

浏览器截图 `.artifacts/open-issues-comparison-1280.png` 与 `.artifacts/open-issues-comparison-390.png` 已由 CTO 实际查看：桌面前后值并列、窄屏各自有方向标签且完整换行。详情截图另保存于 `.artifacts/open-issues-notes-raw-390.png`。这些是隔离合成数据截图，不是正式页面证据。

## 验证中发现与修复

- 初轮 CTO 夹具曾使用错误导航名称、漏模拟可访问旧市场 API，产生2项失败；已修夹具，并保留初轮及后续输出，未以产品 fallback 掩盖。
- Alex 独立浏览器验证发现实际转换缺陷：泛化标签正则误吞普通比较文本 `a<b and c>d`。已限制为已知格式标签及明确属性，保留不确定尖括号文字，并将该反例加入 CTO 浏览器专项。此为真实代码修复，不归为测试错误；最终8项已绿，Alex独立复验另见其报告。
- 没有重新运行整个项目 `npm test`，不以本报告宣称全库全部用例或正式数据验收完成。前端相关旧回归、当前专项、类型及隔离构建如上分别记录。

## 正式交接与剩余工作

交 Alex 独立验证以上 AC，特别是其原 #33 红用例、任务中部阅读锚点与失败保旧、诊断迟到请求、390/817布局及同身份历史隐私。CEO准备的真实样本数据库/隔离真实 API 联调尚未由本报告冒称完成；实际 Kredivo、历史 Apple、PeraMoo、PK 隐私样本及正式维护发布证据应由后续真实样本/发布报告补齐。

本次前端代码可进入隔离真实 API 联调；最终发布、CI、PM逐Issue验收和关闭由 CEO/PM 管理。没有已知 CTO 专项未修失败；Alex/真实样本新发现仍需独立闭环。

## #46 历史成功后成功空值的增量补齐

初次交接后，PM指出：当前补充视图成功返回空值时会清空 `data`，更早的成功隐私链接仍在历史表，不能只检查当前 `enrichments`。CEO授权后端按同 app/国家读取最新有安全链接的历史成功记录；前端接入可选 `historicalPrivacy`（含 appId、historyId、url、source、fetchedAt、requestCountry/requestLanguage）。

前端明确校验 appId 和国家一致、安全 HTTP(S) 及成功时间。字段为 `null` 时不回退旧当前资料；仅 `undefined` 兼容旧 API 夹具。旧 fallback 同样拒绝不明确国家。概况使用历史自身 fetchedAt/source/historyId，即使最新补充是成功空值，也不会把链接的观测时间改成最新空值时间。当前 `app.privacyPolicy` 仍优先，历史链接没有被提升为当前值。

新增真实浏览器夹具覆盖“较早 available 链接→最新 empty 的 DTO→仍显示旧链接/旧时间/历史编号”，然后验证当前链接出现后不显示历史提示；纯辅助反例覆盖 appId/country/null-country/危险URL/缺时间，以及权威 `null` 不降级 fallback。

- `npx tsx --test tests/open-issues-ui.test.ts`：**最新9/9通过，7.428s**，日志 `.artifacts/open-issues-ui-history-final.log`。
- `npm run typecheck`：通过，日志 `.artifacts/open-issues-ui-history-typecheck.log`。
- `npx vite build --outDir .artifacts/open-issues-ui-client`：通过，日志 `.artifacts/open-issues-ui-history-build.log`；仍未写生产 dist。
- `git diff --check -- src tests/open-issues-ui.test.ts docs/reports/OPEN-ISSUES-20260920-CTO-UI.md`：通过。

此增量再次交 Alex 定向验证。前述 Alex 已完成的305项全套结果发生在本增量之前，不能用它替代新增历史分支的后续独立检查；原测试证据保留。

## #49 发布阻断：市场查询的最小性能修复

需求：[ISSUE49-RUNTIME.md](../requirements/ISSUE49-RUNTIME.md)，RUN01–04。此项是后续新增发布阻断，**不由前述界面通过结果代替验收**。CEO给出的正式调用 trace 已定位 `workspaceActivity → libraryRows SELECT a.*` 及重复 `getMarketActivity` 读取；其正式单段1.999s/1.462s属于 CEO trace，本节以下计时则为 CTO 独立合成/备份测量，不能混为同一环境。

本次授权仅修改 `server/workspace-market.ts`、`server/market-activity.ts` 与 `tests/runtime-market.test.ts`，无 DDL、无数据迁移、无正式库写入，无 collector/预算/限速/分页 token/队列/调度修改。其它 #49 批次 summary 与诊断来源查询由 CEO/另一开发分工负责。

### 修复行为（RUN02）

- `workspaceActivity` 的入选身份/类别只需要 id、country、store、category，改为轻量读取，避免为了计算成员数加载并解析全量应用详情与分析。
- 原流程为分页、精选和各国最新动态重复生成完整事件（六国未筛选时共8次）。改为单次生成完整有序集合，同时派生原分页响应、精选4条和各国最新事件；不是从当前页或前200条推算国家卡片。
- 市场查询和所需历史快照仅投影实际展示的 icon/version/releaseNotes/url/storeUpdatedAt/发布日期原文，SQLite `->` 保留 JSON 类型，避免将大 raw/storeData 未使用字段送到 JS。`appIds` 在 SQL 内以 `json_each` 限定，不将不在授权范围的应用大字段取出后再丢弃。
- 公开 `getMarketActivity` 响应形状、窗口/时区、完整类别/国家计数、事件排序、唯一应用/事件区别、分页范围和数据集均保持。普通 `libraryRows` 仅将 `a.*` 改为其实际已使用的列，返回 DTO 和既有过滤/冻结快照/权限检查保持。

### 等值与隔离验证

1. 新 `tests/runtime-market.test.ts` **3/3通过**：64个国家/商店/信贷范围/事件类型/日期/偏移输入与原公开组合完整深等；36市场记录形成360事件，验证超过200条后的分页、全集卡片、精选与按国最新；包含 candidate/excluded 不混入客户集合、unknown分母、零值、invalid/missing/布尔/对象/数组发布日期、首快照与当前来源不同、版本变化及 old/new 原值。调用后原 apps 全行不变。
2. 修改前两个模块已冻结在 ignored `.artifacts/runtime-market-before/`（仅调整模块导入路径以可单独执行，函数逻辑未改）。独立 `.artifacts/runtime-market-benchmark.ts` 在同一隔离内存 SQLite 上调用前后实现：**64查询完整响应深等、9种原文类型深等、apps/snapshots/changes/research_app_categories 四表全行保持**。摘要 `.artifacts/runtime-market-equivalence.json`。这同时覆盖了新旧底层 JSON 投影，而非仅将新函数与自身比较。
3. 合成36应用、360事件、应用 JSON 大于9MB时，实际事件人口查询1次、传到JS的投影 JSON 合计7011字节；4轮前44.5–49.8ms、后11.8–12.7ms。该内存数据有明确合成填充，不代表正式磁盘/collector吞吐。
4. `npx tsx --test tests/runtime-market.test.ts tests/hourly-market.test.ts tests/research-workspace.test.ts tests/alex-research-workspace.test.ts tests/open-issues-backend.test.ts tests/alex-open-issues-backend.test.ts`：**52/52通过，2.090s**，日志 `.artifacts/runtime-market-regression.log`。覆盖小时来源/历史保护和客户鉴权/分类/快照/CSV既有回归。
5. `npm run typecheck` 通过，日志 `.artifacts/runtime-market-typecheck-final.log`；限定源码 `git diff --check` 通过。未向生产 dist 构建。

初轮3项中1项因夹具假定“第一个国家必为TH”失败；真实默认国家顺序并非该假定，已在测试按实际身份查找，产品代码未为测试改国家顺序。原初轮输出 `.artifacts/runtime-market-tests.log` 和复跑 `.artifacts/runtime-market-tests-recheck.log` 均保留。

### 完整备份只读测量（RUN01/02）

CEO明确授权后，对 `data/backups/appeye-before-2026-09-20-release.sqlite` 使用 `DatabaseSync({readOnly:true})` 加 Store 原型 facade；**没有调用 Store 构造、迁移或运行任何写语句**。脚本 `.artifacts/runtime-market-real-readonly.ts`，摘要/时点/响应哈希 `.artifacts/runtime-market-real-readonly.json`，没有在报告输出应用资料或原始响应正文。所有输入固定日期与相同参数，避免默认时钟造成假差异。

| 固定真实输入 | 修改前 | 修改后 | 完整响应 |
| --- | ---: | ---: | --- |
| 2026-09-20 / 六国 / cash-priority / all / limit20 offset100 | 737.6ms | 31.3ms | deepEqual；总72、6国家卡片，越界页空 |
| 2026-09-20 / PH / Apple / all贷款类别 / observedUpdate / limit1 | 82.5ms | 6.1ms | deepEqual；无匹配事件分支 |
| 2026-09-07 / TH / unknown / firstSeen / limit5 offset20 | 330.5ms | 27.6ms | deepEqual；总87，当前页5 |

这是同进程先旧后新、现有系统缓存下的3次只读备份对照，**不是冷盘基准、正式并发测试、持续吞吐结论或全107GB逐字节审计**。不能把该改善倍数外推为整个服务的固定提升。

### 交接及未完成门禁（RUN03/04）

两个市场模块与专项已完成 CTO 自检，可交 Alex 独立等值审阅及 CEO 隔离构建。此处不宣称 #49 已解决：仍须合并同一 Issue 的其它已证阻塞修复，正式唯一 collector 持续推进时完成 PM 要求至少60秒/每5秒交错首页与 health、每次2秒内及原失败诊断往返验证，再经 Alex/PM/精确HEAD CI放行。

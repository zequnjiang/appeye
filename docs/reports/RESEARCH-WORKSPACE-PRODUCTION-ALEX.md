# #42 正式研究工作台：Alex 独立验证

需求：[RESEARCH-WORKSPACE-PRODUCTION.md](../requirements/RESEARCH-WORKSPACE-PRODUCTION.md)，API：[RESEARCH-WORKSPACE-API.md](../requirements/RESEARCH-WORKSPACE-API.md)，[Issue #42](https://github.com/zequnjiang/appeye/issues/42)。

**Alex 独立测试通过，已完成工程、真实资料副本流程及正式部署只读核验，交 PM 最终验收。** 下文保留早期后端阶段和独立反例，追加最终冻结回归及副本实际操作。不得以本报告关闭需求或宣称原扫描 #11 完成。

## 后端独立结果

2026-09-09 05:43 UTC，基线 HEAD `3587bd19f91d53026943d4513223f0ee4321363b` 加当前未提交 #42 工作树。CEO 完成后端自检并交接后，Alex 独立新增 [12 个场景](../../tests/alex-research-workspace.test.ts)，随后复跑关联回归：

| 检查 | 实际结果 |
| --- | --- |
| `npx tsx --test tests/alex-research-workspace.test.ts tests/research-workspace.test.ts tests/api.test.ts tests/v02-api.test.ts tests/v02-migration.test.ts` | 31/31，0 失败/跳过，2.553 秒；其中 Alex 独立 12 项、CEO 研究工作台 7 项、既有 API/迁移 12 项。 |
| `npx tsc --noEmit -p tsconfig.server.json` | 退出码 0。 |

日志：`.artifacts/alex-research-workspace-backend.log`、`-backend-types.log`；13 个源码/测试/日志 SHA256 位于 `.artifacts/alex-research-workspace-backend-manifest.json`。本机 Node v25.9.0，不代表远程 Node24 CI。没有运行覆盖生产 `dist` 的构建。

所有新增场景使用内存 SQLite、127.0.0.1 临时 HTTP 服务、虚构账号和注入 provider。收录用实际 worker 执行注入的详情响应，未请求商店、操作正式数据库或启动生产采集。上述隔离结果不作为线上迁移与吞吐证明。

## 独立覆盖与缺陷闭环

| 范围 | 实际验证 |
| --- | --- |
| AC02–04 身份与隔离 | Viewer/platform 对 16 类研究写操作全部 403；跨空间组/集合/条目替换 ID 为 404。拒绝前后全部私有表及审计行摘要相同。平台无法导出客户研究。工作区停用撤销原成员会话与快照。 |
| AC02/04 凭据与事务 | 同平台密码独立 salted scrypt；重建服务后客户合法 cookie/snapshot 保留，平台密码及 SESSION_SECRET 旋转分别拒绝旧权限。邀请接受在审计写入故障时整体回滚用户/成员/消费状态，解除注入后同 token 成功一次。日志中的 `Synthetic invite audit failure` 是本项预期 500，最终断言通过。 |
| AC05–08 市场与快照 | 20 个快照硬上限/淘汰、过期、跨用户与平台 token 拒绝；probe 不生成新快照。分类细分与当前事件范围一致，0 有效、null 尾部；人工细分未改写旧 app/snapshot。关联既有测试覆盖九字段双向排序、冻结跨页、服务重建与公开可见性撤销。 |
| AC06/07/08/13 日期同源 | 使用实际 `normalizeApp` 处理泰文佛历、西语、印尼语、英文日期，核活动/日期筛选/已读一致；日期精度不补成午夜，无法确认的原始日期保留未知。三个独立缺陷均见下表。 |
| AC13/14 研究与引用 | 外应用 review ID、错误字段/正文、自传来源时间/URL、失败 enrichment history、当前资料伪造 recordId 均拒绝；旧成功补充仍可引用。评论后来更新、应用 excluded 后原摘录/时间保持，当前受限评论仍 404。并发同 revision 编辑为一成功一 409；移除作者不删除空间共享研究。 |
| AC15 导出 | 实际 UTF-8 Markdown attachment 包含所选集合全部 27 条，排除集合外条目与另一客户私密内容；整空间导出包含未归集条目。Viewer 可读导出，夹带 workspaceId 拒绝。验证 HTTP 响应正文，未冒称浏览器已保存到磁盘。 |
| AC16/17 收录 | 两空间同一市场身份复用采集 job，私有备注独立；注入 provider 经实际 worker 生成 snapshot/result，再成为 admitted。保存来源时间与关联 snapshot 相同；人工 excluded 后回到 review，重采不覆盖人工决定。规则与旧管理路径通过关联自检回归，前端运营动作尚待验证。 |

| 编号 | 独立反例与修复结果 |
| --- | --- |
| RWP-ALEX-01 | Thai `๗ ก.ย. ๒๕๖๙` 已产生 2026-09-07 发布事件，但库列表日期过滤返回空。首轮独立 8 项为 6 通过/2 失败；CEO 改为复用原始来源日期证据，正向四语样本复测通过。 |
| RWP-ALEX-02 | 对上述真实活动 API 返回的 `storeRelease:<id>` 标已读，原来 404。CEO 改为按同一原始来源判定事件，复测通过。 |
| RWP-ALEX-03 | `Feb 30, 2026` 被旧 normalize 回卷，或模糊 `09/07/2026` 被宿主解析；DTO 在证据已拒绝后又 fallback 成确定时间。新增反向测试首次失败；共享显示投影现仅在原始日期缺失时兼容旧规范字段，明确原文不可解析时为 null/unknown。列表和详情复测通过，原 DB JSON 完全未改。 |

初次失败均为隔离夹具发现，不声称线上用户已出现该错误。CEO 修改实现，Alex 保留需求断言复测，没有降低预期以使测试通过。

## 最终冻结后的独立工程回归

2026-09-09，候选 `e2d550dcbd5be42abbccee917fb19265a8e470ab`。CTO 最终源码交接后，Alex 独立执行：

| 检查 | 实际结果 |
| --- | --- |
| `npm test` | **265/265，0 失败/跳过，48.008 秒**；`.artifacts/alex-research-final-full-tests.log`。 |
| `npm run typecheck` | 前后端退出码 0；`.artifacts/alex-research-final-typecheck.log`。 |
| Alex 后端独立专项 | **13/13**，2.042 秒；新增 CSV 全 25 行冻结、公式/引号/换行/null/0，以及连续 CSV/JSON/probe 撤权、过期同时撤权、GC 缺失 token 保守撤权。陈旧 DELETE revision 409 保留新版、缺 revision 400、当前 revision 成功删除。 |
| Alex 浏览器独立专项 | **10/10**，37.441 秒。保留旧筛选/翻页/详情返回和真实双 15 秒测试，适配完整 principal 与服务端 snapshot 契约；增加自然过期保留、当前及其他查询全部撤权清空、无静默重建、旧 auth poll 不回滚空间、事件详情 404 卸下旧原文/研究动作。 |

最终全套也独立复跑 CTO 的 17 个浏览器用例，含 CSV 下载、墨西哥浏览器日历日期、503 保授权旧详情、404 清所选事件、DELETE revision。未在独立检查中覆盖正式 `dist`；构建与精确 Node24 CI 属 CEO/CTO 的单独操作证据。本机仍 Node25.9。最终源码与日志 SHA 见 `.artifacts/alex-research-final-evidence.json`；早期 manifest 只对应早期源码，不能冒充最终哈希。

## 隔离真实服务浏览器操作

范围为 `5174 → 3001`、真实 HTTP/SQLite 数据持久化，**不是正式 3000**。市场资料是 CEO 从真实库只读抽样出的 2595 App 副本，不是全历史或性能证明。账号是测试邀请开通的持久账号；私有研究由 Alex 在副本真实创建，无真实邮件、商店采集或生产改写。

| AC / 实际时间 UTC | Alex 实际操作与结果 |
| --- | --- |
| 01/06/09/10，06:14:50–59 | 六国当天概览实际 0 首见/0 发布/143 更新、精选 4。TH GP 评分排序第 2 页 20 个 ID 经详情/比较返回全部相同；勾选 4 项、第五拒绝、比较移除与返回可用。 |
| 03/13/14/15，同上 | 客户 A 建/改名分组、建集合、关注、加入集合、写备注、保存实际 snapshot16131 的描述摘录；来源时间 2026-09-08T15:02:42.941Z。API 并发修改后 UI 保存得到 409，原输入保留；读取新版后导出 4992 字符 Markdown 包含全部当前集合正文/引用/来源。B 无 A 内容且跨集合导出 404；viewer 读同空间但无写按钮、直接写 403，重载仍读到持久内容。 |
| 02/03/04，06:19:16–19、06:23:15–17 | 平台私有研究 403；平台真实建空间/生成首管理员邀请，新 context 接受并登录，消费后 token410。最后管理员移除拒绝；管理员生成 viewer 邀请后撤销，旧 token410。之后同一个真实账户接受第二空间邀请，切换隐藏前空间集合，返回恢复原集合。邀请令牌/凭据不进入公开报告。 |
| 16，06:19:18–19 | A 申请 id1 最初 pending/job=null；平台批准变 processing/job1，副本无 collector，明确不是 admitted；平台拒绝并填写原因，原客户能看到原因。真实成功入库路径由隔离实际 worker＋注入 provider 测试证明，不冒称本副本已采到新详情。 |
| 08/09/15，06:18:23–56 | 817×863，TH GP 20 行/总 56。真实两次 probe200 相隔约 14.9 秒、同一 snapshot、changed=false；displayed 全行文案/顺序/总数不变，表格移除 0、scrollY0。取得浏览器 CSV 下载流 `appeye-market-snapshot.csv`，24945 UTF-8 字节与 SHA 留存。此静态副本窗口没有新变化；“有变化→pending→点击”的竞态由独立夹具验证，不冒充自然实采。 |
| 07/11/12，06:18:56–58、06:20:39–40、06:23:12–15 | 真实 App2520 的 8 张截图 Enter→右键→Esc 后焦点回到触发按钮；商店 gl=th、官网/隐私真实 URL 为 HTTP(S)，全部新标签具 noopener/noreferrer。App790 GP 权限36项默认6→展开36→收回6；App1610 Apple 为 unsupported、无 Android 条目，390无横向文档溢出。Mexico_City 浏览器仍显示原日历 2016-10-14。真实事件 observedUpdate:733:17453 的 sourceUrl 与入口一致，返回当天首页。其他详情 tab、评价/快照/变化来源入口实际载入。 |
| 17，06:20:36–40 | 实际规则开关通过 API 落库递增版本并恢复初始 true；候选核对、诊断、采集运行、国家配置实际导航均无 alert。未在副本启动采集；这些只读页面不代替后端有限任务/配置测试，也不代表原批次终态。 |

证据：`.artifacts/alex-research-live.json`、`alex-research-operations.json`、`alex-research-reading.json`、`alex-research-final-tails.json`、`alex-research-scope-details.json` 及同名 `.mts`。最终 manifest 对各文件逐一记录 SHA，页面错误记录均为 0。操作实际归属为 Alex 的项目隔离 Chrome；不是用户已有浏览器或生产 IAB 操作。

保留探针边界：早期 exact label 对含现有文本的 label、包含角色的单元格定位失败；实际事件字段为 `sourceUrl`，探针误用 `source` 得 undefined；异步受控规则开关已成功提交，但 Playwright `setChecked` 的即时 DOM 检查过早。均按实际 DOM/API 修正，没有改业务代码或降低断言。`operations`/`reading` 原文件保留失败结尾及此前成功 checkpoint，剩余动作在 `final-tails` 独立完成，不能把首轮报告说成全绿。初次首页截图是在 loading 时刻，只作探针记录；成功首页事实来自实际 API 和之后事件返回。

## 390 显示缺陷闭环

实际 390 研究空间存在多个约50字符合法集合名时，“全部研究”与第一集合名横排重叠，原证据 `.artifacts/alex-research-live-research-390.png` 保留。CTO 在 `c8c1822` 只修窄屏 CSS 的 minmax 和 flex shrink；Alex 独立短回归 `.artifacts/alex-research-folders.json` 证明 3 个完整长名/操作按钮矩形互不重叠、文档宽度390、末项横滚可选且对应内容改变，错误0；已亲看前后截图。该定向 CSS 增量通过，未无理由重复整套265测试。当前已测工程和实际副本流程没有未解阻断。

## 正式部署独立核验

CEO 受控部署 `c8c18221b595ffae6582d37465e8d26a9797b624` 后，Alex 于 **2026-09-09 06:32:50–59 UTC** 执行 `.artifacts/alex-research-production.mts`，输出 `.artifacts/alex-research-production.json`，**errors=[]**。此处访问正式 3000；只进行业务读取及正常平台 login/logout、库查询快照，没有创建客户/成员/研究或发起采集。数据库采用独立 readOnly 连接、小范围只读事务，未重扫数百万评论正文或整库响应 JSON。

- launchd PID **69287** 运行、采集锁 PID 相同；**212 个正式产物文件**与 CTO/CEO 隔离构建逐项 SHA256 一致，首页和 server/index.js 与 installed 元证据一致。`e2d550d → c8c1822` 的产品差异仅 `src/research.css`，已按上节独立复测。
- 未认证市场 API 401；平台登录身份为 platform，私有 `/research/state` **403**。`/workspaces` 空，SQL `research_users/research_workspaces` 都为 0；没有把原型或测试客户迁入正式库。
- 正式库本次查询 **512 confirmed，512 待细分**；同一 snapshot 首两页无重复、返回 token 相同，完整 CSV attachment **206712 字节**，SHA留存。六国当天 **297 个观测更新**，首次发现和商店发布为0；这些是该时点实际口径，不能与早一分钟 CEO 的511/290硬对齐或混成固定数字。
- AR GP `com.creditouno.loan` 仍为 App2053；真实详情 API 的完整 rawDetail 与 SQLite 最近快照原文深等，未降为示例。
- 对停机前完整备份的小型身份表独立逐项比较：**旧2613个 id/country/store/externalId/firstSeen全部保持、475个人工覆盖分类/来源全部保持、原2024 cohort成员相同、6国完整配置行相同**。新增008为最新迁移、16个研究表存在。
- 三通道实际恢复后的最新成功 HTTP 均大于停机前高水位：full_scan **55560→55614**（06:32:51Z）、monitor **17336→17340**（06:32:15Z）、discovery **4726→4751**（06:32:20Z），均200且保留各自task归属。没有以心跳单独冒充实际执行，也没有重排任务。

**迁移保留证据的归属和范围：** Alex 独立审读 CEO `.artifacts/research-deploy.mjs` 及 `data/batches/2026-09-09-research-{before,backup,migration,installed,live-smoke}.json`。脚本先要求launchd卸载/无打开句柄/锁释放并checkpoint，再APFS克隆；备份 **67,915,177,984字节**，副本独立inode、0600，首中尾块和逻辑摘要由CEO验证。迁移比较38旧表counts/high-water、apps/cohort及12类完整队列/配置行摘要，errors=[]；新增16研究表，默认规则1行，其余为空。Alex 比较公开摘要与脚本比较范围，另直接复核上述身份/人工/cohort/配置；**不声称亲自重算所有旧历史正文 SHA 或67.9GB全文件hash**。迁移及摘要核对100.203秒包含读取开销，不当纯DDL耗时。

CEO 第一次维护脚本对历史响应 `.all()` 超过Node约4GiB堆、在备份/迁移前退出；改为 `.iterate()` 流式摘要后成功。该现场事实与被修正的维护工具如实保留，非已部署API缺陷。CEO 冷启动 health 11.555秒以及后续实际接口耗时见其报告；副本的毫秒数不冒称正式全库性能。

## 最终交接

已完成本轮有意义的独立自动/真实HTTP/浏览器/运行验证，日期三处、范围撤权/DELETE与详情门的联调反例、390长名显示均闭环。**当前没有未解决的 #42 阻断，交 PM 按 RWP-AC-01–20 最终验收。** CEO负责最终报告提交对应HEAD的两条CI及PR43/Issue42收口；此前e2d550d精确CI通过记录归CEO，不能把本地Node25当远端Node24结果。

实际研究写操作和邀请只在隔离副本；正式库不制造测试客户。新收录成功转换在独立HTTP+实际worker的确定性provider中验证，真实副本验证排队与拒绝，未冒称新增一次真实商店采集。`#11` 扫描及既有源失败仍独立未完：CEO恢复快照中原批次146待续、41评论失败，并有小时/扩展来源失败；本轮没有清除或宣称这些失败已修复。

# 正式研究工作台：前端 CTO 自检

- 对应 [Issue #42](https://github.com/zequnjiang/appeye/issues/42)。依据 [PM 正式需求](../requirements/RESEARCH-WORKSPACE-PRODUCTION.md) 与 [API 契约](../requirements/RESEARCH-WORKSPACE-API.md)。
- 检查日期：2026-09-09（北京时间）。状态：**前端自检通过，交 Alex 独立回归**。不代替 Alex 测试、PM 验收或生产部署结论。
- CTO 文件范围：正式 `src/`、`tests/frontend-browser.test.ts` 与本报告。没有修改独立 4173 原型、生产数据库、采集进程或生产 `dist/client`；后端、依赖及部署由 CEO 负责。

## 实现与口径

| AC 范围 | 前端实际行为 |
| --- | --- |
| RWP-01、05、06 | 深蓝侧栏、六国/可扩展国家总览、当前北京时间日期、同源精选与国家事件；全部来自正式 API。首页请求 `type=all`，具体事件页按选中类型。默认“现金贷优先 · 含待细分”，严格个人/其他/unknown/all 可选，显示冻结查询的 `unknownTotal`。没有原型固定数字、模拟更新、身份切换或 fixture fallback。 |
| RWP-02–04 | 客户邮箱登录、独立平台入口、真实受邀账户接受、合法空间切换、退出；角色来自服务器 principal。客户/平台菜单与实际写 handler 均受限。切换 principal/space/authorizationVersion 时清缓存、待更新与返回上下文；会话轮询有世代检查，避免旧 session 响应盖回新空间。401 清除显示，资源 403/404 不保留失去可见性的缓存。 |
| RWP-07–10 | 今日市场/事件/应用库/关注/集合进入详情并返回原入口；事件携真实 event、snapshot、change 与 before/after。九字段排序、更多筛选、默认累计安装下限倒序由服务端执行；客户端不对当前页冒充全集排序。库只持有受保护快照 token，翻页沿同 token；15 秒只 probe，点击更新才原子接收新 token/rows/total/有效页。20 查询内存 LRU、隐藏暂停、同键单 flight、取消/迟到响应保护；顶部和正文阅读锚点分别恢复。 |
| RWP-11、12 | 复用既有完整详情/原始 JSON、历史变化、趋势、评论和补充历史；平台采集与分类操作加权限门。真实截图灯箱前后/方向键/Escape/焦点恢复，空图和失败态；权限默认六项，可展开全部，原始未知字段保留。官网/隐私用采集字段，官方商店链接使用当前 country/store/externalId，HTTP(S)、新标签和 noopener/noreferrer。2–4 项对比逐 ID 获取授权详情，不排名不同币种或周期。 |
| RWP-13–16 | 本空间共享关注/分组、集合/关联、备注/摘录 CRUD 接真实 API；编辑带 revision，失败/409 留输入且展示真实错误。引用只发送服务器允许的 kind/recordId/field/quote，不伪造来源 URL/时间。不可见应用保留已存研究与引用，关闭当前详情入口。个人已读为稳定 eventId；viewer 不执行写。导出从正式 GET 获取全空间或指定集合 Markdown，显示完整预览/复制与下载尝试，不宣称文件已落盘。 |
| RWP-17–20 | 收录提交/平台批准排队/拒绝理由/有限重试显示真实状态与错误；不把排队当收录。平台复用候选、完整漏收诊断、采集/周期状态、国家配置，新增受控规则开关/重分析和客户成员管理。政策词表只读，邀请只生成可复制链接，没有发邮件或模拟接受。后端隔离、迁移与部署保留证明由 CEO/Alex 另行提供。 |

`LegacyApp.tsx` 保留已有详情和平台操作实现供新壳复用，正式入口是新的 `App.tsx`；原旧壳不挂载。`ResearchMarket/ResearchPanels/ResearchOperations/ResearchUI` 分开市场、研究、成员运营与通用交互。`market-cache.ts` 单独实现正式服务器快照流程；原通用缓存继续用于历史资料并保留展开状态。

## 检查结果

| 命令 / 检查 | 真实结果 |
| --- | --- |
| `npm run typecheck` | 通过：前端与服务端 TypeScript。日志 `.artifacts/research-frontend-typecheck.log`。 |
| `npx vite build --outDir .artifacts/research-production-client` | 通过；输出只在 ignored 隔离目录，生产客户端未覆盖。日志 `.artifacts/research-frontend-build.log`。 |
| `npx tsx --test tests/frontend-browser.test.ts tests/frontend-query-staging.test.ts tests/alex-api-lifecycle.test.ts tests/alex-query-cache.test.ts tests/alex-library-stable-cache.test.ts` | **25/25 通过**，43.64 秒；包括 12 浏览器场景和既有 13 项 API/缓存边界。日志 `.artifacts/research-frontend-final-tests.log`。此处调用 Alex 已有用例作 CTO 回归，不代表 Alex 已正式验收本次实现。 |
| `git diff --check -- src tests/frontend-browser.test.ts` | 通过，无 whitespace 错误。 |

浏览器固定夹具回归继续保留两个真实 15 秒检测周期、817×863 顶部、390×844 返回、DOM/行文本/总数稳定、查询切换 offset 0、慢请求单 flight、隐藏暂停、失败保旧、末页收缩、历史/评论展开及诊断完整采集记录访问。新增两项验证正式 token 跨页冻结/显式更新，以及真实 `<img>`、灯箱键盘焦点、6/9 权限展开和非 HTTP(S) 链接拒绝。

自检过程发现并修复：

1. 新反馈布局在轮询报错时曾把表格下推约 42 px；固定反馈区域后，原位置深等断言复测通过。
2. StrictMode 首次副作用重放曾创建第二份查询快照；初始读取改为加入同键已有请求，只有显式刷新/翻页才可接管，新增 token 测试通过。
3. 灯箱缺少显式 accessible name，补 `aria-label` 后，以真实按钮 Enter → 方向键 → Escape → 原按钮焦点完成验证。
4. 旧移动端诊断测试直接点已收起导航，不符合新导航入口；补真实“切换导航”动作，保留其全部数据、危险 URL、原始响应及采集断言。旧 mock 会话也改为完整真实 principal 契约，未通过 UI 兼容分支放宽鉴权。

## 隔离真实 API 联调

CEO 启动的 `http://127.0.0.1:5174` → `3001` 服务使用公开市场抽样副本和隔离客户记录，没有启动采集。该副本包含 2,595 个市场应用以及有限历史/评论，**不是完整备份或全历史验收**。凭证只从 0600 的 ignored 文件读取，未写入报告、Git 或命令输出。

- 研究员 A 正常邮箱登录 → 应用库 20 行 → PhonePe 详情 → 关注与保存备注 → 返回同一标题/清单 → 研究空间读到真实保存备注 → 正式 Markdown 导出包含该备注。
- 平台入口登录 → 创建独立测试客户空间 → 生成实际管理员邀请 → 新浏览器 context 接受邀请创建客户管理员 → 具有客户成员菜单、没有平台规则菜单。
- 同空间 viewer 正常登录，可读取已保存共享备注；详情的关注/备注/摘录/更新/采集写按钮为 0。
- 1487×1058 截图已人工读取，390×844 文档无横向溢出；上述浏览器 context 的未捕获页面错误均为 0。完整手工视觉与全部客户路径仍交 CEO/Alex 独立核验。

本地证据：`.artifacts/research-production-smoke.json`、`.artifacts/research-production-operations.json` 与对应图片/日志。首份首页证据捕获时使用 firstSeen，出现 0 首发现与 143 更新但精选为空；根据已冻结 API 改为 `type=all`，事件页仍保留类型过滤。该开发中证据保留，不冒称原截图已验证最终首页。

## 交接与剩余工作

前端候选源码冻结，可供 Alex 独立固定夹具、真实授权 API 与浏览器组合测试；旧 `alex-*` 浏览器夹具需由 Alex 按正式 principal 与快照 API 迁移，不能因旧 contract 红而删除验收边界。若发现实质缺陷，再定向修复并复测。

本报告不声称完整全套 `npm test` 已通过、数据迁移已验收、生产已升级，或 #11 原扫描已完成。CEO 的后端自检、Alex 独立测试、PM 验收和受控部署证据另行归档。

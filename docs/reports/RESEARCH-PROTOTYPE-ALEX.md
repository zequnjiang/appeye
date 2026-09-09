# #35 信贷研究工作台原型：Alex 独立验证

- 状态：**Alex正式QA通过，交PM按RP-AC-01–10最终验收；未代替PM关闭#35。**
- 最终结论：原型26项测试、构建与runtime检查通过；CEO执行的IAB核心流程经Alex独立证据/截图审阅通过。真实下载落盘在IAB受限，按PM v1.2采用已验证的完整预览/复制保存路径，限制保留。
- GitHub：[原型 #35](https://github.com/zequnjiang/appeye/issues/35)；需求 [RESEARCH-PROTOTYPE.md](../requirements/RESEARCH-PROTOTYPE.md)，v1.2，RP-AC-01–10。
- 原型范围：`prototypes/research-workspace/`，选定视觉方案1，全部固定mock/本地演示状态。正式3000/API/数据库、商店请求、邀请发送和真实SaaS安全均不在验证对象内。
- Alex文件所有权：原型 `tests/alex-*.test.mjs` 与本报告；不改src、依赖、运行/hosting资产。CEO拥有IAB操作、视觉比较与预览管理；本报告明确区分Alex纯逻辑验证、CEO按检查单执行的浏览器事实及Alex的截图审阅，不冒称Alex另开浏览器执行。

## 独立验证矩阵

| 编号 | 逻辑与浏览器证据要求 |
| --- | --- |
| RP-AC-01 | 页面持续“产品原型/示例数据”，角色空间明确。原型端口与正式服务分离；页面及操作网络记录无生产/API/商店/邮件请求。保留Sites runtime构建检查，不初始化或发布站点。 |
| RP-AC-02 | 重置逐条枚举132主库、120现金贷、12候选；每国22/GP11/AS11；当天30/23/64=117事件，精选4是子集。不同日期/商店/品类与主库统一派生，重复事件按app去重计数，历史日/空日期可用。 |
| RP-AC-03 | 首页TH更新18→国家事件→某一具体版本变化详情/来源→返回原筛选/日期/事件/页/位置；应用库第2页排序后、关注组、研究集合各自进入详情再返回，入口不串。 |
| RP-AC-04 | 9字段双向全过滤集合排序，再分页；0有效/null尾/同值ID稳定，日期按时间；用户排序无隐藏品类权重。模拟新资料未应用时跨页显示修订一致，无重/漏；应用后全集合更新。2–4对比成功，第5项拒绝且可移除。 |
| RP-AC-05 | 132主库每项都有对应详情身份及来源。条款、主体角色、版本前后、指标/评论与来源可达；新发现/商店发布分开，确认来源显示auto/manual；无AI生成结论。 |
| RP-AC-06 | 本地图例缩略→灯箱前后→序号/Esc/入口焦点；示例标识，缺图和加载失败分开。权限默认6项、展开全部、长文本与未知字段；未采集/empty/失败留旧/unsupported/AS隐私另列。 |
| RP-AC-07 | 同一app两客户不同备注/集合不泄漏；新关注组、备注、摘录及集合有本地结果，导出所选空间/集合一致且标示例。个人已读不影响另一用户，只读成员浏览不造成已读写。 |
| RP-AC-08 | 7身份/4角色演示，UI入口、直接演示路由及写处理均约束。管理员仅本空间管理，邀请待接受→模拟接受/撤销闭环；研究员/只读不可越权，运营不默认读取客户研究。 |
| RP-AC-09 | 未命中ID→客户申请→运营处理→客户看到成功身份/详情或拒绝理由；候选/规则/任务/国家/客户成员可见动作更新mock状态；重置恢复初始基线。 |
| RP-AC-10 | CTO自检后Alex正式跑纯逻辑、原型构建及runtime检查。CEO按本矩阵IAB操作并提供本轮事实/截图；Alex独立核视觉选图对应、桌面/817/390、上述关键操作及覆盖限制，再交PM。 |

## 实施中纯逻辑预检

执行于独立原型目录：

```text
node --test tests/alex-*.test.mjs
```

首轮 **9项，7通过、2失败，退出码1**，日志 `.artifacts/alex-research-prototype-precheck.log`。不访问浏览器、网络、正式服务或数据库。

通过范围：132/120/12与每国双店身份、117事件/4精选/国家30–23–64、计数去重/日期/分类、9字段声明及文本数值排序/0/null尾、全过滤集合排序分页不变更源、私有同app研究导出隔离、研究写与平台操作角色谓词。

第二轮补充重复点击边界：**10项，7通过、3失败，退出码1**。已反馈CTO的三个边界：

1. 模拟新增应用的externalId变为 `com.th.newcreditdemo`，但source仍继承原包 `com.th.creditdemo1`，对应事件来源也指向旧身份。须同步新应用与事件的来源身份。
2. 四个日期字段用字符串顺序比较，不同UTC偏移或同一瞬间的等价表示会误排。独立夹具要求按真实日期比较，同瞬间仍按ID稳定排序。
3. 模拟新增应用已经应用后再次检测，结果为134行但只有133个唯一市场身份，app/event ID重复；须幂等保留单个身份与事件。

这些是正在开发的原型逻辑缺陷，原测试保留等待修复。另已向CTO反馈事件入口应携带具体eventId、候选录入同样须绑定新身份来源，以及灯箱初始焦点位于关闭按钮时的方向键作用域，等待实现和IAB验证。尚未完成的页面/示例边界不在此阶段假称已通过，也不把“尚在实现”直接写成生产缺陷。

### 全量示例来源前置核对

按CEO要求仅枚举本地固定fixture，聚合证据 `.artifacts/alex-prototype-data-preflight.json` 保存当时源码SHA、时间及完整问题ID列表。原132条主库的商店URL/market ID均对应自身身份；117个事件的版本前后值均与相应app一致，原主库没有candidate/excluded混入。UI默认库过滤固定confirmed、首页/事件集合也筛confirmed，页面行为尚待正式IAB验证。

时间不一致不只限于精选：30条首次发现事件的`at`与应用`firstSeenAt`不一致，53条事件的`at`晚于所附`observedAt`，18条应用`storeUpdatedAt`晚于`lastFetchedAt`。例如`th-4`商店更新时间10:09，但最近成功观测09:06。已请CTO明确事件时间语义、保持选图固定时刻时同步对应示例观测；date-only发布证据不得被展示时间转换成精确上架时刻。

另有12条business/mortgage示例描述仍称“个人信贷服务”（如`th-21`/`th-22`），与品类字段冲突，已交CTO按品类修复。当前权限数据只有66个GP非空数组及66个Apple null；尚未具备明确的未采集/成功空/失败留旧状态、空图/坏图和历史事件样例。这些列为待补需求分支，不将缺失样例当成已验证状态。

## 视觉及浏览器准备

已读并查看用户选定 `reference/selected-home.png`。预期主结构为深蓝左栏、白色工作区、六国表和四精选行，而不是新增卡片网格或营销页。待CEO提供同viewport、同初始状态的实际截图后，将选图与截图放在同一比较输入，核对字体/层级、留白密度、色彩、资产与文案；817/390单独检查控件可达、横向表格/对比、灯箱与权限换行。

Product Design预检未发现持久用户上下文，使用本次明确选择。遵循IAB浏览器限制；Alex不通过Playwright CLI/Chrome绕过工具选择，也不代替CEO执行Sites生命周期。截图应来自本轮IAB且保存后可读；仅纯源码或构建结果不能替代视觉通过。

## CTO交接后的正式独立工程回归

在独立原型目录执行，全部退出码0：

| 命令 | 实际结果 | 本地日志 |
| --- | --- | --- |
| `npm test` | 21通过，0失败、0跳过；Alex独立12项、CTO5项、runtime4项 | `.artifacts/alex-research-prototype-final-test.log` |
| `npm run build` | Vite生产构建及Sites包装成功；仅原型dist | `.artifacts/alex-research-prototype-final-build.log` |
| `npm run test:sites` | 4通过、0失败；此4项与上方runtime测试相同，不另计为25项 | `.artifacts/alex-research-prototype-final-sites.log` |

输出包含`dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json`；客户端`index-CjMHaNSv.js`及`index-CrD2jxrp.css`。当次源码/测试/日志/入口产物SHA及时间存于`.artifacts/alex-research-prototype-engineering.json`。没有运行正式根目录构建、采集或生产服务操作。

独立12项覆盖原10项及全量132身份来源/事件观测、全部12候选跨六国双店录入与既有人工身份保护。CTO回归覆盖其导出的角色枚举、权限状态、候选录入、时序和空间数据；Alex另只读检查了UI对应handler调用，尚不以此替代真实IAB操作。

缺陷复测闭环：

| 原问题 | 修复及独立验证 |
| --- | --- |
| 新模拟身份/候选source继承错包 | 新身份与事件使用对应商店来源；全部12候选及同市场身份复用通过。 |
| 重复模拟新增/确认产生重复身份 | 重复构造和重复录入幂等，原数据/研究空间不变，既有manual记录保留。 |
| 日期字符串跨时区误排 | 四日期字段按真实时间比较，同刻稳定ID，空值尾、0有效等原断言全过。 |
| 事件/应用时间矛盾及非现金贷描述错误 | 当前事件at为观测时间、首次事件对应firstSeen、发布证据保留日精度、最后成功观测不早于来源；12个其他品类文案对应。增加1条历史事件，当天仍117。 |
| 权限分支缺失、未知状态出现成功时间 | GP available/empty/failed保旧/uncollected分别保留，Apple unsupported；后两者成功时间null，SDK混合原条目和未知字段保留。 |
| 客户角色handler接受非法枚举 | 邀请及成员更新除操作者/空间检查外调用`isCustomerRole`，仅客户admin/researcher/viewer，拒绝platform及未知值。 |

事件入口现传具体eventId，详情默认变化tab标记所选事件；灯箱方向键现绑定dialog，关闭时恢复入口焦点。二者源码修复已确认，交CEO IAB实测闭环。

## 首次正式视觉证据审阅

Alex已将CEO生成的`.artifacts/research-home-comparison-final.png`与`.artifacts/research-header-table-comparison-final.png`作为同输入对照审阅（每张含选图与当前截图）。1487×1058状态下，深蓝左栏、白色主区、六国表、四精选行的层级与相对布局对应；132/120独立数据与首页8/5/18等可见计数一致。选图中的“共4条”调整为明确“精选4条”、可编辑日期及示例检测提示属于本需求功能适配。视图不能证明点击行为；817/390、完整往返、权限/图、研究/角色及收录的浏览器事实仍等待本轮核验。

### IAB首轮实际操作及尚未闭合项目

CEO执行、Alex独立读取的`.artifacts/research-browser-evidence.json`包含首页六国计数、具体事件选中/来源、评分排序第三页的相同12身份、pending未应用仍120条及应用后121、对比第5项拒绝/保4项、权限6→10、North备注写入/South未泄漏、viewer写按钮禁用、管理员邀请待接受→接受，以及AR申请→运营处理→客户对应包详情。

该首轮事实没有被全部标为通过：列表初始scroll390，但点击屏外首行可使浏览器自动滚动，返回0不能证明阅读位置恢复；`event-back.market`实际读到身份select，不能证明国家筛选。CEO正在按可见行与具体事件表单控件补充精确观察。灯箱按钮入口Enter→Esc后，CEO后续独立call确认焦点落BODY，已判真实焦点缺陷交CTO；方向键/关闭成功不替代焦点返回。

下载最初没有IAB下载事件；CTO改为挂载anchor后激活、延后60秒撤销URL后，IAB仍未触发下载事件。这个结果保留为实际浏览器能力/交付边界，不标成已成功保存文件。CEO授权新增完整导出预览、复制和继续下载；后续可以把浏览器可见内容用文件工具保存为验收MD并核对，但必须明确不是IAB已下载落盘。MD一种格式由PM v1.1确认为满足格式选择，空间/集合/来源隔离要求不降低。内部route渲染守卫与handler检查则按PM确认的方法核验，不虚构不存在的URL深链测试。

## 最终冻结工程及精确浏览器复测

加入明确标注的TH9故意坏图、下载请求/预览与StrictMode灯箱生命周期修复后，再修复首页静态相对时间：最近动态改由当前国家/日期/确认分类/现金贷范围的实际最新事件派生，显示真实示例观测时刻/事件/应用名。Alex追加两项独立回归，覆盖别国/别日/排除项/其他信贷类型不能抢当前范围、时区比较及同刻稳定、历史/空日，以及pending生成不改变当前来源、显式使用新输入后才选中新身份。

最后完整执行：`npm test` **26/26通过（Alex14、CTO8、runtime4），0失败/跳过**；`npm run build`成功，`npm run test:sites` **4/4通过**。日志分别为`.artifacts/alex-research-prototype-acceptance-test.log`、`-build.log`、`-sites.log`（共同前缀`alex-research-prototype-acceptance`）。最终客户端为`index-B1NQPOgW.js`与`index-C-O7JQQq.css`。此前21项结果和初始失败记录保留，不改写成同一轮结果。

精确IAB复测由CEO执行，Alex独立读取追加事实：

- **阅读位置**：先将可见入口聚焦，再记录离开前状态，`app-id-18`、评分排序第3页、scroll284；返回时三者一致。此前scroll390经浏览器自动聚焦到284/0的不同探针保留，未用它们证明精确恢复。
- **灯箱焦点**：修复后真实`screenshot-0`按钮Enter打开→Esc关闭→下一次独立读取，dialog数0且activeElement为`screenshot-0`/BUTTON，原BODY问题闭环。前后/方向键和2/2序号已在本轮IAB核验。
- **完整导出**：重置后的North空间预览823字符，复制后剪贴板逐字一致。CEO从可见textarea通过文件工具保存`.artifacts/research-north-export.md`；Alex独立读取为1009 UTF-8字节，并与当前North固定集合的`exportResearch`结果逐字完全相等，SHA256 `e6502acbb724ddd5eb73780f7ccda6a8fa8e3d39126150ac3e8388bdca61a30e`。含两个North集合、North备注、来源与示例标签，无South备注。**这证明预览/复制内容，不证明IAB文件下载落盘。** PM v1.2明确接受该浏览器环境下的完整预览/复制保存路径。
- **图片/权限分支**：TH9故意本地失败图的灯箱1/1明确失败，重试仍保留失败；TH1正常双图与其他缺图分开。GP成功空、未采集和失败保留旧10条及2026-09-07成功时间/原来源均已实际访问；Apple显示接口不支持、隐私另列，不能当零权限。
- **响应式审图**：Alex亲看`research-817-home-final.png`、`research-817-library-final.png`、`research-390-library-final.png`、`research-390-permissions-final.png`。817/390保留示例标识、导航及排序筛选；表格内部横向滚动，控件无互相遮挡，权限窄屏单列且长状态换行。最初名为390-library的截图实为首页，CEO已纠正归类为390-home并重新采集真实应用库；未以文件名误认覆盖。

源码静态覆盖与实际操作保持区分：所有权限/路由谓词与主handler、客户研究scope、身份切换清理经过只读审查；没有声称测试了不存在的公开URL深链或服务器权限防护。纯函数覆盖全部132/12数据，而浏览器使用代表性应用及关键路径，不声称逐项打开了132个详情。

## 最终证据核对及PM交接

最终`.artifacts/research-browser-evidence.json`新增事实已由Alex逐项读取并用独立Node断言检查：评分第3页的12个身份前后完全相同，精确聚焦后的页面/滚动/焦点前后对象完全相同，灯箱最终按钮焦点、TH/updated/2026-09-08事件过滤均吻合。新关注组创建、改名并进入详情返回后仍选中“权限观察示例已改名”，保留1条应用；来源摘录加入新集合后，限定集合导出没有其他集合内容。同North研究员已读与管理员未读彼此独立；七身份均在IAB切换，平台详情研究页显示明确拒绝默认访问。

`.artifacts/research-collection-export.md`与IAB可见textarea记录逐字相等，包含“验收来源集合”、选定资金桥条款摘录及该应用URL，不含初始两个空间的其他集合标题或South私有备注；属于文件工具保存的可见内容证据。全空间823字符导出和限定集合导出分别核对，未混用其范围。

IAB `pageAssets`观测到26个资源（16脚本、5样式、4图片、1字体），Alex逐URL检查全部源自`http://127.0.0.1:4173`，无所观测外联。**该清单是页面资产观测，不是全会话网络抓包。** 最后reload窗口自2026-09-08T21:55:59.929Z起，记录的console error/warn均0；此前HMR和故意坏图案例不并入此窗口。原型代码仅本地fixture/React状态，本轮未访问或修改正式3000/API/数据库。

| AC | 最终QA结论与证据范围 |
| --- | --- |
| RP-AC-01 | 通过。独立目录/4173、持续示例标识、原型自身构建产物；本地资产观测与源代码边界一致。 |
| RP-AC-02 | 通过。全132/120/12、每国双店、当日117/精选4及历史事件可枚举；最近动态已同源派生，空日IAB18项计数为0。 |
| RP-AC-03 | 通过。具体eventId及来源、TH日期类型、清单精确页面/焦点/滚动、关注组返回有IAB证据；集合沿相同路由栈实现，经静态审查，不声称每个入口的所有过滤组合均逐一操作。 |
| RP-AC-04 | 通过。九字段双向及跨页全排序/缺失/0/同刻独立测试；IAB评分第三页、pending保持→显式121、最多4及第5拒绝。 |
| RP-AC-05 | 通过。全身份/来源与事件时间静态枚举，条款/公司/版本与示例精度核对，代表性详情实际访问；无AI/资质核验声明。 |
| RP-AC-06 | 通过。正常双图、缺图、故意坏图重试；方向键/计数/Esc原入口焦点真实红→绿；权限6→10、四状态和Apple边界、390单列可核。 |
| RP-AC-07 | 通过（导出采用v1.2环境路径）。备注跨空间不泄漏、分组与来源摘录集合有本地结果、个人已读隔离；全空间与限定集合内容独立核对。IAB下载落盘未通过，不虚称。 |
| RP-AC-08 | 通过。七身份切换、管理员邀请接受、viewer禁写、平台私有研究拒绝有IAB事实；角色枚举/空间/route及handler静态与纯测试补充，没有真实SaaS安全完成声明。 |
| RP-AC-09 | 通过。AR包名申请→运营处理→客户对应身份详情真实本地闭环；全部12候选录入/重入/既有人工保护由独立测试覆盖；运营规则/任务/市场/成员可见操作handler只读复核，未泛称每个运营按钮均IAB逐一测试。 |
| RP-AC-10 | 通过。CTO→Alex顺序保留，最终26测试/build/sites4、桌面/817/390与关键流程证据齐；最终产品放行由PM完成。 |

最终审阅聚合`.artifacts/alex-research-prototype-acceptance.json`包含源码/独立测试/三日志/浏览器事实/导出文件/截图SHA、26项结果和明确范围。根目录生产代码、数据库、运行服务和Git未由Alex修改；所有权仅三个`tests/alex-*.test.mjs`与本报告。后续SaaS鉴权、真实邀请、真实市场/商店采集和其他浏览器下载兼容均不在本原型完成声明内。

## PR #36 干净 CI 顺序修复的限定回归（2026-09-09）

关联 [Issue #35](https://github.com/zequnjiang/appeye/issues/35)、[PR #36](https://github.com/zequnjiang/appeye/pull/36) 与 [失败 run 34304593511](https://github.com/zequnjiang/appeye/actions/runs/34304593511)。产品此前已完成 PM 验收；本次发现的是干净 CI 的执行顺序问题：原型 `npm test` 包含检查三个 `dist` 打包入口的用例，工作流却先测试后构建。此前本地测试目录已有产物，未暴露这一前置条件，原 26/26 结果不能据此证明干净 CI 顺序正确。

Alex 独立审阅差异，确认仅调整原型工作流为 `npm ci → npm run build → npm test`，同步 README 顺序并补充 CTO 报告；生产 `verify` job 逐字不变，产品源码和测试内容无差异，打包检查没有删除或跳过。

独立副本 `.artifacts/alex-prototype-ci-3plgib` 初始没有 `dist` 或 `node_modules`，核对复制的 27 个输入文件 SHA 后，明确链接已安装原型依赖。Alex 在该副本实际执行：

| 检查 | 实际结果 |
| --- | --- |
| 构建前 `npm test` | 退出码 1，25/26；唯一失败为 `ENOENT dist/client/index.html`，复现原故障。 |
| `npm run build` | 退出码 0，三个要求的打包入口存在。 |
| 构建后 `npm test` | 退出码 0，26/26，0 失败、0 跳过。 |
| `npm run test:sites` | 退出码 0，4/4；这四项已包含于 26 项，不另计总数。 |

四份日志 `before-build.log`、`build.log`、`after-build.log`、`sites.log` 均保留在该副本。聚合 `.artifacts/alex-prototype-ci-order.json` 记录 2026-09-09T02:54:03.685Z、Node v25.9.0、命令结果、日志/入口 SHA 和前后输入文件哈希一致性。Alex 没有在这次独立复现中重新执行 `npm ci`，也未改原型实际预览产物或访问生产服务。

另独立读取 CTO 的 `.artifacts/prototype-fresh-ci-s0duo9uk/fresh-state.json` 及四份日志：该副本初始同样无 `dist`/`node_modules`，实际全流程 `npm ci → build → test → test:sites` 成功，26/26 与 4/4。此依赖安装证据归属 CTO，不能混称 Alex 执行。双方均使用本机 Node v25.9.0；GitHub Node 24 / Ubuntu 的精确最终提交 CI 由 CEO 提交后核对，本报告不提前声称远程已通过。

**限定回归通过，交 PM 验收该 CI 修复增量。** 原型功能、页面和截图未变，本轮不重复浏览器或生产项目测试；原始失败及本地环境边界完整保留。

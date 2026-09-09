# #35 信贷研究工作台原型：PM 最终验收

- 结论：**RP-AC-01–10 全部通过，允许 CEO 发布本轮原型代码与报告、完成精确提交 CI 后合并对应 PR 并关闭 #35。** 没有未解决的原型功能阻断。本结论不表示 GitHub 提交、CI 或合并已完成。
- 验收日期：2026-09-09，Asia/Shanghai。示例日期仍为 2026-09-08 北京时间。
- 需求：[Issue #35](https://github.com/zequnjiang/appeye/issues/35)、[需求 v1.2](../requirements/RESEARCH-PROTOTYPE.md)；分支 `codex/research-prototype`。
- 交接依据：[CTO 自检](RESEARCH-PROTOTYPE-CTO.md) → [Alex 正式 QA](RESEARCH-PROTOTYPE-ALEX.md) → 本 PM 独立验收；视觉记录见 [Design QA](../../prototypes/research-workspace/design-qa.md)。
- 范围：独立目录 `prototypes/research-workspace/` 的前端 mock、本地演示身份/空间和示例数据。**不验收真实 SaaS 鉴权、客户安全隔离、真实邀请、生产迁移、后端排序或采集。**

## 验收基线与证据归属

Alex 最终执行的原型检查为 **26/26 通过**，其中 Alex 14 项、CTO 8 项、runtime 4 项，0 失败、0 跳过；构建成功。另行 `test:sites` 4/4 是上述 runtime 四项的重跑，不合计为 30 项。对应构建日志列出 `index-B1NQPOgW.js` 与 `index-C-O7JQQq.css`。早期 21/22/23/24 项记录属于增量自检时点，不替代最终 26 项结果。

PM 只读核验 `.artifacts/alex-research-prototype-acceptance.json` 中 **26 个文件的 SHA256 全部匹配**，包括当时源码、独立测试、三份真实检查日志、浏览器事实、导出与截图。当前实现尚待 CEO 统一提交，因此本报告不虚构实现提交号或已经通过的远端 CI。主要源码锚点：

| 文件 | SHA256 |
| --- | --- |
| `src/App.jsx` | `b7e870c43056356af4ad48393ed7e99d422e6fe2ae358216baad06d8685dca05` |
| `src/data.js` | `62495db678223b7bc9e3d9a223ca5e465617001dee5dd22817a9906d67514563` |
| `src/utils.js` | `5c114386d99c5efae99fd1f9a57d95f0717df89caa41ecfc0e27aae502842c56` |
| `src/styles.css` | `9fe97eb6f257bea43501663f3715a8e0a478158022d7ad25a4a6ade4c368cb95` |

CEO 操作 IAB 并保存实际页面事实；Alex 独立执行逻辑检查、审查代码并复核浏览器事实/截图；PM 独立读取报告、源码和已保存事实、校验哈希、枚举 fixture 并亲看最终截图。本报告不声称 Alex 或 PM 另开浏览器重复操作，也不把纯逻辑测试当成真实页面结果。

PM 复核范围包括：九个排序字段、原型角色/空间谓词和写入范围、内部导航及焦点恢复、同源最近动态、完整导出，以及固定身份/事件计数。浏览器关键事实归档为 [browser-evidence.json](../../prototypes/research-workspace/reference/qa/browser-evidence.json)，与 Alex 审阅的 `.artifacts/research-browser-evidence.json` 逐字一致。

## 逐项产品结论

| AC | 结论 | PM 核对的结果与边界 |
| --- | --- | --- |
| RP-AC-01 | 通过 | 独立原型和 4173 预览，持续示例标识、演示身份与空间；选定方案的深蓝导航、白色主区、六国对照及四条精选层级保留。源码为本地 fixture/React 状态，静态 worker 只服务原型资产；页面资产观测 26 个 URL 均为 4173。资产清单不是全会话抓包，不由此声称检查过所有网络请求。未接入生产 API/数据库、商店或邮件服务。 |
| RP-AC-02 | 通过 | PM 重新枚举 132 唯一市场身份、120 默认现金贷、12 独立候选；每国 22 条、双店各 11 条。当天 117 条事件、4 条精选均可回查，另有 1 条历史事件，总 fixture 118 条不误记为今天 118 条。六国 30/23/64 矩阵与要求相同；最新动态从同国家/日期/品类事件派生。 |
| RP-AC-03 | 通过 | 实际 TH/updated/2026-09-08 入口与所选 eventId、变化及来源对应；列表评分第三页的 12 个身份前后相同，精确聚焦后返回仍为 `app-id-18`、scrollY 284 和同页。关注分组改名后进入详情返回保留原组。集合返回沿同一内部导航栈并经过代码复核，不声称每个入口全部筛选组合均已逐一操作。 |
| RP-AC-04 | 通过 | 九字段升降序按完整筛选集合排序再分页，日期按实际时间、0 有效、空值末位、同值稳定兜底；独立测试覆盖边界。IAB 验证排序第 3 页、模拟 pending 保持显示清单后显式应用，以及最多 4 个对比/第 5 个拒绝/可移除。运行中模拟收录后的 122 条页面记录不与重置后的默认 120 条混用。 |
| RP-AC-05 | 通过 | 全部初始应用身份与来源由独立全量数据检查覆盖，代表性条款、公司/发布者、版本前后值、指标评论与原文页面实际可达；新发现、商店发布和观测时间分别表达。自动/人工确认来源不混为法律或牌照结论，没有 AI 分析。并未逐个在浏览器打开 132 个详情。 |
| RP-AC-06 | 通过 | 正常本地双图、缺图、明确故意坏图和重试分支可核；前后/方向键/序号可操作。曾发生的 Escape 后焦点落 BODY 已复测为 dialog 0、入口 `screenshot-0`/BUTTON。权限默认 6 项→展开 10 项；成功空、未采集、失败留旧资料时间/来源、Apple 不支持分别展示，390px 为紧凑单列，不把 SDK 类型编号当风险级别。 |
| RP-AC-07 | 通过，采用 v1.2 导出路径 | 关注分组、备注、带来源摘录和集合有本地结果；同应用 North/South 研究内容隔离，同空间研究员已读不改变管理员未读。全空间及限定集合 Markdown 预览/复制内容已独立核对。IAB 文件下载落盘未通过，接受已验证的完整预览/复制/自行保存路径，不声称文件已由浏览器下载。 |
| RP-AC-08 | 通过 | 七身份、两空间按矩阵模拟；管理员邀请待接受→接受、只读禁写、平台不默认访问客户私有研究有实际页面事实。入口、内部页面状态与写 handler 的角色检查经独立复核，角色不能通过成员表单升级为平台运营。没有新增公开 URL 深链，因此不声称验证了该能力；这些前端限制不等于服务端授权或租户安全。 |
| RP-AC-09 | 通过 | AR 未命中包名→客户申请→平台模拟处理→客户对应身份/详情闭环有实际页面事实。全部 12 候选录入、重复录入及既有人工分类保护有独立检查；规则、诊断、任务、国家及客户成员页的可见操作改变本地状态，重置回到同一初始 fixture。不将代码审查扩大描述为逐个运营按钮均已实点。 |
| RP-AC-10 | 通过 | CTO 自检与修正 → Alex 最终 26 项/构建/runtime → 本 PM 验收齐全。同源选图比较、桌面、817/390 及关键流程事实已经归档。视觉测试由 CEO 操作，Alex 和 PM 分别独立审阅；范围归属清楚，未跳过测试或产品验收。 |

PM 独立枚举的当天现金贷事件如下。每类按市场身份去重，同应用可跨类别，不能把类别合计称为不同应用总数。

| 国家 | 系统新发现 | 商店当日发布 | 更新应用 |
| --- | ---: | ---: | ---: |
| TH | 8 | 5 | 18 |
| MX | 6 | 4 | 12 |
| PH | 5 | 3 | 10 |
| PK | 4 | 2 | 7 |
| ID | 3 | 6 | 9 |
| AR | 4 | 3 | 8 |
| 合计 | 30 | 23 | 64 |

## 最终视觉与导出核对

PM 亲看 [最终全图比较](../../prototypes/research-workspace/reference/qa/home-comparison-final.png)、[表头/国家表比较](../../prototypes/research-workspace/reference/qa/header-table-comparison-final.png)、[精选事件比较](../../prototypes/research-workspace/reference/qa/events-comparison-final.png)，以及 817px 应用库、390px 应用库和权限页面。主区/导航比例、信息密度和同一行内容对应用户选择的第 1 张；窄屏筛选和排序可见，宽表使用自身横向滚动，权限长文本可换行。保留原型标识和本地图例属性。未发现阻断使用的视觉差异；字体光栅和细微光学对齐差异不阻断本原型。

最后的固定 54px 国别行、去重复首页 footer 和同源“最近动态”已经体现在 `reference/qa/` 的最终比较图中。`.artifacts/` 中较早的同名比较图仍展示旧“几小时前”文案，属于保留的迭代证据，**本次最终视觉结论不引用它们为最新页面**。最终可追踪锚点：

| 归档文件 | SHA256 |
| --- | --- |
| `reference/qa/home-comparison-final.png` | `48de2617a603657097c3190ad44a3fa49dfaa7de42b417290a45fdb4b6a20515` |
| `reference/qa/header-table-comparison-final.png` | `db36b1db70c32b2774aa61b1577d3969b6a211bace75fb2c7154acb611481cea` |
| `reference/qa/events-comparison-final.png` | `ed6f3923e71c99e22a97370ac4c1b66b8cdf1717c65854dd1c867f30dc1e6590` |

PM 读取 [North 导出](../../prototypes/research-workspace/reference/qa/north-export.md)，与当前 `exportResearch(createFixtures().workspaces.north, apps)` **逐字相同**：823 字符、1009 UTF-8 字节，SHA256 `e6502acbb724ddd5eb73780f7ccda6a8fa8e3d39126150ac3e8388bdca61a30e`。含空间集合、备注、来源和示例标签；实际 IAB 剪贴板与预览相同。另一个 [限定集合导出](../../prototypes/research-workspace/reference/qa/collection-export.md) 与可见 textarea 完全一致，只有“验收来源集合”及相关来源摘录，没有其他集合或另一客户私有内容。两份归档与原验收文件逐字一致。

两份 Markdown 文件是 CEO 用文件工具保存的可见内容副本，**不是浏览器下载落盘证据**。两次 IAB 下载事件超时和后续降级均保留；预览、复制、全选及明确的下载尝试符合 v1.2 的原型边界。正式产品如需可靠文件下载，应另行实现并在目标浏览器验收。

## 已解决问题与发布边界

本轮已解决：模拟新身份来源仍指向旧包、日期按字符串误排、重复模拟新增身份、事件入口丢失具体上下文、未采集/不支持权限伪带成功时间、成员表单角色越界、灯箱入口焦点丢失、首页最近动态与事件时点矛盾，以及窄屏筛选和表格高度问题。最初失败检查、焦点 BODY 记录、误归类的 390 首页截图与下载限制没有被改写成成功。

本次放行仅意味着独立原型满足用户已选方案与可操作核心流程。共享市场库和私有研究、邀请及身份切换均为模拟；数据不是实际市场观察，商店图为本地示意素材，权限不等于设备授权/APK 审计。原型未替换正式后台，不改变原采集和小时监测。

CEO 仍须把代码、需求、CTO/Alex/PM 报告及归档证据统一提交 GitHub，核对最终提交 CI、关联 PR 与 #35，之后完成合并和关闭。若最终源码改变，按变更影响重新核验；仅补提交/PR/CI 链接不需要重复业务测试。原 [全量采集 #11](https://github.com/zequnjiang/appeye/issues/11) 与 [续页来源限制 #24](https://github.com/zequnjiang/appeye/issues/24) 不由本次原型验收结项。

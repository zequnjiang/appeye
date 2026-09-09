# #37 原型应用库调整：Alex 独立回归

- 需求：[PROTOTYPE-LIBRARY-POLISH.md](../requirements/PROTOTYPE-LIBRARY-POLISH.md)，PLP-AC-01–04；[Issue #37](https://github.com/zequnjiang/appeye/issues/37)。
- 状态：**Alex 独立工程与实际 IAB 证据回归通过，交 PM 逐项验收。**
- 范围：仅 `prototypes/research-workspace/` mock 原型。Alex 未修改源码、测试、Git、生产服务或数据库，未启动额外浏览器；本轮只维护本报告。

## CTO 交接后的独立检查

CTO 声明 JS 冻结并完成自检后，Alex 在原型目录依次执行：

| 命令 | 结果 | 本地日志 |
| --- | --- | --- |
| `npm run build` | 退出码 0；Vite 与 Sites 三个打包入口成功 | `.artifacts/alex-prototype-library-polish-build.log` |
| `npm test` | 26/26，0 失败、0 跳过 | `.artifacts/alex-prototype-library-polish-test.log` |
| `npm run test:sites` | 4/4，0 失败；已包含于上方 26 项，不重复计数 | `.artifacts/alex-prototype-library-polish-sites.log` |

运行环境为本机 Node v25.9.0，不替代之后 GitHub Node24 的精确提交 CI。遵循已修正的先构建后测试顺序；仅生成原型自身 `dist`。既有独立九字段回归已覆盖双向排序、空值末位、数字 0 有效、同值稳定 ID、跨时区日期、全集筛选排序后分页及页面夹取，本次没有增写复制实现的测试。

2026-09-09T03:22:39.270Z 的独立内存核对进一步确认：

- 当前 `createFixtures()` 与修改前 HEAD 的整个 model，在移除本次新增的 `iconUrl/iconIndex/iconNote` 后逐字段完全相等；132 个主库身份、120 个现金贷、12 个候选、研究空间和全部事件保持原值。
- 默认现金贷 120 行与独立构造的累计安装下限降序完全一致；首 12 行均为 1,000,000，下同值按 ID 稳定排序。初始 Apple 缺失值仍为 `null`，没有制造下载量。
- 本地 atlas 130 条，缺失 TH19 一条，故意本地加载失败 AR20 一条；PNG 实际为 1536×1024，24 格映射保持方形比例。新模拟身份与候选录入显式清空图标，不继承旧身份素材。
- TH19 的四种时间明确不同：发布日期 `2025-07-19`、商店更新时间 `2026-08-21`、首次发现 `2026-08-19`、采集时间 `2026-09-08`，可据此核验 UI 不混字段。
- 六国当日发现/发布/更新仍依次为 8/5/18、6/4/12、5/3/10、4/2/7、3/6/9、4/3/8，共 117 个事件。

## 静态实现核对

`defaultLibrary` 与 `visibleApps` 的默认值均为 `minInstalls/desc`。现有用户排序状态、显式应用 pending 和详情来源栈没有本轮逻辑变更。表头与每行字段一一对应 `releasedAt → storeUpdatedAt`；旧首次发现列退出表格，但详情和 `sortFields` 仍保留 `firstSeenAt`。安装值旁仍显示“累计 · 非国别”，Apple 显示不可视为 0。

`AppIcon` 使用本地示例图片，名称/开发者/选择框仍单独保留；40×40 槽固定大小，缺失与加载错误使用库内 ImageOff 图标和不同可访问名称。只有实际 IAB 中图片成功、缺失/失败和窄屏布局证据齐备后，才判这些交互及视觉分支通过。

原参考图对应首页，本次调整对应应用库，不能把不同页面做像素级同态比较。最终视觉复核使用调整前实际库页与本轮同范围库页，明确默认排序和日期列是用户授权差异，检查图标质量、字体、间距、颜色和文案。

## 实际 IAB 证据的独立复核

浏览器由 CEO 操作，Alex 独立读取并以 Node 断言复核归档的 [13 项浏览器事实](../../prototypes/research-workspace/reference/qa/library-polish/browser-evidence.json)，SHA256 为 `c7c573751dec2090b425542e61f152552307a330de099340a57ff56f1abfb865`，与本地执行记录逐字相同：

- 初次应用库与重置后均选择 `minInstalls` 降序；首屏 12 个身份与独立全集排序前 12 个完全相等，均为 1,000,000。第 10 页的 12 个身份也与全集末 12 个完全相等，全部为 Apple“未公开 / 不可视为 0”。
- 实际表头按“商店发布时间 → 最近更新时间”，没有旧首次发现列。首屏与 TH/GP 全部可见行的两日期逐字段等于各自 `releasedAt/storeUpdatedAt`。TH19 列表准确显示 `2025-07-19 / 2026-08-21`、有效安装数 0 和“暂无图标”；详情保留首次发现 `2026-08-19` 及独立的最近成功采集时间，可选 `firstSeenAt` 排序仍能选择。
- 实际评分排序第 3 页进入详情再返回，12 个行身份、页码与排序字段前后完全一致。本轮记录没有精确量测滚动或焦点，因此只据此确认页面/行序/排序，不声称重新执行旧报告的精确滚动测试。
- 检测出 pending 后原首屏 12 行不变；显式应用后查询新增身份 `th-new-demo`，实际显示“暂无图标”，没有继承旧应用图片。初始有效 atlas 图片 `naturalWidth=1536`，图标槽均 40×40；AR20 的实际加载失败显示 ImageOff 与“图标加载失败”，保留名称、开发者、评分 0 及身份。
- 390 CSS px 分别验证新增缺图身份及正常图标列表：前者 documentWidth 390、表容器 302px；后者 documentWidth 375、表容器 287px，40×40 图标不缩窄；990px 宽表仅在容器中滚动，无页面级外溢。正常图标场景已有显式应用的新身份，因此 TH/GP 为 11 行；这不表示初始固定数量被改变。
- CEO 记录自 `2026-09-09T03:21:26.925Z` 实现加载起 console error/warn 条目为空；本地故意缺图请求作为单独失败分支保留，不冒称不存在失败请求。本轮没有打开正式后台或请求真实市场。

## 视觉复核与结论

Alex 亲看同输入 [完整前后对照](../../prototypes/research-workspace/reference/qa/library-polish/comparison.png) 和 [表头/前三行局部对照](../../prototypes/research-workspace/reference/qa/library-polish/focused-comparison.png)，以及 [失败占位](../../prototypes/research-workspace/reference/qa/library-polish/icon-failed.png)、[最终 390 列表](../../prototypes/research-workspace/reference/qa/library-polish/library-390.png)。前后共同状态为 TH/GP/个人现金贷/累计安装降序，修改前已经手动选择此排序；因此默认值另由上述 fresh/reset 事实证明。

桌面请求 CSS viewport 1254×964，前后浏览器实际 raster 均 1239×952，完整对照 2478×952，双方没有单独缩放。最终窄屏请求 390 CSS px、截图 raster 375×812；按实际解码尺寸判断，没有把浏览器滚动条差异当布局缺陷。IAB 原截图虽以 `.png` 命名，实际编码为 JPEG；Node/Python 首次按 PNG 头读尺寸不适用，随后以 `sips` 实际解码确认上述尺寸，不据错误头值判定产品问题。

五个相关视觉面均无新增 P0/P1/P2：字体/字重与主次层级保持；40px 图标和 12px 间隔适合原行高，名称/开发者、勾选区没有重叠；海军蓝、青绿、灰字与表格边线保持；实际图标清楚、方形比例正确且未见邻格渗入，失败使用有语义占位；两日期文案、累计非国别和示例标识准确。窄屏名称保留在宽表内，横向滚动沿用已有方式，不要求全部列同时挤入 390px。

| AC | Alex 最终结论 |
| --- | --- |
| PLP-AC-01 | 通过。fresh/reset 默认、独立全排序、首末页、0/null、其他排序第 3 页返回与显式 pending 均有对应证据。 |
| PLP-AC-02 | 通过。初始 130 有图/1 缺失/1 故意失败、新身份占位、桌面/390 实际图片及布局核对通过；素材明确为本地示例。 |
| PLP-AC-03 | 通过。表头、首屏/TH 行值均绑定发布→商店更新，未借用其他时间。 |
| PLP-AC-04 | 通过。首次发现仅退出列表列，详情/可选排序保留；TH19 时间反例准确，整个非图标 fixture 与旧版本全等。 |

没有未解决的本轮阻断缺陷。工程命令、数据枚举、浏览器操作和独立证据审阅的归属与范围分别记录；该结论仅适用于 mock 原型四项调整。交 PM 最终验收，GitHub 精确提交 CI 和发布由 CEO 完成。

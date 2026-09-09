# #37 原型应用库调整：PM 最终验收

- 日期：2026-09-09，Asia/Shanghai。
- 结论：**PLP-AC-01–04 全部通过，无未解决的本轮阻断。允许 CEO 提交代码/报告、核对精确 HEAD CI 通过后合并对应 PR 并关闭 #37。** 本报告不声称远端 CI 或合并已经完成。
- 跟踪：[Issue #37](https://github.com/zequnjiang/appeye/issues/37)、[需求 v1.0](../requirements/PROTOTYPE-LIBRARY-POLISH.md)，分支 `codex/prototype-library-polish`。
- 交接：[CTO 自检](PROTOTYPE-LIBRARY-POLISH-CTO.md) → [Alex 正式独立回归](PROTOTYPE-LIBRARY-POLISH-ALEX.md) → 本 PM 验收。
- 范围：仅 4173 独立前端 mock 原型四项调整；不涉及正式后台、数据库、采集、真实图标获取或 SaaS 权限。原型示例及累计指标口径继续保留。

## 证据与独立审阅

Alex 在 CTO 冻结源码后按 **build → test → test:sites** 验证：构建成功，既有 **26/26** 测试通过，0 失败/跳过；打包检查 **4/4** 已包含于 26 项，不另加总。日志位于 `.artifacts/alex-prototype-library-polish-{build,test,sites}.log`，客户端为 `index-DXPbTTrm.js`、`index-D6oimNFi.css`。本机 Node v25.9.0 结果不替代之后远端 Node 24 CI。

CEO 执行 IAB 并保存 [13 条实际页面事实](../../prototypes/research-workspace/reference/qa/library-polish/browser-evidence.json)，Alex 独立断言核对；PM 只读审阅实现差异、报告、原始日志和事实，重新枚举默认排序/数量并亲看截图，没有另开浏览器或重跑大测试。

PM 独立确认：132 主库、120 默认现金贷、12 候选、示例当天 117 事件；首/末 12 个真实页面身份与当前全集排序一致；pending 原首屏身份不变；评分第 3 页往返的 12 个身份一致；初始图标为 130 个 atlas 映射、TH19 缺失和 AR20 故意失败各一条。Alex 另将整个 fixture 去掉本轮三项图标字段后与修改前 HEAD 比较，所有既有字段相同。

验收时主要文件 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `src/App.jsx` | `b95c2e24856bda93ccf73fb22c69ec902bd83c9db2825a58e07934b6ddb83ad5` |
| `src/components.jsx` | `87989282fafb4ff421bb636b1b7d70b32a571e12f9be6b26cdb7f39246729245` |
| `public/assets/app-icons-demo.png` | `1f89c30329efa1255bbf7ca21ddb873c783d6b81da6c1026927b6a0323219d21` |
| `reference/qa/library-polish/browser-evidence.json` | `c7c573751dec2090b425542e61f152552307a330de099340a57ff56f1abfb865` |

## 四项验收

| AC | 结论 | 核对结果 |
| --- | --- | --- |
| PLP-AC-01 | 通过 | 初次进入和重置默认 `minInstalls/desc`；首屏 12 项均为 1,000,000，第 10 页为 Apple 未公开值，全集排序后分页、0 有效、空值末位与稳定同值规则保持。评分第三页返回的页码/排序/身份一致；pending 仍待点击应用。显示“累计 · 非国别”，不把 Apple 缺失当 0，不称精确或国别下载量。 |
| PLP-AC-02 | 通过 | 每行名称旁提供 40×40 本地示例图标或有语义占位，名称/开发者/选择区域保持。130 条初始记录复用 24 格本地图集；TH19“暂无图标”、AR20“图标加载失败”实际可见，均为明确演示。模拟新增身份清空旧图标并显示占位。桌面/390px 图标比例和行内间距正确，窄屏宽表只在容器内滚动。 |
| PLP-AC-03 | 通过 | 表头与逐行字段依次为“商店发布时间” `releasedAt` → “最近更新时间” `storeUpdatedAt`。PM/Alex 核对首屏及 TH 行与 fixture 对应；TH19 实际列表为 `2025-07-19 / 2026-08-21`，没有借用首次发现或采集时间。既有缺失格式保留。 |
| PLP-AC-04 | 通过 | 列表旧“首次发现”列移除，详情及可选排序仍保留 `firstSeenAt`。TH19 详情首次发现为 `2026-08-19`，最近采集为 `2026-09-08`，均与上述两日期不同；证据证明没有混字段。固定数量、身份、研究内容与事件口径保持。 |

## 视觉与范围说明

PM 亲看 [完整前后对照](../../prototypes/research-workspace/reference/qa/library-polish/comparison.png)、[局部表头/前三行](../../prototypes/research-workspace/reference/qa/library-polish/focused-comparison.png)、[失败占位](../../prototypes/research-workspace/reference/qa/library-polish/icon-failed.png) 和 [390px 列表](../../prototypes/research-workspace/reference/qa/library-polish/library-390.png)。比较对象均为 TH/GP/个人现金贷/累计安装降序的应用库；修改前是手动选择排序，不能用对照截图单独证明旧/新默认值，默认值另由 fresh/reset 事实证明。应用名称、开发者、选择框和图标未重叠；颜色、层级与已验收原型一致。宽表横滚沿用原设计，不要求所有列压进手机宽度。

390px 正常图标画面显示 TH/GP 11 条，因为此前已明确应用一条模拟新身份；不把该状态误认为初始 10 条数量改变。实际浏览器滚动条导致 raster 小于请求 CSS viewport，尺寸由 Alex 实际解码确认；原截图扩展名为 PNG、内容编码为 JPEG，不影响所见页面结论。PM 不把本轮页码/身份往返记录扩大为重新量测过精确 scroll/focus，既有返回机制未改。

本轮没有新增实际市场数据。图标为稳定复用的本地演示素材，不是 130 个真实商店图标；故意失败请求不等于全部请求成功。截图与实际操作归属 CEO，独立工程/事实核对归属 Alex，产品证据审阅归属 PM。原型原有 mock、下载限制及生产边界不变，本次不结项 #11/#24。

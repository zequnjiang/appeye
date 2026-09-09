# #37 原型应用库调整：CTO 自检

- 日期：2026-09-09，Asia/Shanghai。
- 关联：[Issue #37](https://github.com/zequnjiang/appeye/issues/37)、[PLP-AC-01–04](../requirements/PROTOTYPE-LIBRARY-POLISH.md)。
- 状态：实现与 CTO 自检完成，JS 已冻结并正式交 Alex；CEO 浏览器验证与 PM 验收待独立记录。
- 修改范围：仅独立原型 `src/App.jsx`、`src/components.jsx`、`src/data.js`、`src/utils.js`。CEO 管理本地图标素材及 CSS；没有修改生产界面、服务、数据库、采集或测试实现。

## 最终行为

| AC | 实现 |
| --- | --- |
| PLP-AC-01 | `defaultLibrary.sort` 与 `visibleApps` 默认值同为 `minInstalls`，方向 `desc`。原有全集过滤/排序后分页、0 有效、空末位、ID 稳定兜底继续使用；用户选定排序、原路返回、pending 点击后应用的机制未改。 |
| PLP-AC-02 | 行名称和发布者外包身份容器，前置 40×40 `AppIcon`。本地 1536×1024 图标素材按 6×4 共 24 格稳定复用，实际 `<img>` 裁切显示；保留普通单图路径。130 条初始身份使用示例图标，TH19 缺失占位，AR20 故意本地图片错误占位，均有对应 title/aria 状态。模拟新增与候选新收录明确 `iconUrl=null` / `iconIndex=null`，不会沿用旧应用图标。 |
| PLP-AC-03 | 应用库两日期列依次为“商店发布时间” `releasedAt`、“最近更新时间” `storeUpdatedAt`，缺失经 `dateText` 显示“未提供”，未借用采集时间。 |
| PLP-AC-04 | 列表移除首次发现列；原始 `firstSeenAt`、详情字段及可选排序项保留。固定 132 主库 / 120 现金贷 / 12 候选和当日 117 事件不变。 |

图标属于原型本地生成素材，数据 `iconNote` 标明示例复用，不冒称真实商店图标。故意错误只请求原型本地不存在路径，用于演示失败分支；无外部图标或商店请求。应用名称、开发者和原点击入口保持，图标不替代身份文本。

CSS 契约由 CEO 实施：`.library-app-identity` / `.library-app-copy`，`.app-icon`，atlas 图片 `.app-icon-atlas`。代码只计算格子的 `left=-40*(index%6)` 和 `top=-40*floor(index/6)`；素材、容器裁切和尺寸由 CSS 控制。缺失/失败渲染 `lucide-react` 的 `ImageOff` 并区分可访问文案。

## 实际自检

遵循此前修正的构建顺序：

1. `npm run build --prefix prototypes/research-workspace`：通过，保留原型自身三个构建入口。
2. `npm test --prefix prototypes/research-workspace`：**既有 26/26 通过**，未新增重复实现逻辑的测试。
3. 运行一次独立 Node 断言核对默认排序和显示数据：120 条现金贷按累计安装降序，首屏 12 条均为 1,000,000；0 保留、全部缺失排在末尾；10 页合并仍为 120 个唯一身份；默认排序结果与显式 `minInstalls/desc` 一致。
4. 核对本地图标 130 条有效格位（整数 0–23），TH19 缺失 / AR20 故意失败说明，模拟新增与候选收录无继承图标；实际 PNG 头声明尺寸 1536×1024。
5. 日期反例使用 TH19：`releasedAt=2025-07-19`、`firstSeenAt=2026-08-19T08:00:00+08:00`、`storeUpdatedAt=2026-08-21T12:00:00+08:00`，三个日期不同；列表源码绑定前者与第三者，详情和可选排序仍保留第二者。
6. `git diff --check`（本次四源文件）：通过。

构建和测试输出保存在 ignored `.artifacts/prototype-library-polish-cto-{build,test}.log`。实际桌面/390px 图标裁切、失败占位、日期对应与排序/返回行为由 CEO/Alex 浏览器验证，静态检查不替代这些结果。

## 交接

已向 CEO/Alex 提供图标样式契约、缺失/失败示例身份、日期反例与自检结果。JavaScript 已冻结，必要缺陷修复先协调，避免 HMR 重置正在验证的页面。没有提交或推送，PM 验收前不关闭 #37。

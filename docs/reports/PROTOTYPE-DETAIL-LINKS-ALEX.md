# #39 原型详情外链：Alex 独立回归

- 需求：[PROTOTYPE-DETAIL-LINKS.md](../requirements/PROTOTYPE-DETAIL-LINKS.md)，PDL-AC-01–04；[Issue #39](https://github.com/zequnjiang/appeye/issues/39)。
- 状态：**Alex 四项独立回归通过，正式交 PM 验收。**
- 范围：仅 4173 mock 原型。Alex 只维护本报告，未改源码/测试/Git、生产服务或数据库，未打开额外浏览器。

CTO 正式声明 JS 冻结并自检后，Alex 独立按构建先于测试的顺序执行：

| 命令 | 实际结果 |
| --- | --- |
| `npm run build` | 退出码 0，原型 Vite 和 Sites 包装入口完整。 |
| `npm test` | 28/28、0 失败/跳过；既有 26 项加 CTO 两项 URL 安全/身份继承回归。 |
| `npm run test:sites` | 4/4；包含在上述 28 项中，不重复计数。 |

日志为 `.artifacts/alex-prototype-detail-links-{build,test,sites}.log`。本机 Node v25.9.0，未把本地执行称为 GitHub Node24 CI。没有增加复制实现的测试。

2026-09-09T04:08:28.187Z 独立内存枚举全部 132 个应用，确认 GP 官方 origin/path、`id` 和 `gl`，Apple 官方 origin、国家段与编码 ID 均准确。移除本次 `websiteUrl/privacyUrl` 两字段后，整个 fixture 与修改前 HEAD 逐字段完全相等；132 主库、120 现金贷、12 候选及 117 个当日事件/1 个历史事件保持。

源码独立核对三类链接均使用 `AppExternalLink`：HTTP(S) 经 URL 解析后才生成 anchor，统一 `_blank` 和 `noopener noreferrer`，缺失为“未提供”，非法地址为“地址不可用”。TH19 两字段缺失、AR22 两字段不安全/无效均不生成 href；新模拟身份及全部候选新收录的两字段明确清空，不继承旧应用地址。标题商店链接根据当前身份重新生成，SourceInfo 文案明确虚构条目可能不存在，官网与隐私仅为示例。

## 实际 IAB 与最终结论

CEO 执行浏览器操作，Alex 独立读取并以 Node 断言核对 [12 条实际事实](../../prototypes/research-workspace/reference/qa/detail-links/browser-evidence.json)，SHA256 `7d3fe7d7adf222f0490905c120c2e61187df23fde94808c38c0a10af917cd7f8`：

- TH15 的 GP 链接准确为 `details?id=com.th.creditdemo15&gl=th`；AR Apple 为 `/ar/app/id1100000501`。点击各自打开新标签，原型仍在同一应用详情。GP 外部页提示找不到网址，Apple 外部页显示 `Ocurrió un error`；这两个虚构条目没有可用详情，不称真实市场资料访问成功，但实际新标签及目标身份正确。
- 官网与隐私分别打开 `example.com/#demo-website`、`#demo-privacy` 的两个 Example Domain 新标签。三类实际 anchor 均为 `_blank`、`noopener noreferrer`。外链操作后原 TH15“基本信息”保留，返回仍为 TH/GP、`minInstalls`、10 条第 1/1 页。本轮不冒称重新测量精确滚动/焦点或所有其他分页组合。
- TH19 官网/隐私均为“未提供”、资源 anchor 数 0；AR22 均为“地址不可用”、anchor 数 0，未把不安全字符串变成可点击链接。
- 首次名为 390 的探针实际 window1240/document1225，已明确排除窄屏通过依据并保留 [错误尺寸截图](../../prototypes/research-workspace/reference/qa/detail-links/viewport-setup-desktop.jpg)。重新取得浏览器句柄后的最终 width390/document375，三链接右边界均不超过359；官网/隐私长地址换行，无页面外溢。最终 console 观测为空；此记录不是全会话网络抓包。

Alex 亲看 [完整前后同图](../../prototypes/research-workspace/reference/qa/detail-links/comparison.png)、[标题/内容局部对照](../../prototypes/research-workspace/reference/qa/detail-links/focused-comparison.png) 和 [最终390图](../../prototypes/research-workspace/reference/qa/detail-links/detail-390-top.jpg)。同态 TH15 详情的前后 raster 均为1225×952，窄屏 raster375×812；未用错误尺寸截图判断移动布局。字体与主次层级保持，两行链接及示例说明留有适当间距，原蓝/绿/灰色体系与现成外链图标一致，字段含义清楚；没有新增 P0/P1/P2 视觉问题。

| AC | Alex 结论 |
| --- | --- |
| PDL-AC-01 | 通过。132 身份静态全枚举及 GP/TH、Apple/AR 实际新标签分别验证；外部条目不可用如实保留。 |
| PDL-AC-02 | 通过。官网/隐私实际 Example Domain 新标签、字段/示例说明和缺失/无效非链接状态准确。 |
| PDL-AC-03 | 通过。安全协议回归、实际 target/rel、新标签后原详情及筛选/排序/页码保留，390 可用。 |
| PDL-AC-04 | 通过。新身份不继承两 URL，其他 fixture 全等；来源文案与虚构身份边界一致。 |

没有未解决的本轮阻断。仅验收 mock 原型外链功能，不声明虚构商店条目或示例法律文本真实有效；PM 完成最终验收，CEO 负责精确提交 CI/GitHub 收口。

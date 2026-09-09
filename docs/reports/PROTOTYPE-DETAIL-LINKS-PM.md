# #39 原型详情外链：PM 验收

- 结论：**PDL-AC-01–04 全部通过，允许 CEO 提交并核对精确 HEAD CI 通过后合并 PR、关闭 #39。** 尚不声明远端 CI 或合并已完成。
- 日期：2026-09-09，Asia/Shanghai；[Issue #39](https://github.com/zequnjiang/appeye/issues/39)、[需求](../requirements/PROTOTYPE-DETAIL-LINKS.md)，分支 `codex/prototype-detail-links`。
- 交接：[CTO 自检](PROTOTYPE-DETAIL-LINKS-CTO.md) → [Alex 正式回归](PROTOTYPE-DETAIL-LINKS-ALEX.md) → 本 PM 独立验收。仅限 4173 mock 原型，不涉及生产或采集。

## 验收依据

Alex 独立按 build → test → test:sites 执行，构建成功、**28/28** 测试通过、0 失败/跳过；4/4 打包检查包含于 28 项，不重复计数。本机 Node v25.9.0，日志 `.artifacts/alex-prototype-detail-links-{build,test,sites}.log`；构建为 `index-s7lcdvXQ.js`、`index-D4YmhiYQ.css`。PM 已读取真实日志，没有重复大测试或操作生产。

CEO 实际操作 IAB；Alex 独立核对 [12 条页面事实](../../prototypes/research-workspace/reference/qa/detail-links/browser-evidence.json)，PM 再独立读取、核对链接及重新枚举全部 132 个应用的 GP origin/path/id/gl、Apple origin/国家/编码 ID，结果一致。归档事实 SHA256：`7d3fe7d7adf222f0490905c120c2e61187df23fde94808c38c0a10af917cd7f8`。PM 同时确认 132 主库、12 候选、117 当日事件不变；Alex 对整个 fixture 去除两项 URL 字段后与旧 HEAD 比较全等。

| AC | 结论与证据 |
| --- | --- |
| PDL-AC-01 | **通过。** 标题下 ID/商店由当前身份生成链接。GP/TH 实际新标签目标为 `details?id=com.th.creditdemo15&gl=th`，Apple/AR 为 `/ar/app/id1100000501`；全 132 身份的静态枚举正确。两虚构条目的外部错误如实保留，不称真实商店资料访问成功。 |
| PDL-AC-02 | **通过。** 基本信息的官网与隐私分别绑定 `https://example.com/#demo-website` 和 `https://example.com/#demo-privacy`，实际打开两个 Example Domain 标签，邻近说明是示例。需求已同步最终地址。TH19 两项“未提供”、AR22 两项“地址不可用”，资源 anchor 均为 0，不猜测或链接不安全值。 |
| PDL-AC-03 | **通过。** 三类链接统一解析有效 HTTP(S)，实际 anchor 均 `_blank`、`noopener noreferrer`；安全协议反例回归通过。外链后原 TH15 基本信息仍在 4173，返回保留 TH/GP、累计安装排序、10 条第 1/1 页。没有声称本轮重新量测精确滚动/焦点或全部分页组合。 |
| PDL-AC-04 | **通过。** pending 与全部候选新身份明确清空两 URL，不沿用上一应用。其他 fixture 字段不变；来源说明改为可导航当前国家商店路径，但虚构 ID 可能没有条目，官网/隐私不是真实网站或法律文本。 |

PM 亲看 [完整对照](../../prototypes/research-workspace/reference/qa/detail-links/comparison.png)、[标题/内容局部对照](../../prototypes/research-workspace/reference/qa/detail-links/focused-comparison.png) 和 [最终窄屏](../../prototypes/research-workspace/reference/qa/detail-links/detail-390-top.jpg)：标题链接、两行资源与说明保持层级，长地址可换行，没有新增阻断布局问题。首轮标成 390 的测量实际为 1240，保留为错误设置记录，不用它证明窄屏通过；最终记录 width390/document375，三链接右边界均不超过 359。

本次验收证明原型导航和上下文保留，不保证虚构商店条目存在、示例官网属于应用或隐私文本有效。GP 外部页找不到网址、Apple 显示错误，与目标正确/新标签成功分别记录。浏览器执行归属 CEO，独立测试和事实复核归属 Alex，PM 为证据与产品审阅；未接触生产。没有未解决的本轮阻断，#11/#24 等既有任务不由本次结项。

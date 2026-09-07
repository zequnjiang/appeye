# 数字开发者名称目录路由：PM缺陷验收

- 结论：**#14工程与两国真实恢复通过PM验收；允许CEO发布证据并在最终代码/报告CI通过后关闭该缺陷。#11整体采集未完成。**
- 范围：[路由缺陷 #14](https://github.com/zequnjiang/appeye/issues/14)、上层[运营 #11](https://github.com/zequnjiang/appeye/issues/11)及[PR #12](https://github.com/zequnjiang/appeye/pull/12)。Apple页面重定向循环和BCA开发者告警不属于本缺陷；Apple六项另见[来源限制验收](APPLE-SOURCE-LIMIT-PM.md)，BCA仍待处理。
- 运行基线：`2eaaccd`后的冻结修复，runtime-4记录于`2026-09-06T19:13:36.534Z`，含七个运行文件SHA-256；PM逐一比对全部一致。最终修复提交和CI由CEO关联，本报告不将未完成CI写成已成功。
- 证据：[CTO自检](FULL-SCAN-CTO-SELF-CHECK.md)、[Alex正式工程/真实回归](DEVELOPER-ROUTE-ALEX.md)，以及本地只读审计摘要。PM没有写生产库、调用商店、重试任务或重启服务。

## 问题与修复判断

同一Google Play应用`com.smartsave.budget.finance.book`在PH和PK有两条市场记录，其开发者字符串`059916517`包含前导零。SDK以数值ID启发式选择`/store/apps/dev`，但两国各自已保存的官方详情链接均明确指向`/store/apps/developer`。原路由连续三次404，不代表目录实际不存在。

PM审阅实现：只从同batch、同App/国家/冻结语言、成功的官方详情HTTP中提取同开发者ID的可靠目录链接；保留前导零并只解码一次。官方来源、路径和身份均需匹配，歧义链接或缺少可信来源时仍保留SDK默认行为；不能仅因404盲目猜另一路径。实际请求采用被冻结的国家/语言，成功资料source、routing和原详情HTTP引用与之对应。该修复没有从数字名称推断法人、许可证或主体归属。

本次同发布还含有界错误cause记录，属于诊断能力，非#14路由根因。它不能把Apple fetch失败改成成功或可忽略，也不能消除BCA未知响应告警。

## 工程与两国真实恢复

Alex最终独立`npm run check` **110/110通过**，前后端类型和生产构建通过；其中原99项、新增9项路由、2项错误诊断。路由单独回归阶段曾为108项，最终以110为准。PM审阅正式结果，没有重复运行该完整测试。

工程用例覆盖官方链接及身份/语言绑定、前导零/编码、歧义拒绝、旧默认路径、真实SDK目录解析、错误来源留存、旧历史保护、有限新预算以及原人工excluded保护。新增来源是实际采集时间，不回写成原详情时间。

Alex真实只读与本机API核查于`2026-09-06T19:14:41.613Z`完成，摘要`data/batches/finance-2026-09-07-alex-developer-route-recovery.json`为`errorCount=0`。PM于`19:15:51.907Z`另开SQLite只读事务，独立比较旧快照与当前账本，结果如下：

| 市场记录 | PH | PK |
| --- | --- | --- |
| App / developer任务 | 970 / 14412 | 1082 / 15308 |
| 原详情任务 / HTTP | 5903 / 1139 | 6643 / 1449 |
| 修复后目录路径 | `/store/apps/developer?id=059916517&gl=ph&hl=en` | `/store/apps/developer?id=059916517&gl=pk&hl=en` |
| 新真实HTTP | 7390，200 | 7394，200 |
| 新HTTP获取时间UTC | 19:13:41.051 | 19:13:48.444 |
| 新任务观测时间UTC | 19:13:41.706 | 19:13:49.132 |
| 最新结果 | attempt4 succeeded、available、1项/1唯一ID、0告警 | attempt4 succeeded、available、1项/1唯一ID、0告警 |
| 原三次attempt/history | 逐字段不变 | 逐字段不变 |
| 原404 HTTP | 6318/6373/6463元数据及body SHA-256不变 | 6817/6861/6966元数据及body SHA-256不变 |
| 原详情HTTP | 1139原body SHA-256不变 | 1449原body SHA-256不变 |

以上时间日期均为UTC的2026-09-06。PM看到source和routing分别引用本市场原详情HTTP；两国没有借用对方详情证据。新HTTP与task/app/batch关联正确，原失败未被覆盖或删除，PM聚合记录位于`.artifacts/pm-developer-route-audit.json`。

Alex另独立核对了当前/新enrichment_history一致，以及两条本机认证API返回200、目录数量、状态、来源、观测时间和routing证据全部匹配；该API实测由Alex执行，PM本次直接验证的是SQLite与运行代码。runtime-4显式恢复原8个failed任务，其中2个属于#14、6个属于独立Apple失败；不能写成“只重试这两个任务”或把其余6项算作#14修复成功。BCA两项developer-degraded在该恢复中保持原状。

## 验收边界

PM确认#14无未解决的局部阻断项：两条市场记录的真实目录已取得，正确来源与完整新旧历史可追溯，恢复有限且没有篡改旧404记录。该结论仅关闭路由缺陷，不代表所有数字开发者都使用同一路径，也不以这次目录仅1项推断该开发者全球仅有1个产品。

第一项发现、详情与信贷入库验收不变。第二项仍按2,024条`country/store/externalId`市场记录执行七类补充和评论；本次只读统计跨国家按`store/externalId`去重为1,664个商店应用身份（GP791、Apple873），不能把2,024说成全球不同App数量，也不自动合并两商店同品牌。Apple六项来源限制已另行有限验收，BCA未知响应仍待处理；全部资料采集与#11最终验收不在本次放行范围。

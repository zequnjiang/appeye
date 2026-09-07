# 扩展发现后端自检与交接

- Issue：[需求 #22](https://github.com/zequnjiang/appeye/issues/22)。需求：[ED-AC-01–08](../requirements/EXTENDED-DISCOVERY.md)。
- 分支：`codex/silent-refresh-discovery`。角色：CEO兼后端开发；采集适配器由独立CTO子Agent开发、自检，Alex独立验证，PM最后验收。
- 状态：开发自检通过，已交接Alex；正式部署和目标真实采集补录完成，独立测试与最终PM结论分别见对应报告。

## 实现

增加SQLite独立周期、任务、请求、来源、候选及持久轮转账本；每六小时合并调度，保留原小时、批次及手动通道，每11槽1扩展槽。真实HTTP在共享transport发起前检查60来源/60详情预算，步骤20秒、GP每词1000条默认上限。超限及中断有明确deferred状态；部分逐条来源保留，重启重放按市场身份去重，来源类型和候选分别轮转。

按配置及本地词表扩展关键词，回收同市场已有开发者目录，一层关联和开发者扩散。新strong/possible按现有规则入库，insufficient保留暂存。已知ID复用POST/apps，记录用户提交来源，创建记录与真实采集成功分开。历史来源进入统一最早时间计算；人工分类、旧current及原全量批次成员保持。

鉴权GET提供发现状态、候选、市场身份诊断以及分页完整任务响应/HTTP。身份诊断关联扩展、小时、历史批次和手动队列，GET无采集副作用。错误的固定250上限改成实际返回量与SDK边界。

## 自检证据

- `npx tsc --noEmit -p tsconfig.server.json`：退出0。
- `npx tsx --test tests/extended-discovery.test.ts`：7测试通过，0失败；约0.64秒。
- 覆盖：11槽公平、六国双店独立预算与6h停机合并、原开发者时间/部分警告、超时已得结果、insufficient暂存/跨国人工分类、鉴权和已知IDpending、真实统一transport阻止SDK隐藏超额HTTP。
- 初次测试2项因测试调用错误的Store方法失败，改为真实`updateClassification`后全通过；没有改生产行为来绕过失败。
- Provider专项测试及原采集器回归由CTO适配器子Agent另行报告。

## 后续交付证据

业务提交`e356bb323309dbb4e332b3bf941b314c9de6987f`的[CI 34138027098](https://github.com/zequnjiang/appeye/actions/runs/34138027098)通过，隔离生产构建完成。Alex独立完整回归221项全部通过，类型检查通过，详见[独立测试报告](EXTENDED-DISCOVERY-ALEX.md)。

正式备份、迁移前后旧数据核对、实际六国双店请求、`com.creditouno.loan`两次真实成功观测及身份去重、受控重启恢复均已完成，详见[正式部署证据](SILENT-DISCOVERY-DEPLOYMENT.md)。GP关联续页的实际部分失败由[#24](https://github.com/zequnjiang/appeye/issues/24)独立跟踪，没有伪装为完整成功。原2024批次保持不变，#11继续独立追踪。

本自检报告不代替[PM独立验收](EXTENDED-DISCOVERY-PM.md)；合并和关闭议题须以该最终结论为准。

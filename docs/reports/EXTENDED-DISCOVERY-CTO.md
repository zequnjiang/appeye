# 扩展发现后端自检与交接

- Issue：[需求 #22](https://github.com/zequnjiang/appeye/issues/22)。需求：[ED-AC-01–08](../requirements/EXTENDED-DISCOVERY.md)。
- 分支：`codex/silent-refresh-discovery`。角色：CEO兼后端开发；采集适配器由独立CTO子Agent开发、自检，Alex独立验证，PM最后验收。
- 状态：开发自检通过，交接Alex；生产采集与最终验收尚未完成，不能以夹具结果代替真实入库。

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

## 待交付关卡

Alex独立回归、完整构建/CI、受控生产切换、目标`com.creditouno.loan`真实入库和两商店运行证据、PM验收、GitHub提交合并与关闭尚待完成。

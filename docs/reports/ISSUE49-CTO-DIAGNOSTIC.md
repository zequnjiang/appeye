# #49 身份诊断查询 CTO 自检

- 日期：2026-09-20；需求：[ISSUE49-RUNTIME](../requirements/ISSUE49-RUNTIME.md)，RUN01–04。
- 范围：仅`server/extended-discovery.ts`中的身份诊断读路径、`tests/runtime-diagnostic.test.ts`；索引与批次摘要修复由CEO负责。没有改采集器、预算、公平调度、来源或生产数据。
- 此为CTO交接，不替代Alex独立验证、正式RUN03采样与PM验收。

## 证据与原因

CEO正式运行trace报告：来源UNION排序约2300ms，extended任务查询339ms；同一同步SQLite连接使这些步骤占用HTTP服务事件循环。原来源UNION携带每条历史记录的`data/raw`参与排序后才LIMIT，extended任务使用市场条件下的candidate/source OR及`SELECT t.*`。代码路径与读计划支持以上问题，不把只有EXPLAIN的早期快照历史猜测写成唯一运行根因。

本Agent只读执行计划留在`.artifacts/issues-20260920/provider-runtime-query-diagnosis.json`。正式trace的原件和完整请求计时由CEO归档；本报告不将合成测试时长称为正式性能。

## 修改与语义保护

来源首先只选`channel/id/observed_at`，沿原`observed_at DESC,channel,id DESC`顺序执行原LIMIT/OFFSET，再按已选主键读取当前页全部`data/raw`及既有显示字段。总数改为各来源表的覆盖索引COUNT相加。默认页20条只读取20条完整来源；不删除或截断任何返回字段，也不影响深页或空页总数。

extended任务改为candidate索引分支与来源task_id索引分支的UNION，保留任务country/store约束和去重，排序取前20个ID，再读取这些任务的元数据。hourly/batch/manual任务也只选择现有返回所需字段，不取payload、response等大字段。来源、任务排序及unknown/空页的现有状态推断维持原行为。

CEO配合提供`discovery_tasks(candidate_id,country,store,id)`与`discovery_sources(country,store,external_id,task_id)`索引，以及批次来源全局身份时间索引。夹具上EXPLAIN确认三个来源分支均为COVERING，任务candidate/source分支也分别使用覆盖索引，无市场全任务SCAN。生产DDL及构建成本由CEO维护记录，不在请求内建索引。

## 自检

`tests/runtime-diagnostic.test.ts`冻结修改前的完整函数作为参考，比较返回对象深等，而不是以新查询自行推导预期。覆盖混合三通道同时间排序、重复task来源、跨市场/商店身份、不存在批次表、unknown、零长度页、跨页、越界空页、负limit现有行为、阶段分类/错误/人工导入及所有原始字段。独立查询追踪确认raw只按当前页主键读取、空页不读raw，且total_changes保持不变。

| 命令 | 结果 |
| --- | --- |
| `npx tsx --test tests/runtime-diagnostic.test.ts` | 5 passed / 0 failed |
| `npx tsx --test tests/runtime-diagnostic.test.ts tests/extended-discovery.test.ts tests/open-issues-provider-related.test.ts tests/alex-open-issues-provider.test.ts` | 28 passed / 0 failed |
| `npx tsc --noEmit -p tsconfig.server.json` | 通过 |
| `npx prettier --check server/extended-discovery.ts tests/runtime-diagnostic.test.ts` | 通过 |
| `git diff --check -- server/extended-discovery.ts tests/runtime-diagnostic.test.ts docs/reports/ISSUE49-CTO-DIAGNOSTIC.md docs/reports/OPEN-ISSUES-20260920-CTO-PROVIDERS.md` | 通过 |

RUN03真实服务60秒交错HTTP采样、原身份诊断→详情→返回流程、最终产物及原队列保留核对由CEO/Alex执行。本次fixture证明业务结果相等及查询访问边界，未声称正式性能门槛已达成。

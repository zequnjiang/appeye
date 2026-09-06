# GitHub 需求与验收工作流

GitHub 仓库、Issues 和 Pull Requests 是本项目需求与交付的正式记录。对话帮助协作，但不能替代仓库中的需求、测试报告和验收证据。

## 角色和责任

| 角色 | 责任 | 交接输出 |
| --- | --- | --- |
| 主 Agent（CEO） | 对用户目标负责，建立 GitHub 跟踪，分派可并行工作，协调依赖和冲突，检查阶段证据，完成交付。 | Issue/PR 关联、阶段状态、最终交付说明。 |
| Subagent 产品经理（PM） | 理解并拆分需求，维护范围、口径和验收标准；测试结束后独立完成需求验收。 | `docs/requirements/` 中的需求与 `docs/reports/` 中的 PM 验收报告。 |
| Subagent 开发工程师（CTO） | 按已明确需求实施，完成适当自检，修复测试发现的问题。 | 代码、运行说明、CTO 自检证据和待测试交接。 |
| Subagent 测试工程师（Alex） | 依据需求独立验证，执行测试回归、登记问题并确认修复。 | `docs/reports/` 中的测试报告及缺陷议题。 |

一个需求必须经过 PM 验收才能完结。角色由独立 Agent 承担，CTO 的自检不能替代 Alex 测试，Alex 的测试不能替代 PM 验收。

## 状态流转

`需求提出 → PM Ready → CTO In Progress → CTO Self-check → Alex Testing → PM Acceptance → Done / Closed`

1. CEO 建立需求 Issue，填写目标与背景，分派 PM。
2. PM 编写需求文档，给出范围、数据口径和编号验收标准；将文档链接回 Issue，标记 `PM Ready`。
3. CTO 接收需求，创建 `codex/` 前缀的实现分支并开发。PR 描述说明行为变化和验证证据，关联 `Refs #<issue>`。
4. CTO 自检完成，写明执行命令、结果、已知限制和待测提交，交给 Alex。
5. Alex 按验收标准验证并生成测试报告。发现缺陷时建立或关联 Bug Issue，交回 CTO 修复，再做必要回归。
6. 测试完成后 PM 阅读实际实现与 Alex 报告，逐项判定，生成 PM 验收报告。
7. 只有 PM 给出通过结论、所有 P0 问题解决且交付文件齐备，CEO 才可标记 Done 并关闭需求 Issue。PR 可在有明确验收证据后合并。

在 PM 验收前避免使用会提前自动关闭需求的 `Fixes #...` / `Closes #...`。若实现 PR 分阶段合并，需求仍保持打开，直到 PM 完成整体验收。

## GitHub 记录规范

- 一个 Issue 对应可独立理解的需求或缺陷；较大目标可使用父需求与子议题清单。
- Issue 中记录责任角色、当前阶段、需求文档、实现 PR、测试报告和验收报告链接。
- 状态可通过标签和评论维护，不要求 GitHub Projects 可用。建议标签：`type:requirement`、`type:bug`、`stage:pm-ready`、`stage:development`、`stage:testing`、`stage:acceptance`、`stage:done`。
- 需求变更更新文档和 Issue，说明对验收标准的影响；禁止只改对话而保持正式需求过时。
- 失败的命令、不可达的外部商店和未验证范围也要保留。未经验证不能登记为通过。
- 关闭需求的最后记录必须关联 PM 验收结论，并简述交付入口和剩余限制。

## 仓库文档约定

| 路径 | 内容 |
| --- | --- |
| `docs/requirements/MVP.md` | 首版目标、边界、数据口径与 AC 编号。 |
| `docs/requirements/<feature>.md` | 后续需求。 |
| `docs/reports/CTO-SELF-CHECK.md` | CTO 自检命令、结果、已知限制与交接信息。 |
| `docs/reports/ALEX-TEST-REPORT.md` | Alex 独立测试及回归证据。 |
| `docs/reports/PM-ACCEPTANCE.md` | PM 验收判定、证据、残留问题与正式结论。 |
| `.github/ISSUE_TEMPLATE/` | 需求和缺陷模板。 |

## 完成定义

- 所有需求验收标准都有证据与明确结论。
- CTO 自检、Alex 测试和 PM 验收均完成，并且角色交接可追溯。
- 运行方式、配置、数据库、数据局限和演示隔离说明齐备。
- 代码及报告已提交 GitHub，Issue 和 PR 相互关联。
- 无未解决 P0 缺陷；其他已知问题有独立追踪和明确边界。

## 首版 GitHub 议题

1. **[PM 需求 #1](https://github.com/zequnjiang/appeye/issues/1)**：由 PM 维护完整需求，作为父议题，在整体验收前保持打开。
2. **[数据采集后端 #2](https://github.com/zequnjiang/appeye/issues/2)**：覆盖 AC-03 至 AC-10 相关后端能力，链接父议题。
3. **[管理后台 #3](https://github.com/zequnjiang/appeye/issues/3)**：覆盖 AC-02、AC-11 至 AC-13 及前端相关验收，链接父议题。
4. **[回归与验收 #4](https://github.com/zequnjiang/appeye/issues/4)**：汇总 AC-01 至 AC-15 证据，跟踪报告和遗留缺陷，链接父议题。

实现分支为 `codex/mvp-credit-monitor`，对应 [PR #6](https://github.com/zequnjiang/appeye/pull/6)。交付证据见 [Alex 测试报告](reports/ALEX-TEST-REPORT.md) 与 [PM 验收报告](reports/PM-ACCEPTANCE.md)。所有议题须在对应测试、PM 验收与报告发布完成后再关闭。

## V0.2 GitHub 议题

[PM 总需求 #7](https://github.com/zequnjiang/appeye/issues/7) → [采集器迁移 #5](https://github.com/zequnjiang/appeye/issues/5) / [完整信息 #8](https://github.com/zequnjiang/appeye/issues/8) / [信贷识别 #9](https://github.com/zequnjiang/appeye/issues/9)。文档见 [V0.2 需求](requirements/V0.2.md)，报告以 `V0.2-` 前缀保存，不覆盖首版验收记录。

# #42 正式研究工作台：Alex 独立验证

需求：[RESEARCH-WORKSPACE-PRODUCTION.md](../requirements/RESEARCH-WORKSPACE-PRODUCTION.md)，API：[RESEARCH-WORKSPACE-API.md](../requirements/RESEARCH-WORKSPACE-API.md)，[Issue #42](https://github.com/zequnjiang/appeye/issues/42)。

**当前为后端阶段通过，尚未完成整个 #42 的 Alex 验收。** 前端仍由 CTO 实施；浏览器、完整工程与真实受控部署需另行交接。不得以本报告关闭需求或宣称原扫描 #11 完成。

## 后端独立结果

2026-09-09 05:43 UTC，基线 HEAD `3587bd19f91d53026943d4513223f0ee4321363b` 加当前未提交 #42 工作树。CEO 完成后端自检并交接后，Alex 独立新增 [12 个场景](../../tests/alex-research-workspace.test.ts)，随后复跑关联回归：

| 检查 | 实际结果 |
| --- | --- |
| `npx tsx --test tests/alex-research-workspace.test.ts tests/research-workspace.test.ts tests/api.test.ts tests/v02-api.test.ts tests/v02-migration.test.ts` | 31/31，0 失败/跳过，2.553 秒；其中 Alex 独立 12 项、CEO 研究工作台 7 项、既有 API/迁移 12 项。 |
| `npx tsc --noEmit -p tsconfig.server.json` | 退出码 0。 |

日志：`.artifacts/alex-research-workspace-backend.log`、`-backend-types.log`；13 个源码/测试/日志 SHA256 位于 `.artifacts/alex-research-workspace-backend-manifest.json`。本机 Node v25.9.0，不代表远程 Node24 CI。没有运行覆盖生产 `dist` 的构建。

所有新增场景使用内存 SQLite、127.0.0.1 临时 HTTP 服务、虚构账号和注入 provider。收录用实际 worker 执行注入的详情响应，未请求商店、操作正式数据库或启动生产采集。上述隔离结果不作为线上迁移与吞吐证明。

## 独立覆盖与缺陷闭环

| 范围 | 实际验证 |
| --- | --- |
| AC02–04 身份与隔离 | Viewer/platform 对 16 类研究写操作全部 403；跨空间组/集合/条目替换 ID 为 404。拒绝前后全部私有表及审计行摘要相同。平台无法导出客户研究。工作区停用撤销原成员会话与快照。 |
| AC02/04 凭据与事务 | 同平台密码独立 salted scrypt；重建服务后客户合法 cookie/snapshot 保留，平台密码及 SESSION_SECRET 旋转分别拒绝旧权限。邀请接受在审计写入故障时整体回滚用户/成员/消费状态，解除注入后同 token 成功一次。日志中的 `Synthetic invite audit failure` 是本项预期 500，最终断言通过。 |
| AC05–08 市场与快照 | 20 个快照硬上限/淘汰、过期、跨用户与平台 token 拒绝；probe 不生成新快照。分类细分与当前事件范围一致，0 有效、null 尾部；人工细分未改写旧 app/snapshot。关联既有测试覆盖九字段双向排序、冻结跨页、服务重建与公开可见性撤销。 |
| AC06/07/08/13 日期同源 | 使用实际 `normalizeApp` 处理泰文佛历、西语、印尼语、英文日期，核活动/日期筛选/已读一致；日期精度不补成午夜，无法确认的原始日期保留未知。三个独立缺陷均见下表。 |
| AC13/14 研究与引用 | 外应用 review ID、错误字段/正文、自传来源时间/URL、失败 enrichment history、当前资料伪造 recordId 均拒绝；旧成功补充仍可引用。评论后来更新、应用 excluded 后原摘录/时间保持，当前受限评论仍 404。并发同 revision 编辑为一成功一 409；移除作者不删除空间共享研究。 |
| AC15 导出 | 实际 UTF-8 Markdown attachment 包含所选集合全部 27 条，排除集合外条目与另一客户私密内容；整空间导出包含未归集条目。Viewer 可读导出，夹带 workspaceId 拒绝。验证 HTTP 响应正文，未冒称浏览器已保存到磁盘。 |
| AC16/17 收录 | 两空间同一市场身份复用采集 job，私有备注独立；注入 provider 经实际 worker 生成 snapshot/result，再成为 admitted。保存来源时间与关联 snapshot 相同；人工 excluded 后回到 review，重采不覆盖人工决定。规则与旧管理路径通过关联自检回归，前端运营动作尚待验证。 |

| 编号 | 独立反例与修复结果 |
| --- | --- |
| RWP-ALEX-01 | Thai `๗ ก.ย. ๒๕๖๙` 已产生 2026-09-07 发布事件，但库列表日期过滤返回空。首轮独立 8 项为 6 通过/2 失败；CEO 改为复用原始来源日期证据，正向四语样本复测通过。 |
| RWP-ALEX-02 | 对上述真实活动 API 返回的 `storeRelease:<id>` 标已读，原来 404。CEO 改为按同一原始来源判定事件，复测通过。 |
| RWP-ALEX-03 | `Feb 30, 2026` 被旧 normalize 回卷，或模糊 `09/07/2026` 被宿主解析；DTO 在证据已拒绝后又 fallback 成确定时间。新增反向测试首次失败；共享显示投影现仅在原始日期缺失时兼容旧规范字段，明确原文不可解析时为 null/unknown。列表和详情复测通过，原 DB JSON 完全未改。 |

初次失败均为隔离夹具发现，不声称线上用户已出现该错误。CEO 修改实现，Alex 保留需求断言复测，没有降低预期以使测试通过。

## 尚待交接

本阶段支持继续前后端集成，当前没有未解决的后端专项阻断。最终仍需 CTO 前端自检后独立验证 AC01/09–12 的正式页面、返回与快照生命周期，真实研究浏览器操作及权限失败；补全 AC18 的受控备份/迁移/恢复和实际服务证据，并执行最终工程/CI 后交 PM 完整验收。现有 API 隔离检查不能替代这些尚未完成的步骤。

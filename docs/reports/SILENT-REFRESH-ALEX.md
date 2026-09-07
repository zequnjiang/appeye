# #21 静默刷新与列表返回：Alex 独立回归

- GitHub：[前端问题 #21](https://github.com/zequnjiang/appeye/issues/21)。
- 状态：**独立工程、合成浏览器与正式部署一致性核查通过，已交 PM 最终验收；不代表原全量采集 #11 完成。**
- 需求：[SILENT-REFRESH.md](../requirements/SILENT-REFRESH.md)，版本 1，SR-AC-01–06。
- Alex 文件所有权：`tests/alex-*`、本报告；不修改 `src/`、`server/` 或依赖配置。
- 测试隔离：自动用例注入可控响应，浏览器使用合成预览；不操作正式数据库、采集器或服务。

## 已复现的旧行为

只读源码显示，工作区每 15 秒更新统一版本号；列表已有数据时仍以加载提示替换表格与分页。进入详情会卸载 `AppsPage`，其局部筛选、搜索与页码随之丢失；返回重新挂载并发起初次查询，原滚动位置未保存。这些是组件重建，不是 `location.reload()`。

`src/api.ts` 将读取响应正文的所有异常转换为错误对象，HTTP 200 随后仍成功返回；原 `useData` 的成功与错误回调未检查请求是否过期。

准备阶段独立命令：

```text
node --import tsx --test tests/alex-api-lifecycle.test.ts
```

结果：**3 项，1 通过、2 失败，退出码 1**。两项失败均为 `Missing expected rejection`：HTTP 200 正文读取中取消、HTTP 200 非法 JSON。这是修复前已知问题的基线；不是新实现测试结果。真实 401 会话失效事件及 503 原错误消息验证通过。全部使用 fake fetch，无真实网络。

## 独立回归矩阵

| 场景 | 验证目标与证据 |
| --- | --- |
| 列表 → 详情 → 返回 | 国家、商店、分类、识别证据、输入/提交搜索、第 3 页保持；数据渲染后恢复阅读行、滚动及键盘焦点，不新增 document 请求。 |
| 同查询后台刷新 | 原行、分页和焦点保持；不整表切加载提示。失败保留成功数据并清楚提示；初次无缓存加载仍有明确状态。 |
| 请求竞争与取消 | 可控 Promise 的 A→B 乱序成功/失败、正文阶段取消、非法 200 JSON；过期请求不能写入当前数据、错误或加载状态。 |
| 慢请求与轮询 | 单次超过 15 秒时同查询不反复取消而饥饿；同 key 单飞；页面不可见暂停轮询，恢复按约定更新。 |
| 查询与会话隔离 | 同查询缓存可返回，不同国家/商店/过滤条件不混数据；20 项缓存边界和淘汰；退出后不残留上次受保护数据。 |
| 结果变化 | 分类变更后不继续显示不匹配行；末页总数收缩能合法调页；新增数据引起排序变化时遵循确定的阅读锚点规则。 |
| 历史与详情 | 背景更新不关闭已展开原始字段、采集历史或评价/变化内容；旧错误后可恢复；与列表共享请求保护边界。 |
| 浏览器实测 | 合成数据下桌面和窄屏检查返回、位置、焦点与至少一次真实定时刷新；动态请求竞争由确定性测试覆盖，不冒称人眼验证全部异步时序。 |

## 环境与交接

CUA 准备阶段只有原生 Google Chrome，浏览器连接器清单为空。CTO 后续安装了 Playwright 测试依赖，实际独立浏览器回归使用本机 Chrome headless、随机端口 Vite 和全量拦截的合成 API；外部请求被拒绝。未复用正式 `3000` 页面，未读取正式数据库。Alex 夹具使用独立 Vite 缓存目录，未写生产 `dist`。

## 正式独立结果

CTO 以 [前端自检报告](SILENT-REFRESH-CTO.md) 正式冻结交接后，Alex 执行 `npm test`：**221/221 通过，0 失败、0 跳过，42.100504 秒**；`npm run typecheck` 前后端通过，`git diff --check` 通过。基线取消和坏 JSON 的两项失败均已复测通过，没有删除或跳过原断言。

| 证据 | 实际结果 |
| --- | --- |
| `tests/alex-api-lifecycle.test.ts` | 3/3：正文取消原样拒绝、200 非法 JSON 不当作数据、真实 401 与普通 503 错误行为保留。 |
| `tests/alex-query-cache.test.ts` | 3/3：同 key 单飞；旧会话迟到成功/失败隔离；失败保留数据和时间；第21查询淘汰并取消旧请求；StrictMode 重订阅与真实离开分开。 |
| `tests/alex-silent-browser.test.ts` | 3/3：两轮真实15秒自动更新保留同一表格 DOM、分页和编辑焦点，503后旧行保留并可恢复；1280/390px返回完整筛选、非首页、阅读位置及入口焦点，在请求刻意延迟时缓存立即可见，无 document 导航；旧 AR 查询在 MX 成功后释放不能覆盖结果，新过滤请求只用 offset0。 |
| 全套中的 CTO 浏览器用例 | 独立重跑8个场景通过，补充插入/删除锚点、失效末页/空结果、慢请求跨3周期、隐藏/恢复、历史展开、发现诊断及待加载详情返回。确定性隐藏状态由浏览器事件夹具模拟，不冒称人工切换 OS 标签。 |
| 构建边界 | CEO/CTO已报告隔离生产构建通过；Alex本次按部署约束只执行类型/测试检查，未重新构建正式静态目录。最终部署产物与源码指纹待实际运行阶段核对。 |

日志 `.artifacts/alex-silent-discovery-tests.log`、`.artifacts/alex-silent-discovery-types.log` 及带时间/SHA的 `.artifacts/alex-silent-discovery-engineering.json` 留存本机，全部为合成用例。业务提交由 CEO 统一冻结发布，本结论针对正式交接后的工作树，不能提前归给尚未生成的发布提交。

SR-AC-01–06 的工程和合成浏览器范围通过，无未解决阻断问题。以下追加正式部署核查；目标包真实采集另见 [扩展发现 Alex 报告](EXTENDED-DISCOVERY-ALEX.md)，本报告不代表 #11 评论全量完成。

## 正式部署核查与最终交接

业务提交为 `e356bb323309dbb4e332b3bf941b314c9de6987f`；[精确提交 CI 34138027098](https://github.com/zequnjiang/appeye/actions/runs/34138027098) 由 CEO 确认通过。Alex 于 **2026-09-07 15:34:08.192–15:34:09.392 UTC** 执行只读 `.artifacts/alex-extended-live-audit.mjs`，退出码0、`errors=[]`：40个正式源文件与该提交逐字节一致，61个 `dist` 部署文件与隔离发布产物逐字节一致，正式入口文件指纹与安装记录一致。此核查没有重建或改写运行目录。

CEO 已实际验证认证后的发现诊断/身份接口和目标提交，证据为本机 `data/batches/extended-2026-09-07-live-smoke.json` 及 [部署报告](SILENT-DISCOVERY-DEPLOYMENT.md)。这些正式 API 操作归属 CEO；Alex 的轮询、返回筛选/分页/阅读位置/焦点及1280/390px浏览器结论，仍明确来自上述真实 Chrome、全 API 拦截的合成环境，未冒称 Alex 在正式后台重新登录逐项操作。

Alex 于 **15:39:09.904–15:39:10.505 UTC** 独立执行 `.artifacts/alex-extended-restart-audit.mjs`，退出码0、`errors=[]`。CEO 的受控重启将 PID3342 更换为3848；Alex 验证新 owner 存活，旧来源/响应指纹、cycle1、下一调度时间及固定2024成员保持，三个采集通道继续推进。服务重启没有要求改动前端或另换产物。该核查不重复221项测试，也不把后端采集进度当作浏览器交互验证。

正式证据为本机忽略文件 `data/batches/extended-2026-09-07-alex-live-audit.json` 与 `-alex-restart-audit.json`；后者保留前后部署证据 SHA。Alex 至此完成 SR-AC-01–06 的独立回归及已测试代码的部署对应核查，交 PM 作最终产品判定。扩展来源另有 [#24](https://github.com/zequnjiang/appeye/issues/24) 的真实 GP 关联页兼容问题，原运营 [#11](https://github.com/zequnjiang/appeye/issues/11) 继续，不列为本前端交互修复完成的采集成果。

# 2026-09-20 开放 Issue：CEO 受控发布

需求：15 个开放 Issue，见 [PM 需求](../requirements/OPEN-ISSUES-20260920.md)；实现 [PR #48](https://github.com/zequnjiang/appeye/pull/48)。功能源码提交 `bd5c171991f450976af10d95fb13fad414412dca`，发布与运营终验分开，逐项结果以 Alex / PM 报告为准。

## 工程检查

- `npm test`：最终 **309/309** 通过，0 skipped / failed，47.2197 秒。包含 Alex 独立 16 项和 CTO 的 #46 完整历史补修。
- `npm run typecheck`、前后端隔离构建和 `git diff --check`：通过。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- 新前端资源 `index-DFVfwQzx.js`，构建在独立暂存目录，在线旧服务在切换前未读取正在构建的文件。

## 正式资料维修

停止唯一 Appeye launchd collector 并等待其退出后，WAL checkpoint TRUNCATE，创建第二份独立 APFS clone：`data/backups/appeye-before-2026-09-20-release.sqlite`，**107,135,963,136 字节**，0600。2026-09-20 04:15:49Z 完成；文件大小、独立 inode、业务表哈希与首/中/末字节样本一致。它是完整数据库备份；验证未冒称整文件 SHA。首次 bootout 尚在退出时维护守卫拒绝执行，确认退出后才重试。

随后离线更新 **3,563 / 3,563** 条旧识别分析；没有缺失原源、没有网络请求。旧/新分析逐项写入研究审计。维修前后所有应用事实（除 `loan_analysis`）、有效分类、六国配置、私有研究表、原批次 **2,024** 个成员和历史原始表高水位哈希保持一致。

原始历史和人工决定没有被新规则改写。后续新观测仍由正式采集器按正常调度产生。

## 来源恢复

- #11：第一份备份后仅重试已核对的原 **165** 个 GP 评论失败任务；保留原 app 身份、page、cursor、旧 attempts/HTTP，不扩展原 2,024 成员。恢复中部分原游标返回真实 HTTP 200 的 `UsvDTd code 5`，未解释为成功空页或证明下架。独立当前入口样本 app 1236/job 1318/manual response 37 成功保存 **150** 条源评论，只是当前样本，不能替代历史流终验。
- #24：按现有运行 cycle 11 的原预算新增 5 个独立类似应用验证任务 **113299–113303**，分别引用原 task 129/233/337/438/524。未改旧任务、未开新周期、未重置预算。通过原公平调度及共享限速执行；实际结果待追加。

## 发布核对

暂存 release 切换为 `dist`，旧 release 留在私有忽略目录供回退。2026-09-20 04:16Z 重新启动同一 `com.appeye.collector`，PID 84942。恢复期间需要确认 Appeye 自身就绪：仅 HTTP 200 不足，因为同机另有无关 IPv6 3000 服务；启动未就绪时的首次探针命中了该服务的 HTML，未当作通过，后续先核对正式资源身份再登录。未停止或修改无关服务。

正式 API / 浏览器、#24 新来源、#11 最终状态和 PM 验收待后续追加；本段不表示所有 Issue 已完成。

2026-09-20 04:19Z 服务完成恢复，确认 PID 84942 实际监听 `127.0.0.1:3000`，新版资源身份正确。CEO 对正式接口的八个历史问题应用（373/1076/1177/999/1000/1807/116/2089）核对全部通过：heuristics-3、真实原文 offset、32–40 APR上限、Maya储蓄收益、泰文商店日期、完整历史隐私DTO均符合；冻结CSV三类列及GCash待细分、20条手动任务身份返回正常。证据保存在私有 `.artifacts/issues-20260920/production-api.json`；未将评论正文或凭证加入仓库。

代码 `bd5c171` 的 GitHub Quality gates 两项均 SUCCESS（[运行记录](https://github.com/zequnjiang/appeye/actions/runs/35488680910)）。报告后续提交仍须检查最终 HEAD CI，不能沿用本次提交的绿灯合并不同 HEAD。

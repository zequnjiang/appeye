# Appeye · 信贷研究工作台原型

用户选定第 1 张“六国对照”设计方向后的可点击产品原型。[GitHub #35](https://github.com/zequnjiang/appeye/issues/35) · [需求与验收标准](../../docs/requirements/RESEARCH-PROTOTYPE.md)。

这是独立的前端演示，使用固定示例数据、示例身份与本地交互。不会访问正式 Appeye API、数据库或商店服务，不会发送邀请或运行采集。角色切换是产品流程演示，不能用作实际客户数据隔离的安全实现。正式服务继续使用自己的运行目录和端口。

## 本地预览

需要 Node.js 24+。在本目录执行：

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

预览地址为 `http://127.0.0.1:4173/`。仅监听本机，不对外部署。

```sh
npm run build
npm test
```

构建产物在本原型的 `dist/`，不会覆盖主项目的 `dist/`。保留 Product Design 模板的 Worker 和 Sites 构建约定，当前交付不发布到 Sites。

## 评审路径

1. 今日市场 → 泰国 / 某类事件 → 应用详情 → 查看前后变化与来源 → 返回原事件位置。
2. 应用库 → 筛选与字段排序 → 翻页 → 选择 2–4 个应用进行对比。
3. 资金桥 Demo → 商店示例图放大、前后切换 → 紧凑权限展开 → 保存研究摘录。
4. 切换示例客户及角色，查看私有关注、研究集合与成员邀请流程；平台运营处理示例收录申请。
5. 模拟新数据，确认当前清单保持不变，点击更新后再查看新结果。

全部数字、公司、条款、权限和评论均为原型示例，不代表真实商店观测或市场结论。演示日固定 2026-09-08，北京时间。截图示意素材与应用条款字段是独立设计样例，不能当成真实贷款服务或真实披露证据。

## 视觉与素材

- [用户选定首页](reference/selected-home.png)：内置 Image Gen 生成，当前原型的视觉依据。
- Appeye 标识：复用主项目 `public/favicon.svg`，不重画品牌图形。
- 字体：DM Sans Variable，中文使用系统 PingFang SC / Microsoft YaHei 回退。
- 图标：Lucide React，依据选图和现有项目的细线图标风格选择；国旗来自 `flag-icons` 包。
- [图库示例图 1](public/assets/store-demo-1.png)、[图库示例图 2](public/assets/store-demo-2.png)：内置 Image Gen 生成，图内和界面均标示非真实商店素材。生成说明见 [素材记录](reference/assets.md)。

测试、浏览器证据与 PM 验收由独立报告记录；生产多客户权限、服务端排序和查询快照需要后续正式开发，不属于本原型已实现能力。

- [视觉 QA 与实际浏览器证据](design-qa.md)
- [CTO 自检](../../docs/reports/RESEARCH-PROTOTYPE-CTO.md)
- [Alex 独立测试](../../docs/reports/RESEARCH-PROTOTYPE-ALEX.md)
- [PM 验收](../../docs/reports/RESEARCH-PROTOTYPE-PM.md)

IAB 若限制文件下载，可在导出预览中复制完整 Markdown 后保存。界面只提示发起下载，不承诺浏览器已经保存。TH9 的图片是明确标识的故意失败演示，TH1 提供正常双图，其他记录保留缺图状态。

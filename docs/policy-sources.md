# v0.2 政策来源与适用边界

- 本地研究版本：`2026-09-07.1`。
- 检索时间：`2026-09-06T17:12:48.000Z`（北京时间 2026-09-07）。
- 机器可读事实：[server/policy-catalog.json](../server/policy-catalog.json)。
- 该版本是 Appeye 的核对批次，不是 Google 或监管机构公布的版本；指定 Google 页面未提供可引用的政策版本号。

本轮已阅读用户指定的 Google Play 金融服务页面全文，依据完整条款区分描述披露、平台提交材料、权限与背景要求。参考了本地 `gp-loan-app-review` v1.1 的审查维度；其旧国家数字、专家经验和“唯一真源”约定没有替代当前官方原文。该技能的 `pending_updates` 目录不存在，不能据此证明政策没有变化。

## Google Play 可执行事实范围

| 规则组 | 核对事实 | 软件含义 |
| --- | --- | --- |
| GP-PL-* | 个人贷及其获客/撮合需披露还款范围、最高综合年化成本、代表性总成本例和隐私信息；60日内全额到期受限。 | 提取证据，不从分期日推断全额到期；不将披露存在等同真实、完整或合规。 |
| GP-GEN-* | 开发者与提交资质需可关联；敏感权限约束范围包含贷款辅助工具等。 | 账号、公司、权限分别留证；计算器可能受权限要求约束，但不因此成为放贷App。 |
| GP-EWA-* | EWA另有产品定义和披露内容。 | 不把工资预支自动等同普通个人贷款。 |
| GP-TH-* | 泰国个人贷商店页有服务方、开发法律实体、最高利率及费用要求；15%分界关联资质材料或额外声明。 | 普通利率独立于APR；条件不明时不判定；名称与牌照仅作声明。 |
| GP-PH-* | 菲律宾描述中的公司/业务名、SEC号与CA，以及P2P中介要求。 | 分字段保存，不查询或认证其真伪。 |
| GP-ID-* / GP-PK-* | 印尼许可材料；巴基斯坦SECP批准、一NBFC一DLA及特殊期限说明。 | 材料不是仅靠描述即可完成的审查；跨账号主体关系不能凭名称认定。 |
| mx / ar | 指定页面未列这两国的附加段落。 | 只应用适用的通用规则，另标当地法律未全面核验。 |

以上规则仅代表 Google Play 平台政策，不扩展为 Apple 准入规则。抵押房贷、车贷和循环授信不在该页普通个人贷定义中，通用“信贷”识别与具体政策适用性必须分开。 [Google Play 原始政策](https://support.google.com/googleplay/android-developer/answer/9876821)

## 国别官方来源登记

| 国家 | 官方资料与读取状态 | 本轮使用边界 |
| --- | --- | --- |
| 泰国 | 已读 [BoT 受监管个人贷款介绍](https://www.bot.or.th/th/satang-story/managing-debt/personal-loan.html)。 | 该产品存在25%有效年率及费用口径，但有具体产品和费用范围；没有把它写成所有泰国信贷的自动上限。Google Play的15%条款与BoT具体产品利率上限不是同一个规则。 |
| 印尼 | 定位到 [OJK 40/2024 LPBBTI 官方索引](https://ojk.go.id/id/regulasi/Pages/POJK-40-Tahun-2024-Layanan-Pendanaan-Bersama-Berbasis-Teknologi-Informasi.aspx)，仅可靠取得索引/检索摘要，未逐条核验法规全文。 | Google页面仍引用77/2016及其修订，不应因此认为印尼法律停留在2016年；旧技能的逐年日费率不作为执行规则。 |
| 菲律宾 | [SEC 公司类型说明](https://appointment.sec.gov.ph/lending-companies-and-financing-companies-2/lending-companies-and-financing-companies/)与[SEC当前索引](https://www.sec.gov.ph/)仅取得官方检索摘要，部分直读失败。 | 官方索引已有2026年新条目；本轮未读其全文，不套用旧费率、暂停上架说法或自行补全新规。Google描述字段要求已单独从Google原文核对。 |
| 巴基斯坦 | 定位到 [SECP 2023-01-07 数字借贷通报](https://www.secp.gov.pk/wp-content/uploads/2023/01/Press-Release-Jan-7-SECP-apprised-digital-lenders-on-new-regulatory-requirements.pdf)，官方检索摘要可读，PDF直读失败。 | 只作历史背景；当前软件的商店材料/主体要求依据已读Google页面，不宣称完成SECP最新全规则核验。 |
| 墨西哥 | 已读 [Banxico CAT说明](https://www.banxico.org.mx/CATWebTarjetas/CATWebTarjetas.xhtml)；[CONDUSEF登记工具](https://www.condusef.gob.mx/?p=registros)只有官方检索摘要可读。 | CAT是综合年度成本概念，保留指标原名与来源；SIPRES是资料入口，不推出“任意贷款App均需同一种金融牌照”。不执行未经核实的全国利率阈值。 |
| 阿根廷 | 已读 [BCRA P2P登记通报](https://www.bcra.gob.ar/noticias/el-bcra-crea-un-registro-para-los-proveedores-de-servicios-de-credito-entre-particulares/)，发布日期2021-11-25；[利率规则PDF](https://web2.bcra.gob.ar/Pdfs/Texord/t-tasint.pdf)直读失败，仅见官方检索摘要。 | 登记与金融中介授权不同，撮合平台与出借人角色不同；CFT/TNA/TEA可作原文指标识别，现行全规则、广告版式或利率阈值不执行。 |

`sources.status=read` 表示读取了原始页面；`search_excerpt_only` 表示只取得官方检索摘要或索引，不代表阅读全文。后一类的 `verifiedAt` 留空；它们不能作为新增硬性法规判断的唯一依据。所有公司、许可证或登记号在本轮均未经外部登记核验。

## 证据与判断的分层

1. **原始资料**：商店实际返回的描述、发布账号、seller、权限、评论及其他字段，保留来源和时间。
2. **抽取证据**：原文片段及明确字段，例如利率类型/周期、公司角色或编号声明；不捏造缺失信息。
3. **信贷线索**：Appeye 的多语启发式方法，不是官方政策。它可建议strong/possible/insufficient，但保留人工覆盖。
4. **披露对照**：适用的政策要求与已识别字段之间的对应关系。未识别不等于违规，条件不明不等于不适用。
5. **法律/牌照结论**：不由本轮系统给出。上架决策、具体主体资质和产品法律范围需有另外的实际证据与专业复核。

## 规则维护

规则ID保持稳定，语义或来源变化时更新本地版本和时间，并为国家/商店适用性与反例补回归。页面抓取失败保留上次成功版本和失败状态，不能静默用技能记忆覆盖。新增国家没有明确官方国别规则时，沿用适用的通用规则并显示“当地法律未核验”。

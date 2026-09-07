# #25 正式页面观察与前端发布

关联：[回归缺陷 #25](https://github.com/zequnjiang/appeye/issues/25)、[需求 LRR-AC-01–06](../requirements/LIBRARY-REFRESH-REGRESSION.md)。本报告由CEO记录实际页面观察和静态发布，独立结论分别由Alex及PM出具。时间使用UTC，需求日期按Asia/Shanghai。

## 修复前实际观察

用户再次反馈App清单刷新干扰使用，随后明确选择“保持当前清单，有新数据时提示，点击后更新”。这改变原#21的自动应用行为，不将原验收报告改写成当时已实现新选择。

通过真实认证服务及实际API，在817×863、泰国应用库观察33秒（2026-09-07T17:52:45–17:53:18Z），133个250ms采样，包含两个实际轮询响应窗口。总计4个应用请求（含初始全部国家与泰国切换）和1个document请求，表格移除0、加载占位0、JS错误0、scrollY始终0。采样内首四个身份2093/2092/2089/2088未改变；此窗口没有复现新行插入跳动，不能据此否认用户反馈或冒称已在生产复现全部触发。

实际加载产物为`/assets/index-C0wGrNTh.js`。数据与截图留本机忽略文件`.artifacts/library-live-before.json`、`library-live-before-start.png`和`library-live-before-end.png`，执行器为`library-live-probe.mjs`。本次有界页面观察没有创建业务任务或改写正式数据库。

前两次前置尝试失败如实保留：817像素中间宽度隐藏导航文字，按钮缺可访问名称，按名称定位超时；另一尝试等待完整load被外链资源拖至30秒超时。改为已核对的导航位置和DOMContentLoaded后完成上述观察；这些失败不是“页面重载”的证明。CTO随后补导航aria-label及title，正式验证将使用可访问名称。

CTO的旧版合成触发另证明：817×863顶部插入首行使scrollY从0变90、标题top从163变73。此为顶部误用行锚点的确定性复现，与以上真实窗口分开记录。

## 工程与实际发布

CTO完成26/26相关自检、最终小边界6/6及类型检查后冻结源码。Alex独立完整`npm test`为233/233通过、0失败/跳过，44.856467秒；类型和diff检查退出0，证据`.artifacts/alex-library-stable-engineering.json`。业务提交`a7a9f2f8d650b1c8249a3764e166b8c1df77087a`，对应[PR #26](https://github.com/zequnjiang/appeye/pull/26)。

CEO执行`npx vite build --outDir .artifacts/library-refresh-release`，退出0，构建日志`library-refresh-build.log`。11个src文件及11个构建文件SHA记录在`library-refresh-build-manifest.json`，供独立核对。

18:05:42.620–18:05:42.658Z，执行`.artifacts/library-refresh-install.mjs`：备份旧首页、复制新静态资产并原子替换index，保留旧资产，不重启或替换后端。端口3000采集进程前后均为PID3848；旧index SHA为`c0524ad724b49c2dd74879264f9dde13cc7c58824fbc25aa10b98204075237d1`，新index与隔离产物一致，为`a08dc884a705207b55add6629f691ae97c7340abc048b502dc34e9737878dc8b`。正式GET首页确认新`index-ZLBOd48d.js`及`index-CTx8P7Ju.css`。证据`library-refresh-install.json`；未写数据库、改变采集周期或创建采集任务。

## 发布后实际链路

Alex先在实际认证817×863泰国页面观察153秒，613个采样中业务显示、表格及位置保持，原API响应未变化，未出现待更新提示。自然无变化窗口不作为“提示→点击”成功证据。该首次探针对返回整行innerText有一项误报：测试阻断远程图标后，重挂载图标的占位首字母尚未出现；原记录保留，之后仅排除明确装饰`.app-icon`，业务文本断言保留。真实API未被拦截或替换。

按PM澄清的需求v1.1，为取得有界真实变化，在Alex第二段同页基线建立后，CEO对当前清单中的既有TH/GP `ihappyloan`（ID2089、`com.lethai.all`）仅提交一次普通refresh。18:13:04.101Z开始请求，任务1312于18:13:05.708Z创建，一次尝试成功；真实HTTP3078为200，manual response19及snapshot5184的观测时间均为18:13:07.215Z，收据已应用。lastFetched从17:32:52.667Z变为该新时间，身份、分类和firstSeen保持；没有新增应用或手写市场资料。证据`.artifacts/library-real-update.json`，执行器`library-real-update.mjs`。正常采集过程的持久化与此次纯静态部署区分；这是明确触发的真实更新，不称自然变化或合成数据。

Alex第二段基线为18:12:11.780Z，固定同一页面、TH筛选及显示快照，未通过重载取得新数据。至18:13:14.961Z，63秒、253采样及4次真实15秒检测请求中，原20条业务显示/顺序/总数324/分页、标题与表格位置均保持，表格移除和加载占位为0；只有1个document导航。18:13:11.596Z实际API已包含更新，显示快照仍保持且出现“有新数据，当前清单保持不变”。18:13:15.039Z点击“更新清单”后显示摘要改变，与最新成功API的身份、标题、总数相符，scrollY仍0。

随后正文应用2087详情返回，行Y386→386，国家TH、原清单和入口焦点保持；顶部显式刷新共享已有请求并成功应用。证据`.artifacts/alex-library-stable-live-triggered.json`及其start/observed/applied/returned截图，`errors=[]`。CEO已查看实际提示截图；这些是实际认证页面和API，远程图片资源被测试浏览器阻断，市场数据没有替换。

Alex于18:14:48Z独立只读复核job1312、response19、snapshot5184、HTTP3078、当前资料/raw/观测时间、身份及旧分类/firstSeen，无差异，见`alex-library-real-update-audit.json`。Alex另核11个源文件/11个部署文件及PID3848，见`alex-library-deployment-audit.json`。CEO的`library-refresh-release-audit.json`确认源码对应业务提交、正式index/JS/CSS实际HTTP200且SHA与隔离产物一致，后端相对发布前无diff。业务[CI 34150184911](https://github.com/zequnjiang/appeye/actions/runs/34150184911)亦已通过。

真实变化的完整链路与233项确定性工程回归均已交独立PM；最终产品结论见[PM验收报告](LIBRARY-REFRESH-REGRESSION-PM.md)。本轮不关闭原#11或#24。

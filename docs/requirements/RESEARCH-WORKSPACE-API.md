# 正式研究工作台 API 契约（#42）

CEO 拥有 server/ 与本契约，CTO 拥有 src/。JSON 字段一律 camelCase，内部 ID 为 number。所有 API 同源 cookie；除登录/邀请检查及接受外均需登录。错误 `{error:string}`，400参数/401会话/403角色/404不可见对象/409冲突/410快照或邀请失效。客户永远仅可读取当前 confirmed 公共应用及其资料。所有请求拒绝夹带工作区或用户替代会话权限。

## 身份

- `GET /api/auth/session` → `{authenticated,configured,dataset,user,workspaces,authorizationVersion}`；未登录user为null。`user:{id,name,email,role,workspaceId}`，role=`platform|admin|researcher|viewer`；platform id=0、workspaceId=null。`workspaces:[{id,name,role}]`。
- `POST /api/auth/login {email?,password,workspaceId?}`；无 email 为既有管理员密码平台入口；有email为受邀请账号，返回session。
- `POST /api/auth/workspace {workspaceId}` 切换已有成员空间、轮换cookie并返回session。平台不能切成客户身份。`POST /api/auth/logout`。
- `GET /api/auth/invitations/:token` → `{invitation:{email,role,workspaceName,expiresAt}}`。
- `POST /api/auth/accept {token,name,password}`：新账号密码至少12位；已有email需原密码，加入新空间，不覆盖原账号密码。返回session。邀请不发送邮件。

## 公共市场与列表

- `GET /api/market/apps`：query=`country?,store?,q?,loanScope?,sort?,direction?,limit?,offset?,snapshot?,probe?,from?,to?,minScore?,minInstalls?`。loanScope=`cash-priority`(默认personal+unknown)、`personal`、`other`、`unknown`、`all`。from/to为商店发布日期YYYY-MM-DD上下界，minScore为0–5最低评分，minInstalls为非负公开安装下限，均纳入快照查询。只含confirmed；分类细分 category=`personal|other|unknown`，categorySource=`manual|unclassified`。
- sort九值为title/developer/firstSeenAt/releasedAt/storeUpdatedAt/lastFetchedAt/score/ratings/minInstalls；默认minInstalls desc，null始终尾、0有效、id稳定兜底。先全集排序后分页。
- 无snapshot生成新冻结全集合及列表显示字段；返回`{apps,total,unknownTotal,limit,offset,snapshot,revision,createdAt,expiresAt}`。snapshot为不透明string，绑定当前会话+空间+完整查询，最多20个、12小时失效；数据库持久，成员撤权/冻结应用移出confirmed后拒绝旧token；offset越界调整最后有效页。
- 有snapshot仅分页原快照，不被采集变更影响；`probe=1`并带相同query/snapshot返回`{changed,revision}`（只比较当前查询的有序显示字段），不创建新快照。410时保旧清单、提示用户点击更新；不得自动重建。显式应用去掉snapshot请求新快照，成功后原子替换。
- `GET /api/market/activity`：沿用 /api/market-activity 的date/country/store/type/limit/offset和返回结构，增加上述loanScope。counts=每类不同应用数，eventCounts=事件条数。`countries`附`apps`(当前同品类该国已确认记录数)、`latestEventAt`、`latestEvent`(同过滤最新完整事件或null)；顶层`unknownTotal`为同范围待细分记录数、国家附`unknownApps`；顶层`featuredEvents`为同筛选下最近最多4条实际事件。不会固定示例日或示例数字。
- 既有 `GET /api/apps/:id` 与全部历史/评论/enrichment原文路径给客户confirmed资料；返回app附category/categorySource。旧列表/overview/changes/export/jobs/discovery管理路径仅platform；`GET /api/countries`公共。

## 本空间研究（无需传workspaceId）

- `GET /api/research/state` → `{workspace:{id,name},groups,favorites,collections,entries,readStates,requests}`，只含当前客户空间。platform无权。
- groups/collections：`{id,name,createdAt,updatedAt}`；favorites：`{appId,groupId:null|number,createdAt}`；collections附`appIds:number[]`；readStates：`{eventId,readAt}`，按当前用户隔离。
- `POST /api/research/groups {name}`；`PATCH /api/research/groups/:id {name}`；`DELETE .../:id`（该组关注变为未分组）。
- `PUT /api/research/favorites/:appId {groupId?:number|null}`；`DELETE .../:appId`。
- `POST /api/research/collections {name}`；`PATCH .../:id {name}`；`DELETE .../:id`（条目保留为未归集）；`PUT /api/research/collections/:id/apps/:appId {}`；`DELETE .../apps/:appId`。
- entries：`{id,appId,collectionId,kind:'note'|'excerpt',text,citation:null|object,createdBy,revision,createdAt,updatedAt}`。
- `POST /api/research/entries {appId,collectionId?,kind,text,citation?}`；`PATCH .../:id {text?,collectionId?,revision}`（revision为当前整数版本，冲突409，成功递增）；`DELETE .../:id`。每次写返回`{entry}`或`{ok:true}`。
- citation输入：`{kind:'app'|'snapshot'|'change'|'review'|'enrichment',recordId?:number,field?:string,quote?:string}`。服务器验证记录属于app，并固定 sourceUrl/sourceObservedAt/recordId/field/quote，拒绝伪造来源。kind=app引用当前 description/summary/releaseNotes/developer，snapshot默认description，change用真实old/new值，review为正文，enrichment为原始结果。输入quote若有必须是源内容子串；excerpt必需citation。不允许前端任意注入URL或来源时间。
- `PUT /api/research/read/:eventId {}` 标为当前用户已读，`DELETE`撤销。viewer只能浏览/导出，无业务写权限包括已读。
- `GET /api/research/export?collectionId?` 返回真正UTF-8 Markdown下载（Content-Disposition attachment）；同空间/集合内容、作者与固定来源，无示例内容。完整预览/复制可以读取相同文本作为浏览器下载备选。
- `POST /api/research/requests {country,store,externalId,note?}`创建收录申请；`GET state`可见请求`{id,country,store,externalId,status,appId,jobId,error,note,createdAt,updatedAt,resultObservedAt}`。状态pending/processing/admitted/failed/rejected/review；实际详情成功且confirmed才admitted，成功但待确认review，排队不能报收录成功。

## 成员与运营

- `GET /api/workspaces`：platform全部客户，客户仅本人空间列表；`POST /api/workspaces {name}`与`PATCH /api/workspaces/:id {name?,enabled?}`仅platform。
- `GET /api/workspaces/:id/members` → `{members:[{id,name,email,role,enabled}],invitations:[{id,email,role,status,expiresAt,createdAt}]}`；platform或该空间admin。
- `POST /api/workspaces/:id/invitations {email,role}` → `{invitation,token,acceptPath:'/...?invite=...'}`，只返回一次明文token，管理员复制分享。role=admin/researcher/viewer；`DELETE .../invitations/:invitationId`撤销。
- `PATCH /api/workspaces/:id/members/:userId {role?,enabled?}`、`DELETE .../members/:userId`；最后一个启用admin不可降级/删除，改动立即撤销受影响会话。
- `GET /api/platform/requests` → `{requests}`（附workspaceName）；`POST .../:id/process {action:'collect'|'reject',reason?}`：collect复用既有真实持久刷新队列，失败可再处理；demo不可真实采集。
- `PATCH /api/platform/apps/:id/category {category:'personal'|'other'|'unknown',reason}`持久人工细分留审计，不修改信贷确认来源；既有PATCH/apps分类和国家/任务/诊断全部platform。
- `GET /api/platform/rules` → `{autoConfirmStrong,version,updatedAt,catalog}`；`PATCH ... {autoConfirmStrong:boolean}`留审计，只控制强证据是否自动confirmed，不改政策事实/正则词表；影响后续采集分析。`POST .../reanalyze {}`显式重分析当前资料，保留人工/legacy分类，返回count。政策词表以版本化代码+GitHub审核管理，界面不冒充任意规则实时编辑。

所有私有/管理写入服务器强校验，数据库持久化。原型模拟控制与数字不进入正式客户流程。

### 最终集成补充：冻结清单 CSV 与撤权

`GET /api/market/apps.csv` 必须携带当前 `snapshot` 和对应完整查询（不能带 probe）。服务端执行与列表相同的会话、参数、过期和当前 confirmed 可见性验证，导出快照的全部行，忽略分页窗口；不会重新查询实时清单。附件含来源身份、细分类、日期精度、快照创建时间、累计安装口径，处理 CSV 公式注入，null 空值与数字 0 分开。

快照因应用不再 confirmed 而失效时返回 HTTP 410 与 `code: SNAPSHOT_SCOPE_REVOKED`，客户端必须清除旧行及相应选择/详情/研究源缓存，再由用户显式读取新清单。服务端保留已清空 rows 的有界撤权标记，重复 probe/CSV 仍返回相同 code，不降级成普通过期；仍遵守 12 小时/20 份清理规则。只有仍保存且当前所有成员均 confirmed 的自然过期返回不带 code 的 410；先验可见性再判过期。已淘汰或不存在的 token 无法重验旧范围，也带同一 code 清理显示，不能继续信任客户端旧行。

`DELETE /api/research/entries/:id` 同编辑一样必须携带 JSON `{revision}`；当前版本不符返回 409 并保留新版正文。成功删除在原空间/版本条件下执行，审计记录被删除版本。关注分组和集合的短名称操作保留显式最后操作语义。

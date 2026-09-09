import { useState, type FormEvent } from 'react';
import { Plus, Copy, Users, ArrowLeft } from 'lucide-react';
import { post, patch, remove } from './api';
import { useResource } from './use-resource';
import {
  Dialog,
  EmptyState,
  ErrorNotice,
  Heading,
  Busy,
  External,
  Icon,
  time,
  count,
  storeLabels,
  storeSource,
  copyText,
} from './ResearchUI';
import { FieldTree } from './Intelligence';
import { roleLabels, categoryLabels, type Principal, type WorkspaceRef } from './research-types';
import type { Mutation } from './ResearchPanels';
import type { MarketApp } from './types';
import type { Enrichment } from '../server/types';
interface Member {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'researcher' | 'viewer';
  enabled: boolean;
}
interface Invitation {
  id: number;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}
export function MembersPage({
  user,
  version,
  mutate,
}: {
  user: Principal;
  version: number;
  mutate: Mutation;
}) {
  const { data, error } = useResource<{ workspaces: WorkspaceRef[] }>('/workspaces', version);
  const [chosen, setChosen] = useState<number | null>(user.workspaceId),
    [dialog, setDialog] = useState<{ id?: number; name: string } | null>(null);
  return (
    <>
      <Heading
        title={user.role === 'platform' ? '客户与成员' : '客户成员'}
        description={
          user.role === 'platform'
            ? '管理客户空间与成员元数据；平台身份不读取客户私有研究。'
            : '管理本空间成员与邀请。邀请链接由你复制分享，不发送邮件。'
        }
      >
        {user.role === 'platform' && (
          <button className="button" onClick={() => setDialog({ name: '' })}>
            <Plus size={16} />
            创建客户空间
          </button>
        )}
      </Heading>
      <ErrorNotice error={error} />
      {data ? (
        <>
          <div className="research-filters">
            <select
              aria-label="选择客户空间"
              value={chosen || ''}
              onChange={(e) => setChosen(Number(e.target.value))}
            >
              <option value="">选择客户空间</option>
              {data.workspaces.map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                  {w.enabled === false ? ' · 已停用' : ''}
                </option>
              ))}
            </select>
            {user.role === 'platform' && chosen && (
              <>
                <button
                  className="button secondary"
                  onClick={() =>
                    setDialog({
                      id: chosen,
                      name: data.workspaces.find((w) => w.id === chosen)?.name || '',
                    })
                  }
                >
                  重命名
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    void mutate(
                      () =>
                        patch(`/workspaces/${chosen}`, {
                          enabled: data.workspaces.find((w) => w.id === chosen)?.enabled === false,
                        }),
                      '空间状态已更新',
                    )
                  }
                >
                  {data.workspaces.find((w) => w.id === chosen)?.enabled === false
                    ? '启用空间'
                    : '停用空间'}
                </button>
              </>
            )}
          </div>
          {chosen ? (
            <MemberList key={chosen} id={chosen} mutate={mutate} version={version} />
          ) : (
            <EmptyState>选择空间查看成员，或先创建客户空间。</EmptyState>
          )}
        </>
      ) : (
        <Busy />
      )}
      {dialog && (
        <Dialog
          title={dialog.id ? '重命名客户空间' : '创建客户空间'}
          onClose={() => setDialog(null)}
        >
          <form
            className="research-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                () =>
                  dialog.id
                    ? patch(`/workspaces/${dialog.id}`, { name: dialog.name })
                    : post('/workspaces', { name: dialog.name }),
                '客户空间已保存',
              ).then((ok) => {
                if (ok) setDialog(null);
              });
            }}
          >
            <label>
              空间名称
              <input
                required
                value={dialog.name}
                onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
              />
            </label>
            <button className="button">保存</button>
          </form>
        </Dialog>
      )}
    </>
  );
}
function MemberList({ id, mutate, version }: { id: number; mutate: Mutation; version: number }) {
  const { data, error } = useResource<{ members: Member[]; invitations: Invitation[] }>(
    `/workspaces/${id}/members`,
    version,
  );
  const [email, setEmail] = useState(''),
    [role, setRole] = useState('researcher'),
    [invite, setInvite] = useState<string | null>(null),
    [feedback, setFeedback] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    await mutate(async () => {
      const r = await post<{ acceptPath: string }>(`/workspaces/${id}/invitations`, {
        email,
        role,
      });
      setInvite(new URL(r.acceptPath, window.location.origin).href);
      setFeedback('');
      setEmail('');
    }, '邀请已创建；请复制链接分享给目标成员');
  }
  return (
    <>
      <form className="research-filters" onSubmit={submit}>
        <input
          required
          type="email"
          aria-label="邀请邮箱"
          placeholder="成员邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select aria-label="邀请角色" value={role} onChange={(e) => setRole(e.target.value)}>
          {['admin', 'researcher', 'viewer'].map((r) => (
            <option key={r} value={r}>
              {roleLabels[r as keyof typeof roleLabels]}
            </option>
          ))}
        </select>
        <button className="button">
          <Plus size={15} />
          生成邀请链接
        </button>
      </form>
      <ErrorNotice error={error} />
      {data ? (
        <>
          <h2>
            成员 <small>{data.members.length}</small>
          </h2>
          <div className="table-scroll">
            <table className="research-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <small>{m.email}</small>
                    </td>
                    <td>
                      <select
                        aria-label={`${m.name}角色`}
                        value={m.role}
                        onChange={(e) =>
                          void mutate(
                            () =>
                              patch(`/workspaces/${id}/members/${m.id}`, { role: e.target.value }),
                            '角色已更新，旧会话权限将即时重验',
                          )
                        }
                      >
                        {['admin', 'researcher', 'viewer'].map((r) => (
                          <option key={r} value={r}>
                            {roleLabels[r as keyof typeof roleLabels]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{m.enabled ? '有效' : '已停用'}</td>
                    <td>
                      <div className="button-group">
                        <button
                          className="text-button"
                          onClick={() =>
                            void mutate(
                              () =>
                                patch(`/workspaces/${id}/members/${m.id}`, { enabled: !m.enabled }),
                              '成员状态已更新',
                            )
                          }
                        >
                          {m.enabled ? '停用' : '启用'}
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            void mutate(
                              () => remove(`/workspaces/${id}/members/${m.id}`),
                              '成员已移除，空间研究内容保留',
                            )
                          }
                        >
                          移除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>邀请记录</h2>
          {data.invitations.length ? (
            <div className="table-scroll">
              <table className="research-table">
                <thead>
                  <tr>
                    <th>邮箱 / 角色</th>
                    <th>状态</th>
                    <th>过期时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.invitations.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.email}
                        <small>{roleLabels[i.role as keyof typeof roleLabels] || i.role}</small>
                      </td>
                      <td>{i.status}</td>
                      <td>{time(i.expiresAt, true)}</td>
                      <td>
                        {['pending', 'active'].includes(i.status) && (
                          <button
                            className="text-button"
                            onClick={() =>
                              void mutate(
                                () => remove(`/workspaces/${id}/invitations/${i.id}`),
                                '邀请已撤销',
                              )
                            }
                          >
                            撤销
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>暂无邀请。</EmptyState>
          )}
        </>
      ) : (
        <Busy />
      )}
      {invite && (
        <Dialog title="分享邀请链接" onClose={() => setInvite(null)}>
          <p>仅此处展示完整令牌。请分享给对应邮箱的成员；关闭后可撤销并重新生成。</p>
          <textarea readOnly aria-label="邀请链接" value={invite} />
          <button
            className="button"
            onClick={() =>
              void copyText(invite)
                .then(() => setFeedback('邀请链接已复制'))
                .catch((e) => setFeedback(e.message))
            }
          >
            <Copy size={15} />
            复制链接
          </button>
          <p role="status">{feedback}</p>
        </Dialog>
      )}
    </>
  );
}
export function RulesPage({ version, mutate }: { version: number; mutate: Mutation }) {
  const { data, error } = useResource<{
    autoConfirmStrong: boolean;
    version: string;
    updatedAt: string;
    catalog: unknown;
  }>('/platform/rules', version);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Heading title="识别规则" description="自动确认开关影响后续分析；人工与历史分类始终优先。" />
      <ErrorNotice error={error} />
      {data ? (
        <>
          <section className="panel padded">
            <h2>强证据信贷自动确认</h2>
            <p>
              规则版本 {data.version} · 最近修改 {time(data.updatedAt, true)}
            </p>
            <label className="research-checkbox">
              <input
                type="checkbox"
                checked={data.autoConfirmStrong}
                onChange={(e) =>
                  void mutate(
                    () => patch('/platform/rules', { autoConfirmStrong: e.target.checked }),
                    '规则配置已保存，对后续分析生效',
                  )
                }
              />
              启用强证据自动确认
            </label>
            <p className="mini-note">信贷确认不是个人现金贷细分，也不是牌照或合规结论。</p>
            <button className="button secondary" onClick={() => setConfirm(true)}>
              重新分析已有应用
            </button>
          </section>
          <section className="panel padded">
            <h2>版本化政策与词表</h2>
            <p>此处只读。政策修改通过 GitHub 需求、实现与验收流程发布。</p>
            <FieldTree value={data.catalog} />
          </section>
        </>
      ) : (
        <Busy />
      )}
      {confirm && (
        <Dialog title="重新分析当前资料" onClose={() => setConfirm(false)}>
          <p>使用当前规则分析已保存资料，不重新抓取商店。人工和 legacy 覆盖将保留。</p>
          <button
            className="button"
            onClick={() =>
              void mutate(() => post('/platform/rules/reanalyze'), '已完成重新分析').then((ok) => {
                if (ok) setConfirm(false);
              })
            }
          >
            确认执行
          </button>
        </Dialog>
      )}
    </>
  );
}
export function CategoryEditor({
  id,
  current,
  mutate,
}: {
  id: number;
  current: unknown;
  mutate: Mutation;
}) {
  const [category, setCategory] = useState(String(current || 'unknown')),
    [reason, setReason] = useState('');
  return (
    <details className="panel padded">
      <summary>平台人工细分 · 当前 {categoryLabels[String(current || 'unknown')]}</summary>
      <form
        className="research-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(
            () => patch(`/platform/apps/${id}/category`, { category, reason }),
            '细分类已保存，原信贷分类保持',
          ).then((ok) => {
            if (ok) setReason('');
          });
        }}
      >
        <select
          aria-label="人工信贷细分"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {Object.entries(categoryLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          aria-label="细分原因"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="核对依据与原因"
        />
        <button className="button">保存细分</button>
      </form>
    </details>
  );
}
export function ComparePage({
  ids,
  onRemove,
  onSelect,
  onBack,
}: {
  ids: number[];
  onRemove: (id: number) => void;
  onSelect: (id: number) => void;
  onBack: () => void;
}) {
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        返回上一页
      </button>
      <Heading
        title="应用对比"
        description="并列查看来源披露；不同币种、计息周期与权限状态不直接排名。"
      />
      {ids.length < 2 && <p className="mini-note">选择 2–4 个可见应用进行比较。</p>}
      <div className="research-compare">
        {ids.map((id) => (
          <CompareCard
            key={id}
            id={id}
            onRemove={() => onRemove(id)}
            onSelect={() => onSelect(id)}
          />
        ))}
      </div>
    </>
  );
}
function CompareCard({
  id,
  onRemove,
  onSelect,
}: {
  id: number;
  onRemove: () => void;
  onSelect: () => void;
}) {
  const { data, error } = useResource<{ app: MarketApp; enrichments: Enrichment[] }>(`/apps/${id}`);
  return (
    <article className="panel padded">
      <button className="text-button" onClick={onRemove}>
        移除对比
      </button>
      <ErrorNotice error={error} />
      {data ? (
        <>
          <button className="research-app-cell text-button" onClick={onSelect}>
            <Icon app={data.app} />
            <strong>{data.app.title}</strong>
          </button>
          <p>
            {data.app.country.toUpperCase()} · {storeLabels[data.app.store]}
          </p>
          <External url={storeSource(data.app)}>商店来源</External>
          <dl className="facts">
            <div>
              <dt>发布者</dt>
              <dd>{data.app.developer || '未提供'}</dd>
            </div>
            <div>
              <dt>销售方</dt>
              <dd>{String(data.app.sellerName || '未提供')}</dd>
            </div>
            <div>
              <dt>累计安装下限</dt>
              <dd>{data.app.store === 'app-store' ? '未公开' : count(data.app.minInstalls)}</dd>
            </div>
            <div>
              <dt>评分</dt>
              <dd>{data.app.score ?? '未提供'}</dd>
            </div>
            <div>
              <dt>最近观测</dt>
              <dd>{time(data.app.lastFetchedAt, true)}</dd>
            </div>
          </dl>
          <h3>条款与贷款主体线索</h3>
          {data.app.loanAnalysis?.evidence.length ? (
            data.app.loanAnalysis.evidence.map((e) => (
              <blockquote key={e.id}>
                {e.text}
                <small>
                  {e.field} · {e.id}
                </small>
              </blockquote>
            ))
          ) : (
            <p className="muted">未识别到可用描述证据。</p>
          )}
          <h3>权限与隐私来源状态</h3>
          {['permissions', 'privacy', 'dataSafety'].map((kind) => {
            const item = data.enrichments.find((e) => e.kind === kind);
            return (
              <div key={kind}>
                <strong>{kind}</strong>
                <p>{item?.status || '尚未采集'}</p>
                {item?.error && <p className="research-error">{item.error}</p>}
                <FieldTree value={item?.data ?? null} label="完整返回资料" />
              </div>
            );
          })}
        </>
      ) : (
        !error && <Busy />
      )}
    </article>
  );
}

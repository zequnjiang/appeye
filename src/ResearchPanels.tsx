import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Bookmark,
  FolderPlus,
  Plus,
  Trash2,
  FileDown,
  Pencil,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { api, apiText, post, patch, put, remove, query } from './api';
import { useResource } from './use-resource';
import {
  ScopeSelect,
  Busy,
  Dialog,
  EmptyState,
  ErrorNotice,
  External,
  Flag,
  Heading,
  Icon,
  count,
  time,
  storeLabels,
  copyText,
  downloadText,
} from './ResearchUI';
import {
  type LoanScope,
  canWrite,
  roleLabels,
  categoryLabels,
  type Principal,
  type ResearchState,
  type ResearchEntry,
  type Citation,
  type IntakeRequest,
  type WorkspaceRef,
} from './research-types';
import type { Country, MarketApp } from './types';
import { FieldTree } from './Intelligence';
export type Mutation = (operation: () => Promise<unknown>, success?: string) => Promise<boolean>;
export function EntryEditor({
  appId,
  entry,
  citation,
  state,
  mutate,
  onClose,
}: {
  appId: number;
  entry?: ResearchEntry;
  citation?: Citation;
  state: ResearchState;
  mutate: Mutation;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'note' | 'excerpt'>(
    entry?.kind || (citation ? 'excerpt' : 'note'),
  );
  const [text, setText] = useState(entry?.text || citation?.quote || '');
  const [collectionId, setCollectionId] = useState(String(entry?.collectionId || ''));
  const [source, setSource] = useState<Citation>(
    entry?.citation || citation || { kind: 'app', field: 'description' },
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setSaveError('');
    const ok = await mutate(
      () =>
        entry
          ? patch(`/research/entries/${entry.id}`, {
              text,
              collectionId: collectionId ? Number(collectionId) : null,
              revision: entry.revision,
            })
          : post('/research/entries', {
              appId,
              kind,
              text,
              collectionId: collectionId ? Number(collectionId) : null,
              ...(kind === 'excerpt'
                ? {
                    citation: {
                      kind: source.kind,
                      ...(source.recordId ? { recordId: source.recordId } : {}),
                      ...(source.field ? { field: source.field } : {}),
                      ...(source.quote ? { quote: source.quote } : {}),
                    },
                  }
                : {}),
            }),
      '研究内容已保存',
    );
    setBusy(false);
    if (ok) onClose();
    else
      setSaveError(
        '保存未完成，请查看错误说明；发生版本冲突时需关闭后重新读取最新内容再编辑。输入内容仍保留。',
      );
  }
  return (
    <Dialog title={entry ? '编辑研究内容' : '保存研究内容'} onClose={onClose}>
      <form className="research-form" onSubmit={save}>
        <label>
          内容类型
          <select
            disabled={!!entry}
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="note">研究备注 · 自己的观点</option>
            <option value="excerpt">来源摘录 · 商店证据</option>
          </select>
        </label>
        <label>
          集合
          <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            <option value="">未分组研究</option>
            {state.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {kind === 'excerpt' && !entry && (
          <>
            <p className="mini-note">
              引用由服务端核对归属与原文，并保存真实来源和观测时间。输入的引文须是原文片段。
            </p>
            <label>
              来源类型
              <select
                value={source.kind}
                onChange={(e) =>
                  setSource({
                    kind: e.target.value as Citation['kind'],
                    ...(e.target.value === 'app' ? { field: 'description' } : {}),
                  })
                }
              >
                {['app', 'snapshot', 'change', 'review', 'enrichment'].map((k) => (
                  <option value={k} key={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            {source.kind !== 'app' && (
              <label>
                来源记录 ID
                <input
                  type="number"
                  min="1"
                  required
                  value={source.recordId || ''}
                  onChange={(e) => setSource({ ...source, recordId: Number(e.target.value) })}
                />
              </label>
            )}
            <label>
              字段
              <input
                value={source.field || ''}
                onChange={(e) => setSource({ ...source, field: e.target.value })}
                placeholder="description / releaseNotes / …"
              />
            </label>
            <label>
              摘录原文
              <textarea
                value={source.quote || ''}
                onChange={(e) => setSource({ ...source, quote: e.target.value })}
                placeholder="留空时引用服务端验证的完整来源字段"
              />
            </label>
          </>
        )}
        <label>
          {kind === 'note' ? '备注' : '研究说明'}
          <textarea
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={20000}
          />
        </label>
        <ErrorNotice error={saveError} />
        <button className="button" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
      </form>
    </Dialog>
  );
}
export function DetailResearch({
  appId,
  user,
  state,
  mutate,
  eventCitation,
}: {
  appId: number;
  user: Principal;
  state: ResearchState | null;
  mutate: Mutation;
  eventCitation?: Citation;
}) {
  const [editor, setEditor] = useState<'note' | 'excerpt' | null>(null);
  const [group, setGroup] = useState('');
  const [collection, setCollection] = useState('');
  if (user.role === 'platform' || !state) return null;
  const favorite = state.favorites.find((f) => f.appId === appId);
  const write = canWrite(user);
  return (
    <section className="research-detail-actions">
      <span>
        <Bookmark size={16} /> {favorite ? '已关注' : '保存到客户研究空间'}
      </span>
      {write && (
        <>
          <select aria-label="关注分组" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">未分组</option>
            {state.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            onClick={() =>
              void mutate(
                () =>
                  favorite
                    ? remove(`/research/favorites/${appId}`)
                    : put(`/research/favorites/${appId}`, {
                        groupId: group ? Number(group) : null,
                      }),
                favorite ? '已取消关注' : '已关注',
              )
            }
          >
            {favorite ? '取消关注' : '关注应用'}
          </button>
          <button className="button secondary" onClick={() => setEditor('note')}>
            写备注
          </button>
          <button className="button secondary" onClick={() => setEditor('excerpt')}>
            保存摘录
          </button>
          <select
            aria-label="加入集合"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">选择集合</option>
            {state.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            disabled={!collection}
            onClick={() =>
              void mutate(
                () => put(`/research/collections/${collection}/apps/${appId}`),
                '已加入集合',
              )
            }
          >
            加入集合
          </button>
        </>
      )}
      {editor && (
        <EntryEditor
          appId={appId}
          state={state}
          mutate={mutate}
          {...(editor === 'excerpt'
            ? { citation: eventCitation || { kind: 'app', field: 'description' } }
            : {})}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
export function PrivateResearch({
  mode,
  loanScope,
  onLoanScope,
  user,
  state,
  error,
  mutate,
  onSelect,
  selectedId,
  onSelection,
}: {
  mode: 'favorites' | 'research';
  loanScope: LoanScope;
  onLoanScope: (s: LoanScope) => void;
  user: Principal;
  state: ResearchState | null;
  error: string | null;
  mutate: Mutation;
  onSelect: (id: number) => void;
  selectedId: number | null;
  onSelection: (id: number | null) => void;
}) {
  const [nameDialog, setNameDialog] = useState<{ id?: number; name: string } | null>(null),
    [editing, setEditing] = useState<ResearchEntry | null>(null),
    [exportText, setExportText] = useState<string | null>(null),
    [exportError, setExportError] = useState(''),
    [exportBusy, setExportBusy] = useState(false);
  const [exportFeedback, setExportFeedback] = useState('');
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => () => exportAbort.current?.abort(), []);
  if (!state)
    return (
      <>
        <Heading title={mode === 'favorites' ? '我的关注' : '研究空间'} />
        <ErrorNotice error={error} />
        {!error && <Busy />}
      </>
    );
  const write = canWrite(user),
    isGroups = mode === 'favorites',
    items = isGroups ? state.groups : state.collections,
    base = isGroups ? '/research/groups' : '/research/collections';
  const apps = new Map((state.apps || []).map((a) => [a.id, a]));
  const allAppIds = isGroups
    ? state.favorites
        .filter((f) => selectedId == null || f.groupId === selectedId)
        .map((f) => f.appId)
    : selectedId == null
      ? [...new Set(state.collections.flatMap((c) => c.appIds))]
      : state.collections.find((c) => c.id === selectedId)?.appIds || [];
  const appIds = allAppIds.filter((id) => {
    const app = apps.get(id);
    if (!isGroups || !app || loanScope === 'all') return true;
    const category = String(app.category || 'unknown');
    return loanScope === 'cash-priority'
      ? ['personal', 'unknown'].includes(category)
      : category === loanScope;
  });
  const entries = state.entries.filter((e) => selectedId == null || e.collectionId === selectedId);
  async function exportResearch() {
    setExportBusy(true);
    setExportError('');
    exportAbort.current?.abort();
    const c = new AbortController();
    exportAbort.current = c;
    try {
      const text = await apiText(
        '/research/export' +
          query({ collectionId: !isGroups && selectedId != null ? selectedId : undefined }),
        { signal: c.signal },
      );
      if (!c.signal.aborted) {
        setExportText(text);
        setExportFeedback('');
      }
    } catch (e) {
      if (!c.signal.aborted) setExportError((e as Error).message);
    } finally {
      if (!c.signal.aborted) setExportBusy(false);
    }
  }
  return (
    <>
      <Heading
        title={isGroups ? '我的关注' : '研究空间'}
        description={`${state.workspace.name} · ${isGroups ? '共享关注与分组' : '共享集合、备注与可追溯的来源摘录'}`}
      >
        {write && (
          <button className="button" onClick={() => setNameDialog({ name: '' })}>
            <FolderPlus size={16} />
            新建{isGroups ? '分组' : '集合'}
          </button>
        )}
        {!isGroups && (
          <button
            className="button secondary"
            disabled={exportBusy}
            onClick={() => void exportResearch()}
          >
            <FileDown size={16} />
            {exportBusy ? '准备导出…' : '导出研究'}
          </button>
        )}
      </Heading>
      {isGroups && (
        <div className="research-filters">
          <ScopeSelect value={loanScope} onChange={onLoanScope} />
          <span className="mini-note">仅筛选可见摘要；不改变已保存的关注关系。</span>
        </div>
      )}
      <ErrorNotice error={error || exportError} />
      <div className="research-split">
        <aside className="research-folders">
          <button className={selectedId == null ? 'active' : ''} onClick={() => onSelection(null)}>
            全部{isGroups ? '关注' : '研究'}
          </button>
          {items.map((item) => (
            <div key={item.id}>
              <button
                className={selectedId === item.id ? 'active' : ''}
                onClick={() => onSelection(item.id)}
              >
                {item.name}
              </button>
              {write && (
                <>
                  <button
                    className="icon-button"
                    aria-label={`重命名 ${item.name}`}
                    onClick={() => setNameDialog({ id: item.id, name: item.name })}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除 ${item.name}`}
                    onClick={() =>
                      void mutate(
                        () => remove(`${base}/${item.id}`),
                        '已删除分类，研究内容仍保留',
                      ).then((ok) => {
                        if (ok && selectedId === item.id) onSelection(null);
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </aside>
        <div className="research-content">
          <h2>
            {items.find((g) => g.id === selectedId)?.name || '全部'}{' '}
            <small>{appIds.length} 个关联应用</small>
          </h2>
          <div className="research-saved-apps">
            {appIds.map((id) => {
              const app = apps.get(id);
              return (
                <article key={id} data-reading-id={`saved-${id}`}>
                  {app ? (
                    <button
                      className="research-app-cell text-button"
                      data-focus-key={`saved-${id}`}
                      onClick={() => onSelect(id)}
                    >
                      <Icon app={app} />
                      <span>
                        <strong>{app.title}</strong>
                        <small>
                          <Flag country={app.country} /> {storeLabels[app.store]} ·{' '}
                          {categoryLabels[String(app.category || 'unknown')]}
                        </small>
                      </span>
                    </button>
                  ) : (
                    <span>应用 #{id} · 当前不在可见公共库</span>
                  )}
                  {write &&
                    (isGroups ? (
                      <div className="button-group">
                        <select
                          aria-label={`移动关注 ${id}`}
                          value={state.favorites.find((f) => f.appId === id)?.groupId || ''}
                          onChange={(e) =>
                            void mutate(
                              () =>
                                put(`/research/favorites/${id}`, {
                                  groupId: e.target.value ? Number(e.target.value) : null,
                                }),
                              '关注分组已更新',
                            )
                          }
                        >
                          <option value="">未分组</option>
                          {state.groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className="text-button"
                          onClick={() =>
                            void mutate(() => remove(`/research/favorites/${id}`), '已取消关注')
                          }
                        >
                          取消关注
                        </button>
                      </div>
                    ) : (
                      selectedId != null && (
                        <button
                          className="text-button"
                          onClick={() =>
                            void mutate(
                              () => remove(`/research/collections/${selectedId}/apps/${id}`),
                              '已从集合移除',
                            )
                          }
                        >
                          移除应用
                        </button>
                      )
                    ))}
                </article>
              );
            })}
          </div>
          {!appIds.length && <EmptyState>暂无关联应用，可从应用详情添加。</EmptyState>}
          {!isGroups && (
            <>
              <h2>
                备注与摘录 <small>{entries.length} 条</small>
              </h2>
              {entries.map((entry) => (
                <article className="research-note" key={entry.id}>
                  <header>
                    <span className="research-tag">
                      {entry.kind === 'excerpt' ? '来源摘录' : '研究备注'}
                    </span>
                    <strong>
                      {entry.appIdentity?.title ||
                        apps.get(entry.appId)?.title ||
                        `应用 #${entry.appId}`}
                    </strong>
                    <time>{time(entry.updatedAt, true)}</time>
                  </header>
                  <p className="pre-wrap">{entry.text}</p>
                  {entry.citation && (
                    <details>
                      <summary>已保存来源与原文</summary>
                      <FieldTree value={entry.citation} />
                    </details>
                  )}
                  <footer>
                    {entry.appVisible !== false && apps.has(entry.appId) ? (
                      <button className="text-button" onClick={() => onSelect(entry.appId)}>
                        查看应用
                      </button>
                    ) : (
                      <small>来源应用已不在当前公共库；保留当时的研究与引用。</small>
                    )}
                    {write && (
                      <>
                        <button className="text-button" onClick={() => setEditing(entry)}>
                          编辑
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            void mutate(
                              () =>
                                remove(`/research/entries/${entry.id}`, {
                                  revision: entry.revision,
                                }),
                              '研究内容已删除',
                            )
                          }
                        >
                          删除
                        </button>
                      </>
                    )}
                  </footer>
                </article>
              ))}
              {!entries.length && (
                <EmptyState>暂无研究内容。在应用详情中写备注或保存来源摘录。</EmptyState>
              )}
            </>
          )}
        </div>
      </div>
      {nameDialog && (
        <Dialog
          title={`${nameDialog.id ? '重命名' : '新建'}${isGroups ? '分组' : '集合'}`}
          onClose={() => setNameDialog(null)}
        >
          <form
            className="research-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                () =>
                  nameDialog.id
                    ? patch(`${base}/${nameDialog.id}`, { name: nameDialog.name })
                    : post(base, { name: nameDialog.name }),
                '已保存',
              ).then((ok) => {
                if (ok) setNameDialog(null);
              });
            }}
          >
            <label>
              名称
              <input
                required
                maxLength={100}
                value={nameDialog.name}
                onChange={(e) => setNameDialog({ ...nameDialog, name: e.target.value })}
              />
            </label>
            <button className="button">保存</button>
          </form>
        </Dialog>
      )}
      {editing && (
        <EntryEditor
          appId={editing.appId}
          entry={editing}
          state={state}
          mutate={mutate}
          onClose={() => setEditing(null)}
        />
      )}
      {exportText != null && (
        <Dialog
          title="研究导出预览"
          onClose={() => {
            setExportText(null);
            setExportFeedback('');
          }}
        >
          <p>内容来自当前客户空间的正式导出接口。浏览器受限时，可复制或手动保存完整 Markdown。</p>
          <textarea
            className="export-preview"
            readOnly
            aria-label="完整研究导出内容"
            value={exportText}
          />
          <div className="button-group">
            <button
              className="button"
              onClick={() => {
                downloadText(exportText, `appeye-research-${state.workspace.id}.md`);
                setExportFeedback('已发起文件下载，请查看浏览器下载记录。');
              }}
            >
              下载 Markdown
            </button>
            <button
              className="button secondary"
              onClick={() =>
                void copyText(exportText)
                  .then(() => setExportFeedback('完整内容已复制'))
                  .catch((e) => setExportFeedback(e.message))
              }
            >
              <Copy size={15} />
              复制全部
            </button>
          </div>
          <p role="status">{exportFeedback}</p>
        </Dialog>
      )}
    </>
  );
}
export function RequestsPage({
  user,
  state,
  countries,
  mutate,
  onSelect,
  version,
}: {
  user: Principal;
  state: ResearchState | null;
  countries: Country[];
  mutate: Mutation;
  onSelect: (id: number) => void;
  version: number;
}) {
  const [country, setCountry] = useState('ar'),
    [store, setStore] = useState('google-play'),
    [externalId, setExternalId] = useState(''),
    [note, setNote] = useState('');
  const platform = user.role === 'platform';
  const platformData = useResource<{ requests: IntakeRequest[] }>(
    platform ? '/platform/requests' : '/auth/session',
    version,
  );
  const requests = platform ? platformData.data?.requests : state?.requests;
  return (
    <>
      <Heading
        title="收录申请"
        description={
          platform
            ? '核对客户提交的身份、真实任务和采集结果。'
            : '提交尚未找到的应用，由平台核对与采集；排队不等于已收录。'
        }
      />
      {canWrite(user) && (
        <form
          className="research-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(
              () =>
                post('/research/requests', { country, store, externalId: externalId.trim(), note }),
              '收录申请已提交，等待处理',
            ).then((ok) => {
              if (ok) {
                setExternalId('');
                setNote('');
              }
            });
          }}
        >
          <select
            aria-label="申请国家"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <select aria-label="申请商店" value={store} onChange={(e) => setStore(e.target.value)}>
            {Object.entries(storeLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            required
            aria-label="申请包名或ID"
            placeholder="Google Play 包名 / Apple 数字 ID"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
          />
          <input
            placeholder="申请备注"
            aria-label="申请备注"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="button">提交申请</button>
        </form>
      )}
      <ErrorNotice error={platformData.error} />
      {!requests ? (
        <Busy />
      ) : requests.length ? (
        <div className="table-scroll">
          <table className="research-table">
            <thead>
              <tr>
                <th>应用身份</th>
                {platform && <th>客户空间</th>}
                <th>状态 / 任务</th>
                <th>申请与结果</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Flag country={r.country} /> {r.country.toUpperCase()} · {storeLabels[r.store]}
                    <code>{r.externalId}</code>
                    {r.note && <small>{r.note}</small>}
                  </td>
                  {platform && <td>{r.workspaceName}</td>}
                  <td>
                    {(
                      {
                        pending: '待处理',
                        processing: '采集中',
                        admitted: '已收录',
                        failed: '采集失败',
                        rejected: '已拒绝',
                        review: '等待人工核对',
                      } as Record<string, string>
                    )[r.status] || r.status}
                    <small>任务 {r.jobId ?? '尚未关联'}</small>
                    {r.error && <p className="research-error">{r.error}</p>}
                  </td>
                  <td>
                    {time(r.createdAt, true)}
                    <small>结果观测 {time(r.resultObservedAt, true)}</small>
                  </td>
                  <td>
                    <div className="button-group">
                      {r.appId && r.status === 'admitted' && (
                        <button className="text-button" onClick={() => onSelect(r.appId!)}>
                          查看应用
                        </button>
                      )}
                      {platform && (
                        <>
                          <button
                            className="button secondary"
                            disabled={r.status === 'processing' || r.status === 'admitted'}
                            onClick={() =>
                              void mutate(
                                () =>
                                  post(`/platform/requests/${r.id}/process`, { action: 'collect' }),
                                '已提交实际采集任务',
                              )
                            }
                          >
                            {r.status === 'failed' ? '有限重试' : '批准采集'}
                          </button>
                          <RejectRequest id={r.id} mutate={mutate} />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>暂无收录申请。</EmptyState>
      )}
    </>
  );
}
function RejectRequest({ id, mutate }: { id: number; mutate: Mutation }) {
  const [show, setShow] = useState(false),
    [reason, setReason] = useState('');
  return (
    <>
      <button className="text-button" onClick={() => setShow(true)}>
        拒绝
      </button>
      {show && (
        <Dialog title="拒绝收录申请" onClose={() => setShow(false)}>
          <form
            className="research-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                () => post(`/platform/requests/${id}/process`, { action: 'reject', reason }),
                '申请已拒绝',
              ).then((ok) => {
                if (ok) setShow(false);
              });
            }}
          >
            <label>
              原因
              <textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button className="button">确认拒绝</button>
          </form>
        </Dialog>
      )}
    </>
  );
}

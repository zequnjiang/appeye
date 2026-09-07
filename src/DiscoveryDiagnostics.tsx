import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, LoaderCircle, Search } from 'lucide-react';
import { post, query } from './api';
import { useResource } from './use-resource';
import { FieldTree, verdictLabels } from './Intelligence';
import type { Country, StoreName } from './types';

interface Cycle {
  id: string;
  dueAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  counts: Record<string, number>;
  markets: Array<{
    country: string;
    store: StoreName;
    sourceRequests: number;
    detailRequests: number;
  }>;
}
interface Status {
  enabled?: boolean;
  intervalHours: number;
  nextDueAt: string | null;
  heartbeatAt: string | null;
  activeCycle: Cycle | null;
  lastCycle: Cycle | null;
  totals: { pending: number; staged: number; admitted: number; failed: number };
  limits: {
    sourceRequests: number;
    detailRequests: number;
    timeoutMs: number;
    searchResults: number;
  };
  coverageNote: string;
}
interface Candidate {
  id: number;
  country: string;
  store: StoreName;
  externalId: string;
  title: string | null;
  appId: number | null;
  status: string;
  firstObservedAt: string;
  lastObservedAt: string;
  error: string | null;
  verdict: string | null;
  sourceCount: number;
}
interface Identity {
  country: string;
  store: StoreName;
  externalId: string;
  status: string;
  appId: number | null;
  classification: string | null;
  lastFetchedAt: string | null;
  error: string | null;
  sources: Array<{
    id: string;
    kind: string;
    source: string;
    observedAt: string;
    processedAt: string;
    keyword: string | null;
    parentAppId: number | null;
    enrichmentHistoryId: number | null;
    data: unknown;
    raw: unknown;
  }>;
  sourceTotal: number;
  tasks: Array<{
    id: number;
    channel: string;
    kind: string;
    status: string;
    error: string | null;
    stopReason: string | null;
  }>;
  analysis: unknown;
}
const labels: Record<string, string> = {
  'not-discovered': '尚未发现',
  pending: '等待详情',
  queued: '等待执行',
  running: '正在执行',
  staged: '证据暂存',
  failed: '失败',
  admitted: '已入应用库',
  deferred: '延期接续',
  limited: '达到本期预算',
  succeeded: '已完成',
  completed: '已完成',
  unsupported: '来源不支持',
  active: '运行中',
  paused: '已暂停',
  source: '来源',
  detail: '详情',
  confirmed: '已确认信贷',
  candidate: '待确认',
  excluded: '已排除',
};
const text = (s: string) => labels[s] || s;
const stamp = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('zh-CN') : '尚未记录';
const storeName = (s: StoreName) => (s === 'google-play' ? 'Google Play' : 'App Store');
function ErrorNote({ error, cached = false }: { error: string; cached?: boolean }) {
  return error ? (
    <div className="error-box" role="alert">
      {error}
      {cached ? '；保留上次读取结果，将自动重试。' : ''}
    </div>
  ) : null;
}
function Pager({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        共 {total} 条 · {total ? offset + 1 : 0}–{Math.min(offset + 20, total)}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="诊断上一页"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - 20))}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="诊断下一页"
          disabled={offset + 20 >= total}
          onClick={() => onChange(offset + 20)}
        >
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
function SourceLink({ value }: { value: string }) {
  let href: string | undefined;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) href = url.href;
  } catch {
    /* show as text */
  }
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      来源页面 <ExternalLink size={12} />
    </a>
  ) : (
    <span>{value || '未提供地址'}</span>
  );
}
function TaskEvidence({ id, version }: { id: number; version: number }) {
  const [offset, setOffset] = useState(0);
  const result = useResource<{
    task: unknown;
    responses: unknown[];
    http: unknown[];
    httpTotal: number;
    responsesTotal?: number;
  }>(`/discovery/tasks/${id}` + query({ limit: 20, offset }), version);
  return (
    <div className="diagnostic-section" aria-label="完整采集记录">
      <h3>任务 #{id} · 完整采集记录</h3>
      <ErrorNote error={result.error} cached={!!result.data} />
      {result.data ? (
        <>
          <FieldTree value={result.data.task} label="任务与停止原因" />
          <FieldTree value={result.data.responses} label="SDK 原始响应" />
          <FieldTree value={result.data.http} label="HTTP 原文与请求上下文" />
          <Pager
            offset={offset}
            total={Math.max(
              result.data.httpTotal,
              result.data.responsesTotal ?? result.data.responses.length,
            )}
            onChange={setOffset}
          />
        </>
      ) : (
        <p>正在读取保存证据…</p>
      )}
    </div>
  );
}
function IdentityResult({
  identity,
  version,
  onSelect,
  onChanged,
}: {
  identity: { country: string; store: StoreName; externalId: string };
  version: number;
  onSelect: (id: number) => void;
  onChanged: () => void;
}) {
  const [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(''),
    [evidenceId, setEvidenceId] = useState<number | null>(null);
  const { data, error, loading } = useResource<Identity>(
    '/discovery/identity' + query({ ...identity, limit: 20, offset }),
    version,
  );
  async function add() {
    setBusy(true);
    setActionError('');
    try {
      const response = await post<{ app: { id: number } }>('/apps', identity);
      onChanged();
      onSelect(response.app.id);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel diagnostic-identity" aria-label="身份诊断结果">
      <div className="panel-heading">
        <div>
          <h2>{identity.externalId}</h2>
          <p>
            {identity.country.toUpperCase()} · {storeName(identity.store)}
          </p>
        </div>
        {data && (
          <span className={`badge ${data.status === 'failed' ? 'red' : 'teal'}`}>
            {text(data.status)}
          </span>
        )}
      </div>
      <ErrorNote error={error} cached={!!data} />
      <ErrorNote error={actionError} />
      {loading && !data ? (
        <div className="diagnostic-empty">
          <LoaderCircle className="spin" size={18} />
          正在查询已保存来源…
        </div>
      ) : (
        data && (
          <>
            {data.status === 'not-discovered' && (
              <p className="data-note">
                系统尚未发现这个市场身份，不代表商店中不存在。可明确加入跟踪并采集详情；排队不等于采集成功。
              </p>
            )}
            <div className="diagnostic-summary">
              <span>当前分类：{data.classification ? text(data.classification) : '尚未入库'}</span>
              <span>最近成功资料：{stamp(data.lastFetchedAt)}</span>
              <span>保存来源：{data.sourceTotal}</span>
            </div>
            {data.error && <ErrorNote error={data.error} />}
            <div className="button-group diagnostic-actions">
              {data.appId ? (
                <button className="button primary" onClick={() => onSelect(data.appId!)}>
                  查看应用详情
                </button>
              ) : (
                <button className="button primary" disabled={busy} onClick={() => void add()}>
                  {busy ? '正在加入…' : '加入跟踪并采集详情'}
                </button>
              )}
            </div>
            <details className="diagnostic-section">
              <summary>最近任务与停止原因（{data.tasks.length}）</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>通道 / 类型</th>
                      <th>状态</th>
                      <th>停止原因 / 错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks.map((t) => (
                      <tr key={`${t.channel}-${t.id}`}>
                        <td>
                          {t.channel} / {t.kind}
                          {t.channel === 'extended' && (
                            <small>
                              <button className="text-button" onClick={() => setEvidenceId(t.id)}>
                                页内查看完整记录
                              </button>
                              <a
                                href={`/api/discovery/tasks/${encodeURIComponent(t.id)}?limit=20&offset=0`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                完整采集记录（原始 JSON）
                              </a>
                            </small>
                          )}
                        </td>
                        <td>{text(t.status)}</td>
                        <td>
                          {t.stopReason || '—'}
                          {t.error && <p className="diagnostic-error">{t.error}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            {evidenceId !== null && (
              <TaskEvidence key={evidenceId} id={evidenceId} version={version} />
            )}
            <details className="diagnostic-section">
              <summary>信贷规则分析</summary>
              <FieldTree value={data.analysis} label="完整识别证据" />
            </details>
            <h3 className="diagnostic-subheading">已保存来源</h3>
            <p className="data-note">
              原观测时间与本次处理时间分别保留。历史开发者目录回收不代表今天新上架；请求国家、语言也不是用户所在地。
            </p>
            {data.sources.map((s) => (
              <details className="diagnostic-source" key={s.id}>
                <summary>
                  <strong>{s.kind}</strong>
                  <span>原观测 {stamp(s.observedAt)}</span>
                </summary>
                <div className="diagnostic-source-body">
                  <div className="diagnostic-summary">
                    <span>处理：{stamp(s.processedAt)}</span>
                    <span>关键词：{s.keyword || '—'}</span>
                    <span>父应用：{s.parentAppId || '—'}</span>
                    <span>历史资料：{s.enrichmentHistoryId || '—'}</span>
                    <SourceLink value={s.source} />
                  </div>
                  <FieldTree value={s.data} label="规范来源字段" />
                  <FieldTree value={s.raw} label="完整原始返回" />
                </div>
              </details>
            ))}
            {data.sources.length === 0 && <p className="diagnostic-empty">此页没有保存来源。</p>}
            <Pager offset={offset} total={data.sourceTotal} onChange={setOffset} />
          </>
        )
      )}
    </section>
  );
}
export function DiscoveryDiagnostics({
  countries,
  version,
  onSelect,
  onChanged,
}: {
  countries: Country[];
  version: number;
  onSelect: (id: number) => void;
  onChanged: () => void;
}) {
  const status = useResource<Status>('/discovery/status', version);
  const [filters, setFilters] = useState({ country: '', store: '', status: '', offset: 0 });
  const [draft, setDraft] = useState({
    country: 'ar',
    store: 'google-play' as StoreName,
    externalId: '',
  });
  const [identity, setIdentity] = useState<typeof draft | null>(null);
  const candidates = useResource<{ candidates: Candidate[]; total: number }>(
    '/discovery/candidates' + query({ ...filters, limit: 20 }),
    version,
  );
  const change = (key: 'country' | 'store' | 'status', value: string) =>
    setFilters((f) => ({ ...f, [key]: value, offset: 0 }));
  const cycle = status.data?.activeCycle || status.data?.lastCycle;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.externalId.trim()) setIdentity({ ...draft, externalId: draft.externalId.trim() });
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">DISCOVERY COVERAGE</span>
          <h1>发现诊断</h1>
          <p>检查候选来源、详情处理进度和未收录原因。</p>
        </div>
      </div>
      <ErrorNote error={status.error} cached={!!status.data} />
      <section className="panel diagnostic-status">
        <div className="panel-heading">
          <div>
            <h2>每 {status.data?.intervalHours ?? 6} 小时扩展发现</h2>
            <p>应用资料仍按每小时周期更新；扩展发现使用独立预算。</p>
          </div>
          {cycle && <span className="badge teal">{text(cycle.status)}</span>}
        </div>
        {status.data ? (
          <>
            {status.data.enabled === false && (
              <p className="data-note">
                扩展发现通道当前未运行。此页仍可查看已保存记录；到期时间不是采集已执行的证明。
              </p>
            )}
            <div className="diagnostic-stats">
              {Object.entries(status.data.totals).map(([key, value]) => (
                <div key={key}>
                  <span>{text(key)}</span>
                  <strong>{value.toLocaleString('zh-CN')}</strong>
                </div>
              ))}
            </div>
            <div className="diagnostic-summary">
              <span>下次到期：{stamp(status.data.nextDueAt)}</span>
              <span>最近心跳：{stamp(status.data.heartbeatAt)}</span>
            </div>
            <p className="data-note">{status.data.coverageNote}</p>
            <p className="data-note">
              每市场每期预算：来源 {status.data.limits.sourceRequests} 次 HTTP，详情{' '}
              {status.data.limits.detailRequests} 次 HTTP；单步{' '}
              {status.data.limits.timeoutMs / 1000} 秒，Google 查询最多{' '}
              {status.data.limits.searchResults} 条。达到预算会延期接续，不代表已枚举整个商店。
            </p>
            {cycle && (
              <details className="diagnostic-section">
                <summary>最近周期执行与市场请求明细</summary>
                <div className="diagnostic-summary">
                  <span>周期：{cycle.id}</span>
                  <span>到期：{stamp(cycle.dueAt)}</span>
                  <span>启动：{stamp(cycle.startedAt)}</span>
                  <span>结束：{stamp(cycle.finishedAt)}</span>
                </div>
                <div className="diagnostic-summary">
                  {Object.entries(cycle.counts).map(([key, value]) => (
                    <span key={key}>
                      {text(key)}：{value}
                    </span>
                  ))}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>市场</th>
                        <th>来源 HTTP</th>
                        <th>详情 HTTP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycle.markets.map((m) => (
                        <tr key={`${m.country}-${m.store}`}>
                          <td>
                            {m.country.toUpperCase()} · {storeName(m.store)}
                          </td>
                          <td>{m.sourceRequests}</td>
                          <td>{m.detailRequests}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        ) : (
          <p className="diagnostic-empty">
            {status.error ? '运行状态暂不可用' : '正在读取周期状态…'}
          </p>
        )}
      </section>
      <section className="panel diagnostic-search">
        <div className="panel-heading">
          <div>
            <h2>按包名 / App Store ID 查询</h2>
            <p>只查询已保存记录，提交查询不会触发商店采集。</p>
          </div>
        </div>
        <form className="diagnostic-form" onSubmit={submit}>
          <label>
            国家
            <select
              aria-label="诊断国家"
              value={draft.country}
              onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))}
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
          <label>
            商店
            <select
              aria-label="诊断商店"
              value={draft.store}
              onChange={(e) => setDraft((d) => ({ ...d, store: e.target.value as StoreName }))}
            >
              <option value="google-play">Google Play</option>
              <option value="app-store">App Store</option>
            </select>
          </label>
          <label className="diagnostic-id">
            应用 ID
            <input
              aria-label="诊断应用ID"
              required
              value={draft.externalId}
              onChange={(e) => setDraft((d) => ({ ...d, externalId: e.target.value }))}
              placeholder={
                draft.store === 'google-play' ? '例如 com.creditouno.loan' : '例如 123456789'
              }
            />
          </label>
          <button className="button primary" type="submit">
            <Search size={16} />
            查询已保存来源
          </button>
        </form>
      </section>
      {identity && (
        <IdentityResult
          key={`${identity.country}-${identity.store}-${identity.externalId}`}
          identity={identity}
          version={version}
          onSelect={onSelect}
          onChanged={onChanged}
        />
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>扩展发现候选</h2>
            <p>暂存是证据不足待核对，失败是采集未完成；两者分别保留。</p>
          </div>
        </div>
        <div className="diagnostic-filter">
          <select
            aria-label="候选国家"
            value={filters.country}
            onChange={(e) => change('country', e.target.value)}
          >
            <option value="">全部国家</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="候选商店"
            value={filters.store}
            onChange={(e) => change('store', e.target.value)}
          >
            <option value="">全部商店</option>
            <option value="google-play">Google Play</option>
            <option value="app-store">App Store</option>
          </select>
          <select
            aria-label="候选状态"
            value={filters.status}
            onChange={(e) => change('status', e.target.value)}
          >
            <option value="">全部状态</option>
            {['pending', 'staged', 'failed', 'admitted'].map((s) => (
              <option key={s} value={s}>
                {text(s)}
              </option>
            ))}
          </select>
        </div>
        <ErrorNote error={candidates.error} cached={!!candidates.data} />
        {!candidates.data ? (
          <p className="diagnostic-empty">{candidates.error ? '候选暂不可用' : '正在读取候选…'}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>候选应用</th>
                    <th>市场</th>
                    <th>状态 / 识别</th>
                    <th>原首次观测 / 最近观测</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.data.candidates.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          className="text-button diagnostic-title"
                          onClick={() =>
                            setIdentity({
                              country: c.country,
                              store: c.store,
                              externalId: c.externalId,
                            })
                          }
                        >
                          {c.title || c.externalId}
                        </button>
                        <code>{c.externalId}</code>
                        {c.error && <p className="diagnostic-error">{c.error}</p>}
                      </td>
                      <td>
                        {c.country.toUpperCase()}
                        <small>{storeName(c.store)}</small>
                      </td>
                      <td>
                        {text(c.status)}
                        <small>
                          {c.verdict ? verdictLabels[c.verdict] || c.verdict : '尚未分析'}
                        </small>
                      </td>
                      <td>
                        {stamp(c.firstObservedAt)}
                        <small>{stamp(c.lastObservedAt)}</small>
                      </td>
                      <td>{c.sourceCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!candidates.data.candidates.length && (
              <p className="diagnostic-empty">当前筛选没有候选记录。</p>
            )}
            <Pager
              offset={filters.offset}
              total={candidates.data.total}
              onChange={(offset) => setFilters((f) => ({ ...f, offset }))}
            />
          </>
        )}
      </section>
    </>
  );
}

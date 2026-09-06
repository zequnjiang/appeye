import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type FormEvent,
} from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Eye,
  Globe2,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  AlertCircle,
  Play,
  Layers3,
  ExternalLink,
} from 'lucide-react';
import { api, post, patch, query } from './api';
import {
  ClassificationNote,
  LoanIntelligence,
  StoreInformation,
  EnrichmentPanel,
  ObservationHistory,
  FieldTree,
  verdictLabels,
} from './Intelligence';
import type { Enrichment } from '../server/types';
import type {
  Country,
  MarketApp,
  Change,
  Snapshot,
  Review,
  Job,
  Overview,
  Session,
  StoreName,
} from './types';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './styles.css';

const countryFlags: Record<string, string> = {
  th: '🇹🇭',
  mx: '🇲🇽',
  ph: '🇵🇭',
  pk: '🇵🇰',
  id: '🇮🇩',
  ar: '🇦🇷',
};
const stores: Record<string, string> = { 'google-play': 'Google Play', 'app-store': 'App Store' };
const classes: Record<string, string> = {
  candidate: '待确认',
  confirmed: '已确认信贷',
  excluded: '已排除',
};
const statuses: Record<string, string> = {
  queued: '等待执行',
  running: '采集中',
  succeeded: '已完成',
  failed: '失败',
};
const jobTypes: Record<string, string> = {
  discover: '发现应用',
  refresh: '更新信息',
  reviews: '采集评价',
  enrich: '补充资料',
};
const fields: Record<string, string> = {
  version: '版本更新',
  description: '应用描述',
  score: '评分变化',
  ratings: '评分人数',
  installs: '累计安装量',
  minInstalls: '安装量下限',
  maxInstalls: '安装量上限',
  title: '应用名称',
  developer: '开发者',
  releaseNotes: '更新说明',
  releasedAt: '商店发布日期',
  storeUpdatedAt: '商店更新时间',
  first_seen: '首次发现',
  discovered: '首次发现',
  new_app: '首次发现',
};
const number = (v: unknown) =>
  typeof v === 'number' ? new Intl.NumberFormat('zh-CN').format(v) : '—';
const compact = (v: unknown) =>
  typeof v === 'number'
    ? new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
    : '—';
const date = (v: unknown, full = false) => {
  if (!v) return '—';
  const d = new Date(String(v));
  return Number.isNaN(+d)
    ? String(v)
    : new Intl.DateTimeFormat(
        'zh-CN',
        full
          ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
          : { year: 'numeric', month: '2-digit', day: '2-digit' },
      ).format(d);
};
const relative = (v: unknown) => {
  if (!v) return '尚未采集';
  const mins = Math.floor((Date.now() - +new Date(String(v))) / 60000);
  return mins < 1
    ? '刚刚'
    : mins < 60
      ? `${mins} 分钟前`
      : mins < 1440
        ? `${Math.floor(mins / 60)} 小时前`
        : date(v);
};
const val = (v: unknown): string =>
  v === null || v === undefined ? '未提供' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const safeUrl = (url: string | null | undefined) => {
  try {
    const u = new URL(url || '');
    return ['http:', 'https:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
};
function useData<T>(path: string, version = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, version]);
  return { data, error, loading };
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">
        <Layers3 size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> 正在加载数据
    </div>
  );
}
function ErrorBox({ message }: { message: string }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function AppIcon({ app }: { app: MarketApp }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`app-icon ${app.store === 'app-store' ? 'blue' : ''}`}>
      {safeUrl(app.icon) && !failed ? (
        <img
          src={safeUrl(app.icon)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{app.title?.slice(0, 1) || 'A'}</span>
      )}
    </div>
  );
}
function StoreMark({ store }: { store: string }) {
  return (
    <span className="store-mark">
      <span className={store === 'app-store' ? 'store-dot blue' : 'store-dot'} />
      {stores[store] || store}
    </span>
  );
}
function Pagination({
  offset,
  total,
  limit,
  onChange,
}: {
  offset: number;
  total: number;
  limit: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        共 {number(total)} 条
        {total > 0 ? ` · ${offset + 1}–${Math.min(offset + limit, total)}` : ''}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

function Login({ session, onLogin }: { session: Session; onLogin: () => void }) {
  const [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/login', { password });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="brand">
          <span className="brand-icon">
            <Eye size={26} />
          </span>
          appeye<span className="brand-point">.</span>
        </div>
        <div>
          <span className="eyebrow">CREDIT MARKET INTELLIGENCE</span>
          <h1>
            看见市场变化。
            <br />
            理解每一次更新。
          </h1>
          <p>
            Google Play & App Store
            <br />
            六国信贷应用 · 持续观察
          </p>
        </div>
        <div className="login-markets">
          {Object.keys(countryFlags).map((c) => (
            <span key={c}>
              {countryFlags[c]} {c.toUpperCase()}
            </span>
          ))}
        </div>
      </div>
      <main className="login-form">
        <div>
          <span className="eyebrow">APPEYE WORKSPACE</span>
          <h2>登录观察后台</h2>
          <p className="muted">查看信贷应用、版本动态与用户反馈。</p>
          {!session.configured ? (
            <div className="notice">
              <ShieldCheck size={20} />
              <div>
                <strong>先设置管理员密码</strong>
                <p>在项目的 .env 中配置 ADMIN_PASSWORD（至少 12 位），然后重启服务。</p>
              </div>
            </div>
          ) : (
            <form onSubmit={submit}>
              <label>
                管理员密码
                <input
                  autoFocus
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="输入管理员密码"
                />
              </label>
              {error && <ErrorBox message={error} />}
              <button className="button primary full" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
                进入工作台
              </button>
            </form>
          )}
          <small>
            <ShieldCheck size={14} />
            仅限授权管理员访问
          </small>
        </div>
      </main>
    </div>
  );
}

function Dashboard({
  version,
  countries,
  onNavigate,
  onSelect,
  onDiscover,
}: {
  version: number;
  countries: Country[];
  onNavigate: (page: string) => void;
  onSelect: (id: number) => void;
  onDiscover: () => void;
}) {
  const { data, error, loading } = useData<Overview>('/overview', version);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;
  const stats = [
    {
      label: '观察应用',
      value: data.stats.apps,
      icon: Layers3,
      note: `近 7 天首次发现 ${data.stats.newApps7d || 0} 个`,
    },
    {
      label: '已确认信贷',
      value: data.stats.confirmed,
      icon: ShieldCheck,
      note: `${number(data.stats.candidates)} 个应用待人工确认`,
    },
    {
      label: '近 7 天变化',
      value: data.stats.changes7d,
      icon: Activity,
      note: '版本、信息与指标变化',
    },
    {
      label: '已采集评价',
      value: data.stats.reviews,
      icon: MessageSquare,
      note: '公开评价抽样 · 非全量',
    },
  ];
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">MARKET OVERVIEW</span>
          <h1>市场概览</h1>
          <p>跟踪信贷应用，发现变化的信号。</p>
        </div>
        <button className="button primary" onClick={onDiscover}>
          <RefreshCw size={16} />
          发现应用
        </button>
      </div>
      <div className="stats-grid">
        {stats.map((s, i) => (
          <article className="stat-card" key={s.label}>
            <div>
              <span>{s.label}</span>
              <s.icon size={18} />
            </div>
            <strong>{number(s.value)}</strong>
            <small>{s.note}</small>
            <div className={`stat-accent accent-${i}`} />
          </article>
        ))}
      </div>
      <section className="panel market-panel">
        <div className="panel-heading">
          <div>
            <h2>国家观察</h2>
            <p>从 {countries.filter((c) => c.enabled).length} 个启用市场开始，按本地语言发现应用</p>
          </div>
          <button className="text-button" onClick={() => onNavigate('settings')}>
            管理市场 <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="market-grid">
          {countries.map((c) => {
            const s = data.countries.find((v) => v.code === c.code);
            const total = s?.apps || 0;
            return (
              <div className={`market-card ${!c.enabled ? 'disabled-market' : ''}`} key={c.code}>
                <div className="market-title">
                  <span className="flag">{countryFlags[c.code] || '🌐'}</span>
                  <div>
                    <strong>{c.name}</strong>
                    <span>
                      {c.code.toUpperCase()} / {c.language.toUpperCase()}
                    </span>
                  </div>
                  <span
                    className={`health-dot ${!c.enabled ? 'off' : ''}`}
                    title={c.enabled ? '已启用' : '已停用'}
                  />
                </div>
                <div className="market-number">
                  {number(total)}
                  <small>个应用</small>
                </div>
                <div className="market-bar">
                  <span
                    style={{
                      width: `${total ? Math.max(4, ((s?.confirmed || 0) / total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="market-footer">
                  <span>{s?.confirmed || 0} 已确认</span>
                  <span>{c.enabled ? '每 ' + c.intervalHours + ' 小时' : '已停用'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>近期首次发现</h2>
            <p>首次进入本系统的应用 · 不等同于新上架</p>
          </div>
          <button className="text-button" onClick={() => onNavigate('apps')}>
            应用库 <ArrowUpRight size={15} />
          </button>
        </div>
        {data.recentDiscoveries?.length ? (
          <div className="discovery-grid">
            {data.recentDiscoveries.map((a) => (
              <button className="discovery-card" onClick={() => onSelect(a.id)} key={a.id}>
                <AppIcon app={a} />
                <div>
                  <strong>{a.title || a.externalId}</strong>
                  <span>
                    {countryFlags[a.country]} {a.country.toUpperCase()} · {stores[a.store]}
                  </span>
                  <small>
                    首次发现 {date(a.firstSeenAt)} · 商店发布 {date(a.releasedAt)}
                  </small>
                </div>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title="等待首次发现"
            description="运行关键词发现任务，新增观察对象会出现在这里。"
          />
        )}
      </section>
      <div className="overview-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>最新变化</h2>
              <p>基于连续采集的对比结果</p>
            </div>
            <button className="text-button" onClick={() => onNavigate('changes')}>
              全部动态 <ArrowUpRight size={15} />
            </button>
          </div>
          {data.recentChanges.length ? (
            <ChangeList changes={data.recentChanges.slice(0, 6)} onSelect={onSelect} />
          ) : (
            <Empty
              title="市场观察即将开始"
              description="执行首次采集，建立应用基线。后续采集会自动记录变化。"
              action={
                <button className="button secondary" onClick={onDiscover}>
                  <Play size={15} />
                  开始首次采集
                </button>
              }
            />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>采集运行</h2>
              <p>任务状态与数据新鲜度</p>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate('jobs')}
              aria-label="查看全部采集任务"
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
          {data.recentJobs.length ? (
            <div className="job-mini-list">
              {data.recentJobs.slice(0, 5).map((j) => (
                <div className="job-mini" key={j.id}>
                  <span className={`job-symbol ${j.status}`}>
                    <RefreshCw size={15} />
                  </span>
                  <div>
                    <strong>
                      {jobTypes[j.type]} · {j.country?.toUpperCase() || '全部市场'}
                    </strong>
                    <span>{relative(j.createdAt)}</span>
                  </div>
                  <Badge tone={j.status}>{statuses[j.status]}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="暂无采集任务" description="定时与手动任务都会在这里留下运行记录。" />
          )}
          <div className="panel-note">
            <Clock3 size={15} />
            国家采集周期可在设置中调整
          </div>
        </section>
      </div>
      <div className="insight-note">
        <CircleHelp size={19} />
        <p>
          <strong>观察口径</strong> 首次发现 ≠ 新上架。Google Play
          显示商店累计安装量，非国别下载量；App Store 不公开下载量。
        </p>
      </div>
    </>
  );
}
function ChangeList({ changes, onSelect }: { changes: Change[]; onSelect: (id: number) => void }) {
  return (
    <div className="change-list">
      {changes.map((c) => (
        <button className="change-row" key={c.id} onClick={() => onSelect(c.appId)}>
          <span className={`change-symbol ${c.field === 'version' ? 'version' : ''}`}>
            {c.field === 'version' ? <ArrowUpRight size={18} /> : <Activity size={17} />}
          </span>
          <div className="change-content">
            <div>
              <strong>{c.title || c.appTitle || `应用 #${c.appId}`}</strong>
              <Badge tone={c.field === 'version' ? 'teal' : 'neutral'}>
                {fields[c.field] || c.field}
              </Badge>
            </div>
            <p>
              <span>{val(c.oldValue).slice(0, 65)}</span>
              <ArrowRight size={12} />
              <span>{val(c.newValue).slice(0, 85)}</span>
            </p>
          </div>
          <div className="change-time">
            <span>{c.country?.toUpperCase()}</span>
            <time>{date(c.observedAt || c.createdAt, true)}</time>
          </div>
        </button>
      ))}
    </div>
  );
}

function Filters({
  countries,
  country,
  setCountry,
  store,
  setStore,
  children,
}: {
  countries: Country[];
  country: string;
  setCountry: (v: string) => void;
  store: string;
  setStore: (v: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="filters">
      <div className="filter-caption">
        <ListFilter size={16} />
        筛选
      </div>
      <select aria-label="筛选国家" value={country} onChange={(e) => setCountry(e.target.value)}>
        <option value="">全部国家</option>
        {countries.map((c) => (
          <option value={c.code} key={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      <select aria-label="筛选商店" value={store} onChange={(e) => setStore(e.target.value)}>
        <option value="">全部商店</option>
        <option value="google-play">Google Play</option>
        <option value="app-store">App Store</option>
      </select>
      {children}
    </div>
  );
}
function AppsPage({
  version,
  countries,
  onSelect,
  onAdd,
}: {
  version: number;
  countries: Country[];
  onSelect: (id: number) => void;
  onAdd: () => void;
}) {
  const [country, setCountry] = useState(''),
    [store, setStore] = useState(''),
    [classification, setClassification] = useState(''),
    [loanVerdict, setLoanVerdict] = useState(''),
    [q, setQ] = useState(''),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setOffset(0), [country, store, classification, loanVerdict, search]);
  const { data, error, loading } = useData<{ apps: MarketApp[]; total: number }>(
    '/apps' + query({ country, store, classification, loanVerdict, q: search, limit: 20, offset }),
    version,
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">APPLICATION INTELLIGENCE</span>
          <h1>
            应用库 <span className="count">{number(data?.total || 0)}</span>
          </h1>
          <p>发现、确认和持续跟踪各市场的信贷应用。</p>
        </div>
        <div className="button-group">
          <a
            className="button secondary"
            href={
              '/api/export/apps.csv' +
              query({ country, store, classification, loanVerdict, q: search })
            }
          >
            <ArrowDownToLine size={16} />
            导出 CSV
          </a>
          <button className="button primary" onClick={onAdd}>
            <Plus size={17} />
            添加应用
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="apps-toolbar">
          <div className="search-input">
            <Search size={18} />
            <input
              aria-label="搜索应用"
              placeholder="搜索应用名称、开发者或应用 ID"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button className="icon-button" aria-label="清除搜索" onClick={() => setQ('')}>
                <X size={15} />
              </button>
            )}
          </div>
          <Badge tone="neutral">{countries.length} 个市场</Badge>
        </div>
        <Filters {...{ countries, country, setCountry, store, setStore }}>
          <select
            aria-label="筛选信贷分类"
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
          >
            <option value="">全部分类</option>
            {Object.entries(classes).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选识别证据"
            value={loanVerdict}
            onChange={(e) => setLoanVerdict(e.target.value)}
          >
            <option value="">全部识别证据</option>
            {Object.entries(verdictLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </Filters>
        {error ? (
          <ErrorBox message={error} />
        ) : loading ? (
          <Loading />
        ) : data?.apps.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>应用 / 开发者</th>
                    <th>国家与商店</th>
                    <th>信贷分类</th>
                    <th>评分</th>
                    <th>累计安装量 ⓘ</th>
                    <th>当前版本</th>
                    <th>首次发现 / 商店发布</th>
                    <th>最近采集</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.apps.map((app) => (
                    <tr key={app.id}>
                      <td>
                        <button className="app-cell" onClick={() => onSelect(app.id)}>
                          <AppIcon app={app} />
                          <div>
                            <strong>{app.title || app.externalId}</strong>
                            <span>{app.developer || app.externalId}</span>
                          </div>
                        </button>
                      </td>
                      <td>
                        <span className="country-inline">
                          {countryFlags[app.country] || '🌐'} {app.country.toUpperCase()}
                        </span>
                        <StoreMark store={app.store} />
                      </td>
                      <td>
                        <Badge
                          tone={
                            app.classification === 'confirmed'
                              ? 'teal'
                              : app.classification === 'candidate'
                                ? 'amber'
                                : 'neutral'
                          }
                        >
                          {classes[app.classification]}
                        </Badge>
                        <ClassificationNote app={app} />
                      </td>
                      <td>
                        <strong className="rating">
                          {app.score === null ? '—' : app.score?.toFixed(2)}
                          <span>{app.score !== null ? ' ★' : ''}</span>
                        </strong>
                        <small>{number(app.ratings)} 人评分</small>
                      </td>
                      <td>
                        <strong className="tabular">
                          {app.store === 'app-store' ? '未公开' : app.installs || '—'}
                        </strong>
                        <small>
                          {app.store === 'google-play' ? '商店累计 · 非国别' : 'App Store'}
                        </small>
                      </td>
                      <td>
                        <span className="version-text">{app.version || '—'}</span>
                        <small>{date(app.storeUpdatedAt)}</small>
                      </td>
                      <td>
                        {date(app.firstSeenAt)}
                        <small>商店发布 {date(app.releasedAt)}</small>
                      </td>
                      <td className="muted">{relative(app.lastFetchedAt)}</td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`查看 ${app.title}`}
                          onClick={() => onSelect(app.id)}
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination offset={offset} total={data.total} limit={20} onChange={setOffset} />
          </>
        ) : (
          <Empty
            title={
              q || country || store || classification ? '没有匹配的应用' : '建立你的信贷应用库'
            }
            description={
              q || country || store || classification
                ? '调整筛选条件，或搜索其他应用名称。'
                : '通过关键词发现应用，或使用应用 ID 添加重点观察对象。'
            }
            action={
              <button className="button secondary" onClick={onAdd}>
                <Plus size={16} />
                添加应用
              </button>
            }
          />
        )}
      </section>
      <p className="footnote">
        新应用具有强信贷证据时自动确认，其余保持待确认。人工和历史分类优先，可在详情中查看依据或启用自动分类。
      </p>
    </>
  );
}

function Trend({
  snapshots,
  metric,
}: {
  snapshots: Snapshot[];
  metric: 'score' | 'minInstalls' | 'ratings';
}) {
  const points = [...snapshots]
    .filter((s) => typeof s.data[metric] === 'number')
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  if (points.length < 2)
    return (
      <div className="chart-empty">
        <Activity size={20} />
        <p>需要至少两个有效观测点才能显示趋势</p>
      </div>
    );
  const values = points.map((s) => Number(s.data[metric]));
  const min = metric === 'score' ? 0 : Math.min(...values) * 0.95,
    max = metric === 'score' ? 5 : Math.max(...values) * 1.05 || 1;
  const pts = points
    .map(
      (s, i) =>
        `${50 + ((+new Date(s.observedAt) - +new Date(points[0].observedAt)) / (+new Date(points[points.length - 1].observedAt) - +new Date(points[0].observedAt) || 1)) * 710},${160 - ((Number(s.data[metric]) - min) / (max - min || 1)) * 125}`,
    )
    .join(' ');
  return (
    <div className="trend">
      <svg viewBox="0 0 800 210" role="img" aria-label="历史观测数据趋势">
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line x1="50" y1={160 - p * 125} x2="760" y2={160 - p * 125} stroke="#e8edf2" />
            <text x="38" y={164 - p * 125} textAnchor="end">
              {metric === 'score'
                ? (min + (max - min) * p).toFixed(1)
                : compact(min + (max - min) * p)}
            </text>
          </g>
        ))}
        <polyline
          points={pts}
          fill="none"
          stroke="#0cae99"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <text x="50" y="192">
          {date(points[0].observedAt)}
        </text>
        <text x="760" y="192" textAnchor="end">
          {date(points[points.length - 1].observedAt)}
        </text>
      </svg>
      <span>{points.length} 次有效观测 · 横轴为实际观测时间</span>
    </div>
  );
}
function AppDetail({
  id,
  version,
  onBack,
  onRefresh,
  onNotify,
  onChanged,
}: {
  id: number;
  version: number;
  onBack: () => void;
  onRefresh: (id: number, type: 'refresh' | 'reviews' | 'enrich') => void;
  onNotify: (s: string) => void;
  onChanged: () => void;
}) {
  const { data, error, loading } = useData<{
    app: MarketApp;
    snapshots: Snapshot[];
    changes: Change[];
    reviews: Review[];
    rawDetail: unknown;
    enrichments: Enrichment[];
  }>(`/apps/${id}`, version);
  const [tab, setTab] = useState('overview'),
    [metric, setMetric] = useState<'score' | 'minInstalls' | 'ratings'>('score'),
    [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;
  const app = data.app;
  async function classify(value: string) {
    setBusy(true);
    try {
      await patch(`/apps/${id}`, { classification: value });
      onChanged();
      onNotify('信贷分类已更新');
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        返回应用库
      </button>
      <section className="detail-hero panel">
        <div className="detail-heading">
          <AppIcon app={app} />
          <div>
            <div className="detail-title">
              <h1>{app.title || app.externalId}</h1>
              <Badge tone={app.classification === 'confirmed' ? 'teal' : 'amber'}>
                {classes[app.classification]}
              </Badge>
            </div>
            <p>{app.developer || '开发者暂未提供'}</p>
            <ClassificationNote app={app} />
            <div className="detail-meta">
              <StoreMark store={app.store} />
              <span>
                {countryFlags[app.country]} {app.country.toUpperCase()}
              </span>
              <code>{app.externalId}</code>
            </div>
          </div>
        </div>
        <div className="button-group">
          <button className="button secondary" onClick={() => onRefresh(id, 'refresh')}>
            <RefreshCw size={16} />
            更新信息
          </button>
          {safeUrl(app.url) && (
            <a
              className="button secondary"
              href={safeUrl(app.url)}
              target="_blank"
              rel="noreferrer"
            >
              商店页面 <ExternalLink size={15} />
            </a>
          )}
          <select
            aria-label="设置应用分类"
            value={app.classification}
            disabled={busy}
            onChange={(e) => void classify(e.target.value)}
          >
            {Object.entries(classes).map(([v, n]) => (
              <option value={v} key={v}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {app.lastError && (
          <ErrorBox message={`最近采集未成功：${app.lastError}。以下仍显示最后一次成功数据。`} />
        )}
        <div className="detail-stats">
          <div>
            <small>商店评分</small>
            <strong>
              {app.score?.toFixed(2) || '—'} <span className="gold">★</span>
            </strong>
            <span>{number(app.ratings)} 人评分</span>
          </div>
          <div>
            <small>累计安装量</small>
            <strong>{app.store === 'app-store' ? '未公开' : app.installs || '—'}</strong>
            <span>
              {app.store === 'google-play' ? '商店累计量 · 非国别' : 'App Store 不公开此数据'}
            </span>
          </div>
          <div>
            <small>观测到的版本更新</small>
            <strong>
              {number(app.updateCount || 0)} <em>次</em>
            </strong>
            <span>
              平均间隔{' '}
              {app.observedUpdateIntervalDays != null
                ? app.observedUpdateIntervalDays.toFixed(1) + ' 天'
                : '待积累'}
            </span>
          </div>
          <div>
            <small>最近成功采集</small>
            <strong className="date-stat">{date(app.lastFetchedAt, true)}</strong>
            <span>{relative(app.lastFetchedAt)}</span>
          </div>
        </div>
      </section>
      <div className="tabs" role="tablist" aria-label="应用详情">
        {[
          ['overview', '应用概况'],
          ['intelligence', '信贷识别'],
          ['company', '公司与商店信息'],
          ['enrichments', '权限与隐私'],
          ['changes', '变化记录'],
          ['reviews', '用户评价'],
          ['raw', '采集快照'],
        ].map(([v, n]) => (
          <button
            key={v}
            role="tab"
            aria-selected={tab === v}
            className={tab === v ? 'active' : ''}
            onClick={() => setTab(v)}
          >
            {n}
          </button>
        ))}
      </div>
      {tab === 'overview' && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>历史趋势</h2>
                <p>最近 50 次成功观测，横轴为实际采集时间</p>
              </div>
              <select
                aria-label="趋势指标"
                value={metric}
                onChange={(e) => setMetric(e.target.value as typeof metric)}
              >
                <option value="score">评分</option>
                <option value="ratings">评分人数</option>
                {app.store === 'google-play' && <option value="minInstalls">累计安装量下限</option>}
              </select>
            </div>
            <Trend snapshots={data.snapshots || []} metric={metric} />
          </section>
          <div className="detail-columns">
            <section className="panel padded">
              <h2>应用信息</h2>
              <dl className="facts">
                <div>
                  <dt>商店发布日期</dt>
                  <dd>{date(app.releasedAt)}</dd>
                </div>
                <div>
                  <dt>本系统首次发现</dt>
                  <dd>{date(app.firstSeenAt, true)}</dd>
                </div>
                <div>
                  <dt>当前版本</dt>
                  <dd>{app.version || '未提供'}</dd>
                </div>
                <div>
                  <dt>商店更新时间</dt>
                  <dd>{date(app.storeUpdatedAt, true)}</dd>
                </div>
              </dl>
              <div className="mini-note">
                首次发现仅表示进入本系统的时间，不代表在该市场首次上架。
              </div>
              <h3>本次更新说明</h3>
              <p className="pre-wrap">{app.releaseNotes || '商店未提供更新说明。'}</p>
            </section>
            <section className="panel padded">
              <h2>应用描述</h2>
              <p className="pre-wrap description-text">
                {app.description || app.summary || '等待详情采集。'}
              </p>
            </section>
          </div>
        </>
      )}
      {tab === 'intelligence' && (
        <LoanIntelligence app={app} onChanged={onChanged} onNotify={onNotify} />
      )}
      {tab === 'company' && <StoreInformation app={app} rawDetail={data.rawDetail} />}
      {tab === 'enrichments' && (
        <EnrichmentPanel
          app={app}
          version={version}
          enrichments={data.enrichments || []}
          onCollect={() => onRefresh(id, 'enrich')}
        />
      )}
      {tab === 'changes' && <DetailChanges id={id} version={version} />}
      {tab === 'reviews' && (
        <Reviews
          id={id}
          version={version}
          country={app.country}
          store={app.store}
          onCollect={() => onRefresh(id, 'reviews')}
        />
      )}
      {tab === 'raw' && (
        <section className="panel padded">
          <h2>采集快照与发现记录</h2>
          <ObservationHistory
            endpoint={`/apps/${id}/discoveries`}
            listKey="discoveries"
            title="搜索发现原始记录"
            version={version}
          />
          <p className="muted">规范化字段与原始商店返回数据用于追溯。最近的观测在前。</p>
          <ObservationHistory
            endpoint={`/apps/${id}/snapshots`}
            listKey="snapshots"
            title="全部详情快照"
            version={version}
          />
        </section>
      )}
    </>
  );
}
function DetailChanges({ id, version }: { id: number; version: number }) {
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useData<{ changes: Change[]; total: number }>(
    `/apps/${id}/changes` + query({ offset, limit: 20 }),
    version,
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>变化记录</h2>
          <p>每条变化对应前后两次观测结果</p>
        </div>
      </div>
      {error ? (
        <ErrorBox message={error} />
      ) : loading ? (
        <Loading />
      ) : data?.changes.length ? (
        <>
          <div className="detail-change-list">
            {data.changes.map((c) => (
              <article key={c.id}>
                <div>
                  <Badge tone="teal">{fields[c.field] || c.field}</Badge>
                  <time>{date(c.observedAt || c.createdAt, true)}</time>
                </div>
                <div className="diff-values">
                  <pre>{val(c.oldValue)}</pre>
                  <ArrowRight size={16} />
                  <pre>{val(c.newValue)}</pre>
                </div>
              </article>
            ))}
          </div>
          <Pagination offset={offset} total={data.total} limit={20} onChange={setOffset} />
        </>
      ) : (
        <Empty
          title="尚未观察到变化"
          description="后续成功采集出现字段变化时，将在这里记录前后差异。"
        />
      )}
    </section>
  );
}
function Reviews({
  id,
  version,
  country,
  store,
  onCollect,
}: {
  id: number;
  version: number;
  country: string;
  store: StoreName;
  onCollect: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useData<{ reviews: Review[]; total: number }>(
    `/apps/${id}/reviews` + query({ offset, limit: 20 }),
    version,
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>
            用户评价 <span className="count">{number(data?.total || 0)}</span>
          </h2>
          <p>
            {country.toUpperCase()} 店面 ·{' '}
            {store === 'google-play'
              ? '每次请求最新最多 100 条，按配置语言采集'
              : '每次请求最新第 1 页，实际语言未验证'}
          </p>
          <p>以下为历史累计采集样本，非全量评价。国家与语言是请求上下文，不代表用户所在地。</p>
        </div>
        <button className="button secondary" onClick={onCollect}>
          <RefreshCw size={16} />
          采集评价
        </button>
      </div>
      {error ? (
        <ErrorBox message={error} />
      ) : loading ? (
        <Loading />
      ) : data?.reviews.length ? (
        <>
          <div className="reviews-list">
            {data.reviews.map((r) => (
              <article className="review" key={r.id}>
                <div className="review-heading">
                  <strong>{r.userName || '匿名用户'}</strong>
                  <span className="review-stars">
                    {'★'.repeat(Math.min(5, Math.max(0, r.score || 0)))}
                    <span>{'★'.repeat(5 - Math.min(5, Math.max(0, r.score || 0)))}</span>
                  </span>
                  <time>{date(r.reviewedAt || r.updatedAt || r.date)}</time>
                </div>
                {r.title && <h3>{r.title}</h3>}
                <p className="pre-wrap">{r.text}</p>
                <div className="review-meta">
                  <span>
                    {(r.country || country).toUpperCase()} ·{' '}
                    {r.language === 'und' ? '语言未验证' : r.language || '商店语言'}
                  </span>
                  <span>版本 {r.version || '未提供'}</span>
                </div>
                {r.replyText && (
                  <div className="review-reply">
                    <strong>开发者回复</strong>
                    <p>{r.replyText}</p>
                  </div>
                )}
                <FieldTree value={r} label="评论完整字段与原始数据" depth={1} />
              </article>
            ))}
          </div>
          <Pagination offset={offset} total={data.total} limit={20} onChange={setOffset} />
        </>
      ) : (
        <Empty
          title="还没有采集到评价"
          description="采集最新的公开用户评价。商店可能限制可见范围或返回数量。"
          action={
            <button className="button secondary" onClick={onCollect}>
              采集评价
            </button>
          }
        />
      )}
    </section>
  );
}

function ChangesPage({
  version,
  countries,
  onSelect,
}: {
  version: number;
  countries: Country[];
  onSelect: (id: number) => void;
}) {
  const [country, setCountry] = useState(''),
    [store, setStore] = useState(''),
    [field, setField] = useState(''),
    [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [country, store, field]);
  const { data, error, loading } = useData<{ changes: Change[]; total: number }>(
    '/changes' + query({ country, store, field, offset, limit: 20 }),
    version,
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">MARKET SIGNALS</span>
          <h1>市场动态</h1>
          <p>跟踪版本、描述与指标变化，保留每一次观测证据。</p>
        </div>
      </div>
      <section className="panel">
        <Filters {...{ countries, country, setCountry, store, setStore }}>
          <select
            aria-label="筛选变化类型"
            value={field}
            onChange={(e) => setField(e.target.value)}
          >
            <option value="">全部变化</option>
            {[
              'version',
              'description',
              'score',
              'ratings',
              'minInstalls',
              'releaseNotes',
              'title',
              'developer',
            ].map((f) => (
              <option value={f} key={f}>
                {fields[f]}
              </option>
            ))}
          </select>
        </Filters>
        {error ? (
          <ErrorBox message={error} />
        ) : loading ? (
          <Loading />
        ) : data?.changes.length ? (
          <>
            <ChangeList changes={data.changes} onSelect={onSelect} />
            <Pagination offset={offset} total={data.total} limit={20} onChange={setOffset} />
          </>
        ) : (
          <Empty
            title="尚无匹配的市场动态"
            description="应用完成基线采集后，后续字段变化会自动出现在这里。"
          />
        )}
      </section>
    </>
  );
}
function JobsPage({
  version,
  countries,
  onDiscover,
  onNotify,
  onChanged,
}: {
  version: number;
  countries: Country[];
  onDiscover: () => void;
  onNotify: (s: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState(''),
    [offset, setOffset] = useState(0),
    [expanded, setExpanded] = useState<number | null>(null),
    [busy, setBusy] = useState<number | null>(null);
  useEffect(() => setOffset(0), [status]);
  const { data, error, loading } = useData<{ jobs: Job[]; total: number }>(
    '/jobs' + query({ status, offset, limit: 20 }),
    version,
  );
  async function retry(id: number) {
    setBusy(id);
    try {
      await post(`/jobs/${id}/retry`);
      onNotify('任务已重新排队');
      onChanged();
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">COLLECTION OPERATIONS</span>
          <h1>采集任务</h1>
          <p>查看任务进度、失败原因与下一次执行时间。</p>
        </div>
        <button className="button primary" onClick={onDiscover}>
          <Plus size={17} />
          创建发现任务
        </button>
      </div>
      <div className="notice slim">
        <Clock3 size={18} />
        <p>已启用国家按设置周期自动发现应用。采集失败会有限重试，仍失败的任务可手动重试。</p>
      </div>
      <section className="panel">
        <div className="filters">
          <ListFilter size={16} />
          <select
            aria-label="筛选任务状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            {Object.entries(statuses).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <span className="muted small">每 15 秒刷新状态</span>
        </div>
        {error ? (
          <ErrorBox message={error} />
        ) : loading && !data ? (
          <Loading />
        ) : data?.jobs.length ? (
          <>
            <div className="table-wrap">
              <table className="jobs-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>市场 / 商店</th>
                    <th>状态</th>
                    <th>尝试次数</th>
                    <th>创建时间</th>
                    <th>下次执行 / 完成</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <React.Fragment key={j.id}>
                      <tr>
                        <td>
                          <button
                            className="job-title"
                            onClick={() => setExpanded(expanded === j.id ? null : j.id)}
                          >
                            <ChevronDown size={15} className={expanded === j.id ? 'rotate' : ''} />
                            <strong>{jobTypes[j.type]}</strong>
                            <span>#{j.id}</span>
                          </button>
                        </td>
                        <td>
                          {countries.find((c) => c.code === j.country)?.name ||
                            j.country?.toUpperCase() ||
                            '全部国家'}
                          <small>
                            {j.store ? stores[j.store] : '两个商店'}
                            {j.appId ? ' · 应用 #' + j.appId : ''}
                          </small>
                        </td>
                        <td>
                          <Badge tone={j.status}>
                            {j.status === 'running' && <span className="health-dot" />}
                            {statuses[j.status]}
                          </Badge>
                        </td>
                        <td className="tabular">
                          {j.attempts} / {j.maxAttempts}
                        </td>
                        <td>{date(j.createdAt, true)}</td>
                        <td>{date(j.finishedAt || j.nextRunAt, true)}</td>
                        <td>
                          {j.status === 'failed' ? (
                            <button
                              className="text-button"
                              disabled={busy === j.id}
                              onClick={() => void retry(j.id)}
                            >
                              重试 <RefreshCw size={14} />
                            </button>
                          ) : (
                            <button
                              className="icon-button"
                              aria-label={`任务 ${j.id} 详情`}
                              onClick={() => setExpanded(expanded === j.id ? null : j.id)}
                            >
                              <MoreHorizontal size={18} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded === j.id && (
                        <tr>
                          <td colSpan={7} className="job-expanded">
                            {j.error && <ErrorBox message={j.error} />}
                            <div className="job-detail-grid">
                              <div>
                                <h4>执行进度</h4>
                                <pre>{JSON.stringify(j.progress, null, 2) || '暂无进度'}</pre>
                              </div>
                              <div>
                                <h4>结果与覆盖范围</h4>
                                <pre>{JSON.stringify(j.result, null, 2) || '任务尚未完成'}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination offset={offset} total={data.total} limit={20} onChange={setOffset} />
          </>
        ) : (
          <Empty
            title="尚无采集任务"
            description="选择一个国家开始发现，系统会保存任务状态与结果。"
            action={
              <button className="button secondary" onClick={onDiscover}>
                创建发现任务
              </button>
            }
          />
        )}
      </section>
    </>
  );
}

function SettingsPage({
  countries,
  onEdit,
  onCreate,
}: {
  countries: Country[];
  onEdit: (c: Country) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">MONITORING CONFIGURATION</span>
          <h1>市场设置</h1>
          <p>按国家配置发现关键词、采集语言和执行周期。</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          <Plus size={17} />
          添加国家
        </button>
      </div>
      <div className="country-settings-grid">
        {countries.map((c) => (
          <section className="panel country-setting" key={c.code}>
            <div className="country-setting-heading">
              <span className="flag">{countryFlags[c.code] || '🌐'}</span>
              <div>
                <h2>{c.name}</h2>
                <p>
                  {c.code.toUpperCase()} · {c.language}
                </p>
              </div>
              <Badge tone={c.enabled ? 'teal' : 'neutral'}>{c.enabled ? '监测中' : '已停用'}</Badge>
            </div>
            <div className="setting-keywords">
              {c.keywords.map((k) => (
                <span key={k}>{k}</span>
              ))}
            </div>
            <div className="setting-row">
              <span>
                <Clock3 size={14} />
                采集周期
              </span>
              <strong>每 {c.intervalHours} 小时</strong>
            </div>
            <div className="setting-row">
              <span>最近发现任务</span>
              <span>{relative(c.lastDiscoveryAt)}</span>
            </div>
            <button className="button secondary full" onClick={() => onEdit(c)}>
              <Settings2 size={15} />
              编辑市场配置
            </button>
          </section>
        ))}
      </div>
      <section className="panel padded methodology">
        <h2>数据口径</h2>
        <div className="method-grid">
          <div>
            <h3>发现范围</h3>
            <p>
              关键词搜索用于建立候选应用集合，不保证覆盖整个应用市场。信贷属性按描述证据识别，支持人工覆盖；识别不等同合规认证。
            </p>
          </div>
          <div>
            <h3>下载与安装</h3>
            <p>
              Google Play 记录公开的累计安装量，不能当作某个国家的日下载量。App Store
              下载量显示“未公开”。
            </p>
          </div>
          <div>
            <h3>发布时间与频率</h3>
            <p>商店发布日期、本系统首次发现时间分别保存。更新频率来自持续监测到的版本变化。</p>
          </div>
          <div>
            <h3>用户评价</h3>
            <p>
              按国家与语言抓取公开评价并去重，可能受到商店返回窗口限制。评分人数不等于已采集文字评价数。
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function CountryForm({
  country,
  onClose,
  onSaved,
}: {
  country: Country | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(country?.code || ''),
    [name, setName] = useState(country?.name || ''),
    [language, setLanguage] = useState(country?.language || 'en'),
    [keywords, setKeywords] = useState(country?.keywords.join('\n') || ''),
    [interval, setInterval] = useState(country?.intervalHours || 24),
    [enabled, setEnabled] = useState(country?.enabled ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      code: code.toLowerCase(),
      name,
      language,
      keywords: keywords
        .split(/[\n,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      intervalHours: interval,
      enabled,
    };
    try {
      if (country) {
        const { code: _, ...updates } = body;
        await patch(`/countries/${country.code}`, updates);
      } else await post('/countries', body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={country ? `编辑 ${country.name}` : '添加监测国家'} onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <label>
            国家代码
            <input
              required
              pattern="[a-zA-Z]{2}"
              maxLength={2}
              disabled={!!country}
              placeholder="例如 vn"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <label>
            显示名称
            <input
              required
              maxLength={80}
              placeholder="例如 越南"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            采集语言
            <input
              required
              placeholder="例如 vi"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </label>
          <label>
            采集周期（小时）
            <input
              required
              type="number"
              min="1"
              max="720"
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          发现关键词
          <textarea
            required
            rows={5}
            placeholder="每行一个关键词，支持本地语言"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <small>建议同时包含本地语言和英文信贷关键词。</small>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          启用该国家的定时监测
        </label>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存配置
          </button>
        </div>
      </form>
    </Modal>
  );
}
function DiscoveryForm({
  countries,
  onClose,
  onSaved,
}: {
  countries: Country[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const enabled = countries.filter((c) => c.enabled);
  const [country, setCountry] = useState(enabled[0]?.code || ''),
    [store, setStore] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/jobs', {
        type: 'discover',
        ...(country ? { country } : {}),
        ...(store ? { store } : {}),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="发现市场应用" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <p className="muted">根据国家关键词搜索应用。任务在后台执行，结果先进入待确认列表。</p>
        <label>
          目标市场
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">全部启用市场</option>
            {enabled.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          应用商店
          <select value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">Google Play + App Store</option>
            <option value="google-play">Google Play</option>
            <option value="app-store">App Store</option>
          </select>
        </label>
        <div className="notice slim">
          <CircleHelp size={18} />
          <p>采集有间隔与数量限制。可在任务详情中查看返回数量与错误。</p>
        </div>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy || !enabled.length}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}开始发现
          </button>
        </div>
      </form>
    </Modal>
  );
}
function AddAppForm({
  countries,
  onClose,
  onSaved,
}: {
  countries: Country[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [country, setCountry] = useState(countries[0]?.code || ''),
    [store, setStore] = useState('google-play'),
    [externalId, setExternalId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/apps', { country, store, externalId: externalId.trim() });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="添加重点观察应用" onClose={onClose}>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <label>
            国家
            <select required value={country} onChange={(e) => setCountry(e.target.value)}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            商店
            <select value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="google-play">Google Play</option>
              <option value="app-store">App Store</option>
            </select>
          </label>
        </div>
        <label>
          {store === 'google-play' ? 'Google Play 应用包名' : 'App Store 数字 ID'}
          <input
            required
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            placeholder={store === 'google-play' ? 'com.company.app' : '1234567890'}
          />
          <small>
            {store === 'google-play'
              ? '商店链接中 id= 后面的包名。'
              : '商店链接中 /id 后面的数字。'}
          </small>
        </label>
        <p className="muted small">
          添加后自动排队采集应用详情。相同国家与商店中的同一个应用只保留一条记录。
        </p>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}添加并采集
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Workspace({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [page, setPage] = useState('overview'),
    [appId, setAppId] = useState<number | null>(null),
    [version, setVersion] = useState(0),
    [modal, setModal] = useState<'discover' | 'add' | 'country' | null>(null),
    [editCountry, setEditCountry] = useState<Country | null>(null),
    [toast, setToast] = useState('');
  const { data: countryData, error: countryError } = useData<{ countries: Country[] }>(
    '/countries',
    version,
  );
  const countries = countryData?.countries || [];
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const nav = [
    { id: 'overview', label: '市场概览', icon: LayoutDashboard },
    { id: 'apps', label: '应用库', icon: Layers3 },
    { id: 'changes', label: '市场动态', icon: Activity },
    { id: 'jobs', label: '采集任务', icon: RefreshCw },
    { id: 'settings', label: '市场设置', icon: Settings2 },
  ];
  function navigate(p: string) {
    setPage(p);
    setAppId(null);
    window.scrollTo(0, 0);
  }
  function select(id: number) {
    setPage('apps');
    setAppId(id);
    window.scrollTo(0, 0);
  }
  function saved(message: string) {
    setModal(null);
    setToast(message);
    refresh();
  }
  async function collect(id: number, type: 'refresh' | 'reviews' | 'enrich') {
    try {
      await post('/jobs', { type, appId: id });
      setToast('采集任务已加入队列，可在采集任务中查看进度');
      refresh();
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  async function logout() {
    try {
      await post('/auth/logout');
      onLogout();
    } catch (e) {
      setToast((e as Error).message);
    }
  }
  const demo = session.demoMode || session.dataset === 'demo';
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Eye size={25} />
          </span>
          appeye<span className="brand-point">.</span>
        </div>
        <div className="workspace-tag">
          <span className="health-dot" />
          信贷行业观察站<span>V0.2</span>
        </div>
        <div className="nav-caption">工作空间</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? 'active' : ''}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {page === n.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="coverage-card">
            <Globe2 size={20} />
            <strong>{countries.filter((c) => c.enabled).length} 个市场 · 两大商店</strong>
            <span>Google Play / App Store</span>
            <div>
              {countries.slice(0, 6).map((c) => (
                <span title={c.name} key={c.code}>
                  {countryFlags[c.code] || c.code.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
          <div className="profile">
            <div className="avatar">A</div>
            <div>
              <strong>Administrator</strong>
              <span>观察后台</span>
            </div>
            <button className="icon-button" onClick={() => void logout()} aria-label="退出登录">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span>
            <strong>
              {nav.find((n) => n.id === page)?.label}
              {appId ? ' / 应用详情' : ''}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="live-label">
              <span className="health-dot" />
              {demo ? '演示环境' : '本地数据源'}
            </span>
            <span className="today">
              {new Intl.DateTimeFormat('zh-CN', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              }).format(new Date())}
            </span>
            <button className="icon-button" aria-label="刷新当前数据" onClick={refresh}>
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <Sparkles size={16} />
            演示数据 · 仅用于展示后台功能，不代表真实市场情况
          </div>
        )}
        <main className="content">
          {countryError && <ErrorBox message={countryError} />}
          {appId !== null ? (
            <AppDetail
              key={appId}
              id={appId}
              version={version}
              onBack={() => setAppId(null)}
              onRefresh={(id, t) => void collect(id, t)}
              onNotify={setToast}
              onChanged={refresh}
            />
          ) : page === 'overview' ? (
            <Dashboard
              version={version}
              countries={countries}
              onNavigate={navigate}
              onSelect={select}
              onDiscover={() => setModal('discover')}
            />
          ) : page === 'apps' ? (
            <AppsPage
              version={version}
              countries={countries}
              onSelect={select}
              onAdd={() => setModal('add')}
            />
          ) : page === 'changes' ? (
            <ChangesPage version={version} countries={countries} onSelect={select} />
          ) : page === 'jobs' ? (
            <JobsPage
              version={version}
              countries={countries}
              onDiscover={() => setModal('discover')}
              onNotify={setToast}
              onChanged={refresh}
            />
          ) : (
            <SettingsPage
              countries={countries}
              onEdit={(c) => {
                setEditCountry(c);
                setModal('country');
              }}
              onCreate={() => {
                setEditCountry(null);
                setModal('country');
              }}
            />
          )}
          <footer className="page-footer">
            <span>Appeye · 持续观察，基于证据</span>
            <span>数据源：Google Play / App Store</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Bell size={18} />
          <span>{toast}</span>
          <button className="icon-button" aria-label="关闭通知" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === 'discover' && (
        <DiscoveryForm
          countries={countries}
          onClose={() => setModal(null)}
          onSaved={() => {
            saved('发现任务已创建');
            navigate('jobs');
          }}
        />
      )}
      {modal === 'add' && (
        <AddAppForm
          countries={countries}
          onClose={() => setModal(null)}
          onSaved={() => {
            saved('应用已添加，详情采集已排队');
            navigate('apps');
          }}
        />
      )}
      {modal === 'country' && (
        <CountryForm
          country={editCountry}
          onClose={() => setModal(null)}
          onSaved={() => saved('市场配置已保存')}
        />
      )}
    </div>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    api<Session>('/auth/session')
      .then(setSession)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const h = () => setSession((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener('appeye:unauthorized', h);
    return () => window.removeEventListener('appeye:unauthorized', h);
  }, []);
  if (error)
    return (
      <div className="connection-error">
        <ErrorBox message={error} />
        <button className="button primary" onClick={load}>
          重新连接
        </button>
      </div>
    );
  if (!session) return <Loading />;
  return session.authenticated ? (
    <Workspace session={session} onLogout={load} />
  ) : (
    <Login session={session} onLogin={load} />
  );
}

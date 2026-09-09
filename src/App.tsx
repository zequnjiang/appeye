import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  ChartNoAxesCombined,
  ClipboardList,
  Compass,
  Database,
  Globe2,
  Layers3,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { api, post } from './api';
import { sessionQueries, useResource } from './use-resource';
import { clearMarketCache, setMarketScope, marketKey, loadMarket } from './market-cache';
import { captureLibraryReading, type LibraryReading } from './library-reading';
import {
  AppDetail,
  AppsPage,
  JobsPage,
  SettingsPage,
  CountryForm,
  DiscoveryForm,
  AddAppForm,
  defaultAppsView,
  type AppsViewState,
} from './LegacyApp';
import { DiscoveryDiagnostics } from './DiscoveryDiagnostics';
import { MarketActivity as CollectionMonitor } from './MarketActivity';
import {
  MarketHome,
  MarketLibrary,
  EventsPage,
  SelectedEvent,
  defaultEventView,
  type EventView,
} from './ResearchMarket';
import { DetailResearch, PrivateResearch, RequestsPage, type Mutation } from './ResearchPanels';
import { MembersPage, RulesPage, ComparePage, CategoryEditor } from './ResearchOperations';
import {
  MutationErrorContext,
  Busy,
  ErrorNotice,
  Heading,
  External,
  Gallery,
  storeSource,
  storeLabels,
} from './ResearchUI';
import {
  canWrite,
  defaultLibraryQuery,
  roleLabels,
  type ResearchSession,
  type ResearchState,
  type LibraryQuery,
  type Principal,
} from './research-types';
import type { Country, MarketApp } from './types';
import type { MarketActivityEvent } from '../server/market-activity';
import '@fontsource-variable/dm-sans';
import 'flag-icons/css/flag-icons.min.css';
import './styles.css';
import './research.css';
export function clearResearchSession() {
  sessionQueries.clear();
  clearMarketCache();
}
function sessionKey(s: ResearchSession) {
  return `${s.user?.id}:${s.user?.workspaceId}:${s.user?.role}:${s.authorizationVersion ?? ''}`;
}
function Login({
  configured,
  onSession,
}: {
  configured: boolean;
  onSession: (s: ResearchSession) => void;
}) {
  const [platform, setPlatform] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const s = await post<ResearchSession>('/auth/login', {
        ...(platform ? {} : { email }),
        password,
      });
      setPassword('');
      onSession(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="research-login">
      <section>
        <a className="research-brand" href="/">
          <EyeLogo />
          appeye<span>.</span>
        </a>
        <h1>市场变化，成为研究依据</h1>
        <p>六国信贷应用观察与客户研究工作台。</p>
        <form onSubmit={submit} className="research-form">
          <div className="tabs">
            <button
              type="button"
              className={!platform ? 'active' : ''}
              onClick={() => setPlatform(false)}
            >
              客户登录
            </button>
            <button
              type="button"
              className={platform ? 'active' : ''}
              onClick={() => setPlatform(true)}
            >
              平台运营
            </button>
          </div>
          {!platform && (
            <label>
              邮箱
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          <label>
            密码
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorNotice error={error} />
          {platform && !configured && (
            <p className="mini-note">平台密码尚未配置，请由部署管理员设置 ADMIN_PASSWORD。</p>
          )}
          <button className="button" disabled={busy}>
            {busy ? '登录中…' : '登录工作台'}
            <ArrowRight size={16} />
          </button>
        </form>
        <small>客户账号由所属空间管理员邀请开通。</small>
      </section>
    </main>
  );
}
function Invitation({
  token,
  onSession,
}: {
  token: string;
  onSession: (s: ResearchSession) => void;
}) {
  const [preview, setPreview] = useState<{
      email: string;
      role: string;
      workspaceName: string;
      expiresAt: string;
    } | null>(null),
    [error, setError] = useState(''),
    [name, setName] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api<{ invitation: typeof preview }>(`/auth/invitations/${encodeURIComponent(token)}`, {
      signal: c.signal,
    })
      .then((r) => {
        if (!c.signal.aborted) setPreview(r.invitation);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [token]);
  async function accept(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await post<ResearchSession>('/auth/accept', { token, name, password });
      history.replaceState(null, '', location.pathname);
      onSession(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="research-login">
      <section>
        <h1>加入客户空间</h1>
        <ErrorNotice error={error} />
        {preview ? (
          <form className="research-form" onSubmit={accept}>
            <p>
              {preview.workspaceName} ·{' '}
              {roleLabels[preview.role as keyof typeof roleLabels] || preview.role}
            </p>
            <p>受邀邮箱：{preview.email}</p>
            <p className="mini-note">
              新账户设置至少 12 位密码；已有该邮箱账户请使用现有密码。此链接不代表已通过邮箱验证。
            </p>
            <label>
              姓名
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              账户密码
              <input
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? '接受中…' : '接受邀请并登录'}
            </button>
          </form>
        ) : (
          !error && <Busy />
        )}
        <a href="/">返回登录</a>
      </section>
    </main>
  );
}
function EyeLogo() {
  return <img className="research-logo" src="/favicon.svg" alt="" />;
}
type Page =
  | 'market'
  | 'events'
  | 'library'
  | 'favorites'
  | 'research'
  | 'requests'
  | 'members'
  | 'candidates'
  | 'rules'
  | 'discovery'
  | 'jobs'
  | 'countries';
type Route =
  | { page: Page }
  | { page: 'detail'; id: number; event?: MarketActivityEvent }
  | { page: 'compare' };
const names: Record<Page, string> = {
  market: '今日市场',
  events: '市场动态',
  library: '应用库',
  favorites: '我的关注',
  research: '研究空间',
  requests: '收录申请',
  members: '客户成员',
  candidates: '候选核对',
  rules: '识别规则',
  discovery: '发现诊断',
  jobs: '采集运行',
  countries: '国家配置',
};
const icons: Record<Page, React.ElementType> = {
  market: Globe2,
  events: Activity,
  library: Layers3,
  favorites: Bookmark,
  research: BookOpen,
  requests: ClipboardList,
  members: Users,
  candidates: ShieldCheck,
  rules: Settings2,
  discovery: Search,
  jobs: Database,
  countries: Compass,
};
interface BackEntry {
  route: Route;
  scrollY: number;
  focusKey: string | null;
  scrollLeft: number[];
  anchor: { id: string; top: number } | null;
}
function permitted(user: Principal, page: Route['page']) {
  if (['detail', 'compare', 'market', 'events', 'library'].includes(page)) return true;
  if (['favorites', 'research'].includes(page)) return user.role !== 'platform';
  if (page === 'requests') return true;
  if (page === 'members') return ['platform', 'admin'].includes(user.role);
  return user.role === 'platform';
}
function Workspace({
  session,
  onSession,
  onLogout,
}: {
  session: ResearchSession;
  onSession: (s: ResearchSession) => void;
  onLogout: () => Promise<void>;
}) {
  const user = session.user!;
  const [route, setRoute] = useState<Route>({
      page:
        location.hash === '#market-activity'
          ? 'events'
          : location.hash === '#discovery' && user.role === 'platform'
            ? 'discovery'
            : 'market',
    }),
    [menu, setMenu] = useState(false),
    [version, setVersion] = useState(0),
    [toast, setToast] = useState(''),
    [mutationError, setMutationError] = useState(''),
    [switching, setSwitching] = useState(false);
  const [library, setLibrary] = useState<LibraryQuery>({ ...defaultLibraryQuery }),
    [searchDraft, setSearchDraft] = useState(''),
    [events, setEvents] = useState<EventView>({ ...defaultEventView }),
    [group, setGroup] = useState<number | null>(null),
    [collection, setCollection] = useState<number | null>(null),
    [selected, setSelected] = useState<number[]>([]);
  const [candidateView, setCandidateView] = useState<AppsViewState>({
    ...defaultAppsView,
    classification: 'candidate',
  });
  const [modal, setModal] = useState<'add' | 'discover' | 'country' | null>(null),
    [editCountry, setEditCountry] = useState<Country | null>(null);
  const backStack = useRef<BackEntry[]>([]),
    restore = useRef<BackEntry | null>(null),
    reading = useRef<LibraryReading | null>(null),
    candidateReading = useRef<LibraryReading | null>(null),
    mutationBusy = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const revoked = () => {
      backStack.current = [];
      restore.current = null;
      reading.current = null;
      candidateReading.current = null;
      setSelected([]);
      sessionQueries.clear();
      setVersion((v) => v + 1);
      setMutationError('公共可见范围已变化，旧清单与选择已清除，请点击更新重新读取。');
    };
    window.addEventListener('appeye:public-scope-revoked', revoked);
    return () => window.removeEventListener('appeye:public-scope-revoked', revoked);
  }, []);
  const countriesResource = useResource<{ countries: Country[] }>('/countries', version);
  const researchResource = useResource<ResearchState>(
    user.role === 'platform' ? '/auth/session' : '/research/state',
    version,
  );
  const research = user.role === 'platform' ? null : researchResource.data;
  const countries = countriesResource.data?.countries || [];
  const notify = (s: string) => {
    setToast(s);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const changed = () => setVersion((v) => v + 1);
  const mutate: Mutation = async (operation, success) => {
    if (!canWrite(user) && user.role !== 'platform') {
      setMutationError('当前身份没有写入权限。');
      return false;
    }
    if (mutationBusy.current) return false;
    mutationBusy.current = true;
    setMutationError('');
    try {
      await operation();
      if (!mounted.current) return false;
      changed();
      if (success) notify(success);
      return true;
    } catch (e) {
      if (mounted.current) {
        setMutationError((e as Error).message);
        changed();
      }
      return false;
    } finally {
      mutationBusy.current = false;
    }
  };
  function navigate(page: Page) {
    if (!permitted(user, page)) return;
    backStack.current = [];
    reading.current = null;
    restore.current = null;
    setRoute({ page });
    setMenu(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function push(next: Route) {
    const active = document.activeElement as HTMLElement | null;
    const anchorNode = [...document.querySelectorAll<HTMLElement>('[data-reading-id]')].find(
      (n) => n.getBoundingClientRect().top >= 65 && n.getBoundingClientRect().top < innerHeight,
    );
    backStack.current.push({
      anchor: anchorNode
        ? { id: anchorNode.dataset.readingId!, top: anchorNode.getBoundingClientRect().top }
        : null,
      route,
      scrollY: window.scrollY,
      focusKey: active?.dataset.focusKey ?? null,
      scrollLeft: [...document.querySelectorAll<HTMLElement>('.table-scroll')].map(
        (n) => n.scrollLeft,
      ),
    });
    if (route.page === 'library') reading.current = captureLibraryReading(marketKey(library), true);
    if (route.page === 'candidates')
      candidateReading.current = captureLibraryReading('candidates', true);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function select(id: number, event?: MarketActivityEvent) {
    push({ page: 'detail', id, event });
  }
  function back() {
    const previous = backStack.current.pop();
    if (previous) {
      restore.current = previous;
      setRoute(previous.route);
    } else navigate('library');
  }
  useLayoutEffect(() => {
    const saved = restore.current;
    if (!saved) return;
    requestAnimationFrame(() => {
      if (saved.route.page !== 'library' && saved.route.page !== 'candidates') {
        const anchor =
          saved.anchor &&
          [...document.querySelectorAll<HTMLElement>('[data-reading-id]')].find(
            (n) => n.dataset.readingId === saved.anchor!.id,
          );
        if (anchor && saved.anchor)
          window.scrollBy({
            top: anchor.getBoundingClientRect().top - saved.anchor.top,
            behavior: 'instant',
          });
        else window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      }
      [...document.querySelectorAll<HTMLElement>('.table-scroll')].forEach((el, i) => {
        el.scrollLeft = saved.scrollLeft[i] || 0;
      });
      if (saved.focusKey)
        [...document.querySelectorAll<HTMLElement>('[data-focus-key]')]
          .find((el) => el.dataset.focusKey === saved.focusKey)
          ?.focus({ preventScroll: true });
      restore.current = null;
    });
  }, [route]);
  async function switchSpace(id: number) {
    if (switching) return;
    setSwitching(true);
    try {
      const next = await post<ResearchSession>('/auth/workspace', { workspaceId: id });
      onSession(next);
    } catch (e) {
      setMutationError((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }
  function toggleCompare(app: MarketApp) {
    setSelected((ids) => {
      if (ids.includes(app.id)) return ids.filter((id) => id !== app.id);
      if (ids.length >= 4) {
        notify('最多对比 4 个应用，请先移除一项。');
        return ids;
      }
      return [...ids, app.id];
    });
  }
  async function collect(id: number, type: 'refresh' | 'reviews' | 'enrich') {
    if (user.role !== 'platform') return;
    await mutate(() => post('/jobs', { type, appId: id }), '采集任务已排队，实际结果稍后显示');
  }
  const customerPages: Page[] = [
    'market',
    'events',
    'library',
    ...(user.role !== 'platform' ? (['favorites', 'research'] as Page[]) : []),
    'requests',
  ];
  const operationPages: Page[] =
    user.role === 'platform'
      ? ['candidates', 'rules', 'discovery', 'jobs', 'countries', 'members']
      : user.role === 'admin'
        ? ['members']
        : [];
  const currentName =
    route.page === 'detail'
      ? '应用研究'
      : route.page === 'compare'
        ? '应用对比'
        : names[route.page];
  const content = !permitted(user, route.page) ? (
    <ErrorNotice error="当前身份不可访问该页面。" />
  ) : route.page === 'market' ? (
    <MarketHome
      countries={countries}
      view={events}
      onView={setEvents}
      onEvents={(v) => {
        setEvents(v);
        navigate('events');
      }}
      onSelect={select}
    />
  ) : route.page === 'events' ? (
    <EventsPage
      countries={countries}
      view={events}
      onView={setEvents}
      onSelect={select}
      readIds={research?.readStates.map((r) => r.eventId) || []}
      onRead={
        canWrite(user)
          ? (id, read) =>
              void mutate(
                () =>
                  api(`/research/read/${encodeURIComponent(id)}`, {
                    method: read ? 'PUT' : 'DELETE',
                    ...(read ? { body: '{}' } : {}),
                  }),
                read ? '已标记已读' : '已标记未读',
              )
          : undefined
      }
    />
  ) : route.page === 'library' ? (
    <MarketLibrary
      searchDraft={searchDraft}
      onSearchDraft={setSearchDraft}
      countries={countries}
      view={library}
      onView={setLibrary}
      onSelect={select}
      selected={selected}
      onCompare={toggleCompare}
      reading={reading}
    />
  ) : route.page === 'favorites' || route.page === 'research' ? (
    <PrivateResearch
      loanScope={library.loanScope}
      onLoanScope={(loanScope) => setLibrary((v) => ({ ...v, loanScope }))}
      mode={route.page}
      user={user}
      state={research}
      error={researchResource.error}
      mutate={mutate}
      onSelect={select}
      selectedId={route.page === 'favorites' ? group : collection}
      onSelection={route.page === 'favorites' ? setGroup : setCollection}
    />
  ) : route.page === 'requests' ? (
    <RequestsPage
      user={user}
      state={research}
      countries={countries}
      mutate={mutate}
      onSelect={select}
      version={version}
    />
  ) : route.page === 'members' ? (
    <MembersPage user={user} mutate={mutate} version={version} />
  ) : route.page === 'rules' ? (
    <RulesPage mutate={mutate} version={version} />
  ) : route.page === 'compare' ? (
    <ComparePage
      ids={selected}
      onRemove={(id) => setSelected((v) => v.filter((x) => x !== id))}
      onSelect={select}
      onBack={back}
    />
  ) : route.page === 'detail' ? (
    <ProductionDetail
      key={route.id}
      id={route.id}
      event={route.event}
      user={user}
      state={research}
      mutate={mutate}
      version={version}
      onBack={back}
      backLabel={`返回${backStack.current.at(-1)?.route.page === 'compare' ? '应用对比' : names[backStack.current.at(-1)?.route.page as Page] || '应用库'}`}
      onRefresh={collect}
      onChanged={changed}
      onNotify={notify}
    />
  ) : route.page === 'candidates' ? (
    <AppsPage
      version={version}
      countries={countries}
      onSelect={select}
      onAdd={() => setModal('add')}
      view={candidateView}
      onViewChange={setCandidateView}
      reading={candidateReading}
    />
  ) : route.page === 'discovery' ? (
    <DiscoveryDiagnostics
      countries={countries}
      version={version}
      onSelect={select}
      onChanged={changed}
    />
  ) : route.page === 'jobs' ? (
    <>
      <JobsPage
        version={version}
        countries={countries}
        onDiscover={() => setModal('discover')}
        onNotify={notify}
        onChanged={changed}
      />
      <CollectionMonitor
        countries={countries}
        version={version}
        onSelect={select}
        onJobs={() => navigate('jobs')}
      />
    </>
  ) : route.page === 'countries' ? (
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
  ) : null;
  return (
    <MutationErrorContext.Provider value={mutationError}>
      <div className={`research-shell ${menu ? 'menu-open' : ''}`}>
        <aside className="research-sidebar">
          <button className="research-brand" onClick={() => navigate('market')}>
            <EyeLogo />
            appeye<span>.</span>
          </button>
          <small className="research-sidebar-caption">信贷行业研究工作台</small>
          <nav aria-label="主导航">
            {customerPages.map((p) => {
              const I = icons[p];
              return (
                <button
                  key={p}
                  aria-label={names[p]}
                  className={route.page === p ? 'active' : ''}
                  onClick={() => navigate(p)}
                >
                  <I size={19} />
                  <span>{names[p]}</span>
                </button>
              );
            })}
            {operationPages.length > 0 && (
              <small className="research-nav-section">
                {user.role === 'platform' ? '平台运营' : '空间管理'}
              </small>
            )}
            {operationPages.map((p) => {
              const I = icons[p];
              return (
                <button
                  key={p}
                  aria-label={names[p]}
                  className={route.page === p ? 'active' : ''}
                  onClick={() => navigate(p)}
                >
                  <I size={18} />
                  <span>
                    {p === 'members' && user.role === 'platform' ? '客户与成员' : names[p]}
                  </span>
                </button>
              );
            })}
          </nav>
          <footer>
            <span className="research-avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{roleLabels[user.role]}</small>
            </div>
            <button aria-label="退出登录" className="icon-button" onClick={() => void onLogout()}>
              <LogOut size={16} />
            </button>
          </footer>
        </aside>
        <div className="research-workspace">
          <header className="research-topbar topbar">
            <div>
              <button
                className="icon-button research-menu"
                aria-label="切换导航"
                onClick={() => setMenu(!menu)}
              >
                <Menu size={20} />
              </button>
              <span>研究工作台</span>
              <span className="muted">/</span>
              <strong>{currentName}</strong>
            </div>
            <div>
              {session.dataset === 'demo' && <span className="research-tag">演示数据库</span>}
              {user.workspaceId != null ? (
                <select
                  aria-label="切换客户空间"
                  disabled={switching}
                  value={user.workspaceId}
                  onChange={(e) => void switchSpace(Number(e.target.value))}
                >
                  {session.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="research-tag">平台公共数据</span>
              )}
              <span>{roleLabels[user.role]}</span>
              <button
                className="icon-button"
                aria-label="刷新当前数据"
                onClick={() => {
                  if (route.page === 'library') {
                    reading.current = captureLibraryReading(marketKey(library));
                    void loadMarket(library, { fresh: true });
                  } else changed();
                }}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </header>
          <main className="research-main">
            <ErrorNotice error={mutationError || countriesResource.error} />
            {content}
          </main>
          {selected.length > 0 && route.page !== 'compare' && (
            <div className="research-compare-tray">
              <span>已选择 {selected.length} / 4 个应用</span>
              <button
                className="button"
                disabled={selected.length < 2}
                onClick={() => push({ page: 'compare' })}
              >
                <ChartNoAxesCombined size={16} />
                开始对比
              </button>
              <button className="text-button" onClick={() => setSelected([])}>
                清空
              </button>
            </div>
          )}
          <footer className="research-footer">
            公开商店观测与客户研究 · 指标存在来源窗口限制 · 不构成牌照或合规判断
          </footer>
        </div>
        {toast && (
          <div className="toast" role="status">
            {toast}
            <button className="icon-button" aria-label="关闭通知" onClick={() => setToast('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {user.role === 'platform' && modal === 'country' && (
          <CountryForm
            country={editCountry}
            onClose={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              changed();
              notify('国家配置已保存');
            }}
          />
        )}
        {user.role === 'platform' && modal === 'discover' && (
          <DiscoveryForm
            countries={countries}
            onClose={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              changed();
              notify('发现任务已排队');
            }}
          />
        )}
        {user.role === 'platform' && modal === 'add' && (
          <AddAppForm
            countries={countries}
            onClose={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              changed();
              notify('应用已加入采集队列，尚不表示详情采集成功');
            }}
          />
        )}
      </div>
    </MutationErrorContext.Provider>
  );
}
function ProductionDetail({
  id,
  event,
  user,
  state,
  mutate,
  version,
  onBack,
  backLabel,
  onRefresh,
  onChanged,
  onNotify,
}: {
  id: number;
  event?: MarketActivityEvent;
  user: Principal;
  state: ResearchState | null;
  mutate: Mutation;
  version: number;
  onBack: () => void;
  backLabel: string;
  onRefresh: (id: number, type: 'refresh' | 'reviews' | 'enrich') => void;
  onChanged: () => void;
  onNotify: (s: string) => void;
}) {
  const { data } = useResource<{ app: MarketApp }>(`/apps/${id}`, version);
  return (
    <>
      {data && (
        <>
          {event && <SelectedEvent event={event} />}
          <DetailResearch
            appId={id}
            user={user}
            state={state}
            mutate={mutate}
            eventCitation={
              event?.changes[0] ? { kind: 'change', recordId: event.changes[0].id } : undefined
            }
          />
        </>
      )}
      <div className="production-detail">
        <AppDetail
          id={id}
          version={version}
          onBack={onBack}
          backLabel={backLabel}
          canOperate={user.role === 'platform'}
          onRefresh={onRefresh}
          onChanged={onChanged}
          onNotify={onNotify}
        />
      </div>
      {data && (
        <>
          <Gallery app={data.app} />
          {user.role === 'platform' && (
            <CategoryEditor id={id} current={data.app.category} mutate={mutate} />
          )}
        </>
      )}
    </>
  );
}
export default function App() {
  const [session, setSession] = useState<ResearchSession | null>(null),
    [error, setError] = useState('');
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get('invite'));
  const keyRef = useRef('');
  const authEpoch = useRef(0);
  const acceptSession = useCallback((next: ResearchSession) => {
    authEpoch.current++;
    const key = sessionKey(next);
    if (keyRef.current !== key || !next.authenticated) {
      clearResearchSession();
      keyRef.current = key;
      setMarketScope(key);
    }
    setSession(next);
    if (next.authenticated && next.user) {
      setToken(null);
    }
  }, []);
  useEffect(() => {
    let current: AbortController | null = null;
    let alive = true;
    const load = () => {
      if (document.hidden || current) return;
      const c = new AbortController();
      const epoch = authEpoch.current;
      current = c;
      api<ResearchSession>('/auth/session', { signal: c.signal })
        .then((s) => {
          if (alive && !c.signal.aborted && epoch === authEpoch.current) {
            acceptSession(s);
            setError('');
          }
        })
        .catch((e) => {
          if (alive && !c.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (current === c) current = null;
        });
    };
    load();
    const timer = setInterval(load, 15000);
    const unauthorized = () => {
      authEpoch.current++;
      current?.abort();
      current = null;
      clearResearchSession();
      keyRef.current = '';
      setSession({ authenticated: false, configured: true, user: null, workspaces: [] });
    };
    window.addEventListener('appeye:unauthorized', unauthorized);
    document.addEventListener('visibilitychange', load);
    return () => {
      alive = false;
      current?.abort();
      clearInterval(timer);
      window.removeEventListener('appeye:unauthorized', unauthorized);
      document.removeEventListener('visibilitychange', load);
    };
  }, [acceptSession]);
  async function logout() {
    try {
      await post('/auth/logout');
      clearResearchSession();
      acceptSession({
        authenticated: false,
        configured: session?.configured ?? true,
        user: null,
        workspaces: [],
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (token) return <Invitation token={token} onSession={acceptSession} />;
  if (!session)
    return (
      <main className="research-login">
        <section>
          <Busy />
          <ErrorNotice error={error} />
        </section>
      </main>
    );
  if (!session.authenticated || !session.user)
    return <Login configured={session.configured} onSession={acceptSession} />;
  return (
    <>
      <ErrorNotice error={error} />
      <Workspace
        key={sessionKey(session)}
        session={session}
        onSession={acceptSession}
        onLogout={logout}
      />
    </>
  );
}

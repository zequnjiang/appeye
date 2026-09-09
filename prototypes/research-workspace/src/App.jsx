import { requestDownload } from './download';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Layers,
  Star,
  Folder,
  ArrowRight,
  RefreshCw,
  Clock,
  CalendarDays,
  Info,
  ChevronDown,
  Search,
  Plus,
  SlidersHorizontal,
  ArrowUpDown,
  Check,
  X,
  Users,
  Settings2,
  ShieldCheck,
  ListChecks,
  Activity,
  Globe2,
  FileText,
  Download,
  Edit3,
  Trash2,
  BookOpen,
  GitCompareArrows,
  Bell,
  ChevronRight,
  CheckCheck,
  Send,
  Copy,
  Landmark,
  LogOut,
  Eye,
} from 'lucide-react';
import '@fontsource-variable/dm-sans';
import 'flag-icons/css/flag-icons.min.css';
import {
  createFixtures,
  createPendingDemo,
  admitCandidate,
  storeSource,
  DEMO_DAY,
  countries,
  eventLabels,
  roles,
  stores,
} from './data';
import {
  visibleApps,
  paginate,
  marketCounts,
  latestMarketObservation,
  sortFields,
  formatNumber,
  dateText,
  statusText,
  canEditResearch,
  canManageMembers,
  isCustomerRole,
  canOperate,
  exportResearch,
} from './utils';
import {
  Flag,
  AppIcon,
  AppExternalLink,
  CountryLabel,
  Tag,
  SourceNote,
  PageHeading,
  Empty,
  Pager,
  Dialog,
  Lightbox,
  Evidence,
  EventTable,
  Back,
  Field,
  DemoSource,
} from './components';
const pageLabels = {
  home: '今日市场',
  events: '市场变化',
  library: '应用库',
  following: '我的关注',
  research: '研究空间',
  candidates: '候选审核',
  rules: '识别规则',
  diagnostics: '发现诊断',
  tasks: '采集任务',
  markets: '市场设置',
  members: '客户与成员',
  compare: '应用对比',
  detail: '应用详情',
};
const identities = [
  { id: 'north-researcher', space: 'north', role: 'researcher', name: '林研究员' },
  { id: 'north-admin', space: 'north', role: 'admin', name: '北辰管理员' },
  { id: 'north-viewer', space: 'north', role: 'viewer', name: '北辰只读成员' },
  { id: 'south-researcher', space: 'south', role: 'researcher', name: '周研究员' },
  { id: 'south-admin', space: 'south', role: 'admin', name: '远山管理员' },
  { id: 'south-viewer', space: 'south', role: 'viewer', name: '远山只读成员' },
  { id: 'platform', space: null, role: 'platform', name: '平台运营员' },
];
const defaultLibrary = {
  q: '',
  country: '',
  store: '',
  loanType: 'personal',
  classification: 'confirmed',
  score: '',
  installs: '',
  from: '',
  to: '',
  sort: 'minInstalls',
  direction: 'desc',
  page: 1,
};
export function App() {
  const [model, setModel] = useState(createFixtures),
    [identityId, setIdentityId] = useState('north-researcher'),
    [route, setRoute] = useState({ page: 'home' }),
    [library, setLibrary] = useState(defaultLibrary),
    [eventFilter, setEventFilter] = useState({
      country: '',
      type: '',
      day: DEMO_DAY,
      store: '',
      loanType: 'personal',
      page: 1,
    }),
    [cashOnly, setCashOnly] = useState(true),
    [day, setDay] = useState(DEMO_DAY),
    [pending, setPending] = useState(null),
    [toast, setToast] = useState(''),
    [dialog, setDialog] = useState(null),
    [compare, setCompare] = useState([]),
    [reads, setReads] = useState({}),
    [detailTab, setDetailTab] = useState('overview'),
    [permissionExpanded, setPermissionExpanded] = useState(false),
    [lightbox, setLightbox] = useState(null),
    [diagnostic, setDiagnostic] = useState(null),
    [autoDemo, setAutoDemo] = useState(false),
    [followGroup, setFollowGroup] = useState('');
  const identity = identities.find((x) => x.id === identityId),
    role = identity.role,
    workspace = identity.space ? model.workspaces[identity.space] : null;
  const history = useRef([]),
    restoration = useRef(null);
  const notify = (s) => setToast(s);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (!autoDemo) return;
    const timer = setInterval(() => {
      if (!model.apps.some((a) => a.id === 'th-new-demo'))
        setPending((p) => p || createPendingDemo(model.apps, model.events));
    }, 15000);
    return () => clearInterval(timer);
  }, [autoDemo, model.apps, model.events]);
  useLayoutEffect(() => {
    if (restoration.current) {
      const saved = restoration.current;
      restoration.current = null;
      window.scrollTo(0, saved.y);
      if (saved.focus) document.getElementById(saved.focus)?.focus({ preventScroll: true });
      const table = document.querySelector('.table-scroll');
      if (table) table.scrollLeft = saved.x;
    }
  }, [route]);
  const go = (next, push = true) => {
    if (push)
      history.current.push({
        route,
        y: scrollY,
        focus: document.activeElement?.id,
        x: document.querySelector('.table-scroll')?.scrollLeft || 0,
      });
    setRoute(next);
    setDetailTab('overview');
    setPermissionExpanded(false);
    window.scrollTo(0, 0);
  };
  const back = () => {
    const saved = history.current.pop();
    if (saved) {
      restoration.current = saved;
      setRoute(saved.route);
    } else setRoute({ page: 'home' });
  };
  const nav = (page) => {
    history.current = [];
    go({ page }, false);
  };
  const selectApp = (id, eventId) => {
    go({ page: 'detail', id, eventId });
    if (eventId) setDetailTab('changes');
  };
  const editWorkspace = (fn) => {
    if (!workspace || !canEditResearch(role)) {
      notify('当前演示身份没有研究写入权限。');
      return;
    }
    setModel((m) => ({
      ...m,
      workspaces: { ...m.workspaces, [identity.space]: fn(m.workspaces[identity.space]) },
    }));
  };
  const toggleFollow = (id) =>
    editWorkspace((w) => ({
      ...w,
      following: w.following.includes(id)
        ? w.following.filter((x) => x !== id)
        : [...w.following, id],
      groups: w.following.includes(id)
        ? w.groups.map((g) => ({ ...g, appIds: g.appIds.filter((a) => a !== id) }))
        : w.groups,
    }));
  const markRead = (id) => {
    if (!workspace || !canEditResearch(role)) {
      notify('只读成员不能修改已读状态。');
      return;
    }
    setReads((s) => ({
      ...s,
      [identityId]: (s[identityId] || []).includes(id)
        ? s[identityId].filter((x) => x !== id)
        : [...(s[identityId] || []), id],
    }));
  };
  const toggleCompare = (id) => {
    setCompare((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 4 ? [...ids, id] : ids,
    );
    if (!compare.includes(id) && compare.length === 4)
      notify('一次最多对比 4 个应用，请先移除一个。');
  };
  const download = (name, content) => setDialog({ kind: 'export', name, content });
  const triggerDownload = (name, content) => {
    try {
      requestDownload(name, content);
      notify('已发起示例文件下载，请查看浏览器的下载记录。');
    } catch {
      notify('浏览器未能启动下载，请重试或使用允许下载的浏览器。');
    }
  };
  const detectDemo = () => {
    if (model.apps.some((a) => a.id === 'th-new-demo'))
      return notify('本轮示例新资料已应用，可重置数据再次体验。');
    setPending(createPendingDemo(model.apps, model.events));
    notify('检测到示例新数据；清单尚未替换。');
  };
  const applyPending = () => {
    if (!pending) return;
    setModel((m) => ({
      ...m,
      apps: [...pending.apps.filter((a) => !m.apps.some((x) => x.id === a.id)), ...m.apps],
      events: [...pending.events.filter((e) => !m.events.some((x) => x.id === e.id)), ...m.events],
    }));
    setPending(null);
    notify('已应用这次示例更新。后台检测不会自行替换正在阅读的清单。');
  };
  const scopeApps = model.apps.filter(
    (a) => a.classification === 'confirmed' && (!cashOnly || a.loanType === 'personal'),
  );
  const summary = marketCounts(model.apps, model.events, { day, cashOnly });
  const featured = model.featuredIds
    .map((id) => model.events.find((e) => e.id === id))
    .filter(Boolean);
  const currentApp = route.page === 'detail' ? model.apps.find((a) => a.id === route.id) : null;
  const privatePages = ['following', 'research'];
  const operatorPages = ['candidates', 'rules', 'diagnostics', 'tasks', 'markets'];
  const allowed =
    !(privatePages.includes(route.page) && !workspace) &&
    !(operatorPages.includes(route.page) && !canOperate(role)) &&
    !(route.page === 'members' && !canOperate(role) && !canManageMembers(role));
  function changeLibrary(key, value) {
    setLibrary((v) => ({ ...v, [key]: value, page: 1 }));
  }
  function openEvents(country = '', type = '') {
    setEventFilter({
      country,
      type,
      day,
      store: '',
      loanType: cashOnly ? 'personal' : '',
      page: 1,
    });
    go({ page: 'events' });
  }
  function addNote(app, text, existing) {
    editWorkspace((w) => ({
      ...w,
      notes: existing
        ? w.notes.map((n) => (n.id === existing.id ? { ...n, text } : n))
        : [
            ...w.notes,
            {
              id: `note-${Date.now()}`,
              appId: app.id,
              text,
              author: identity.name,
              date: DEMO_DAY,
            },
          ],
    }));
    setDialog(null);
    notify('研究备注已保存到当前客户空间。');
  }
  function approveCandidate(candidate) {
    if (!canOperate(role)) return notify('需要平台运营身份。');
    setModel((m) => admitCandidate(m, candidate.id));
    notify('已确认收录，公共市场库与首页计数同步更新。');
  }
  function requestIntake(values) {
    editWorkspace((w) => ({
      ...w,
      requests: [
        ...w.requests,
        { id: `request-${Date.now()}`, ...values, status: 'pending', date: DEMO_DAY },
      ],
    }));
    setDialog(null);
    notify('收录申请已保存；示例操作未请求任何商店。');
  }
  function updateMember(space, id, changes) {
    if ('role' in changes && !isCustomerRole(changes.role))
      return notify('客户成员仅允许管理员、研究员或只读角色。');
    if (!(canOperate(role) || (canManageMembers(role) && space === identity.space)))
      return notify('当前身份没有此空间的成员管理权限。');
    setModel((m) => ({
      ...m,
      workspaces: {
        ...m.workspaces,
        [space]: {
          ...m.workspaces[space],
          members: m.workspaces[space].members.map((x) => (x.id === id ? { ...x, ...changes } : x)),
        },
      },
    }));
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/assets/appeye.svg" width="36" height="36" alt="" />
          <strong>
            appeye<span>.</span>
          </strong>
        </div>
        <p className="brand-caption">信贷行业观察站</p>
        <span className="demo-pill">产品原型 · 示例数据</span>
        <nav aria-label="主导航">
          {[
            ['home', '今日市场', BarChart3],
            ['library', '应用库', Layers],
            ['following', '我的关注', Star],
            ['research', '研究空间', Folder],
          ]
            .filter(([p]) => workspace || !privatePages.includes(p))
            .map(([p, label, Icon]) => (
              <button
                key={p}
                className={route.page === p ? 'active' : ''}
                onClick={() => nav(p)}
                aria-label={label}
              >
                <Icon size={22} />
                <span>{label}</span>
              </button>
            ))}
          {canOperate(role) && (
            <>
              <div className="nav-group-label">平台运营</div>
              {[
                ['candidates', '候选审核', ListChecks],
                ['rules', '识别规则', ShieldCheck],
                ['diagnostics', '发现诊断', Activity],
                ['tasks', '采集任务', RefreshCw],
                ['markets', '市场设置', Globe2],
              ].map(([p, label, Icon]) => (
                <button key={p} className={route.page === p ? 'active' : ''} onClick={() => nav(p)}>
                  <Icon size={20} />
                  {label}
                </button>
              ))}
            </>
          )}
          {(canManageMembers(role) || canOperate(role)) && (
            <button
              className={route.page === 'members' ? 'active' : ''}
              onClick={() => nav('members')}
            >
              <Users size={21} />
              {canOperate(role) ? '客户与成员' : '成员管理'}
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <details className="identity-menu">
            <summary>
              <span className="avatar">A</span>
              <span>{roles[role]}</span>
              <ChevronDown size={14} />
            </summary>
            <div className="identity-popover">
              <strong>切换演示身份</strong>
              <p>仅模拟权限，不是正式登录。</p>
              <select
                aria-label="演示身份"
                value={identityId}
                onChange={(e) => {
                  setIdentityId(e.target.value);
                  history.current = [];
                  setRoute({ page: 'home' });
                  setDialog(null);
                  setCompare([]);
                  setLightbox(null);
                  setDiagnostic(null);
                  setLibrary(defaultLibrary);
                  setFollowGroup('');
                }}
              >
                {identities.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.space ? model.workspaces[i.space].name : '平台'} · {roles[i.role]}
                  </option>
                ))}
              </select>
              <button onClick={() => setAutoDemo(!autoDemo)}>
                {autoDemo ? '关闭' : '开启'}每 15 秒示例检测
              </button>
              <button
                onClick={() => {
                  detectDemo();
                }}
              >
                演示一次新数据检测
              </button>
              <button onClick={() => setDialog({ kind: 'reset' })}>重置示例数据</button>
            </div>
          </details>
          <p>
            专注全球信贷应用市场
            <br />
            更透明的行业观察
          </p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="mobile-demo">原型 · 示例数据</span>
          <span>
            <Clock size={14} />
            北京时间&nbsp; 2026年9月8日&nbsp; 星期二
          </span>
          <i />
          <button className="top-update" onClick={pending ? applyPending : detectDemo}>
            <RefreshCw size={17} />
            {pending ? '有新数据 · 点击更新' : '演示检测 · 清单保持不变'}
          </button>
        </header>
        <main className="main-content">
          {!allowed ? (
            <Empty
              title="当前身份无法访问此工作区"
              description="演示权限在页面入口和操作中均检查。请在左下角切换对应身份。"
            >
              <button className="primary" onClick={() => nav('home')}>
                返回今日市场
              </button>
            </Empty>
          ) : (
            <>
              {route.page === 'home' && (
                <>
                  <PageHeading title="今日市场" description="六个市场，今天有哪些变化。">
                    <button className="primary" onClick={() => openEvents()}>
                      查看变化 <ArrowRight size={17} />
                    </button>
                  </PageHeading>
                  <div className="home-scope">
                    <label>
                      <CalendarDays size={17} />
                      <input
                        aria-label="市场日期"
                        type="date"
                        value={day}
                        onChange={(e) => setDay(e.target.value)}
                      />
                      <span>（北京时间）</span>
                    </label>
                    <i />
                    <label className="cash-switch">
                      <ShieldCheck size={15} />
                      <input
                        type="checkbox"
                        checked={cashOnly}
                        onChange={(e) => setCashOnly(e.target.checked)}
                      />
                      仅显示已确认的信贷应用（个人现金贷款）
                      <Info size={14} />
                    </label>
                    <SourceNote />
                  </div>
                  <div className="table-scroll home-country-table">
                    <table>
                      <colgroup>
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '27%' }} />
                        <col style={{ width: '9%' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>市场</th>
                          <th>
                            系统新发现<small>我们首次收录的应用</small>
                          </th>
                          <th>
                            商店当日发布<small>在应用商店今日上架</small>
                          </th>
                          <th>
                            有更新的应用<small>版本或信息发生变化</small>
                          </th>
                          <th>最近动态</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {model.markets.map((c) => {
                          const latest = latestMarketObservation(model.apps, model.events, {
                            country: c.code,
                            day,
                            cashOnly,
                          });
                          const counts = summary[c.code] || {
                            firstSeen: 0,
                            storeRelease: 0,
                            updated: 0,
                          };
                          return (
                            <tr key={c.code}>
                              <td>
                                <CountryLabel code={c.code} full />
                              </td>
                              <td>
                                <button
                                  className="count-link"
                                  onClick={() => openEvents(c.code, 'firstSeen')}
                                >
                                  {counts.firstSeen}
                                </button>
                              </td>
                              <td>
                                <button
                                  className="count-link"
                                  onClick={() => openEvents(c.code, 'storeRelease')}
                                >
                                  {counts.storeRelease}
                                </button>
                              </td>
                              <td>
                                <div className="update-count">
                                  <button
                                    className="count-link"
                                    onClick={() => openEvents(c.code, 'updated')}
                                  >
                                    {counts.updated}
                                  </button>
                                  <progress value={counts.updated} max={36} />
                                </div>
                              </td>
                              <td className="muted recent-note">
                                {latest
                                  ? `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(latest.observedTime))} · ${eventLabels[latest.type]} ${latest.title}`
                                  : '所选范围暂无动态'}
                              </td>
                              <td>
                                <button className="text-button" onClick={() => openEvents(c.code)}>
                                  查看变化 <ArrowRight size={15} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <section className="featured-section">
                    <div className="section-heading">
                      <div>
                        <h2>今日值得关注</h2>
                        <p>基于六个市场的最新变化，以下为值得关注的应用事件。</p>
                      </div>
                      <div>
                        <span className="muted">
                          精选{' '}
                          {day === DEMO_DAY
                            ? 4
                            : Math.min(4, model.events.filter((e) => e.date === day).length)}{' '}
                          条事件
                        </span>
                        <button className="text-button" onClick={() => openEvents()}>
                          查看全部 <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                    {model.events.some((e) => e.date === day) ? (
                      <EventTable
                        events={
                          day === DEMO_DAY
                            ? featured
                            : model.events.filter((e) => e.date === day).slice(0, 4)
                        }
                        apps={model.apps}
                        onSelect={selectApp}
                      />
                    ) : (
                      <Empty title="所选日期没有示例事件" />
                    )}
                  </section>
                </>
              )}
              {route.page === 'events' && (
                <>
                  <Back onClick={back}>返回今日市场</Back>
                  <PageHeading
                    title={
                      eventFilter.country
                        ? `${countries.find((c) => c.code === eventFilter.country)?.name || eventFilter.country} · 市场变化`
                        : '全部市场变化'
                    }
                    description="系统首次发现、商店发布和观测更新分别统计；同一应用可出现在不同事件类别。"
                  >
                    <SourceNote />
                  </PageHeading>
                  <div className="filters">
                    <Field label="市场">
                      <select
                        value={eventFilter.country}
                        onChange={(e) =>
                          setEventFilter((f) => ({ ...f, country: e.target.value, page: 1 }))
                        }
                      >
                        <option value="">全部市场</option>
                        {model.markets.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="事件类型">
                      <select
                        value={eventFilter.type}
                        onChange={(e) =>
                          setEventFilter((f) => ({ ...f, type: e.target.value, page: 1 }))
                        }
                      >
                        <option value="">全部类型</option>
                        {Object.entries(eventLabels).map(([k, v]) => (
                          <option value={k} key={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="北京时间日期">
                      <input
                        type="date"
                        value={eventFilter.day}
                        onChange={(e) =>
                          setEventFilter((f) => ({ ...f, day: e.target.value, page: 1 }))
                        }
                      />
                    </Field>
                    <Field label="商店">
                      <select
                        value={eventFilter.store}
                        onChange={(e) =>
                          setEventFilter((f) => ({ ...f, store: e.target.value, page: 1 }))
                        }
                      >
                        <option value="">全部商店</option>
                        {Object.entries(stores).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="信贷品类">
                      <select
                        value={eventFilter.loanType}
                        onChange={(e) =>
                          setEventFilter((f) => ({ ...f, loanType: e.target.value, page: 1 }))
                        }
                      >
                        <option value="personal">个人现金贷</option>
                        <option value="">全部已确认信贷</option>
                        <option value="business">经营贷</option>
                        <option value="mortgage">房贷</option>
                      </select>
                    </Field>
                    <span className="filter-note">已读按当前演示成员隔离</span>
                  </div>
                  {(() => {
                    const ids = new Set(
                      model.apps
                        .filter(
                          (a) =>
                            a.classification === 'confirmed' &&
                            (!eventFilter.loanType || a.loanType === eventFilter.loanType) &&
                            (!eventFilter.store || a.store === eventFilter.store),
                        )
                        .map((a) => a.id),
                    );
                    const rows = model.events
                      .filter(
                        (e) =>
                          ids.has(e.appId) &&
                          e.date === eventFilter.day &&
                          (!eventFilter.country || e.country === eventFilter.country) &&
                          (!eventFilter.type || e.type === eventFilter.type),
                      )
                      .sort((a, b) => b.at.localeCompare(a.at));
                    const page = paginate(rows, eventFilter.page, 12);
                    return (
                      <>
                        <div className="results-summary">
                          {rows.length} 个事件 · {new Set(rows.map((e) => e.appId)).size} 个应用
                        </div>
                        {rows.length ? (
                          <EventTable
                            events={page.rows}
                            apps={model.apps}
                            onSelect={selectApp}
                            onRead={markRead}
                            reads={reads[identityId] || []}
                            showRead={canEditResearch(role)}
                          />
                        ) : (
                          <Empty />
                        )}
                        <Pager
                          {...page}
                          onPage={(page) => setEventFilter((f) => ({ ...f, page }))}
                        />
                      </>
                    );
                  })()}
                </>
              )}
              {(route.page === 'library' || route.page === 'following') && (
                <>
                  <PageHeading
                    title={route.page === 'following' ? '我的关注' : '应用库'}
                    description={
                      route.page === 'following'
                        ? `${workspace.name} · 空间共享关注，研究决策集中保存。`
                        : '检索、比较与持续观察各市场的信贷应用。'
                    }
                  >
                    <button
                      className="secondary"
                      onClick={() => go({ page: 'compare' })}
                      disabled={compare.length < 2}
                    >
                      <GitCompareArrows size={16} />
                      对比 {compare.length}/4
                    </button>
                    {workspace && (
                      <button
                        className="primary"
                        disabled={!canEditResearch(role)}
                        title={canEditResearch(role) ? '' : '只读成员不能申请收录'}
                        onClick={() => setDialog({ kind: 'intake' })}
                      >
                        <Plus size={16} />
                        申请收录
                      </button>
                    )}
                  </PageHeading>
                  {route.page === 'following' && (
                    <div className="filters">
                      <Field label="关注分组">
                        <select
                          value={followGroup}
                          onChange={(e) => {
                            setFollowGroup(e.target.value);
                            setLibrary((l) => ({ ...l, page: 1 }));
                          }}
                        >
                          <option value="">全部关注</option>
                          {workspace.groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <button
                        className="secondary"
                        disabled={!canEditResearch(role)}
                        onClick={() => setDialog({ kind: 'group' })}
                      >
                        创建分组
                      </button>
                      {followGroup && (
                        <button
                          className="text-button"
                          disabled={!canEditResearch(role)}
                          onClick={() =>
                            setDialog({
                              kind: 'group',
                              group: workspace.groups.find((g) => g.id === followGroup),
                            })
                          }
                        >
                          管理 / 重命名分组
                        </button>
                      )}
                    </div>
                  )}
                  <div className="library-toolbar">
                    <div className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="搜索应用"
                        placeholder="搜索应用、开发者或包名"
                        value={library.q}
                        onChange={(e) => changeLibrary('q', e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="应用市场"
                      value={library.country}
                      onChange={(e) => changeLibrary('country', e.target.value)}
                    >
                      <option value="">全部市场</option>
                      {model.markets.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="应用商店"
                      value={library.store}
                      onChange={(e) => changeLibrary('store', e.target.value)}
                    >
                      <option value="">全部商店</option>
                      {Object.entries(stores).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="信贷类型"
                      value={library.loanType}
                      onChange={(e) => changeLibrary('loanType', e.target.value)}
                    >
                      <option value="personal">个人现金贷</option>
                      <option value="">全部信贷类型</option>
                      <option value="business">经营贷</option>
                      <option value="mortgage">房贷</option>
                    </select>
                    <details className="advanced-filters">
                      <summary>
                        <SlidersHorizontal size={16} />
                        更多筛选
                      </summary>
                      <div>
                        <Field label="最低评分">
                          <input
                            type="number"
                            min="0"
                            max="5"
                            step="0.1"
                            value={library.score}
                            onChange={(e) => changeLibrary('score', e.target.value)}
                          />
                        </Field>
                        <Field label="累计安装量至少">
                          <input
                            type="number"
                            min="0"
                            value={library.installs}
                            onChange={(e) => changeLibrary('installs', e.target.value)}
                          />
                        </Field>
                        <Field label="商店发布日期从">
                          <input
                            type="date"
                            value={library.from}
                            onChange={(e) => changeLibrary('from', e.target.value)}
                          />
                        </Field>
                        <Field label="截至">
                          <input
                            type="date"
                            value={library.to}
                            onChange={(e) => changeLibrary('to', e.target.value)}
                          />
                        </Field>
                        <button className="text-button" onClick={() => setLibrary(defaultLibrary)}>
                          重置所有筛选
                        </button>
                      </div>
                    </details>
                  </div>
                  <div className="list-meta">
                    <span>清单保持不变，检测结果需点击右上角更新才应用。</span>
                    <label>
                      排序
                      <select
                        aria-label="排序字段"
                        value={library.sort}
                        onChange={(e) => changeLibrary('sort', e.target.value)}
                      >
                        {sortFields.map(([k, n]) => (
                          <option key={k} value={k}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="icon-button"
                      aria-label="切换排序方向"
                      title={library.direction === 'asc' ? '当前升序' : '当前降序'}
                      onClick={() =>
                        changeLibrary('direction', library.direction === 'asc' ? 'desc' : 'asc')
                      }
                    >
                      <ArrowUpDown size={16} />
                    </button>
                    <span>{library.direction === 'asc' ? '升序' : '降序'} · 缺失值始终置后</span>
                  </div>
                  {(() => {
                    const pool =
                      route.page === 'following'
                        ? model.apps.filter(
                            (a) =>
                              workspace.following.includes(a.id) &&
                              (!followGroup ||
                                workspace.groups
                                  .find((g) => g.id === followGroup)
                                  ?.appIds.includes(a.id)),
                          )
                        : model.apps;
                    const filtered = visibleApps(pool, library, library.sort, library.direction),
                      page = paginate(filtered, library.page);
                    return (
                      <>
                        <div className="results-summary">
                          {page.total} 个应用 ·{' '}
                          {library.loanType === 'personal' ? '个人现金贷' : '全部选定类型'}
                        </div>
                        {page.rows.length ? (
                          <div className="table-scroll">
                            <table className="library-table">
                              <thead>
                                <tr>
                                  <th />
                                  <th>应用 / 开发者</th>
                                  <th>市场 / 商店</th>
                                  <th>评分</th>
                                  <th>累计安装</th>
                                  <th>商店发布时间</th>
                                  <th>最近更新时间</th>
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {page.rows.map((a) => (
                                  <tr key={a.id} data-app-id={a.id}>
                                    <td>
                                      <input
                                        aria-label={`对比 ${a.title}`}
                                        type="checkbox"
                                        checked={compare.includes(a.id)}
                                        onChange={() => toggleCompare(a.id)}
                                      />
                                    </td>
                                    <td>
                                      <div className="library-app-identity">
                                        <AppIcon app={a} />
                                        <div className="library-app-copy">
                                          <button
                                            id={`app-${a.id}`}
                                            className="app-title"
                                            onClick={() => selectApp(a.id)}
                                          >
                                            {a.title}
                                          </button>
                                          <small>{a.developer}</small>
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <CountryLabel code={a.country} />
                                      <small>{stores[a.store]}</small>
                                    </td>
                                    <td>
                                      {a.score ?? '未提供'}
                                      <small>{formatNumber(a.ratings)} 人评分</small>
                                    </td>
                                    <td>
                                      {a.store === 'app-store'
                                        ? '未公开'
                                        : formatNumber(a.minInstalls)}
                                      <small>
                                        {a.store === 'google-play' ? '累计 · 非国别' : '不可视为 0'}
                                      </small>
                                    </td>
                                    <td>{dateText(a.releasedAt)}</td>
                                    <td>{dateText(a.storeUpdatedAt)}</td>
                                    <td>
                                      <button
                                        className={`icon-button ${workspace?.following.includes(a.id) ? 'is-followed' : ''}`}
                                        aria-label={`${workspace?.following.includes(a.id) ? '取消关注' : '关注'} ${a.title}`}
                                        disabled={!canEditResearch(role) || !workspace}
                                        onClick={() => toggleFollow(a.id)}
                                      >
                                        <Star size={17} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <Empty>
                            <button
                              className="secondary"
                              onClick={() => setLibrary(defaultLibrary)}
                            >
                              重置筛选
                            </button>
                          </Empty>
                        )}
                        <Pager {...page} onPage={(page) => setLibrary((l) => ({ ...l, page }))} />
                      </>
                    );
                  })()}
                </>
              )}
              {route.page === 'detail' && currentApp && (
                <>
                  <Back onClick={back}>
                    返回{pageLabels[history.current.at(-1)?.route.page] || '应用库'}
                  </Back>
                  <PageHeading
                    title={currentApp.title}
                    description={
                      <AppExternalLink url={storeSource(currentApp)} className="store-app-link">
                        {currentApp.externalId} · {stores[currentApp.store]}
                      </AppExternalLink>
                    }
                  >
                    {workspace && (
                      <button
                        className="secondary"
                        disabled={!canEditResearch(role)}
                        onClick={() => setDialog({ kind: 'app-to-collection', app: currentApp })}
                      >
                        加入集合
                      </button>
                    )}
                    <button className="secondary" onClick={() => toggleCompare(currentApp.id)}>
                      <GitCompareArrows size={16} />
                      {compare.includes(currentApp.id) ? '移出对比' : '加入对比'}
                    </button>
                    {workspace && (
                      <button
                        className="primary"
                        disabled={!canEditResearch(role)}
                        onClick={() => toggleFollow(currentApp.id)}
                      >
                        <Star size={16} />
                        {workspace.following.includes(currentApp.id) ? '已关注 · 取消' : '关注应用'}
                      </button>
                    )}
                  </PageHeading>
                  <div className="detail-meta">
                    <CountryLabel code={currentApp.country} full />
                    <Tag>
                      已确认信贷 · {currentApp.loanType === 'personal' ? '个人现金贷' : '其他信贷'}
                    </Tag>
                    <span>{currentApp.developer}</span>
                    <SourceNote />
                  </div>
                  {route.eventId && (
                    <div className="context-banner">
                      从具体事件进入：
                      {eventLabels[model.events.find((e) => e.id === route.eventId)?.type]} ·{' '}
                      {model.events.find((e) => e.id === route.eventId)?.at}
                      <button className="text-button" onClick={() => setDetailTab('changes')}>
                        查看该事件证据
                      </button>
                    </div>
                  )}
                  <div className="tabs">
                    {[
                      ['overview', '基本信息'],
                      ['terms', '信贷与主体'],
                      ['permissions', '权限声明'],
                      ['changes', '变化记录'],
                      ['reviews', '评价样本'],
                      ['research', '研究笔记'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        className={detailTab === key ? 'active' : ''}
                        onClick={() => setDetailTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {detailTab === 'overview' && (
                    <>
                      <div className="detail-grid">
                        <section className="panel">
                          <h2>应用介绍</h2>
                          <p className="long-text">{currentApp.description}</p>
                          <dl className="app-resource-links">
                            <div className="app-resource-link-row">
                              <dt>官网</dt>
                              <dd>
                                <AppExternalLink url={currentApp.websiteUrl} />
                              </dd>
                            </div>
                            <div className="app-resource-link-row">
                              <dt>隐私协议</dt>
                              <dd>
                                <AppExternalLink url={currentApp.privacyUrl} />
                              </dd>
                            </div>
                          </dl>
                          <p className="fine-print">
                            示例链接，仅演示导航；不代表该应用实际官网或法律文本。
                          </p>
                          <div className="actions">
                            <button
                              className="text-button"
                              disabled={!canEditResearch(role)}
                              onClick={() =>
                                setDialog({
                                  kind: 'excerpt',
                                  app: currentApp,
                                  text: currentApp.description,
                                  source: currentApp.source,
                                })
                              }
                            >
                              摘录到研究空间 <BookOpen size={15} />
                            </button>
                            <button
                              className="text-button"
                              disabled={!canEditResearch(role)}
                              onClick={() => setDialog({ kind: 'note', app: currentApp })}
                            >
                              添加研究备注
                            </button>
                          </div>
                          <h3>版本 {currentApp.version}</h3>
                          <p>{currentApp.releaseNotes}</p>
                        </section>
                        <aside className="panel">
                          <h2>当前观测</h2>
                          <dl className="facts">
                            <dt>评分</dt>
                            <dd>{currentApp.score ?? '未提供'} / 5</dd>
                            <dt>评分人数</dt>
                            <dd>{formatNumber(currentApp.ratings)}</dd>
                            <dt>公开累计安装</dt>
                            <dd>
                              {currentApp.store === 'app-store'
                                ? 'App Store 未公开'
                                : formatNumber(currentApp.minInstalls)}
                            </dd>
                            <dt>首次发现</dt>
                            <dd>{dateText(currentApp.firstSeenAt)}</dd>
                            <dt>商店发布日期</dt>
                            <dd>{dateText(currentApp.releasedAt)}</dd>
                            <dt>最近成功采集</dt>
                            <dd>{currentApp.lastFetchedAt}</dd>
                          </dl>
                          <p className="fine-print">
                            Google Play
                            安装是公开累计指标，非国别下载。评分人数不等于可获取的文字评论数。
                          </p>
                        </aside>
                      </div>
                      <section className="panel screenshots">
                        <div className="section-heading">
                          <h2>商店截图</h2>
                          <span className="muted">原型示例 · 非真实商店图</span>
                        </div>
                        {currentApp.screenshotNote && (
                          <p className="fine-print">{currentApp.screenshotNote}</p>
                        )}
                        {currentApp.screenshots.length ? (
                          <div className="screenshot-grid">
                            {currentApp.screenshots.map((src, i) => (
                              <button
                                id={`screenshot-${i}`}
                                key={src}
                                onClick={() =>
                                  setLightbox({
                                    images: currentApp.screenshots,
                                    index: i,
                                    appTitle: currentApp.title,
                                  })
                                }
                              >
                                <img
                                  src={src}
                                  alt={`${currentApp.title} 原型示例截图 ${i + 1}，非真实商店图`}
                                  onError={(e) => {
                                    e.currentTarget.hidden = true;
                                    e.currentTarget.nextSibling.hidden = false;
                                  }}
                                />
                                <span hidden>示例图片加载失败 · 点击可重试预览</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <Empty
                            title="该示例尚无商店截图"
                            description="未取得图片不代表商店没有图片。"
                          />
                        )}
                      </section>
                      <DemoSource app={currentApp} />
                    </>
                  )}
                  {detailTab === 'terms' && (
                    <>
                      <div className="detail-grid">
                        <section className="panel">
                          <h2>信贷条款摘录</h2>
                          <dl className="facts">
                            <dt>产品类型</dt>
                            <dd>
                              {currentApp.loanType === 'personal'
                                ? '个人现金贷'
                                : currentApp.loanType === 'business'
                                  ? '经营贷'
                                  : '房贷'}
                            </dd>
                            <dt>金额范围</dt>
                            <dd>5,000–50,000 · 示例当地货币</dd>
                            <dt>期限</dt>
                            <dd>90–180 天</dd>
                            <dt>利率 / 费用</dt>
                            <dd>来源未提供，不推断</dd>
                          </dl>
                          <p className="fine-print">
                            仅展示虚构描述中的声明，不构成金融建议或持牌结论。
                          </p>
                          <button
                            className="text-button"
                            disabled={!canEditResearch(role)}
                            onClick={() =>
                              setDialog({
                                kind: 'excerpt',
                                app: currentApp,
                                text: '示例申请金额 5,000–50,000，当地货币；期限 90–180 天。',
                                source: currentApp.source,
                              })
                            }
                          >
                            保存条款摘录
                          </button>
                        </section>
                        <section className="panel">
                          <h2>发布主体与识别</h2>
                          <dl className="facts">
                            <dt>商店发布账号</dt>
                            <dd>{currentApp.developer}</dd>
                            <dt>商店声明公司</dt>
                            <dd>{currentApp.seller}</dd>
                            <dt>识别方式</dt>
                            <dd>
                              {currentApp.classificationSource === 'manual'
                                ? '人工确认'
                                : '描述规则自动确认'}
                            </dd>
                            <dt>规则版本</dt>
                            <dd>{currentApp.ruleVersion}</dd>
                            <dt>证据评分</dt>
                            <dd>{currentApp.confidence}/100（非概率）</dd>
                            <dt>牌照 / 合规</dt>
                            <dd>未核验，不能由信贷识别推断</dd>
                          </dl>
                        </section>
                      </div>
                      <DemoSource app={currentApp} />
                      <Evidence value={currentApp} label="查看全部应用示例字段" />
                    </>
                  )}
                  {detailTab === 'permissions' && (
                    <section className="panel">
                      <PageHeading
                        title="商店声明 / 返回的权限"
                        description="不是实际授权、APK Manifest 或 iOS 权限审计。SDK 类型编号不表示风险等级。"
                      />
                      {currentApp.store === 'app-store' ? (
                        <>
                          <Empty
                            title="App Store 此接口不支持权限清单"
                            description="不支持不等于零权限；隐私声明也不能替代系统实际授权。"
                          />
                          <h3>另列：商店隐私披露示例</h3>
                          <p>
                            开发者声明可能处理联系方式与诊断数据；未独立核验。此内容不代表系统权限清单。
                          </p>
                          <Evidence
                            value={{
                              status: 'available',
                              source: currentApp.source,
                              observedAt: currentApp.lastFetchedAt,
                              data: {
                                contactInformation: '开发者声明 · 示例',
                                diagnostics: '开发者声明 · 示例',
                              },
                            }}
                            label="隐私披露原始示例"
                          />
                        </>
                      ) : (
                        <>
                          <div className="context-banner">
                            状态：
                            {currentApp.permissionStatus === 'failed'
                              ? '本次采集失败，保留上次成功资料'
                              : currentApp.permissionStatus === 'uncollected'
                                ? '尚未采集'
                                : currentApp.permissions.length
                                  ? '已取得商店返回内容'
                                  : '来源返回空清单'}{' '}
                            ·{' '}
                            {currentApp.permissionStatus === 'uncollected'
                              ? '没有成功资料时间'
                              : `成功资料观测 ${currentApp.permissionFetchedAt}`}
                            {currentApp.permissionStatus === 'failed' && (
                              <p>
                                最近失败：{currentApp.lastFetchedAt} · {currentApp.permissionError}
                                ；旧资料来源：{currentApp.source}
                              </p>
                            )}
                          </div>
                          {currentApp.permissions.length ? (
                            <>
                              <div className="permission-grid">
                                {currentApp.permissions
                                  .slice(0, permissionExpanded ? undefined : 6)
                                  .map((p, i) => (
                                    <article className="permission-card" key={i}>
                                      <h3>
                                        {typeof p === 'string'
                                          ? p
                                          : p.permission || p.title || p.name || '来源字段'}
                                      </h3>
                                      <p>
                                        {typeof p === 'object'
                                          ? p.group || '商店声明'
                                          : '商店返回权限字符串'}
                                      </p>
                                      {typeof p === 'object' && (
                                        <p>
                                          {p.description ||
                                            `SDK 类型：${p.type ?? '未提供'}（非风险分数）`}
                                        </p>
                                      )}
                                    </article>
                                  ))}
                              </div>
                              <button
                                className="text-button"
                                onClick={() => setPermissionExpanded((v) => !v)}
                              >
                                {permissionExpanded
                                  ? '收起权限清单'
                                  : `展开全部 ${currentApp.permissions.length} 项权限`}
                              </button>
                            </>
                          ) : (
                            <Empty
                              title={
                                currentApp.permissionStatus === 'uncollected'
                                  ? '尚未采集权限声明'
                                  : '本次来源返回空权限清单'
                              }
                              description={
                                currentApp.permissionStatus === 'uncollected'
                                  ? '没有资料不等于没有权限。'
                                  : '空清单不证明该应用不申请权限。'
                              }
                            />
                          )}
                          <Evidence value={currentApp.permissions} label="完整权限原始示例字段" />
                        </>
                      )}
                    </section>
                  )}
                  {detailTab === 'changes' && (
                    <section className="panel">
                      <h2>变化与观测来源</h2>
                      {model.events
                        .filter((e) => e.appId === currentApp.id)
                        .map((e) => (
                          <article
                            className={`change-entry ${route.eventId === e.id ? 'selected' : ''}`}
                            key={e.id}
                          >
                            <div className="section-heading">
                              <h3>
                                {eventLabels[e.type]}{' '}
                                {route.eventId === e.id && <Tag>本次选中事件</Tag>}
                              </h3>
                              <span>{e.at}</span>
                            </div>
                            <p>{e.before ? `${e.before} → ${e.after}` : e.summary}</p>
                            {e.type === 'updated' && (
                              <p>{e.field === 'version' ? currentApp.releaseNotes : e.summary}</p>
                            )}
                            <p className="fine-print">
                              观测：{e.observedAt} ·{' '}
                              {e.type === 'storeRelease'
                                ? '商店日期精度：日；此处时间为发现发布信息的观测时间。'
                                : '事件记录对应此次示例来源。'}
                            </p>
                            <button
                              className="text-button"
                              disabled={!canEditResearch(role)}
                              onClick={() =>
                                setDialog({
                                  kind: 'excerpt',
                                  app: currentApp,
                                  text: `${eventLabels[e.type]}：${e.before ? e.before + ' → ' + e.after : e.summary}`,
                                  source: e.source,
                                  eventId: e.id,
                                })
                              }
                            >
                              摘录此事件
                            </button>
                            <Evidence value={e} label="查看该事件完整来源" />
                          </article>
                        ))}
                      <DemoSource app={currentApp} />
                    </section>
                  )}
                  {detailTab === 'reviews' && (
                    <section className="panel">
                      <h2>用户评价样本</h2>
                      <p className="fine-print">
                        以下均为虚构演示文本。请求国家 /
                        语言不等于用户所在地；样本不代表全部用户意见。
                      </p>
                      {currentApp.reviews.map((r) => (
                        <article className="change-entry" key={r.id}>
                          <strong>{r.score} / 5</strong>
                          <span className="muted"> · {r.date}</span>
                          <p>{r.text}</p>
                          <button
                            className="text-button"
                            disabled={!canEditResearch(role)}
                            onClick={() =>
                              setDialog({
                                kind: 'excerpt',
                                app: currentApp,
                                text: r.text,
                                source: currentApp.source,
                              })
                            }
                          >
                            摘录评价
                          </button>
                        </article>
                      ))}
                      <Evidence value={currentApp.reviews} />
                    </section>
                  )}
                  {detailTab === 'research' && (
                    <section className="panel">
                      <div className="section-heading">
                        <h2>{workspace ? workspace.name : '客户私有研究'} · 笔记</h2>
                        {workspace && (
                          <button
                            className="primary"
                            disabled={!canEditResearch(role)}
                            onClick={() => setDialog({ kind: 'note', app: currentApp })}
                          >
                            添加备注
                          </button>
                        )}
                      </div>
                      {workspace ? (
                        <>
                          {workspace.notes
                            .filter((n) => n.appId === currentApp.id)
                            .map((n) => (
                              <article className="change-entry" key={n.id}>
                                <p className="long-text">{n.text}</p>
                                <small>
                                  {n.author} · {n.date}
                                </small>
                                {n.source && (
                                  <Evidence
                                    value={{ source: n.source, eventId: n.eventId }}
                                    label="摘录来源"
                                  />
                                )}
                                <div className="actions">
                                  <button
                                    className="text-button"
                                    disabled={!canEditResearch(role)}
                                    onClick={() =>
                                      setDialog({
                                        kind: 'note',
                                        app: currentApp,
                                        note: n,
                                        text: n.text,
                                      })
                                    }
                                  >
                                    编辑
                                  </button>
                                  <button
                                    className="text-button danger"
                                    disabled={!canEditResearch(role)}
                                    onClick={() =>
                                      editWorkspace((w) => ({
                                        ...w,
                                        notes: w.notes.filter((x) => x.id !== n.id),
                                        collections: w.collections.map((c) => ({
                                          ...c,
                                          noteIds: c.noteIds.filter((id) => id !== n.id),
                                        })),
                                      }))
                                    }
                                  >
                                    删除
                                  </button>
                                </div>
                              </article>
                            ))}
                          {!workspace.notes.some((n) => n.appId === currentApp.id) && (
                            <Empty title="当前空间尚无该应用笔记" />
                          )}
                        </>
                      ) : (
                        <Empty
                          title="平台运营不默认读取客户私有研究"
                          description="可切换客户演示身份体验对应空间；这不是实际登录或安全边界。"
                        />
                      )}
                    </section>
                  )}
                </>
              )}
              {route.page === 'compare' && (
                <>
                  <Back onClick={back} />
                  <PageHeading
                    title="应用对比"
                    description="最多 4 个市场身份；缺失值和不支持状态保留原义。"
                  >
                    <button className="secondary" onClick={() => nav('library')}>
                      继续选择应用
                    </button>
                  </PageHeading>
                  {compare.length >= 2 ? (
                    <div className="table-scroll">
                      <table className="compare-table">
                        <thead>
                          <tr>
                            <th>对比项目</th>
                            {compare.map((id) => {
                              const a = model.apps.find((x) => x.id === id);
                              return (
                                <th key={id}>
                                  <button className="app-title" onClick={() => selectApp(id)}>
                                    {a.title}
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={`移除 ${a.title}`}
                                    onClick={() => toggleCompare(id)}
                                  >
                                    <X size={14} />
                                  </button>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ['市场', (a) => a.country.toUpperCase()],
                            ['商店', (a) => stores[a.store]],
                            ['发布账号', (a) => a.developer],
                            ['声明公司', (a) => a.seller],
                            [
                              '产品类型',
                              (a) => (a.loanType === 'personal' ? '个人现金贷' : '其他信贷'),
                            ],
                            ['贷款期限', () => '90–180 天（示例）'],
                            ['金额', () => '5,000–50,000 当地货币（示例）'],
                            ['评分', (a) => a.score ?? '未提供'],
                            [
                              '累计安装',
                              (a) =>
                                a.store === 'app-store' ? '未公开' : formatNumber(a.minInstalls),
                            ],
                            ['商店发布', (a) => dateText(a.releasedAt)],
                            [
                              '权限来源',
                              (a) =>
                                a.store === 'app-store'
                                  ? '接口不支持'
                                  : a.permissionStatus === 'failed'
                                    ? '失败 · 保留旧资料'
                                    : `${a.permissions.length} 项商店声明`,
                            ],
                            ['观测时间', (a) => a.lastFetchedAt],
                            ['来源', (a) => a.source],
                          ].map(([label, value]) => (
                            <tr key={label}>
                              <th>{label}</th>
                              {compare.map((id) => (
                                <td key={id}>{value(model.apps.find((a) => a.id === id))}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title="请选择至少 2 个应用"
                      description="返回应用库勾选应用，同一次最多比较 4 个。"
                    />
                  )}
                </>
              )}
              {route.page === 'research' && workspace && (
                <>
                  <PageHeading
                    title="研究空间"
                    description={`${workspace.name} · 私有研究在本客户空间共享，公共市场数据不受影响。`}
                  >
                    <button
                      className="secondary"
                      onClick={() =>
                        download(
                          `${workspace.name}-示例研究.md`,
                          exportResearch(workspace, model.apps),
                        )
                      }
                    >
                      <Download size={16} />
                      导出示例研究
                    </button>
                    <button
                      className="primary"
                      disabled={!canEditResearch(role)}
                      onClick={() => setDialog({ kind: 'collection' })}
                    >
                      <Plus size={16} />
                      新建集合
                    </button>
                  </PageHeading>
                  <div className="collection-grid">
                    {workspace.collections.map((c) => (
                      <section className="panel" key={c.id}>
                        <div className="section-heading">
                          <h2>{c.name}</h2>
                          <button
                            className="icon-button"
                            aria-label={`编辑集合 ${c.name}`}
                            disabled={!canEditResearch(role)}
                            onClick={() => setDialog({ kind: 'collection', collection: c })}
                          >
                            <Edit3 size={16} />
                          </button>
                        </div>
                        <p className="muted">
                          {c.appIds.length} 个应用 · {c.noteIds.length} 条摘录
                        </p>
                        {c.appIds.map((id) => {
                          const a = model.apps.find((x) => x.id === id);
                          return (
                            a && (
                              <div className="collection-app" key={id}>
                                <button
                                  id={`collection-${c.id}-${id}`}
                                  className="app-title"
                                  onClick={() => selectApp(id)}
                                >
                                  {a.title}
                                </button>
                                <button
                                  className="icon-button"
                                  aria-label={`从 ${c.name} 移除 ${a.title}`}
                                  disabled={!canEditResearch(role)}
                                  onClick={() =>
                                    editWorkspace((w) => ({
                                      ...w,
                                      collections: w.collections.map((x) =>
                                        x.id === c.id
                                          ? { ...x, appIds: x.appIds.filter((aid) => aid !== id) }
                                          : x,
                                      ),
                                    }))
                                  }
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            )
                          );
                        })}
                        {c.noteIds.map((id) => {
                          const n = workspace.notes.find((n) => n.id === id);
                          return (
                            n && (
                              <blockquote key={id}>
                                {n.text}
                                <small>{n.source}</small>
                              </blockquote>
                            )
                          );
                        })}
                        <button
                          className="text-button"
                          disabled={!canEditResearch(role)}
                          onClick={() => setDialog({ kind: 'collection-add', collection: c })}
                        >
                          添加应用或摘录
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            download(
                              `${c.name}-示例.md`,
                              exportResearch(
                                {
                                  ...workspace,
                                  collections: [c],
                                  notes: workspace.notes.filter((n) => c.noteIds.includes(n.id)),
                                },
                                model.apps,
                              ),
                            )
                          }
                        >
                          导出本集合
                        </button>
                      </section>
                    ))}
                  </div>
                  <section className="panel">
                    <h2>全部研究备注与摘录</h2>
                    {workspace.notes.map((n) => (
                      <article className="change-entry" key={n.id}>
                        <button
                          className="app-title"
                          onClick={() => {
                            go({ page: 'detail', id: n.appId });
                            setDetailTab('research');
                          }}
                        >
                          {model.apps.find((a) => a.id === n.appId)?.title}
                        </button>
                        <p>{n.text}</p>
                        <small>
                          {n.author} · {n.date}
                        </small>
                        {n.source && (
                          <Evidence
                            value={{ source: n.source, eventId: n.eventId }}
                            label="摘录来源"
                          />
                        )}
                      </article>
                    ))}
                  </section>
                  <section className="panel">
                    <h2>我的收录申请</h2>
                    {workspace.requests.length ? (
                      workspace.requests.map((r) => (
                        <article className="collection-app" key={r.id}>
                          <div>
                            <strong>{r.externalId}</strong>
                            <small>
                              {r.country.toUpperCase()} · {stores[r.store]} · {statusText(r.status)}
                            </small>
                          </div>
                          {r.appId && (
                            <button className="text-button" onClick={() => selectApp(r.appId)}>
                              查看已收录应用
                            </button>
                          )}
                        </article>
                      ))
                    ) : (
                      <Empty
                        title="暂无收录申请"
                        description="在应用库中可申请收录尚未发现的市场身份。"
                      />
                    )}
                  </section>
                </>
              )}
              {route.page === 'candidates' && (
                <>
                  <PageHeading
                    title="候选审核"
                    description="独立候选池不计入主库；人工确认后公共清单与市场计数同步。"
                  >
                    <SourceNote />
                  </PageHeading>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>候选应用</th>
                          <th>市场 / 商店</th>
                          <th>证据</th>
                          <th>状态</th>
                          <th>审核操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.candidates.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.title}</strong>
                              <small>{c.externalId}</small>
                            </td>
                            <td>
                              <CountryLabel code={c.country} />
                              <small>{stores[c.store]}</small>
                            </td>
                            <td>
                              {c.reason}
                              <small>{c.verdict} · 示例规则证据</small>
                            </td>
                            <td>
                              <Tag>{statusText(c.status)}</Tag>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                disabled={c.status !== 'pending'}
                                onClick={() => approveCandidate(c)}
                              >
                                确认收录
                              </button>
                              <button
                                className="text-button danger"
                                disabled={c.status !== 'pending'}
                                onClick={() => {
                                  if (canOperate(role))
                                    setModel((m) => ({
                                      ...m,
                                      candidates: m.candidates.map((x) =>
                                        x.id === c.id ? { ...x, status: 'excluded' } : x,
                                      ),
                                    }));
                                }}
                              >
                                排除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {route.page === 'rules' && (
                <>
                  <PageHeading
                    title="识别规则"
                    description="规则编辑仅作用于本原型；人工判断优先，不据此推断持牌或合规。"
                  />
                  {model.rules.map((r) => (
                    <section className="panel" key={r.id}>
                      <div className="section-heading">
                        <h2>{r.name}</h2>
                        <label>
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={(e) => {
                              if (canOperate(role))
                                setModel((m) => ({
                                  ...m,
                                  rules: m.rules.map((x) =>
                                    x.id === r.id ? { ...x, enabled: e.target.checked } : x,
                                  ),
                                }));
                            }}
                          />
                          启用
                        </label>
                      </div>
                      <p>{r.description}</p>
                      <p className="muted">规则版本 {r.version}</p>
                      <button
                        className="secondary"
                        onClick={() => setDialog({ kind: 'rule', rule: r })}
                      >
                        编辑规则
                      </button>
                    </section>
                  ))}
                </>
              )}
              {route.page === 'diagnostics' && (
                <>
                  <PageHeading
                    title="发现诊断"
                    description="查询具体市场身份的示例发现状态；未发现不等于商店不存在。"
                  />
                  <form
                    className="filters"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      setDiagnostic({
                        country: f.get('country'),
                        store: f.get('store'),
                        externalId: String(f.get('externalId')).trim(),
                      });
                    }}
                  >
                    <Field label="国家">
                      <select name="country">
                        {model.markets.map((c) => (
                          <option value={c.code} key={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="商店">
                      <select name="store">
                        {Object.entries(stores).map(([k, v]) => (
                          <option value={k} key={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="包名 / 应用 ID">
                      <input name="externalId" required placeholder="com.th.creditdemo1" />
                    </Field>
                    <button className="primary">查询身份</button>
                  </form>
                  {diagnostic &&
                    (() => {
                      const a = model.apps.find(
                        (a) =>
                          a.country === diagnostic.country &&
                          a.store === diagnostic.store &&
                          a.externalId === diagnostic.externalId,
                      );
                      return (
                        <section className="panel">
                          <h2>{a ? '已收录' : '尚未发现该身份'}</h2>
                          <p>{diagnostic.externalId}</p>
                          {a ? (
                            <>
                              <button className="text-button" onClick={() => selectApp(a.id)}>
                                查看应用详情
                              </button>
                              <DemoSource app={a} />
                            </>
                          ) : (
                            <>
                              <p>
                                公开榜单、搜索和关联目录均有来源范围；不能把未发现判断为商店下架。
                              </p>
                              <button
                                className="primary"
                                onClick={() =>
                                  setDialog({ kind: 'operator-intake', ...diagnostic })
                                }
                              >
                                模拟核对并收录此身份
                              </button>
                            </>
                          )}
                        </section>
                      );
                    })()}
                  <section className="panel">
                    <h2>客户收录申请</h2>
                    {Object.entries(model.workspaces).flatMap(([space, w]) =>
                      w.requests.map((r) => (
                        <article className="collection-app" key={r.id}>
                          <div>
                            <strong>
                              {w.name} · {r.externalId}
                            </strong>
                            <small>
                              {r.country.toUpperCase()} · {stores[r.store]} · {statusText(r.status)}
                            </small>
                          </div>
                          {r.status === 'pending' && (
                            <button
                              className="text-button"
                              onClick={() => setDialog({ kind: 'operator-intake', ...r, space })}
                            >
                              核对并处理
                            </button>
                          )}
                        </article>
                      )),
                    )}
                    <p className="fine-print">
                      仅显示客户提交给平台的申请，不读取其私有备注、关注与集合。
                    </p>
                  </section>
                </>
              )}
              {route.page === 'tasks' && (
                <>
                  <PageHeading
                    title="采集任务"
                    description="队列状态、错误与重试为本地模拟，不向商店发送请求。"
                  >
                    <button
                      className="primary"
                      onClick={() => {
                        if (canOperate(role))
                          setModel((m) => ({
                            ...m,
                            tasks: [
                              ...m.tasks,
                              {
                                id: `task-${Date.now()}`,
                                name: '手动示例资料更新',
                                status: 'queued',
                                at: '12:00',
                                error: null,
                              },
                            ],
                          }));
                      }}
                    >
                      创建示例任务
                    </button>
                  </PageHeading>
                  {model.tasks.map((t) => (
                    <section className="panel" key={t.id}>
                      <div className="section-heading">
                        <h2>{t.name}</h2>
                        <Tag kind={t.status}>{statusText(t.status)}</Tag>
                      </div>
                      <p>
                        {t.id} · 最近尝试 {t.at}
                      </p>
                      {t.error && <p className="error-text">{t.error}</p>}
                      {t.status !== 'succeeded' && (
                        <button
                          className="secondary"
                          onClick={() => {
                            if (canOperate(role))
                              setModel((m) => ({
                                ...m,
                                tasks: m.tasks.map((x) =>
                                  x.id === t.id
                                    ? {
                                        ...x,
                                        status: 'succeeded',
                                        error: null,
                                        at: '12:00',
                                        previousError: x.error,
                                        attempts: (x.attempts || 1) + 1,
                                      }
                                    : x,
                                ),
                              }));
                            notify('示例任务执行完成，旧错误保留在记录中。');
                          }}
                        >
                          {t.status === 'failed' ? '重试示例任务' : '执行示例任务'}
                        </button>
                      )}
                      <Evidence value={t} />
                    </section>
                  ))}
                </>
              )}
              {route.page === 'markets' && (
                <>
                  <PageHeading
                    title="市场设置"
                    description="启用状态、关键词和新增市场只在本次原型状态中保存。"
                  >
                    <button className="primary" onClick={() => setDialog({ kind: 'market' })}>
                      添加市场
                    </button>
                  </PageHeading>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>市场</th>
                          <th>关键词</th>
                          <th>资料更新</th>
                          <th>状态</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {model.markets.map((c) => (
                          <tr key={c.code}>
                            <td>
                              <CountryLabel code={c.code} />
                              <small>{c.name}</small>
                            </td>
                            <td>{c.keywords}</td>
                            <td>每 {c.interval} 小时</td>
                            <td>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={c.enabled}
                                  onChange={(e) => {
                                    if (canOperate(role))
                                      setModel((m) => ({
                                        ...m,
                                        markets: m.markets.map((x) =>
                                          x.code === c.code
                                            ? { ...x, enabled: e.target.checked }
                                            : x,
                                        ),
                                      }));
                                  }}
                                />
                                {c.enabled ? '启用' : '暂停'}
                              </label>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => setDialog({ kind: 'market', market: c })}
                              >
                                编辑
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {route.page === 'members' && (
                <>
                  <PageHeading
                    title={canOperate(role) ? '客户与成员' : '空间成员'}
                    description="演示邀请只修改本地状态，不发送邮件，不代表真实鉴权。"
                  />
                  {Object.entries(model.workspaces)
                    .filter(([id]) => canOperate(role) || id === identity.space)
                    .map(([space, w]) => (
                      <section className="panel" key={space}>
                        <div className="section-heading">
                          <h2>{w.name}</h2>
                          {canOperate(role) && (
                            <button
                              className="text-button"
                              onClick={() => setDialog({ kind: 'customer', space })}
                            >
                              编辑客户
                            </button>
                          )}
                          <button
                            className="primary"
                            onClick={() => setDialog({ kind: 'invite', space })}
                          >
                            邀请成员
                          </button>
                        </div>
                        {w.members.map((member) => (
                          <article className="collection-app" key={member.id}>
                            <div>
                              <strong>{member.name}</strong>
                              <small>
                                {member.email} · {roles[member.role]} ·{' '}
                                {member.status === 'pending'
                                  ? '待接受邀请'
                                  : member.status === 'revoked'
                                    ? '已撤销'
                                    : '已加入'}
                              </small>
                            </div>
                            {member.status !== 'pending' && member.status !== 'revoked' && (
                              <button
                                className="text-button"
                                onClick={() => setDialog({ kind: 'member', space, member })}
                              >
                                编辑角色 / 移除
                              </button>
                            )}
                            {member.status === 'pending' && (
                              <div className="actions">
                                <button
                                  className="text-button"
                                  onClick={() => changeMember(space, member.id, 'active')}
                                >
                                  模拟接受
                                </button>
                                <button
                                  className="text-button danger"
                                  onClick={() => changeMember(space, member.id, 'revoked')}
                                >
                                  撤销邀请
                                </button>
                              </div>
                            )}
                          </article>
                        ))}
                      </section>
                    ))}
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <SourceNote />
            <span>公开市场资料与客户私有研究分开 · 演示身份切换并非真实登录</span>
          </footer>
        </main>
      </div>
      {compare.length > 0 && route.page !== 'compare' && (
        <div className="compare-dock">
          <GitCompareArrows size={18} />
          <span>已选 {compare.length}/4 个应用</span>
          <button
            className="primary"
            disabled={compare.length < 2}
            onClick={() => go({ page: 'compare' })}
          >
            开始对比
          </button>
          <button className="icon-button" aria-label="清空对比" onClick={() => setCompare([])}>
            <X size={18} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
      {dialog && (
        <Dialog
          title={
            {
              note: '研究备注',
              excerpt: '保存来源摘录',
              collection: dialog.collection ? '编辑集合' : '新建研究集合',
              'collection-add': '添加到研究集合',
              intake: '申请收录应用',
              'operator-intake': '核对并收录 · 示例',
              rule: '编辑识别规则',
              market: '市场配置',
              invite: '邀请演示成员',
              reset: '重置示例数据',
              group: '关注分组',
              'app-to-collection': '加入研究集合',
              member: '编辑空间成员',
              customer: '编辑示例客户',
              export: '导出预览 · 示例 Markdown',
            }[dialog.kind]
          }
          onClose={() => setDialog(null)}
        >
          {renderDialog()}
        </Dialog>
      )}
    </div>
  );
  function changeMember(space, id, status) {
    if (!canOperate(role) && !(canManageMembers(role) && space === identity.space))
      return notify('无该空间管理权限。');
    setModel((m) => ({
      ...m,
      workspaces: {
        ...m.workspaces,
        [space]: {
          ...m.workspaces[space],
          members: m.workspaces[space].members.map((x) => (x.id === id ? { ...x, status } : x)),
        },
      },
    }));
  }
  function renderDialog() {
    if (dialog.kind === 'group')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              name = String(f.get('name')).trim(),
              appIds = f.getAll('apps');
            if (!name) return;
            editWorkspace((w) => ({
              ...w,
              groups: dialog.group
                ? w.groups.map((g) => (g.id === dialog.group.id ? { ...g, name, appIds } : g))
                : [...w.groups, { id: `group-${Date.now()}`, name, appIds }],
            }));
            setDialog(null);
          }}
        >
          <Field label="分组名称">
            <input name="name" required defaultValue={dialog.group?.name || ''} />
          </Field>
          <Field label="已关注应用（可多选）">
            <select name="apps" multiple size={7} defaultValue={dialog.group?.appIds || []}>
              {workspace.following.map((id) => {
                const a = model.apps.find((a) => a.id === id);
                return (
                  <option key={id} value={id}>
                    {a?.title}
                  </option>
                );
              })}
            </select>
          </Field>
          <div className="actions">
            <button className="primary">保存分组</button>
            {dialog.group && (
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  editWorkspace((w) => ({
                    ...w,
                    groups: w.groups.filter((g) => g.id !== dialog.group.id),
                  }));
                  setFollowGroup('');
                  setDialog(null);
                }}
              >
                删除分组（保留关注）
              </button>
            )}
          </div>
        </form>
      );
    if (dialog.kind === 'app-to-collection')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const id = new FormData(e.currentTarget).get('collection');
            editWorkspace((w) => ({
              ...w,
              collections: w.collections.map((c) =>
                c.id === id ? { ...c, appIds: [...new Set([...c.appIds, dialog.app.id])] } : c,
              ),
            }));
            setDialog(null);
            notify('应用已加入当前空间集合。');
          }}
        >
          <p>{dialog.app.title}</p>
          <Field label="研究集合">
            <select name="collection">
              {workspace.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <button className="primary">加入集合</button>
        </form>
      );
    if (dialog.kind === 'member')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateMember(dialog.space, dialog.member.id, {
              role: new FormData(e.currentTarget).get('role'),
            });
            setDialog(null);
          }}
        >
          <p>
            {dialog.member.name} · {dialog.member.email}
          </p>
          <Field label="角色">
            <select name="role" defaultValue={dialog.member.role}>
              <option value="admin">客户管理员</option>
              <option value="researcher">研究员</option>
              <option value="viewer">只读成员</option>
            </select>
          </Field>
          <div className="actions">
            <button className="primary">保存角色</button>
            <button
              className="text-button danger"
              type="button"
              onClick={() => {
                updateMember(dialog.space, dialog.member.id, { status: 'revoked' });
                setDialog(null);
              }}
            >
              移除成员
            </button>
          </div>
          <p className="fine-print">
            本地成员记录的变更不代表实际账户授权；左下角七个固定身份用于独立体验角色。
          </p>
        </form>
      );
    if (dialog.kind === 'customer')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canOperate(role)) return;
            const name = String(new FormData(e.currentTarget).get('name')).trim();
            if (!name) return;
            setModel((m) => ({
              ...m,
              workspaces: {
                ...m.workspaces,
                [dialog.space]: { ...m.workspaces[dialog.space], name },
              },
            }));
            setDialog(null);
          }}
        >
          <Field label="客户空间名称">
            <input name="name" required defaultValue={model.workspaces[dialog.space].name} />
          </Field>
          <p className="fine-print">修改示例客户资料，不读取该空间的私有笔记。</p>
          <button className="primary">保存客户资料</button>
        </form>
      );
    if (dialog.kind === 'export')
      return (
        <>
          <p>
            <strong>{dialog.name}</strong>
          </p>
          <p className="fine-print">
            以下是本次所选空间 / 集合的完整导出内容。浏览器可能限制下载，可复制或全选后保存为
            Markdown。内容均为示例。
          </p>
          <Field label="完整 Markdown 内容">
            <textarea
              id="export-content"
              className="export-preview"
              aria-label="完整 Markdown 内容"
              readOnly
              rows={16}
              value={dialog.content}
            />
          </Field>
          <div className="actions">
            <button
              className="primary"
              onClick={() => triggerDownload(dialog.name, dialog.content)}
            >
              发起文件下载
            </button>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(dialog.content);
                  notify('完整示例内容已复制。');
                } catch {
                  const field = document.getElementById('export-content');
                  field.focus();
                  field.select();
                  let copied = false;
                  try {
                    copied = document.execCommand('copy');
                  } catch {}
                  notify(copied ? '完整示例内容已复制。' : '已选中完整内容，请使用系统复制命令。');
                }
              }}
            >
              复制完整内容
            </button>
            <button
              className="text-button"
              onClick={() => {
                const field = document.getElementById('export-content');
                field.focus();
                field.select();
              }}
            >
              全选内容
            </button>
          </div>
        </>
      );
    if (dialog.kind === 'reset')
      return (
        <>
          <p>这会清除本地演示操作，恢复 132 主库应用、12 候选与全部初始事件。生产资料不受影响。</p>
          <button
            className="primary"
            onClick={() => {
              setModel(createFixtures());
              setPending(null);
              setReads({});
              setCompare([]);
              setLibrary(defaultLibrary);
              setDay(DEMO_DAY);
              setDialog(null);
              nav('home');
            }}
          >
            确认重置示例
          </button>
        </>
      );
    if (['note', 'excerpt'].includes(dialog.kind))
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canEditResearch(role)) return;
            const f = new FormData(e.currentTarget);
            const text = String(f.get('text')).trim();
            if (!text) return;
            editWorkspace((w) => ({
              ...w,
              notes: dialog.note
                ? w.notes.map((n) => (n.id === dialog.note.id ? { ...n, text } : n))
                : [
                    ...w.notes,
                    {
                      id: `note-${Date.now()}`,
                      appId: dialog.app.id,
                      text,
                      source: dialog.source || dialog.app.source,
                      eventId: dialog.eventId || null,
                      author: identity.name,
                      date: DEMO_DAY,
                    },
                  ],
            }));
            setDialog(null);
            notify('已保存到当前客户空间。');
          }}
        >
          <p>{dialog.app.title}</p>
          <Field label={dialog.kind === 'excerpt' ? '摘录内容（保留来源）' : '备注内容'}>
            <textarea name="text" required rows={6} defaultValue={dialog.text || ''} />
          </Field>
          <p className="fine-print">{dialog.source || dialog.app.source}</p>
          <button className="primary">保存{dialog.kind === 'excerpt' ? '摘录' : '备注'}</button>
        </form>
      );
    if (dialog.kind === 'collection')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get('name')).trim();
            if (!name) return;
            editWorkspace((w) => ({
              ...w,
              collections: dialog.collection
                ? w.collections.map((c) => (c.id === dialog.collection.id ? { ...c, name } : c))
                : [
                    ...w.collections,
                    { id: `collection-${Date.now()}`, name, appIds: [], noteIds: [] },
                  ],
            }));
            setDialog(null);
          }}
        >
          <Field label="集合名称">
            <input name="name" required defaultValue={dialog.collection?.name || ''} />
          </Field>
          <div className="actions">
            <button className="primary">保存集合</button>
            {dialog.collection && (
              <button
                type="button"
                className="text-button danger"
                onClick={() => {
                  editWorkspace((w) => ({
                    ...w,
                    collections: w.collections.filter((c) => c.id !== dialog.collection.id),
                  }));
                  setDialog(null);
                }}
              >
                删除集合
              </button>
            )}
          </div>
        </form>
      );
    if (dialog.kind === 'collection-add')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            editWorkspace((w) => ({
              ...w,
              collections: w.collections.map((c) =>
                c.id === dialog.collection.id
                  ? {
                      ...c,
                      appIds: [...new Set([...c.appIds, ...f.getAll('apps')])],
                      noteIds: [...new Set([...c.noteIds, ...f.getAll('notes')])],
                    }
                  : c,
              ),
            }));
            setDialog(null);
          }}
        >
          <Field label="选择应用（可多选）">
            <select name="apps" multiple size={7}>
              {model.apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.country.toUpperCase()} · {a.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="选择来源摘录">
            <select name="notes" multiple size={4}>
              {workspace.notes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.text}
                </option>
              ))}
            </select>
          </Field>
          <button className="primary">加入集合</button>
        </form>
      );
    if (['intake', 'operator-intake'].includes(dialog.kind))
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              values = {
                country: String(f.get('country')),
                store: String(f.get('store')),
                externalId: String(f.get('externalId')).trim(),
                title: String(f.get('title')).trim() || '待核对应用 Demo',
              };
            if (dialog.kind === 'intake') return requestIntake(values);
            if (!canOperate(role)) return;
            setModel((m) => {
              const candidate = {
                ...values,
                id: `intake-${values.country}-${values.store}-${values.externalId}`,
                status: 'pending',
              };
              const existing = m.apps.find(
                (a) =>
                  a.country === values.country &&
                  a.store === values.store &&
                  a.externalId === values.externalId,
              );
              const next = existing
                ? m
                : admitCandidate({ ...m, candidates: [...m.candidates, candidate] }, candidate.id);
              const app = next.apps.find(
                (a) =>
                  a.country === values.country &&
                  a.store === values.store &&
                  a.externalId === values.externalId,
              );
              return dialog.space
                ? {
                    ...next,
                    workspaces: {
                      ...next.workspaces,
                      [dialog.space]: {
                        ...next.workspaces[dialog.space],
                        requests: next.workspaces[dialog.space].requests.map((r) =>
                          r.id === dialog.id ? { ...r, status: 'approved', appId: app.id } : r,
                        ),
                      },
                    },
                  }
                : next;
            });
            setDialog(null);
            notify('模拟资料核对并收录完成；没有发起真实商店采集。');
          }}
        >
          <Field label="国家">
            <select name="country" defaultValue={dialog.country || 'th'}>
              {model.markets.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="商店">
            <select name="store" defaultValue={dialog.store || 'google-play'}>
              {Object.entries(stores).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="包名 / 应用 ID">
            <input name="externalId" required defaultValue={dialog.externalId || library.q} />
          </Field>
          <Field label="应用名称 / 核对备注">
            <input name="title" defaultValue={dialog.title || ''} />
          </Field>
          <p className="fine-print">
            {dialog.kind === 'intake'
              ? '提交后可在研究空间查看状态；切换平台运营到发现诊断处理。'
              : '模拟确认描述中存在个人信贷证据，并创建有来源的演示应用。'}
          </p>
          <button className="primary">
            {dialog.kind === 'intake' ? '提交收录申请' : '模拟确认并收录'}
          </button>
        </form>
      );
    if (dialog.kind === 'rule')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canOperate(role)) return;
            const f = new FormData(e.currentTarget);
            setModel((m) => ({
              ...m,
              rules: m.rules.map((r) =>
                r.id === dialog.rule.id
                  ? {
                      ...r,
                      name: String(f.get('name')),
                      description: String(f.get('description')),
                      version: String(f.get('version')),
                    }
                  : r,
              ),
            }));
            setDialog(null);
          }}
        >
          <Field label="规则名称">
            <input name="name" required defaultValue={dialog.rule.name} />
          </Field>
          <Field label="版本">
            <input name="version" required defaultValue={dialog.rule.version} />
          </Field>
          <Field label="识别条件">
            <textarea name="description" required rows={4} defaultValue={dialog.rule.description} />
          </Field>
          <button className="primary">保存规则</button>
        </form>
      );
    if (dialog.kind === 'market')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canOperate(role)) return;
            const f = new FormData(e.currentTarget),
              code = String(f.get('code')).toLowerCase();
            if (!dialog.market && model.markets.some((c) => c.code === code))
              return notify('该市场代码已存在。');
            const value = {
              code,
              name: String(f.get('name')),
              keywords: String(f.get('keywords')),
              interval: 1,
              enabled: true,
              recent: '暂无示例观测',
            };
            setModel((m) => ({
              ...m,
              markets: dialog.market
                ? m.markets.map((c) => (c.code === dialog.market.code ? { ...c, ...value } : c))
                : [...m.markets, value],
            }));
            setDialog(null);
          }}
        >
          <Field label="国家代码（ISO 两位）">
            <input
              name="code"
              required
              pattern="[a-zA-Z]{2}"
              readOnly={!!dialog.market}
              defaultValue={dialog.market?.code || ''}
            />
          </Field>
          <Field label="国家名称">
            <input name="name" required defaultValue={dialog.market?.name || ''} />
          </Field>
          <Field label="本地关键词">
            <input name="keywords" required defaultValue={dialog.market?.keywords || ''} />
          </Field>
          <p>资料更新每 1 小时；扩展发现每 6 小时（演示配置）。</p>
          <button className="primary">保存市场</button>
        </form>
      );
    if (dialog.kind === 'invite')
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canOperate(role) && !(canManageMembers(role) && dialog.space === identity.space))
              return;
            const f = new FormData(e.currentTarget),
              member = {
                id: `member-${Date.now()}`,
                name: String(f.get('name')),
                email: String(f.get('email')),
                role: String(f.get('role')),
                status: 'pending',
              };
            if (!isCustomerRole(member.role)) return notify('客户邀请不能设置平台或未知角色。');
            setModel((m) => ({
              ...m,
              workspaces: {
                ...m.workspaces,
                [dialog.space]: {
                  ...m.workspaces[dialog.space],
                  members: [...m.workspaces[dialog.space].members, member],
                },
              },
            }));
            setDialog(null);
            notify('演示邀请已创建，未发送邮件。');
          }}
        >
          <Field label="姓名">
            <input name="name" required />
          </Field>
          <Field label="邮箱">
            <input name="email" type="email" required />
          </Field>
          <Field label="空间角色">
            <select name="role">
              <option value="researcher">研究员</option>
              <option value="viewer">只读成员</option>
              <option value="admin">客户管理员</option>
            </select>
          </Field>
          <button className="primary">创建演示邀请</button>
        </form>
      );
    return null;
  }
}

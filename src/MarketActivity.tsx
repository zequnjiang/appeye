import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Clock3,
  ExternalLink,
  Globe2,
  Layers3,
  LoaderCircle,
  Radar,
  RefreshCw,
} from 'lucide-react';
import { api, query } from './api';
import type { Country } from './types';
import type {
  MarketEventType as EventType,
  MarketActivityEvent as ActivityEvent,
  MarketActivityResponse as ActivityResponse,
  CollectionStatus,
} from '../server/market-activity';

const TIME_ZONE = 'Asia/Shanghai';
const flags: Record<string, string> = {
  th: '🇹🇭',
  mx: '🇲🇽',
  ph: '🇵🇭',
  pk: '🇵🇰',
  id: '🇮🇩',
  ar: '🇦🇷',
};
const stores = { 'google-play': 'Google Play', 'app-store': 'App Store' };
const classes: Record<string, string> = {
  confirmed: '已确认信贷',
  candidate: '待确认',
  excluded: '已排除',
};
const fields: Record<string, string> = {
  version: '版本',
  releaseNotes: '更新说明',
  description: '应用描述',
  summary: '简介',
  title: '应用名称',
  developer: '开发者',
  score: '评分',
  ratings: '评分人数',
  reviews: '评论数量',
  installs: '公开累计安装量',
  minInstalls: '累计安装量下限',
  maxInstalls: '累计安装量上限',
  releasedAt: '商店发布日期',
  storeUpdatedAt: '商店更新时间',
  price: '价格',
  currency: '币种',
  icon: '应用图标',
  url: '商店链接',
  privacyPolicy: '隐私政策',
};
const tabs = [
  { id: 'firstSeen' as const, label: '新发现', description: '当天首次进入本系统', icon: Radar },
  {
    id: 'storeRelease' as const,
    label: '商店发布',
    description: '商店标注在当天发布',
    icon: CalendarDays,
  },
  {
    id: 'observedUpdate' as const,
    label: '应用更新',
    description: '当天观测到的资料变化',
    icon: Activity,
  },
];
const formatNumber = (n: number | undefined) =>
  n === undefined ? '—' : new Intl.NumberFormat('zh-CN').format(n);
const today = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const dateShift = (day: string, shift: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + shift);
  return date.toISOString().slice(0, 10);
};
function timestamp(value: string | null | undefined) {
  if (!value) return '未提供';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(+date)
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: TIME_ZONE,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
}
const textValue = (value: unknown) =>
  value === null || value === undefined
    ? '未提供'
    : typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value);
function safeUrl(value: string | null | undefined) {
  try {
    const url = new URL(value || '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function useResource<T>(path: string, version: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const previousPath = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    if (previousPath.current !== path) setData(null);
    previousPath.current = path;
    setLoading(true);
    setError('');
    api<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '数据读取失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, version]);
  return { data, error, loading };
}
function EventIcon({ event }: { event: ActivityEvent }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`app-icon ${event.store === 'app-store' ? 'blue' : ''}`}>
      {safeUrl(event.icon) && !failed ? (
        <img
          src={safeUrl(event.icon)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{event.title.slice(0, 1) || 'A'}</span>
      )}
    </div>
  );
}
function FieldComparison({ change }: { change: ActivityEvent['changes'][number] }) {
  const before = textValue(change.oldValue),
    after = textValue(change.newValue);
  const short =
    before.length < 100 && after.length < 100 && !before.includes('\n') && !after.includes('\n');
  return (
    <details className="activity-comparison" open={short}>
      <summary>
        <strong>{fields[change.field] || change.field}</strong>
        <span>{short ? '前后对照' : `查看完整前后内容 · ${formatNumber(after.length)} 字符`}</span>
        <ChevronDown size={15} />
      </summary>
      <div className="activity-comparison-values">
        <div>
          <span>上次记录</span>
          <pre>{before}</pre>
        </div>
        <div>
          <span>本次记录</span>
          <pre>{after}</pre>
        </div>
      </div>
    </details>
  );
}
function EventCard({
  event,
  countryName,
  onSelect,
}: {
  event: ActivityEvent;
  countryName: string;
  onSelect: (id: number) => void;
}) {
  const release = event.releasedAt;
  const source = safeUrl(event.sourceUrl);
  const versionChange = event.versionChanged;
  return (
    <article className="activity-event">
      <div className="activity-event-top">
        <button className="activity-app-link" onClick={() => onSelect(event.appId)}>
          <EventIcon event={event} />
          <span>
            <strong>{event.title}</strong>
            <small>
              {flags[event.country] || '🌐'} {countryName} <span>·</span> {stores[event.store]}
            </small>
          </span>
          <ArrowUpRight size={16} />
        </button>
        <div className="activity-event-tags">
          <span
            className={`badge ${event.type === 'firstSeen' ? 'teal' : event.type === 'storeRelease' ? 'neutral' : 'amber'}`}
          >
            {event.type === 'firstSeen'
              ? '首次发现'
              : event.type === 'storeRelease'
                ? '商店标注发布'
                : versionChange
                  ? '版本与资料变化'
                  : '资料变化'}
          </span>
          <span className="badge neutral">
            {classes[event.classification] || event.classification}
          </span>
        </div>
      </div>
      <div className="activity-event-dates">
        <span>
          <Clock3 size={13} />
          {event.type === 'firstSeen'
            ? '首次发现'
            : event.type === 'storeRelease'
              ? '商店发布'
              : '观测时间'}
          ：{timestamp(event.type === 'storeRelease' ? release : event.eventAt)}
        </span>
        {event.type !== 'observedUpdate' && <span>实际观测：{timestamp(event.observedAt)}</span>}
        {event.type === 'observedUpdate' && (
          <span>
            商店更新时间：{event.storeUpdatedAt ? timestamp(event.storeUpdatedAt) : '未提供'}
          </span>
        )}
        {event.type === 'firstSeen' && (
          <span>商店发布日期：{release ? timestamp(release) : '未提供'}</span>
        )}
      </div>
      {event.changes.length > 0 && (
        <div className="activity-event-changes">
          {event.changes.map((change) => (
            <FieldComparison key={change.field} change={change} />
          ))}
        </div>
      )}
      {event.releaseNotes && !event.changes.some((c) => c.field === 'releaseNotes') && (
        <details className="activity-release-notes">
          <summary>
            查看商店更新说明 <ChevronDown size={14} />
          </summary>
          <pre>{event.releaseNotes}</pre>
        </details>
      )}
      <footer className="activity-event-footer">
        <span>{event.snapshotId ? `来源快照 #${event.snapshotId}` : '来源：系统首次发现记录'}</span>
        <div>
          {source && (
            <a href={source} target="_blank" rel="noreferrer">
              商店来源 <ExternalLink size={12} />
            </a>
          )}
          <button onClick={() => onSelect(event.appId)}>
            应用与历史资料 <ArrowRight size={13} />
          </button>
        </div>
      </footer>
    </article>
  );
}

export function MarketActivity({
  version,
  countries,
  onSelect,
  onJobs,
}: {
  version: number;
  countries: Country[];
  onSelect: (id: number) => void;
  onJobs: () => void;
}) {
  const [day, setDay] = useState(today);
  const [followToday, setFollowToday] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);
  const [type, setType] = useState<EventType>('firstSeen');
  const [country, setCountry] = useState('');
  const [store, setStore] = useState('');
  const [classification, setClassification] = useState('');
  const [offset, setOffset] = useState(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const limit = 20;
  const path =
    '/market-activity' + query({ date: day, country, store, classification, type, offset, limit });
  const { data, error, loading } = useResource<ActivityResponse>(path, version + retryVersion);
  const status = useResource<CollectionStatus>('/collection/status', version + retryVersion);
  const filter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setOffset(0);
  };
  const cycle = status.data?.activeCycle ?? status.data?.lastCycle;
  const chooseDate = (value: string) => {
    setDay(value);
    setFollowToday(value === today());
    setOffset(0);
  };
  useEffect(() => {
    if (followToday && day !== today()) {
      setDay(today());
      setOffset(0);
    }
  }, [version, followToday, day]);
  useEffect(() => {
    if (data && !loading && offset > 0 && offset >= data.total)
      setOffset(Math.max(0, Math.floor((data.total - 1) / limit) * limit));
  }, [data, loading, offset]);
  const selectedTab = tabs.find((tab) => tab.id === type)!;
  const pending = cycle ? cycle.queued + cycle.running : 0;
  const heartbeat = status.data?.collector.lastHeartbeatAt;
  const staleHeartbeat = !heartbeat || Date.now() - Date.parse(heartbeat) > 180000;
  return (
    <div className="market-activity-page">
      <div className="section-heading activity-heading">
        <div>
          <span className="eyebrow">DAILY MARKET ACTIVITY</span>
          <h1>市场动态</h1>
          <p>新发现、商店发布与应用变化，按国家逐日查看。</p>
        </div>
        <div className="activity-date-control">
          <div>
            <button
              className="icon-button"
              aria-label="前一天"
              onClick={() => chooseDate(dateShift(day, -1))}
            >
              <ArrowLeft size={16} />
            </button>
            <label>
              <CalendarDays size={16} />
              <input
                aria-label="动态日期"
                type="date"
                value={day}
                onChange={(e) => chooseDate(e.target.value || today())}
              />
            </label>
            <button
              className="icon-button"
              aria-label="后一天"
              onClick={() => chooseDate(dateShift(day, 1))}
            >
              <ArrowRight size={16} />
            </button>
            <button className="button secondary" onClick={() => chooseDate(today())}>
              今天
            </button>
          </div>
          <span>北京时间 · Asia/Shanghai（UTC+8）</span>
        </div>
      </div>

      <section
        className={`activity-monitor ${status.error || status.data?.overdue || staleHeartbeat ? 'attention' : ''}`}
        aria-label="自动监测状态"
      >
        <div className="activity-monitor-title">
          <span className="activity-monitor-icon">
            <RefreshCw size={18} />
          </span>
          <div>
            <strong>
              {status.data
                ? status.data.enabled
                  ? `每 ${status.data.intervalMinutes} 分钟自动监测`
                  : '自动监测已暂停'
                : '自动监测状态'}
            </strong>
            <p>
              {status.error
                ? '暂时无法读取调度状态'
                : !status.data
                  ? '正在读取运行状态…'
                  : staleHeartbeat
                    ? '采集进程心跳未更新，请查看运行状态'
                    : status.data.overdue
                      ? '本轮仍有待处理工作，完成时间受采集队列影响'
                      : '持续发现应用并刷新详情，按实际采集结果生成动态'}
            </p>
          </div>
        </div>
        <dl>
          <div>
            <dt>最近成功观测</dt>
            <dd>
              {status.data
                ? status.data.lastSuccessAt
                  ? timestamp(status.data.lastSuccessAt)
                  : '尚无成功观测'
                : '读取中…'}
            </dd>
          </div>
          <div>
            <dt>下次调度</dt>
            <dd>
              {status.data?.enabled
                ? status.data.nextDueAt
                  ? timestamp(status.data.nextDueAt)
                  : '待首次调度'
                : '—'}
            </dd>
          </div>
        </dl>
        <button
          className="activity-monitor-jobs"
          aria-expanded={showSchedule}
          aria-controls="hourly-collection-progress"
          onClick={() => setShowSchedule((shown) => !shown)}
        >
          {cycle
            ? `${formatNumber(pending)} 待处理 · ${formatNumber(cycle.failed)} 失败`
            : '查看监测进度'}
          <ChevronDown size={15} />
        </button>
      </section>
      {showSchedule && (
        <section
          className="activity-schedule-detail"
          id="hourly-collection-progress"
          aria-label="小时采集进度"
        >
          <div className="activity-schedule-heading">
            <strong>{status.data?.activeCycle ? '当前监测周期' : '最近监测周期'}</strong>
            <span>
              {cycle
                ? `计划于 ${timestamp(cycle.dueAt)} · 已完成 ${formatNumber(cycle.succeeded)} / ${formatNumber(cycle.total)} 项`
                : '尚无周期记录'}
            </span>
          </div>
          {cycle && (
            <dl className="activity-schedule-counts">
              {[
                ['待执行', cycle.queued],
                ['执行中', cycle.running],
                ['成功', cycle.succeeded],
                ['失败', cycle.failed],
                ['已跳过', cycle.skipped],
              ].map(([name, count]) => (
                <div key={String(name)}>
                  <dt>{name}</dt>
                  <dd>{formatNumber(Number(count))}</dd>
                </div>
              ))}
            </dl>
          )}
          {status.data && (
            <p>
              {formatNumber(status.data.overdueApps)}{' '}
              个应用尚未在最近一小时内成功刷新。任务按限速执行，周期开始不代表采集已经完成。
            </p>
          )}
          {!!status.data?.failures.length && (
            <div className="activity-schedule-failures">
              <strong>最近采集失败</strong>
              {status.data.failures.map((failure) => (
                <div key={failure.id}>
                  <span>
                    {flags[failure.country] || '🌐'}{' '}
                    {countries.find((item) => item.code === failure.country)?.name ||
                      failure.country}{' '}
                    · {stores[failure.store]} · {failure.kind === 'detail' ? '详情' : '发现'} ·
                    已尝试 {failure.attempts} 次
                  </span>
                  <pre>{failure.error}</pre>
                  {failure.appId && (
                    <button onClick={() => onSelect(failure.appId!)}>
                      查看关联应用 <ArrowUpRight size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {status.error && <p role="alert">{status.error}</p>}
          <button className="button secondary" onClick={onJobs}>
            查看手动采集任务 <ArrowUpRight size={13} />
          </button>
        </section>
      )}
      {status.data?.batch &&
        (status.data.batch.pending > 0 || status.data.batch.reviewFailed > 0) && (
          <p className="activity-batch-note">
            <Layers3 size={13} />
            <span>
              {status.data.batch.pending > 0 && (
                <>
                  历史资料补齐同时进行，剩余 {formatNumber(status.data.batch.pending)}{' '}
                  条分页任务；小时监测与它交替执行。
                </>
              )}
              {status.data.batch.reviewFailed > 0 && (
                <>
                  {' '}
                  评论失败待处理 {formatNumber(status.data.batch.reviewFailed)}{' '}
                  项，原游标与错误历史已保留。
                </>
              )}
            </span>
          </p>
        )}

      <div className="activity-view-tabs" role="group" aria-label="选择动态视图">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={type === tab.id ? 'selected' : ''}
            aria-pressed={type === tab.id}
            onClick={() => {
              setType(tab.id);
              setOffset(0);
            }}
          >
            <span className="activity-view-name">
              <tab.icon size={18} />
              {tab.label}
            </span>
            <strong>
              {formatNumber(data?.counts?.[tab.id])}
              <small> 个应用</small>
            </strong>
            <span className="activity-view-description">{tab.description}</span>
          </button>
        ))}
      </div>

      <section className="panel activity-feed">
        <div className="activity-filter-bar">
          <div className="activity-filter-selects">
            <label>
              <span>国家</span>
              <select
                aria-label="动态国家"
                value={country}
                onChange={(e) => filter(setCountry, e.target.value)}
              >
                <option value="">全部国家</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {flags[c.code] || '🌐'} {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>商店</span>
              <select
                aria-label="动态商店"
                value={store}
                onChange={(e) => filter(setStore, e.target.value)}
              >
                <option value="">两家商店</option>
                {Object.entries(stores).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>当前分类</span>
              <select
                aria-label="动态分类"
                value={classification}
                onChange={(e) => filter(setClassification, e.target.value)}
              >
                <option value="">全部分类</option>
                {Object.entries(classes).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="button secondary"
            onClick={() => setRetryVersion((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新数据
          </button>
        </div>
        <div className="activity-feed-caption">
          <strong>
            {data?.date || day} · {selectedTab.label}
          </strong>
          <span>
            {data
              ? `${formatNumber(data.total)} 条记录${data.uniqueApps === undefined ? '' : ` · ${formatNumber(data.uniqueApps)} 个应用`}`
              : '—'}
          </span>
        </div>
        <p className="activity-scope-note">
          {type === 'firstSeen'
            ? '首次发现指进入本系统的时间，历史应用也可能今天才被发现。'
            : type === 'storeRelease'
              ? '仅列出有商店发布日期的已跟踪应用，不证明该国首次上架，也不代表完整上架名单。'
              : '按系统观测日展示。评分与资料变化不等于发布新版本；累计安装量不是该国当日下载量。'}
          分类按当前状态筛选。
        </p>
        {error && (
          <div className="error-box" role="alert">
            <AlertCircle size={17} />
            <span>
              {error}
              {data ? '；下方仍为上次读取结果。' : ''}
            </span>
            <button onClick={() => setRetryVersion((value) => value + 1)}>重试</button>
          </div>
        )}
        {!data && loading ? (
          <div className="loading" role="status">
            <LoaderCircle size={20} className="spin" />
            正在读取当日动态
          </div>
        ) : data?.events.length ? (
          <>
            <div className="activity-events" aria-busy={loading}>
              {data.events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  countryName={
                    countries.find((c) => c.code === event.country)?.name ||
                    event.country.toUpperCase()
                  }
                  onSelect={onSelect}
                />
              ))}
            </div>
            <div className="pagination">
              <span>
                共 {formatNumber(data.total)} 条 · {offset + 1}–
                {Math.min(offset + limit, data.total)}
              </span>
              <div>
                <button
                  className="icon-button"
                  aria-label="上一页动态"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="下一页动态"
                  disabled={offset + limit >= data.total || loading}
                  onClick={() => setOffset(offset + limit)}
                >
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          !error && (
            <div className="empty activity-empty">
              <span className="empty-symbol">
                <selectedTab.icon size={25} />
              </span>
              <h3>这一天暂无{selectedTab.label === '应用更新' ? '观测变化' : selectedTab.label}</h3>
              <p>
                {type === 'storeRelease'
                  ? '没有匹配的商店发布日期，或来源未提供日期。可切换到「新发现」查看当天新纳入的应用。'
                  : type === 'firstSeen'
                    ? '未发现符合这些筛选条件的新应用。可以切换日期、国家或分类继续查看。'
                    : '后续成功采集发现字段变化后，会在实际观测日期下显示。'}
              </p>
            </div>
          )
        )}
      </section>
      <p className="activity-footnote">
        <Globe2 size={13} />
        按国家与商店分别跟踪。同一应用可出现在多个视图，视图计数不应直接相加。页面刷新只读取数据，不会重复发起商店采集。
      </p>
    </div>
  );
}

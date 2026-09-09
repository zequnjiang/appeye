import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Bookmark,
  Check,
  RefreshCw,
  Search,
  SlidersHorizontal,
  FileDown,
} from 'lucide-react';
import { query, apiText, ApiError } from './api';
import { useResource } from './use-resource';
import { useMarket, marketKey, expireMarketSnapshot, revokeMarketScope } from './market-cache';
import {
  captureLibraryReading,
  restoreLibraryReading,
  type LibraryReading,
} from './library-reading';
import {
  Busy,
  EmptyState,
  ErrorNotice,
  Flag,
  Heading,
  Icon,
  Pager,
  ScopeSelect,
  count,
  time,
  storeLabels,
  eventLabels,
  businessToday,
  External,
  downloadText,
} from './ResearchUI';
import {
  scopeLabels,
  sortLabels,
  categoryLabels,
  type LibraryQuery,
  type LoanScope,
  type ResearchActivity,
} from './research-types';
import type { Country, MarketApp } from './types';
import type { MarketActivityEvent } from '../server/market-activity';
export interface EventView {
  date: string;
  country: string;
  store: string;
  loanScope: LoanScope;
  type: 'firstSeen' | 'storeRelease' | 'observedUpdate';
  offset: number;
}
export const defaultEventView: EventView = {
  date: businessToday(),
  country: '',
  store: '',
  loanScope: 'cash-priority',
  type: 'firstSeen',
  offset: 0,
};
export function EventRows({
  events,
  onSelect,
  readIds = [],
  onRead,
}: {
  events: MarketActivityEvent[];
  onSelect: (id: number, event?: MarketActivityEvent) => void;
  readIds?: string[];
  onRead?: (id: string, read: boolean) => void;
}) {
  return events.length ? (
    <div className="research-event-list">
      {events.map((e) => (
        <article
          key={e.id}
          className={readIds.includes(e.id) ? 'is-read' : ''}
          data-reading-id={e.id}
        >
          <span className={`event-mark ${e.type}`}>
            {e.type === 'observedUpdate' ? (
              <RefreshCw size={17} />
            ) : e.type === 'firstSeen' ? (
              <Search size={17} />
            ) : (
              <ArrowUp size={17} />
            )}
          </span>
          <div className="research-event-copy">
            <div className="research-event-title">
              <Flag country={e.country} />
              <button
                className="text-button"
                data-focus-key={`event-${e.id}`}
                onClick={() => onSelect(e.appId, e)}
              >
                {e.title || e.externalId}
              </button>
              <span className="research-tag">{eventLabels[e.type]}</span>
            </div>
            <p>
              {e.type === 'observedUpdate'
                ? (e.versionChanged ? '版本变化' : '资料变化') +
                  ' · ' +
                  e.changes.map((c) => c.field).join('、')
                : e.type === 'firstSeen'
                  ? '系统首次发现，与商店上架时间不同'
                  : '商店披露的发布日期'}{' '}
              · {storeLabels[e.store]}
            </p>
            <small>
              {time(e.eventAt || e.releasedAt, true)}
              {e.releasedAtPrecision === 'date' && e.type === 'storeRelease'
                ? ' · 仅日期精度'
                : ''}{' '}
              · 观测 {time(e.observedAt, true)}
            </small>
          </div>
          <div className="button-group">
            {onRead && (
              <button
                className="icon-button"
                aria-label={readIds.includes(e.id) ? '标记未读' : '标记已读'}
                onClick={() => onRead(e.id, !readIds.includes(e.id))}
              >
                <Check size={16} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label={`查看 ${e.title} ${eventLabels[e.type]}`}
              onClick={() => onSelect(e.appId, e)}
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </article>
      ))}
    </div>
  ) : (
    <EmptyState>该日期与筛选范围没有已记录动态。</EmptyState>
  );
}
export function MarketHome({
  countries,
  view,
  onView,
  onEvents,
  onSelect,
}: {
  countries: Country[];
  view: EventView;
  onView: (v: EventView) => void;
  onEvents: (v: EventView) => void;
  onSelect: (id: number, event?: MarketActivityEvent) => void;
}) {
  const { data, error } = useResource<ResearchActivity>(
    '/market/activity' +
      query({
        date: view.date,
        store: view.store,
        loanScope: view.loanScope,
        limit: 4,
        offset: 0,
        type: 'all',
      }),
  );
  return (
    <>
      <Heading title="今日市场" description="从每日变化，开始你的市场研究。">
        <input
          aria-label="市场日期"
          type="date"
          value={view.date}
          onChange={(e) => onView({ ...view, date: e.target.value })}
        />
        <ScopeSelect
          value={view.loanScope}
          onChange={(loanScope) => onView({ ...view, loanScope })}
        />
      </Heading>
      <div className="research-context">
        <span>北京时间 · {view.date}</span>
        <span>
          {scopeLabels[view.loanScope]} · 首次发现不等于新上架
          {data?.unknownTotal != null ? ` · 待细分 ${count(data.unknownTotal)} 项` : ''}
        </span>
        <select
          aria-label="市场商店"
          value={view.store}
          onChange={(e) => onView({ ...view, store: e.target.value })}
        >
          <option value="">两个商店</option>
          {Object.entries(storeLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrorNotice error={error} />
      {!data ? (
        <Busy />
      ) : (
        <>
          <div className="research-summary">
            {Object.entries(eventLabels).map(([type, label]) => (
              <button
                key={type}
                onClick={() =>
                  onEvents({ ...view, country: '', type: type as EventView['type'], offset: 0 })
                }
              >
                <span>{label}</span>
                <strong>{count(data.counts[type as keyof typeof data.counts])}</strong>
                <small>
                  {data.eventCounts[type as keyof typeof data.eventCounts]} 条事件 · 按市场应用去重
                </small>
              </button>
            ))}
          </div>
          <section className="research-section">
            <header>
              <h2>国家市场概览</h2>
              <small>同一日期与信贷范围</small>
            </header>
            <div className="table-scroll">
              <table className="research-table country-table">
                <thead>
                  <tr>
                    <th>国家 / 市场</th>
                    <th>已确认应用</th>
                    <th>首次发现</th>
                    <th>商店发布</th>
                    <th>观测更新</th>
                    <th>最近动态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.countries.map((c) => (
                    <tr key={c.country}>
                      <td>
                        <button
                          className="country-cell text-button"
                          onClick={() => onEvents({ ...view, country: c.country, offset: 0 })}
                        >
                          <Flag country={c.country} />
                          <span>
                            {c.name ||
                              countries.find((x) => x.code === c.country)?.name ||
                              c.country}
                            <small>{c.country.toUpperCase()}</small>
                          </span>
                        </button>
                      </td>
                      <td>{count(c.apps)}</td>
                      {(['firstSeen', 'storeRelease', 'observedUpdate'] as const).map((type) => (
                        <td key={type}>
                          <button
                            className="count-link"
                            onClick={() =>
                              onEvents({ ...view, country: c.country, type, offset: 0 })
                            }
                          >
                            {count(c.counts[type])}
                          </button>
                        </td>
                      ))}
                      <td>
                        {c.latestEvent ? (
                          <>
                            <button
                              className="text-button"
                              onClick={() => onSelect(c.latestEvent!.appId, c.latestEvent!)}
                            >
                              {c.latestEvent.title}
                            </button>
                            <small>
                              {eventLabels[c.latestEvent.type]} ·{' '}
                              {time(c.latestEvent.eventAt || c.latestEvent.releasedAt, true)}
                            </small>
                          </>
                        ) : c.latestEventAt ? (
                          <small>{time(c.latestEventAt, true)}</small>
                        ) : (
                          <span className="muted">该范围暂无动态</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`查看${c.name}市场`}
                          onClick={() => onEvents({ ...view, country: c.country, offset: 0 })}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="research-section">
            <header>
              <div>
                <h2>值得关注的动态</h2>
                <small>当前范围最新精选，最多 4 条 · 非全部事件</small>
              </div>
              <button className="text-button" onClick={() => onEvents({ ...view, offset: 0 })}>
                查看全部动态 <ArrowRight size={14} />
              </button>
            </header>
            <EventRows events={data.featuredEvents || []} onSelect={onSelect} />
          </section>
        </>
      )}
    </>
  );
}
export function EventsPage({
  countries,
  view,
  onView,
  onSelect,
  readIds,
  onRead,
}: {
  countries: Country[];
  view: EventView;
  onView: (v: EventView) => void;
  onSelect: (id: number, event?: MarketActivityEvent) => void;
  readIds: string[];
  onRead?: (id: string, read: boolean) => void;
}) {
  const { data, error } = useResource<ResearchActivity>(
    '/market/activity' + query({ ...view, limit: 20 }),
  );
  const change = (value: Partial<EventView>) => onView({ ...view, ...value, offset: 0 });
  return (
    <>
      <Heading
        title={
          view.country
            ? `${countries.find((c) => c.code === view.country)?.name || view.country.toUpperCase()}市场动态`
            : '市场动态'
        }
        description="查看实际来源与变化前后内容；按北京时间划分日期。"
      />
      <div className="research-filters">
        <input
          aria-label="动态日期"
          type="date"
          value={view.date}
          onChange={(e) => change({ date: e.target.value })}
        />
        <select
          aria-label="动态国家"
          value={view.country}
          onChange={(e) => change({ country: e.target.value })}
        >
          <option value="">全部国家</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="动态商店"
          value={view.store}
          onChange={(e) => change({ store: e.target.value })}
        >
          <option value="">全部商店</option>
          {Object.entries(storeLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <ScopeSelect value={view.loanScope} onChange={(loanScope) => change({ loanScope })} />
      </div>
      <div className="tabs">
        {Object.entries(eventLabels).map(([type, label]) => (
          <button
            key={type}
            className={view.type === type ? 'active' : ''}
            onClick={() => change({ type: type as EventView['type'] })}
          >
            {label} {data?.counts[type as keyof typeof data.counts] ?? '—'}
          </button>
        ))}
      </div>
      <ErrorNotice error={error} />
      {data ? (
        <>
          <p className="research-context">
            当前类型 {data.uniqueApps} 个市场应用 · {data.total} 条事件；同应用跨类型可重复出现。
          </p>
          <EventRows events={data.events} onSelect={onSelect} readIds={readIds} onRead={onRead} />
          <Pager
            offset={view.offset}
            limit={20}
            total={data.total}
            onChange={(offset) => onView({ ...view, offset })}
          />
        </>
      ) : (
        <Busy />
      )}
    </>
  );
}
export function MarketLibrary({
  countries,
  searchDraft,
  onSearchDraft,
  view,
  onView,
  onSelect,
  selected,
  onCompare,
  reading,
}: {
  countries: Country[];
  searchDraft: string;
  onSearchDraft: (s: string) => void;
  view: LibraryQuery;
  onView: (q: LibraryQuery) => void;
  onSelect: (id: number) => void;
  selected: number[];
  onCompare: (app: MarketApp) => void;
  reading: React.RefObject<LibraryReading | null>;
}) {
  const state = useMarket(view);
  const search = searchDraft,
    setSearch = onSearchDraft;
  const [more, setMore] = useState(false);
  const key = marketKey(view);
  const prior = useRef(state.data);
  const exportAbort = useRef<AbortController | null>(null);
  const [exportBusy, setExportBusy] = useState(false),
    [exportMessage, setExportMessage] = useState('');
  useEffect(() => {
    setExportBusy(false);
    setExportMessage('');
    return () => exportAbort.current?.abort();
  }, [key]);
  async function exportCsv() {
    if (!state.data || state.expired || exportBusy) return;
    const c = new AbortController();
    exportAbort.current = c;
    setExportBusy(true);
    setExportMessage('');
    try {
      const text = await apiText(
        '/market/apps.csv' + query({ ...view, snapshot: state.data.snapshot }),
        { signal: c.signal },
      );
      if (!c.signal.aborted) {
        downloadText(text, 'appeye-market-snapshot.csv', 'text/csv');
        setExportMessage('已发起当前冻结清单的 CSV 下载，请查看浏览器下载记录。');
      }
    } catch (e) {
      if (!c.signal.aborted) {
        setExportMessage((e as Error).message);
        if (e instanceof ApiError && e.code === 'SNAPSHOT_SCOPE_REVOKED')
          revokeMarketScope(e.message);
        else if (e instanceof ApiError && e.status === 410) expireMarketSnapshot(view, e.message);
      }
    } finally {
      if (!c.signal.aborted) setExportBusy(false);
    }
  }

  useLayoutEffect(() => {
    if (reading.current && state.data) {
      restoreLibraryReading(reading.current);
      reading.current = null;
    }
    prior.current = state.data;
  }, [state.data]);
  const change = (values: Partial<LibraryQuery>) => {
    reading.current = null;
    onView({ ...view, ...values });
  };
  const refresh = () => {
    reading.current = captureLibraryReading(key);
    void state.refresh();
  };
  const paginate = (offset: number) => {
    reading.current = null;
    void state.page(offset);
  };
  return (
    <>
      <Heading title="应用库" description="保持当前清单；后台检测到新数据后，由你决定何时更新。">
        <button
          className="button secondary"
          disabled={!state.data || state.expired || exportBusy}
          onClick={() => void exportCsv()}
        >
          <FileDown size={15} />
          {exportBusy ? '准备导出…' : '导出当前清单 CSV'}
        </button>
        <button className="button secondary" onClick={refresh} disabled={state.loading}>
          <RefreshCw size={15} />
          刷新当前清单
        </button>
      </Heading>
      <div className="research-filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            change({ q: search });
          }}
          className="research-search"
        >
          <Search size={16} />
          <input
            data-focus-key="library-search"
            aria-label="搜索应用"
            placeholder="应用名称、开发者或包名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="button secondary" type="submit">
            搜索
          </button>
        </form>
        <select
          data-focus-key="library-country"
          aria-label="筛选国家"
          value={view.country}
          onChange={(e) => change({ country: e.target.value })}
        >
          <option value="">全部国家</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="应用商店"
          value={view.store}
          onChange={(e) => change({ store: e.target.value })}
        >
          <option value="">全部商店</option>
          {Object.entries(storeLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <ScopeSelect value={view.loanScope} onChange={(loanScope) => change({ loanScope })} />
        <button className="button secondary" aria-expanded={more} onClick={() => setMore(!more)}>
          <SlidersHorizontal size={15} />
          更多筛选
        </button>
      </div>
      {more && (
        <div className="research-filters">
          <label>
            商店发布从
            <input
              type="date"
              value={view.from}
              onChange={(e) => change({ from: e.target.value })}
            />
          </label>
          <label>
            至<input type="date" value={view.to} onChange={(e) => change({ to: e.target.value })} />
          </label>
          <label>
            最低评分
            <input
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={view.minScore}
              onChange={(e) => change({ minScore: e.target.value })}
            />
          </label>
          <label>
            累计安装下限
            <input
              type="number"
              min="0"
              value={view.minInstalls}
              onChange={(e) => change({ minInstalls: e.target.value })}
            />
          </label>
        </div>
      )}
      <div className="research-context">
        <span>
          {scopeLabels[view.loanScope]} · 待细分不代表已确认现金贷
          {state.data
            ? ` · 当前清单待细分 ${state.data.unknownTotal ?? state.data.apps.filter((a) => !a.category || a.category === 'unknown').length} 项${state.data.unknownTotal == null ? '（仅当前页）' : ''}`
            : ''}
        </span>
        <label>
          排序{' '}
          <select
            aria-label="排序字段"
            value={view.sort}
            onChange={(e) => change({ sort: e.target.value as LibraryQuery['sort'] })}
          >
            {Object.entries(sortLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          aria-label="切换排序方向"
          onClick={() => change({ direction: view.direction === 'desc' ? 'asc' : 'desc' })}
        >
          {view.direction === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}{' '}
          {view.direction === 'desc' ? '降序' : '升序'}
        </button>
      </div>
      <div className="research-pending" aria-live="polite">
        {state.pending && (
          <>
            <span>
              {state.expired
                ? '查询快照已过期或可见范围已变，请更新清单。'
                : '有新数据，当前清单保持不变。'}
            </span>
            <button className="button" disabled={state.loading} onClick={refresh}>
              {state.loading ? '更新中…' : '更新清单'}
            </button>
          </>
        )}
      </div>
      <div className="research-library-error">
        <ErrorNotice error={state.error} />
        {exportMessage && <p role="status">{exportMessage}</p>}
      </div>
      {!state.data ? (
        state.error ? null : (
          <Busy />
        )
      ) : (
        <>
          <div className="table-scroll" data-library-table>
            <table className="research-table library-table">
              <thead>
                <tr>
                  <th>对比</th>
                  <th>应用 / 开发者</th>
                  <th>市场 / 商店</th>
                  <th>商店发布时间</th>
                  <th>最近更新时间</th>
                  <th>评分</th>
                  <th>累计安装下限</th>
                  <th>细分</th>
                </tr>
              </thead>
              <tbody>
                {state.data.apps.map((app) => (
                  <tr key={app.id} data-library-row={app.id}>
                    <td>
                      <input
                        aria-label={`对比 ${app.title}`}
                        type="checkbox"
                        checked={selected.includes(app.id)}
                        onChange={() => onCompare(app)}
                      />
                    </td>
                    <td>
                      <button
                        className="research-app-cell app-cell text-button"
                        data-focus-key={`app-${app.id}`}
                        onClick={() => onSelect(app.id)}
                      >
                        <Icon app={app} />
                        <span>
                          <strong>{app.title || app.externalId}</strong>
                          <small>{app.developer || '未提供开发者'}</small>
                          <code>{app.externalId}</code>
                        </span>
                      </button>
                    </td>
                    <td>
                      <Flag country={app.country} /> {app.country.toUpperCase()}
                      <small>{storeLabels[app.store]}</small>
                    </td>
                    <td>{time(app.releasedAt)}</td>
                    <td>{time(app.storeUpdatedAt, true)}</td>
                    <td>
                      {app.score == null ? '—' : app.score.toFixed(2)}
                      <small>{count(app.ratings)} 人评分</small>
                    </td>
                    <td>
                      {app.store === 'app-store' ? '未公开' : count(app.minInstalls)}
                      <small>{app.store === 'google-play' ? '累计 · 非国别下载' : ''}</small>
                    </td>
                    <td>
                      <span className="research-tag">
                        {categoryLabels[String(app.category || 'unknown')]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!state.data.apps.length && (
              <EmptyState>没有符合条件的应用，调整筛选或提交收录申请。</EmptyState>
            )}
          </div>
          <Pager
            offset={state.data.offset}
            limit={state.data.limit}
            total={state.data.total}
            disabled={state.loading}
            onChange={paginate}
          />
          <p className="mini-note">
            快照生成 {time(state.data.createdAt, true)} · 到期 {time(state.data.expiresAt, true)}
            。安装未知值保持缺失，0 为实际有效值。
          </p>
        </>
      )}
    </>
  );
}
export function SelectedEvent({ event }: { event: MarketActivityEvent }) {
  return (
    <section className="panel padded selected-event">
      <h2>来自本次所选动态：{eventLabels[event.type]}</h2>
      <p>
        {time(event.eventAt || event.releasedAt, true)} · 原观测 {time(event.observedAt, true)} ·
        快照 {event.snapshotId ?? '未关联'}
      </p>
      <External url={event.sourceUrl}>查看该动态来源</External>
      {event.changes.map((c) => (
        <div className="diff-values" key={c.id}>
          <strong>{c.field}</strong>
          <pre>
            {typeof c.oldValue === 'string' ? c.oldValue : JSON.stringify(c.oldValue, null, 2)}
          </pre>
          <ArrowRight size={15} />
          <pre>
            {typeof c.newValue === 'string' ? c.newValue : JSON.stringify(c.newValue, null, 2)}
          </pre>
        </div>
      ))}
      <p className="pre-wrap">{event.releaseNotes || '该观测未提供更新说明。'}</p>
    </section>
  );
}

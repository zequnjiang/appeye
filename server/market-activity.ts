import type { Store } from './db.js';
import type { Classification, StoreName } from './types.js';
import { parseStoreReleaseDate } from './store-release-date.js';

export type MarketEventType = 'firstSeen' | 'storeRelease' | 'observedUpdate';
export interface ActivityCounts {
  firstSeen: number;
  storeRelease: number;
  observedUpdate: number;
}
export interface MarketActivityEvent {
  id: string;
  type: MarketEventType;
  appId: number;
  externalId: string;
  title: string;
  icon: string | null;
  store: StoreName;
  country: string;
  classification: Classification;
  eventAt: string | null;
  observedAt: string | null;
  lastFetchedAt: string | null;
  releasedAt: string | null;
  releasedAtPrecision: 'date' | 'timestamp' | 'unknown';
  releasedAtRaw: unknown;
  storeUpdatedAt: string | null;
  sourceUrl: string | null;
  snapshotId: number | null;
  releaseNotes: string | null;
  versionChanged: boolean;
  changes: Array<{ id: number; field: string; oldValue: unknown; newValue: unknown }>;
}
export interface MarketActivityResponse {
  dateMode: 'business-timezone';
  timeZone: 'Asia/Shanghai';
  date: string;
  windowStart: string;
  windowEnd: string;
  /** Unique market apps for each type; unaffected by the selected type tab. */
  counts: ActivityCounts;
  eventCounts: ActivityCounts;
  countries: Array<{
    country: string;
    name: string;
    counts: ActivityCounts;
    eventCounts: ActivityCounts;
  }>;
  events: MarketActivityEvent[];
  total: number;
  uniqueApps: number;
  limit: number;
  offset: number;
  dataset: 'live' | 'demo';
}
export interface CollectionCycleStatus {
  id: number;
  dueAt: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
}
export interface CollectionStatus {
  enabled: boolean;
  intervalMinutes: 60;
  lastSuccessAt: string | null;
  nextDueAt: string | null;
  lastCycle: CollectionCycleStatus | null;
  activeCycle: CollectionCycleStatus | null;
  overdue: boolean;
  overdueApps: number;
  collector: {
    mode: 'coordinator' | 'paused' | 'demo' | 'external';
    lastHeartbeatAt: string | null;
    busy: boolean;
  };
  batch: {
    id: string;
    pending: number;
    reviewFailed: number;
    lastProgressAt: string | null;
  } | null;
  failures: Array<{
    id: number;
    kind: string;
    country: string;
    store: StoreName;
    appId: number | null;
    error: string;
    attempts: number;
  }>;
}
export interface ActivityQuery {
  appIds?: number[];
  date?: string;
  timeZone?: string;
  country?: string;
  store?: StoreName;
  classification?: Classification;
  type?: MarketEventType | 'all';
  limit?: number;
  offset?: number;
}

export function activityWindow(date?: string, timeZone = 'Asia/Shanghai', now = new Date()) {
  if (timeZone !== 'Asia/Shanghai') throw new Error('仅支持 Asia/Shanghai 时区');
  const selected = date ?? new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selected)) throw new Error('日期必须为 YYYY-MM-DD');
  const midnight = new Date(`${selected}T00:00:00.000Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== selected)
    throw new Error('无效日期');
  return {
    dateMode: 'business-timezone' as const,
    timeZone: 'Asia/Shanghai' as const,
    date: selected,
    windowStart: new Date(midnight.getTime() - 8 * 3600000).toISOString(),
    windowEnd: new Date(midnight.getTime() + 16 * 3600000).toISOString(),
  };
}

/** Calendar-only source values never acquire an invented release instant. */
export function releaseEvidence(data: Record<string, any>) {
  const raw = data.storeData?.released ?? data.storeData?.releaseDate ?? null;
  if (raw == null || raw === '' || !['string', 'number'].includes(typeof raw))
    return { releasedAt: null, releasedAtRaw: raw, releasedAtPrecision: 'unknown' as const };
  if (typeof raw === 'string') {
    const value = raw.trim();
    const calendarDate = parseStoreReleaseDate(value);
    if (calendarDate)
      return { releasedAt: calendarDate, releasedAtRaw: raw, releasedAtPrecision: 'date' as const };
    if (!/[T ].*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))
      return { releasedAt: null, releasedAtRaw: raw, releasedAtPrecision: 'unknown' as const };
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime())
    ? {
        releasedAt: parsed.toISOString(),
        releasedAtRaw: raw,
        releasedAtPrecision: 'timestamp' as const,
      }
    : { releasedAt: null, releasedAtRaw: raw, releasedAtPrecision: 'unknown' as const };
}

export function getMarketActivity(
  store: Store,
  query: ActivityQuery = {},
  now = new Date(),
): MarketActivityResponse {
  const window = activityWindow(query.date, query.timeZone, now);
  const limit = query.limit ?? 50,
    offset = query.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new Error('分页参数无效');
  const parts: string[] = [],
    params: string[] = [];
  for (const key of ['country', 'store', 'classification'] as const)
    if (query[key]) {
      parts.push(`${key}=?`);
      params.push(query[key]!);
    }
  const apps = store.all(
    `SELECT id,external_id,title,country,store,classification,data,first_seen_at,last_fetched_at FROM apps ${parts.length ? `WHERE ${parts.join(' AND ')}` : ''}`,
    ...params,
  );
  const events: MarketActivityEvent[] = [];
  const inWindow = (at: string | null) => !!at && at >= window.windowStart && at < window.windowEnd;
  const allowedIds = query.appIds ? new Set(query.appIds) : null;
  for (const app of apps) {
    if (allowedIds && !allowedIds.has(app.id)) continue;
    const current = JSON.parse(app.data),
      release = releaseEvidence(current);
    const base: MarketActivityEvent = {
      id: '',
      type: 'firstSeen',
      appId: app.id,
      externalId: app.external_id,
      title: app.title,
      icon: current.icon ?? null,
      country: app.country,
      store: app.store,
      classification: app.classification,
      eventAt: null,
      observedAt: null,
      lastFetchedAt: app.last_fetched_at,
      ...release,
      storeUpdatedAt: current.storeUpdatedAt ?? null,
      sourceUrl: current.url ?? null,
      snapshotId: null,
      releaseNotes: current.releaseNotes ?? null,
      versionChanged: false,
      changes: [],
    };
    if (inWindow(app.first_seen_at)) {
      const first = store.one(
        'SELECT id,data,observed_at FROM snapshots WHERE app_id=? ORDER BY observed_at,id LIMIT 1',
        app.id,
      );
      const data = first ? JSON.parse(first.data) : {};
      events.push({
        ...base,
        ...releaseEvidence(data),
        id: `firstSeen:${app.id}`,
        eventAt: app.first_seen_at,
        observedAt: first?.observed_at ?? null,
        snapshotId: first?.id ?? null,
        storeUpdatedAt: data.storeUpdatedAt ?? null,
        releaseNotes: data.releaseNotes ?? null,
        sourceUrl: data.url ?? base.sourceUrl,
      });
    }
    if (
      release.releasedAt &&
      (release.releasedAtPrecision === 'date'
        ? release.releasedAt === window.date
        : inWindow(release.releasedAt))
    ) {
      const latest = store.one(
        'SELECT id,observed_at FROM snapshots WHERE app_id=? ORDER BY observed_at DESC,id DESC LIMIT 1',
        app.id,
      );
      events.push({
        ...base,
        id: `storeRelease:${app.id}`,
        type: 'storeRelease',
        eventAt: release.releasedAtPrecision === 'timestamp' ? release.releasedAt : null,
        observedAt: latest?.observed_at ?? app.first_seen_at,
        snapshotId: latest?.id ?? null,
      });
    }
    const changes = store.all(
      'SELECT id,snapshot_id,field,old_value,new_value,observed_at FROM changes WHERE app_id=? AND observed_at>=? AND observed_at<? ORDER BY id',
      app.id,
      window.windowStart,
      window.windowEnd,
    );
    const groups = new Map<string, typeof changes>();
    for (const change of changes) {
      const key = String(change.snapshot_id ?? change.observed_at);
      groups.set(key, [...(groups.get(key) ?? []), change]);
    }
    for (const [key, rows] of groups) {
      const row = rows[0]!;
      const snapshot = row.snapshot_id
        ? store.one('SELECT data FROM snapshots WHERE id=? AND app_id=?', row.snapshot_id, app.id)
        : undefined;
      const data = snapshot ? JSON.parse(snapshot.data) : {};
      const version = typeof data.version === 'string' ? data.version.trim() : '';
      const previous = row.snapshot_id
        ? store.one(
            "SELECT json_extract(data,'$.version') version FROM snapshots WHERE app_id=? AND (observed_at<? OR (observed_at=? AND id<?)) AND trim(COALESCE(json_extract(data,'$.version'),''))<>'' AND lower(trim(json_extract(data,'$.version'))) NOT IN ('vary','varies with device','unknown') ORDER BY observed_at DESC,id DESC LIMIT 1",
            app.id,
            row.observed_at,
            row.observed_at,
            row.snapshot_id,
          )
        : undefined;
      events.push({
        ...base,
        ...releaseEvidence(data),
        id: `observedUpdate:${app.id}:${key}`,
        type: 'observedUpdate',
        eventAt: row.observed_at,
        observedAt: row.observed_at,
        snapshotId: row.snapshot_id,
        storeUpdatedAt: data.storeUpdatedAt ?? null,
        releaseNotes: data.releaseNotes ?? null,
        sourceUrl: data.url ?? base.sourceUrl,
        versionChanged:
          !!previous &&
          !!version &&
          !/^(vary|varies with device|unknown)$/i.test(version) &&
          version !== String(previous.version).trim(),
        changes: rows.map((r) => ({
          id: r.id,
          field: r.field,
          oldValue: JSON.parse(r.old_value),
          newValue: JSON.parse(r.new_value),
        })),
      });
    }
  }
  const count = (rows: MarketActivityEvent[], unique: boolean): ActivityCounts =>
    Object.fromEntries(
      (['firstSeen', 'storeRelease', 'observedUpdate'] as const).map((type) => [
        type,
        unique
          ? new Set(rows.filter((e) => e.type === type).map((e) => e.appId)).size
          : rows.filter((e) => e.type === type).length,
      ]),
    ) as unknown as ActivityCounts;
  const selected = events
    .filter((e) => !query.type || query.type === 'all' || e.type === query.type)
    .sort(
      (a, b) =>
        (b.eventAt ?? `${window.date}T00:00:00`).localeCompare(
          a.eventAt ?? `${window.date}T00:00:00`,
        ) ||
        b.appId - a.appId ||
        b.id.localeCompare(a.id),
    );
  return {
    ...window,
    counts: count(events, true),
    eventCounts: count(events, false),
    countries: store
      .listCountries()
      .filter((c) => !query.country || c.code === query.country)
      .map((c) => ({
        country: c.code,
        name: c.name,
        counts: count(
          events.filter((e) => e.country === c.code),
          true,
        ),
        eventCounts: count(
          events.filter((e) => e.country === c.code),
          false,
        ),
      })),
    events: selected.slice(offset, offset + limit),
    total: selected.length,
    uniqueApps: new Set(selected.map((e) => e.appId)).size,
    limit,
    offset,
    dataset:
      store.one("SELECT value FROM metadata WHERE key='dataset'")?.value === 'demo'
        ? 'demo'
        : 'live',
  };
}

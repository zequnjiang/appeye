import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './db.js';
import { getMarketActivity, releaseEvidence } from './market-activity.js';
import { HttpError, tokenHash, timestamp, type Actor } from './workspace-auth.js';

export const loanScopeSchema = z.enum(['cash-priority', 'personal', 'other', 'unknown', 'all']);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().startsWith(v);
  });
export const marketQuerySchema = z
  .object({
    country: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    store: z.enum(['google-play', 'app-store']).optional(),
    q: z.string().trim().max(200).optional(),
    loanScope: loanScopeSchema.default('cash-priority'),
    sort: z
      .enum([
        'title',
        'developer',
        'firstSeenAt',
        'releasedAt',
        'storeUpdatedAt',
        'lastFetchedAt',
        'score',
        'ratings',
        'minInstalls',
      ])
      .default('minInstalls'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    from: date.optional(),
    to: date.optional(),
    minScore: z.coerce.number().min(0).max(5).optional(),
    minInstalls: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    snapshot: z.string().max(100).optional(),
    probe: z.enum(['1']).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, '日期区间无效');
type MarketQuery = z.infer<typeof marketQuerySchema>;
const fields = [
  'icon',
  'summary',
  'score',
  'ratings',
  'installs',
  'minInstalls',
  'maxInstalls',
  'releasedAt',
  'storeUpdatedAt',
  'version',
  'url',
] as const;
export function displayReleaseEvidence(data: Record<string, any>) {
  const release = releaseEvidence(data);
  // A present but unparseable source must not be replaced by Date's rollover or
  // locale guess from an older normalized field. Only source-less legacy values
  // retain their already stored value, with precision explicitly still unknown.
  const missingSource = release.releasedAtRaw == null || release.releasedAtRaw === '';
  return {
    ...release,
    releasedAt: release.releasedAt ?? (missingSource ? (data.releasedAt ?? null) : null),
  };
}
export function category(store: Store, appId: number) {
  const row = store.one('SELECT category FROM research_app_categories WHERE app_id=?', appId);
  return { category: row?.category ?? 'unknown', categorySource: row ? 'manual' : 'unclassified' };
}
export function libraryRows(store: Store, query: Partial<MarketQuery> = {}) {
  const rows = store.all(
    "SELECT a.*,c.category FROM apps a LEFT JOIN research_app_categories c ON c.app_id=a.id WHERE a.classification='confirmed'",
  );
  const scope = query.loanScope ?? 'cash-priority';
  return rows
    .map((row) => {
      const data = JSON.parse(row.data);
      const release = displayReleaseEvidence(data);
      const analysis = row.loan_analysis ? JSON.parse(row.loan_analysis) : null;
      return {
        ...Object.fromEntries(fields.map((field) => [field, data[field] ?? null])),
        releasedAt: release.releasedAt,
        releasedAtPrecision: release.releasedAtPrecision,
        releasedAtRaw: release.releasedAtRaw,
        id: row.id,
        country: row.country,
        store: row.store,
        externalId: row.external_id,
        title: row.title,
        developer: row.developer,
        firstSeenAt: row.first_seen_at,
        lastFetchedAt: row.last_fetched_at,
        classification: 'confirmed',
        classificationSource: row.classification_source,
        category: row.category ?? 'unknown',
        categorySource: row.category ? 'manual' : 'unclassified',
        loanAnalysis: analysis
          ? {
              verdict: analysis.verdict,
              productType: analysis.productType,
              confidence: analysis.confidence,
            }
          : null,
      } as Record<string, any>;
    })
    .filter((row) => {
      if (
        (query.country && row.country !== query.country) ||
        (query.store && row.store !== query.store)
      )
        return false;
      if (
        (scope === 'cash-priority' && !['personal', 'unknown'].includes(row.category)) ||
        (!['cash-priority', 'all'].includes(scope) && row.category !== scope)
      )
        return false;
      if (
        query.q &&
        ![row.title, row.developer, row.externalId].some((v) =>
          String(v ?? '')
            .toLocaleLowerCase()
            .includes(query.q!.toLocaleLowerCase()),
        )
      )
        return false;
      const release = typeof row.releasedAt === 'string' ? row.releasedAt.slice(0, 10) : null;
      if (
        (query.from && (!release || release < query.from)) ||
        (query.to && (!release || release > query.to))
      )
        return false;
      if (query.minScore !== undefined && (row.score == null || row.score < query.minScore))
        return false;
      if (
        query.minInstalls !== undefined &&
        (row.minInstalls == null || row.minInstalls < query.minInstalls)
      )
        return false;
      return true;
    });
}
export function sortLibrary(
  rows: Record<string, any>[],
  sort: MarketQuery['sort'],
  direction: MarketQuery['direction'],
) {
  const dates = ['firstSeenAt', 'releasedAt', 'storeUpdatedAt', 'lastFetchedAt'];
  const value = (row: Record<string, any>) => {
    const v = row[sort];
    if (v == null || v === '') return null;
    if (dates.includes(sort)) return Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
    if (['score', 'ratings', 'minInstalls'].includes(sort))
      return Number.isFinite(Number(v)) ? Number(v) : null;
    return String(v);
  };
  return rows.sort((a, b) => {
    const av = value(a),
      bv = value(b);
    if (av == null || bv == null)
      return av == null && bv == null ? a.id - b.id : av == null ? 1 : -1;
    const order =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'zh-CN', { numeric: true });
    return order ? order * (direction === 'desc' ? -1 : 1) : a.id - b.id;
  });
}
export function queryMarket(store: Store, actor: Actor, input: unknown) {
  const query = marketQuerySchema.parse(input);
  if (query.country && !store.getCountry(query.country)) throw new HttpError(400, '国家不存在');
  const { snapshot, probe, offset, limit, ...filters } = query;
  const key = JSON.stringify(filters);
  let saved = snapshot
    ? store.one(
        'SELECT * FROM research_query_snapshots WHERE id=? AND session_hash=?',
        snapshot,
        actor.sessionId,
      )
    : undefined;
  if (snapshot) {
    if (saved?.revision === 'scope-revoked')
      throw new HttpError(
        410,
        '清单包含已移出客户应用库的记录，请重新读取',
        'SNAPSHOT_SCOPE_REVOKED',
      );
    if (!saved)
      throw new HttpError(
        410,
        '清单快照已失效，无法确认可见范围，请点击更新重新读取',
        'SNAPSHOT_SCOPE_REVOKED',
      );
    if (saved.query !== key) throw new HttpError(409, '清单快照与当前查询不匹配');
    const currentIds = new Set(
      store.all("SELECT id FROM apps WHERE classification='confirmed'").map((row) => row.id),
    );
    if ((JSON.parse(saved.rows) as { id: number }[]).some((row) => !currentIds.has(row.id))) {
      // Keep a bounded tombstone so a concurrent CSV/probe cannot downgrade a
      // visibility revocation to an ordinary expired snapshot on its next read.
      store.run(
        "UPDATE research_query_snapshots SET rows='[]',revision='scope-revoked' WHERE id=?",
        snapshot,
      );
      throw new HttpError(
        410,
        '清单包含已移出客户应用库的记录，请重新读取',
        'SNAPSHOT_SCOPE_REVOKED',
      );
    }
    if (saved.expires_at <= timestamp())
      throw new HttpError(410, '清单快照已过期，请点击更新重新读取');
  }
  if (probe && !saved) throw new HttpError(400, '检测更新需要当前清单快照');
  if (!saved || probe) {
    const rows = sortLibrary(libraryRows(store, query), query.sort, query.direction);
    const serialized = JSON.stringify(rows),
      revision = tokenHash(serialized);
    if (probe) return { changed: saved!.revision !== revision, revision };
    const time = timestamp(),
      id = randomBytes(24).toString('hex'),
      expires = new Date(Date.now() + 12 * 3600000).toISOString();
    store.transaction(() => {
      store.run('DELETE FROM research_query_snapshots WHERE expires_at<=?', time);
      store.run(
        'INSERT INTO research_query_snapshots VALUES (?,?,?,?,?,?,?)',
        id,
        actor.sessionId,
        key,
        revision,
        serialized,
        time,
        expires,
      );
      store.run(
        'DELETE FROM research_query_snapshots WHERE session_hash=? AND id NOT IN (SELECT id FROM research_query_snapshots WHERE session_hash=? ORDER BY created_at DESC,rowid DESC LIMIT 20)',
        actor.sessionId,
        actor.sessionId,
      );
    });
    saved = { id, rows: serialized, revision, created_at: time, expires_at: expires };
  }
  const rows = JSON.parse(saved!.rows) as Record<string, any>[];
  const selectedOffset =
    rows.length && offset >= rows.length
      ? Math.floor((rows.length - 1) / limit) * limit
      : rows.length
        ? offset
        : 0;
  return {
    apps: rows.slice(selectedOffset, selectedOffset + limit),
    total: rows.length,
    unknownTotal: rows.filter((row) => row.category === 'unknown').length,
    offset: selectedOffset,
    limit,
    snapshot: saved!.id,
    revision: saved!.revision,
    createdAt: saved!.created_at,
    expiresAt: saved!.expires_at,
  };
}
export function workspaceActivity(store: Store, input: unknown) {
  const query = z
    .object({
      date: z.string().optional(),
      timeZone: z.literal('Asia/Shanghai').optional(),
      country: z
        .string()
        .regex(/^[a-z]{2}$/)
        .optional(),
      store: z.enum(['google-play', 'app-store']).optional(),
      loanScope: loanScopeSchema.default('cash-priority'),
      type: z.enum(['all', 'firstSeen', 'storeRelease', 'observedUpdate']).default('all'),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .strict()
    .parse(input);
  if (query.country && !store.getCountry(query.country)) throw new HttpError(400, '国家不存在');
  const selected = libraryRows(store, query);
  const all = getMarketActivity(store, {
    ...query,
    classification: 'confirmed',
    appIds: selected.map((row) => row.id),
  });
  const complete = getMarketActivity(store, {
    ...query,
    classification: 'confirmed',
    appIds: selected.map((row) => row.id),
    limit: 200,
    offset: 0,
  });
  return {
    ...all,
    unknownTotal: selected.filter((row) => row.category === 'unknown').length,
    featuredEvents: complete.events.slice(0, 4),
    countries: all.countries.map((country) => {
      // Use the same query for each country's actual most recent event, not an invented clock.
      const one = getMarketActivity(store, {
        ...query,
        country: country.country,
        classification: 'confirmed',
        appIds: selected.filter((row) => row.country === country.country).map((row) => row.id),
        limit: 1,
        offset: 0,
      });
      return {
        ...country,
        apps: selected.filter((row) => row.country === country.country).length,
        unknownApps: selected.filter(
          (row) => row.country === country.country && row.category === 'unknown',
        ).length,
        latestEvent: one.events[0] ?? null,
        latestEventAt: one.events[0]?.eventAt ?? null,
      };
    }),
  };
}
export function exportMarketCsv(store: Store, actor: Actor, input: unknown) {
  const query = marketQuerySchema.parse(input);
  if (!query.snapshot || query.probe) throw new HttpError(400, '请先加载应用库清单再导出');
  // Reuse normal session, query, expiry and current visibility checks before
  // reading every frozen row. Export never silently creates a new snapshot.
  queryMarket(store, actor, query);
  const saved = store.one(
    'SELECT rows,created_at FROM research_query_snapshots WHERE id=? AND session_hash=?',
    query.snapshot,
    actor.sessionId,
  )!;
  const rows = JSON.parse(saved.rows) as Record<string, unknown>[];
  const columns = [
    'id',
    'country',
    'store',
    'externalId',
    'title',
    'developer',
    'category',
    'score',
    'ratings',
    'installs',
    'minInstalls',
    'maxInstalls',
    'releasedAt',
    'releasedAtPrecision',
    'storeUpdatedAt',
    'firstSeenAt',
    'lastFetchedAt',
    'url',
  ];
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    '\uFEFF' +
    [...columns, 'snapshotCreatedAt', 'installsScope'].join(',') +
    '\r\n' +
    rows
      .map((row) =>
        [
          ...columns.map((key) => row[key]),
          saved.created_at,
          row.store === 'google-play'
            ? 'public cumulative; not country downloads'
            : 'not published',
        ]
          .map(cell)
          .join(','),
      )
      .join('\r\n') +
    '\r\n'
  );
}

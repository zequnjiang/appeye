import type { Store } from './db.js';
import {
  ScanSourceError,
  type FullScanProviders,
  type ScanPage,
  type ScanTransportRecord,
} from './full-scan-providers.js';
import type { NormalizedApp, StoreName } from './types.js';
import { normalizeApp } from './normalization.js';
import { classifyLoan } from './loan-identification.js';
import { earliestKnownDiscovery } from './manual-collection.js';

type Row = Record<string, any>;
const json = (v: unknown) => JSON.stringify(v ?? null);
const parse = (v: string | null) => (v ? JSON.parse(v) : null);
const SIX_HOURS = 6 * 3600000;
export const discoveryLimits = {
  sourceRequests: 60,
  detailRequests: 60,
  timeoutMs: 20000,
  searchResults: 1000,
};
export interface DiscoveryOptions {
  store: Store;
  providers: FullScanProviders;
  now?: () => Date;
  enabled?: boolean;
  sourceRequests?: number;
  detailRequests?: number;
  timeoutMs?: number;
  searchResults?: number;
}
export class DiscoveryBudgetError extends Error {
  constructor() {
    super('Discovery HTTP budget exhausted; deferred to next cycle');
    this.name = 'DiscoveryBudgetError';
  }
}
const phrases: Record<string, string[]> = {
  ar: ['préstamos personales', 'préstamo personal', 'crédito personal', 'préstamos en línea'],
  mx: ['préstamos personales', 'préstamo personal', 'crédito personal', 'préstamos en línea'],
  th: ['สินเชื่อส่วนบุคคล', 'เงินกู้ออนไลน์', 'กู้เงิน', 'สินเชื่อเงินสด'],
  id: ['pinjaman tunai', 'pinjaman pribadi', 'pinjaman cepat', 'pinjaman dana'],
  ph: ['personal loan', 'online loan', 'pautang', 'mabilis na pautang'],
  pk: ['personal loan', 'online loan', 'ذاتی قرض', 'فوری قرض'],
};
export function expandedKeywords(country: { code: string; keywords: string[] }) {
  const terms = [
    ...country.keywords,
    ...(phrases[country.code] ?? []),
    'loan',
    'personal loan',
    'cash loan',
  ];
  return [
    ...new Set(
      terms.flatMap((t) => [t, t.normalize('NFD').replace(/\p{M}/gu, '')]).filter(Boolean),
    ),
  ];
}
const identityArgs = (r: Row) => [r.country, r.store, r.external_id] as [string, string, string];

/** Sources may predate processing; every admission consults their original observation time. */
function attachSources(store: Store, appId: number, identity: Row) {
  for (const row of store.all(
    'SELECT * FROM discovery_sources WHERE country=? AND store=? AND external_id=? AND discovery_id IS NULL',
    ...identityArgs(identity),
  )) {
    const saved = store.recordDiscovery(appId, {
      keyword: row.keyword,
      requestCountry: row.country,
      requestLanguage: row.request_language ?? 'und',
      source: row.source,
      observedAt: row.observed_at,
      data: parse(row.data),
      raw: parse(row.raw),
    });
    store.run(
      'UPDATE discovery_sources SET app_id=?,discovery_id=? WHERE id=?',
      appId,
      saved.id,
      row.id,
    );
  }
}
export function recordKnownIdentity(
  store: Store,
  app: { id: number; country: string; store: string; externalId: string },
  jobId: number,
  observedAt: string,
) {
  const source =
    app.store === 'google-play'
      ? `https://play.google.com/store/apps/details?${new URLSearchParams({ id: app.externalId, gl: app.country })}`
      : `https://apps.apple.com/${app.country}/app/id${app.externalId}`;
  const data = { externalId: app.externalId, title: app.externalId };
  store.run(
    `INSERT OR IGNORE INTO discovery_sources(origin_key,country,store,external_id,app_id,kind,observed_at,processed_at,source,keyword,data,raw)
    VALUES(?,?,?,?,?,'known-id',?,?,?,?,?,?)`,
    `manual:${jobId}`,
    app.country,
    app.store,
    app.externalId,
    app.id,
    observedAt,
    observedAt,
    source,
    'user-provided-id',
    json(data),
    json({ externalId: app.externalId, jobId, source: 'user-provided-id' }),
  );
  attachSources(store, app.id, {
    country: app.country,
    store: app.store,
    external_id: app.externalId,
  });
}

/** One-hop, durable discovery. No writes to the frozen full-scan cohort. */
export function createDiscoveryRunner(options: DiscoveryOptions) {
  const { store, providers } = options;
  const now = options.now ?? (() => new Date());
  const stamp = () => now().toISOString();
  const limits = Object.fromEntries(
    Object.entries(discoveryLimits).map(([k, fallback]) => {
      const value = options[k as keyof typeof discoveryLimits] ?? fallback;
      if (!Number.isInteger(value) || value < 1 || (k === 'searchResults' && value > 1000))
        throw new Error(`Invalid discovery ${k}`);
      return [k, value];
    }),
  ) as typeof discoveryLimits;
  const enabled =
    options.enabled !== false &&
    store.one("SELECT value FROM metadata WHERE key='dataset'")?.value !== 'demo';
  let active: Row | undefined,
    controller: AbortController | undefined,
    stopped = false;
  const frontier = (
    country: string,
    name: StoreName,
    kind: string,
    target: string,
    payload: Row,
  ) => {
    store.run(
      `INSERT INTO discovery_frontier(country,store,kind,target,payload,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(country,store,kind,target) DO UPDATE SET payload=excluded.payload`,
      country,
      name,
      kind,
      target,
      json(payload),
      stamp(),
    );
  };
  function enqueueDetails(cycleId: number) {
    store.run(`UPDATE discovery_candidates AS c SET app_id=(SELECT a.id FROM apps a WHERE a.country=c.country AND a.store=c.store AND a.external_id=c.external_id),status='admitted'
      WHERE EXISTS(SELECT 1 FROM apps a WHERE a.country=c.country AND a.store=c.store AND a.external_id=c.external_id AND a.last_fetched_at IS NOT NULL)`);
    // All pending identities remain durable even when this cycle's detail quota is exhausted.
    store.run(
      `INSERT OR IGNORE INTO discovery_tasks(cycle_id,country,store,kind,candidate_id,payload,created_at)
      SELECT ?,c.country,c.store,'detail',c.id,json_object('externalId',c.external_id,'requestLanguage',CASE WHEN c.store='app-store' THEN 'en_us' ELSE m.language END),?
      FROM discovery_candidates c JOIN countries m ON m.code=c.country
      WHERE m.enabled=1 AND c.status='pending' AND EXISTS(SELECT 1 FROM discovery_markets d WHERE d.cycle_id=? AND d.country=c.country AND d.store=c.store)`,
      cycleId,
      stamp(),
      cycleId,
    );
  }
  function seed(cycleId: number) {
    for (const country of store.listCountries().filter((c) => c.enabled)) {
      for (const name of ['google-play', 'app-store'] as const) {
        store.run(
          'INSERT OR IGNORE INTO discovery_rotation(country,store) VALUES(?,?)',
          country.code,
          name,
        );
        store.run(
          'INSERT INTO discovery_markets(cycle_id,country,store,last_served,next_lane) SELECT ?,country,store,last_served,next_lane FROM discovery_rotation WHERE country=? AND store=?',
          cycleId,
          country.code,
          name,
        );
        const language = name === 'app-store' ? 'en_us' : country.language;
        for (const term of expandedKeywords(country))
          frontier(country.code, name, 'search', term, {
            keyword: term,
            requestLanguage: language,
            vocabularyVersion: '2026-09-07.1',
          });
        // Seed membership is frozen at cycle creation: admissions can only expand next cycle.
        for (const app of store.all(
          "SELECT id,external_id,title,data FROM apps WHERE country=? AND store=? AND classification='confirmed'",
          country.code,
          name,
        )) {
          const data = parse(app.data);
          frontier(country.code, name, 'similar', app.external_id, {
            externalId: app.external_id,
            parentAppId: app.id,
            requestLanguage: language,
          });
          if (data?.developerId)
            frontier(country.code, name, 'developer', String(data.developerId), {
              externalId: app.external_id,
              parentAppId: app.id,
              developerId: String(data.developerId),
              developerUrl: data.developerUrl,
              requestLanguage: language,
            });
          if (app.title && app.title !== app.external_id)
            frontier(country.code, name, 'search', app.title, {
              keyword: app.title,
              parentAppId: app.id,
              requestLanguage: language,
              vocabularyVersion: 'observed-title',
            });
        }
        for (const h of store.all(
          `SELECT h.id,h.app_id FROM enrichment_history h JOIN apps a ON a.id=h.app_id
          WHERE a.country=? AND a.store=? AND h.request_country=? AND h.kind='developer' AND h.status='available'
          AND h.id=(SELECT MAX(h2.id) FROM enrichment_history h2 WHERE h2.app_id=h.app_id AND h2.kind='developer' AND h2.status='available' AND h2.request_country=?)`,
          country.code,
          name,
          country.code,
          country.code,
        ))
          frontier(country.code, name, 'catalog', String(h.id), {
            enrichmentHistoryId: h.id,
            parentAppId: h.app_id,
            requestLanguage: language,
          });
        for (const [kind, count] of [
          ['catalog', 20],
          ['search', 12],
          ['similar', 10],
          ['developer', 10],
        ] as const) {
          const entries = store.all(
            `SELECT f.* FROM discovery_frontier f WHERE f.country=? AND f.store=? AND f.kind=? AND f.consumed=0
            AND (json_extract(f.payload,'$.parentAppId') IS NULL OR f.kind='catalog' OR EXISTS(SELECT 1 FROM apps a WHERE a.id=json_extract(f.payload,'$.parentAppId') AND a.classification='confirmed'))
            ORDER BY COALESCE(f.last_served,f.created_at),f.id LIMIT ?`,
            country.code,
            name,
            kind,
            count,
          );
          for (const f of entries)
            store.run(
              'INSERT INTO discovery_tasks(cycle_id,country,store,kind,frontier_id,payload,created_at) VALUES(?,?,?,?,?,?,?)',
              cycleId,
              country.code,
              name,
              kind,
              f.id,
              f.payload,
              stamp(),
            );
        }
      }
    }
    enqueueDetails(cycleId);
  }
  function finishCycle() {
    const cycle = store.one("SELECT * FROM discovery_cycles WHERE status='running'");
    if (
      !cycle ||
      store.one(
        "SELECT 1 FROM discovery_tasks WHERE cycle_id=? AND status IN ('queued','running') LIMIT 1",
        cycle.id,
      )
    )
      return;
    const has = (status: string) =>
      !!store.one(
        'SELECT 1 FROM discovery_tasks WHERE cycle_id=? AND status=? LIMIT 1',
        cycle.id,
        status,
      );
    store.run(
      'UPDATE discovery_cycles SET status=?,finished_at=? WHERE id=?',
      has('deferred') ? 'limited' : has('failed') ? 'completed-with-errors' : 'completed',
      stamp(),
      cycle.id,
    );
  }
  function schedule() {
    if (!enabled || stopped) return null;
    return store.transaction(() => {
      const time = stamp();
      store.run('UPDATE discovery_state SET heartbeat_at=? WHERE id=1', time);
      store.run(
        "UPDATE discovery_tasks SET status='deferred',stop_reason='country-paused',finished_at=? WHERE status='queued' AND country IN (SELECT code FROM countries WHERE enabled=0)",
        time,
      );
      finishCycle();
      let cycle = store.one("SELECT * FROM discovery_cycles WHERE status='running'");
      const due = store.one('SELECT next_due_at FROM discovery_state WHERE id=1')?.next_due_at;
      if (!cycle && (!due || due <= time)) {
        const dueAt = due
          ? new Date(
              Date.parse(due) +
                Math.floor((now().getTime() - Date.parse(due)) / SIX_HOURS) * SIX_HOURS,
            ).toISOString()
          : time;
        const id = Number(
          store.run(
            'INSERT INTO discovery_cycles(due_at,started_at,settings) VALUES(?,?,?)',
            dueAt,
            time,
            json(limits),
          ).lastInsertRowid,
        );
        store.run(
          'UPDATE discovery_state SET next_due_at=? WHERE id=1',
          new Date(Date.parse(dueAt) + SIX_HOURS).toISOString(),
        );
        seed(id);
        cycle = store.one('SELECT * FROM discovery_cycles WHERE id=?', id);
      }
      return cycle?.id ?? null;
    });
  }
  function recover() {
    store.transaction(() => {
      store.run(
        "UPDATE discovery_attempts SET status='interrupted',finished_at=?,error='Process interrupted; replay saved response or restart source from head' WHERE status='running'",
        stamp(),
      );
      store.run(
        "UPDATE discovery_tasks SET status='queued',error='Interrupted; resuming durable checkpoint' WHERE status='running'",
      );
    });
    stopped = false;
  }
  function captureHttpRecorder() {
    const task = active;
    if (!task) throw new Error('No active discovery task');
    return (r: ScanTransportRecord) =>
      Number(
        store.run(
          'INSERT INTO discovery_http(cycle_id,task_id,fetched_at,url,method,status,content_type,body,error) VALUES(?,?,?,?,?,?,?,?,?)',
          task.cycle_id,
          task.id,
          r.fetchedAt,
          r.url,
          r.method,
          r.status,
          r.contentType,
          r.body,
          r.error,
        ).lastInsertRowid,
      );
  }
  function captureRequestBudget() {
    const task = active,
      signal = controller?.signal;
    if (!task) throw new Error('No active discovery task');
    return () => {
      signal?.throwIfAborted();
      const field = task.kind === 'detail' ? 'detail_requests' : 'source_requests';
      const savedLimits = parse(
        store.one('SELECT settings FROM discovery_cycles WHERE id=?', task.cycle_id)!.settings,
      );
      const budget = savedLimits[task.kind === 'detail' ? 'detailRequests' : 'sourceRequests'];
      const used = store.run(
        `UPDATE discovery_markets SET ${field}=${field}+1 WHERE cycle_id=? AND country=? AND store=? AND ${field}<?`,
        task.cycle_id,
        task.country,
        task.store,
        budget,
      );
      if (!used.changes) throw new DiscoveryBudgetError();
    };
  }
  function remember(
    task: Row,
    data: NormalizedApp,
    source: string,
    observedAt: string,
    raw: unknown = data.raw ?? data,
    requestLanguage?: string | null,
  ) {
    controller?.signal.throwIfAborted();
    if (!data.externalId || !data.title) throw new Error('Malformed discovery row');
    const payload = parse(task.payload);
    const origin =
      task.kind === 'catalog' ? `catalog:${payload.enrichmentHistoryId}` : `task:${task.id}`;
    const existing = store.one(
      'SELECT id FROM apps WHERE country=? AND store=? AND external_id=?',
      task.country,
      task.store,
      data.externalId,
    );
    store.transaction(() => {
      store.run(
        `INSERT OR IGNORE INTO discovery_sources(cycle_id,task_id,origin_key,country,store,external_id,app_id,parent_app_id,enrichment_history_id,kind,observed_at,processed_at,source,request_language,keyword,data,raw)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        task.cycle_id,
        task.id,
        origin,
        task.country,
        task.store,
        data.externalId,
        existing?.id ?? null,
        payload.parentAppId ?? null,
        payload.enrichmentHistoryId ?? null,
        task.kind,
        observedAt,
        stamp(),
        source,
        requestLanguage === undefined ? payload.requestLanguage : requestLanguage,
        payload.keyword ?? task.kind,
        json(data),
        json(raw),
      );
      store.run(
        `INSERT INTO discovery_candidates(country,store,external_id,title,app_id,status,first_observed_at,last_observed_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(country,store,external_id) DO UPDATE SET title=excluded.title,
        first_observed_at=MIN(first_observed_at,excluded.first_observed_at),last_observed_at=MAX(last_observed_at,excluded.last_observed_at),
        app_id=COALESCE(excluded.app_id,app_id),status=CASE WHEN excluded.app_id IS NOT NULL THEN 'admitted' WHEN excluded.last_observed_at>last_observed_at AND status IN ('failed','staged') THEN 'pending' ELSE status END,
        attempts=CASE WHEN excluded.last_observed_at>last_observed_at AND status IN ('failed','staged') THEN 0 ELSE attempts END`,
        task.country,
        task.store,
        data.externalId,
        data.title,
        existing?.id ?? null,
        existing ? 'admitted' : 'pending',
        observedAt,
        observedAt,
        stamp(),
      );
      if (existing) attachSources(store, existing.id, { ...task, external_id: data.externalId });
    });
  }
  async function fetchTask(task: Row, signal: AbortSignal) {
    const payload = parse(task.payload),
      provider = providers[task.store as StoreName];
    const context = { country: task.country, language: payload.requestLanguage, signal };
    if (task.kind === 'detail')
      return {
        detail: true,
        data: await provider.app({ ...context, externalId: payload.externalId }),
      };
    if (task.kind === 'catalog') {
      const h = store.one(
        'SELECT * FROM enrichment_history WHERE id=? AND request_country=?',
        payload.enrichmentHistoryId,
        task.country,
      );
      if (!h) throw new Error('Saved developer source no longer available');
      const raw = parse(h.data);
      if (!Array.isArray(raw)) throw new Error('Saved developer catalog is not an array');
      const historyRaw = parse(h.raw);
      return {
        data: raw.map((r) => normalizeApp(r, task.store)),
        raw: historyRaw,
        source: h.source,
        observedAt: h.fetched_at,
        stopReason: historyRaw?.warnings?.length
          ? 'saved-catalog-partial'
          : 'saved-catalog-recovered',
        requestLanguage: h.request_language,
        note: h.note,
        enrichmentHistoryId: h.id,
      };
    }
    if (task.kind === 'developer') {
      const result = await provider.enrich({
        ...context,
        externalId: payload.externalId,
        kind: 'developer',
        developerId: payload.developerId,
        developerUrl: payload.developerUrl,
      });
      if (result.status === 'unsupported')
        return { data: [], raw: result, source: result.source, stopReason: 'unsupported' };
      if (!Array.isArray(result.data)) throw new Error('Developer response is not an array');
      const warnings =
        result.raw &&
        typeof result.raw === 'object' &&
        'warnings' in result.raw &&
        Array.isArray(result.raw.warnings)
          ? result.raw.warnings
          : [];
      const page = {
        data: result.data.map((r) => normalizeApp(r, task.store)),
        raw: result.raw,
        source: result.source,
        requestLanguage: result.requestLanguage,
        stopReason: warnings.length ? 'developer-partial' : 'bounded-developer-catalog',
        warnings,
        note: result.note,
      };
      if (warnings.length)
        throw new ScanSourceError('Developer source returned partial results with warnings', page);
      return page;
    }
    if (task.kind === 'similar') {
      if (!provider.related) return { data: [], raw: null, source: '', stopReason: 'unsupported' };
      return provider.related({ ...context, externalId: payload.externalId });
    }
    if (!provider.extendedSearch)
      return { data: [], raw: null, source: '', stopReason: 'unsupported' };
    const savedLimits = parse(
      store.one('SELECT settings FROM discovery_cycles WHERE id=?', task.cycle_id)!.settings,
    );
    return provider.extendedSearch({
      ...context,
      keyword: payload.keyword,
      limit: savedLimits.searchResults,
      onItem: (data, source) => {
        signal.throwIfAborted();
        remember(task, data, source, stamp());
      },
    });
  }
  function apply(task: Row, response: Row) {
    if (task.applied_response_id === response.id) return;
    const value = parse(response.data),
      payload = parse(task.payload);
    if (task.kind !== 'detail') {
      if (!Array.isArray(value.data)) throw new Error('Malformed discovery response');
      for (const data of value.data)
        remember(
          task,
          data,
          value.source,
          value.observedAt ?? response.observed_at,
          data.raw ?? data,
          value.requestLanguage,
        );
      if (task.kind === 'catalog')
        store.run('UPDATE discovery_frontier SET consumed=1 WHERE id=?', task.frontier_id);
      store.run(
        'UPDATE discovery_tasks SET applied_response_id=?,stop_reason=? WHERE id=?',
        response.id,
        value.stopReason ?? 'bounded-public-source',
        task.id,
      );
      enqueueDetails(task.cycle_id);
      return;
    }
    const data = value.data as NormalizedApp;
    if (!value.detail || !data?.title || data.externalId !== payload.externalId)
      throw new Error('Malformed detail or mismatched externalId');
    const analysis = classifyLoan({
      ...data,
      country: task.country,
      store: task.store,
      observedAt: response.observed_at,
      raw: data.raw ?? data.storeData,
    });
    let app = store.one(
      'SELECT id FROM apps WHERE country=? AND store=? AND external_id=?',
      task.country,
      task.store,
      payload.externalId,
    );
    const receipt = (appId: number | null) => {
      store.run(
        'UPDATE discovery_candidates SET app_id=?,status=?,analysis=?,error=NULL,attempts=0 WHERE id=?',
        appId,
        appId ? 'admitted' : 'staged',
        json(analysis),
        task.candidate_id,
      );
      store.run(
        'UPDATE discovery_tasks SET applied_response_id=?,stop_reason=? WHERE id=?',
        response.id,
        appId ? 'admitted' : 'insufficient-evidence',
        task.id,
      );
      if (appId) attachSources(store, appId, { ...task, external_id: payload.externalId });
    };
    if (!app && analysis.verdict === 'insufficient') {
      store.transaction(() => receipt(null));
      return;
    }
    if (!app)
      app = store.createApp({
        country: task.country,
        store: task.store,
        externalId: payload.externalId,
        data,
        observedAt: earliestKnownDiscovery(
          store,
          { country: task.country, store: task.store, externalId: payload.externalId },
          response.observed_at,
        ),
      });
    store.saveObservation(app.id, data, response.observed_at, () => receipt(app!.id));
  }
  function pickTask(): Row | undefined {
    const cycle = store.one("SELECT * FROM discovery_cycles WHERE status='running'");
    if (!cycle) return;
    const quota = parse(cycle.settings);
    for (const market of store.all(
      'SELECT * FROM discovery_markets WHERE cycle_id=? ORDER BY last_served,country,store',
      cycle.id,
    )) {
      for (const lane of [market.next_lane, market.next_lane === 'source' ? 'detail' : 'source']) {
        const detail = lane === 'detail';
        const kind = detail ? "t.kind='detail'" : "t.kind<>'detail'";
        if (
          detail
            ? market.detail_requests >= quota.detailRequests
            : market.source_requests >= quota.sourceRequests
        ) {
          store.run(
            `UPDATE discovery_tasks AS t SET status='deferred',stop_reason='http-budget',finished_at=? WHERE cycle_id=? AND country=? AND store=? AND status='queued' AND ${kind} AND t.kind<>'catalog'`,
            stamp(),
            cycle.id,
            market.country,
            market.store,
          );
        }
        const find = (sourceKind?: string) =>
          store.one(
            `SELECT t.* FROM discovery_tasks t LEFT JOIN discovery_frontier f ON f.id=t.frontier_id LEFT JOIN discovery_candidates c ON c.id=t.candidate_id
          WHERE t.cycle_id=? AND t.country=? AND t.store=? AND t.status='queued' AND ${kind}
          ${sourceKind ? 'AND t.kind=?' : ''} ORDER BY COALESCE(c.last_served,c.created_at,f.last_served,f.created_at,''),t.id LIMIT 1`,
            cycle.id,
            market.country,
            market.store,
            ...(sourceKind ? [sourceKind] : []),
          );
        let task: Row | undefined;
        if (detail) task = find();
        else {
          const cursor = store.one(
            'SELECT source_cursor FROM discovery_rotation WHERE country=? AND store=?',
            market.country,
            market.store,
          )!.source_cursor;
          const kinds = ['search', 'similar', 'developer', 'catalog'];
          for (let n = 0; n < kinds.length; n++) {
            const position = (cursor + n) % kinds.length;
            task = find(kinds[position]);
            if (task) {
              store.run(
                'UPDATE discovery_rotation SET source_cursor=? WHERE country=? AND store=?',
                (position + 1) % kinds.length,
                market.country,
                market.store,
              );
              break;
            }
          }
        }
        if (!task) continue;
        store.run(
          'UPDATE discovery_markets SET last_served=(SELECT COALESCE(MAX(last_served),0)+1 FROM discovery_markets WHERE cycle_id=?),next_lane=? WHERE cycle_id=? AND country=? AND store=?',
          cycle.id,
          detail ? 'source' : 'detail',
          cycle.id,
          market.country,
          market.store,
        );
        store.run(
          'UPDATE discovery_rotation SET last_served=(SELECT last_served FROM discovery_markets WHERE cycle_id=? AND country=? AND store=?),next_lane=? WHERE country=? AND store=?',
          cycle.id,
          market.country,
          market.store,
          detail ? 'source' : 'detail',
          market.country,
          market.store,
        );
        return task;
      }
    }
  }
  async function runOnce() {
    if (!enabled || stopped || active) return false;
    schedule();
    const task = pickTask();
    if (!task) {
      finishCycle();
      return false;
    }
    active = task;
    controller = new AbortController();
    const signal = controller.signal;
    const attempt = store.transaction(() => {
      store.run(
        "UPDATE discovery_tasks SET status='running',attempts=attempts+1,started_at=? WHERE id=?",
        stamp(),
        task.id,
      );
      if (task.frontier_id)
        store.run(
          'UPDATE discovery_frontier SET last_served=? WHERE id=?',
          stamp(),
          task.frontier_id,
        );
      if (task.candidate_id)
        store.run(
          'UPDATE discovery_candidates SET last_served=? WHERE id=?',
          stamp(),
          task.candidate_id,
        );
      return Number(
        store.run(
          'INSERT INTO discovery_attempts(task_id,started_at) VALUES(?,?)',
          task.id,
          stamp(),
        ).lastInsertRowid,
      );
    });
    const quota = parse(
      store.one('SELECT settings FROM discovery_cycles WHERE id=?', task.cycle_id)!.settings,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let response = task.response_id
        ? store.one(
            'SELECT * FROM discovery_responses WHERE id=? AND task_id=?',
            task.response_id,
            task.id,
          )
        : undefined;
      if (!response) {
        const value = await Promise.race([
          fetchTask(task, signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller?.abort();
              reject(new Error('Discovery step timed out; source restarts from head next cycle'));
            }, quota.timeoutMs);
          }),
        ]);
        signal.throwIfAborted();
        const id = Number(
          store.run(
            'INSERT INTO discovery_responses(task_id,attempt_id,observed_at,data) VALUES(?,?,?,?)',
            task.id,
            attempt,
            stamp(),
            json(value),
          ).lastInsertRowid,
        );
        store.run('UPDATE discovery_tasks SET response_id=? WHERE id=?', id, task.id);
        response = store.one('SELECT * FROM discovery_responses WHERE id=?', id)!;
      }
      apply(task, response);
      const reason = store.one(
        'SELECT stop_reason FROM discovery_tasks WHERE id=?',
        task.id,
      )?.stop_reason;
      const status =
        reason === 'unsupported'
          ? 'unsupported'
          : reason === 'insufficient-evidence'
            ? 'staged'
            : reason === 'local-result-limit'
              ? 'deferred'
              : 'succeeded';
      store.run(
        'UPDATE discovery_tasks SET status=?,finished_at=?,error=NULL WHERE id=?',
        status,
        stamp(),
        task.id,
      );
      store.run(
        "UPDATE discovery_attempts SET status='succeeded',finished_at=? WHERE id=?",
        stamp(),
        attempt,
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const deferred =
        signal.aborted ||
        e instanceof DiscoveryBudgetError ||
        (e instanceof Error && e.name === 'DiscoveryBudgetError');
      if (!signal.aborted && e && typeof e === 'object' && 'partial' in e) {
        const partial = e.partial as ScanPage<NormalizedApp> | undefined;
        if (partial && Array.isArray(partial.data)) {
          store.run(
            'INSERT INTO discovery_responses(task_id,attempt_id,observed_at,data) VALUES(?,?,?,?)',
            task.id,
            attempt,
            stamp(),
            json(partial),
          );
          for (const row of partial.data)
            remember(task, row, partial.source, stamp(), row.raw ?? row, partial.requestLanguage);
        }
      }
      store.run(
        'UPDATE discovery_tasks SET status=?,stop_reason=?,finished_at=?,error=? WHERE id=?',
        deferred ? 'deferred' : 'failed',
        signal.aborted ? 'step-timeout-or-interrupted' : deferred ? 'http-budget' : 'source-error',
        stamp(),
        error,
        task.id,
      );
      store.run(
        'UPDATE discovery_attempts SET status=?,finished_at=?,error=? WHERE id=?',
        deferred ? 'interrupted' : 'failed',
        stamp(),
        error,
        attempt,
      );
      if (task.candidate_id && !deferred)
        store.run(
          "UPDATE discovery_candidates SET attempts=attempts+1,status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END,error=? WHERE id=?",
          error,
          task.candidate_id,
        );
      // Successful streamed rows survive an interrupted iterator even without a final response.
      enqueueDetails(task.cycle_id);
    } finally {
      if (timer) clearTimeout(timer);
      controller?.abort();
      controller = undefined;
      active = undefined;
      store.run('UPDATE discovery_state SET heartbeat_at=? WHERE id=1', stamp());
      finishCycle();
    }
    return true;
  }
  return {
    schedule,
    recover,
    runOnce,
    captureHttpRecorder,
    captureRequestBudget,
    status: () => getDiscoveryStatus(store, { enabled: enabled && !stopped }),
    stop() {
      stopped = true;
      controller?.abort();
    },
    get busy() {
      return !!active;
    },
  };
}

export function getDiscoveryStatus(store: Store, options: { enabled?: boolean } = {}) {
  const cycle = (row: Row | undefined) =>
    row
      ? {
          id: row.id,
          dueAt: row.due_at,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          status: row.status,
          counts: Object.fromEntries(
            store
              .all(
                'SELECT status,COUNT(*) n FROM discovery_tasks WHERE cycle_id=? GROUP BY status',
                row.id,
              )
              .map((r) => [r.status, r.n]),
          ),
          markets: store
            .all('SELECT * FROM discovery_markets WHERE cycle_id=? ORDER BY country,store', row.id)
            .map((r) => ({
              country: r.country,
              store: r.store,
              sourceRequests: r.source_requests,
              detailRequests: r.detail_requests,
            })),
        }
      : null;
  const state = store.one('SELECT * FROM discovery_state WHERE id=1')!;
  const totals = { pending: 0, staged: 0, admitted: 0, failed: 0 };
  for (const r of store.all('SELECT status,COUNT(*) n FROM discovery_candidates GROUP BY status'))
    totals[r.status as keyof typeof totals] = r.n;
  const current = store.one("SELECT * FROM discovery_cycles WHERE status='running'");
  const last = store.one('SELECT * FROM discovery_cycles ORDER BY id DESC LIMIT 1');
  return {
    enabled: options.enabled ?? false,
    intervalHours: 6,
    nextDueAt: state.next_due_at,
    heartbeatAt: state.heartbeat_at,
    activeCycle: cycle(current),
    lastCycle: cycle(last),
    totals,
    limits: last ? parse(last.settings) : discoveryLimits,
    coverageNote:
      '公开结果为有界样本。未发现不代表商店不存在；历史目录回收、首次发现与商店新上架分别记录。GP迭代器不公开恢复游标，中断后从头去重。',
  };
}
export function listDiscoveryCandidates(
  store: Store,
  filters: { country?: string; store?: string; status?: string; limit?: number; offset?: number },
) {
  const terms: string[] = [],
    args: string[] = [];
  for (const key of ['country', 'store', 'status'] as const)
    if (filters[key]) {
      terms.push(`c.${key}=?`);
      args.push(filters[key]!);
    }
  const where = terms.length ? `WHERE ${terms.join(' AND ')}` : '';
  return {
    total: store.one(`SELECT COUNT(*) n FROM discovery_candidates c ${where}`, ...args)!.n,
    candidates: store
      .all(
        `SELECT c.*,(SELECT COUNT(*) FROM discovery_sources s WHERE s.country=c.country AND s.store=c.store AND s.external_id=c.external_id) source_count FROM discovery_candidates c ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
        ...args,
        filters.limit ?? 20,
        filters.offset ?? 0,
      )
      .map((r) => ({
        id: r.id,
        country: r.country,
        store: r.store,
        externalId: r.external_id,
        title: r.title,
        appId: r.app_id,
        status: r.status,
        firstObservedAt: r.first_observed_at,
        lastObservedAt: r.last_observed_at,
        error: r.error,
        verdict: parse(r.analysis)?.verdict ?? null,
        sourceCount: r.source_count,
      })),
  };
}
export function discoveryIdentity(
  store: Store,
  identity: { country: string; store: string; externalId: string; limit?: number; offset?: number },
) {
  const args = [identity.country, identity.store, identity.externalId];
  const app = store.one(
    'SELECT id,classification,last_fetched_at,last_error,loan_analysis FROM apps WHERE country=? AND store=? AND external_id=?',
    ...args,
  );
  const candidate = store.one(
    'SELECT * FROM discovery_candidates WHERE country=? AND store=? AND external_id=?',
    ...args,
  );
  const hasBatch = !!store.one("SELECT name FROM sqlite_master WHERE name='full_scan_sources'");
  const sourceQueries = [
    "SELECT 'extended' channel,id,kind,source,observed_at,processed_at,keyword,parent_app_id,enrichment_history_id,data,raw FROM discovery_sources WHERE country=? AND store=? AND external_id=?",
    "SELECT 'hourly' channel,id,'hourly' kind,source,observed_at,observed_at processed_at,keyword,NULL parent_app_id,NULL enrichment_history_id,data,raw FROM monitor_sources WHERE country=? AND store=? AND external_id=?",
    ...(hasBatch
      ? [
          "SELECT 'batch' channel,id,'batch' kind,source,observed_at,observed_at processed_at,keyword,NULL parent_app_id,NULL enrichment_history_id,data,raw FROM full_scan_sources WHERE country=? AND store=? AND external_id=?",
        ]
      : []),
  ];
  const sourceArgs = sourceQueries.flatMap(() => args);
  const sources = store.all(
    `SELECT * FROM (${sourceQueries.join(' UNION ALL ')}) ORDER BY observed_at DESC,channel,id DESC LIMIT ? OFFSET ?`,
    ...sourceArgs,
    identity.limit ?? 20,
    identity.offset ?? 0,
  );
  const tasks = store
    .all(
      `SELECT t.* FROM discovery_tasks t WHERE t.country=? AND t.store=? AND
    (t.candidate_id=? OR t.id IN (SELECT task_id FROM discovery_sources WHERE country=? AND store=? AND external_id=?)) ORDER BY t.id DESC LIMIT 20`,
      identity.country,
      identity.store,
      candidate?.id ?? -1,
      ...args,
    )
    .map((t) => ({
      id: t.id,
      channel: 'extended',
      kind: t.kind,
      status: t.status,
      error: t.error,
      stopReason: t.stop_reason,
    }));
  for (const t of store.all(
    'SELECT * FROM monitor_tasks WHERE country=? AND store=? AND external_id=? ORDER BY id DESC LIMIT 10',
    ...args,
  ))
    tasks.push({
      id: t.id,
      channel: 'hourly',
      kind: t.kind,
      status: t.status,
      error: t.error,
      stopReason:
        parse(t.result)?.analysis?.verdict === 'insufficient' ? 'insufficient-evidence' : null,
    });
  if (store.one("SELECT name FROM sqlite_master WHERE name='full_scan_tasks'"))
    for (const t of store.all(
      'SELECT * FROM full_scan_tasks WHERE country=? AND store=? AND external_id=? ORDER BY id DESC LIMIT 10',
      ...args,
    ))
      tasks.push({
        id: t.id,
        channel: 'batch',
        kind: t.kind,
        status: t.status,
        error: t.error,
        stopReason: t.stop_reason,
      });
  if (app)
    for (const j of store.all(
      'SELECT * FROM jobs WHERE app_id=? ORDER BY id DESC LIMIT 10',
      app.id,
    ))
      tasks.push({
        id: j.id,
        channel: 'manual',
        kind: j.type,
        status: j.status,
        error: j.error,
        stopReason: null,
      });
  const batchCandidate = hasBatch
    ? store.one(
        'SELECT analysis,verdict FROM full_scan_candidates WHERE country=? AND store=? AND external_id=? ORDER BY observed_at DESC LIMIT 1',
        ...args,
      )
    : undefined;
  const pending = tasks.some(
    (t) => t.status === 'queued' || t.status === 'running' || t.status === 'deferred',
  );
  const failed = tasks.some((t) => t.kind === 'refresh' && t.status === 'failed');
  const status = app?.last_fetched_at
    ? 'admitted'
    : app
      ? !pending && failed
        ? 'failed'
        : 'pending'
      : (candidate?.status ??
        (batchCandidate?.verdict === 'insufficient' ||
        tasks.some((t) => t.stopReason === 'insufficient-evidence')
          ? 'staged'
          : pending
            ? 'pending'
            : tasks.some((t) => t.status === 'failed')
              ? 'failed'
              : tasks.length || sources.length
                ? 'pending'
                : 'not-discovered'));
  return {
    ...identity,
    status,
    appId: app?.id ?? null,
    classification: app?.classification ?? null,
    lastFetchedAt: app?.last_fetched_at ?? null,
    error: app?.last_error ?? candidate?.error ?? null,
    analysis: parse(app?.loan_analysis ?? candidate?.analysis ?? batchCandidate?.analysis ?? null),
    tasks,
    sourceTotal: store.one(
      `SELECT COUNT(*) n FROM (${sourceQueries.join(' UNION ALL ')})`,
      ...sourceArgs,
    )!.n,
    sources: sources.map((s) => ({
      id: `${s.channel}:${s.id}`,
      kind: s.kind,
      source: s.source,
      observedAt: s.observed_at,
      processedAt: s.processed_at,
      keyword: s.keyword,
      parentAppId: s.parent_app_id,
      enrichmentHistoryId: s.enrichment_history_id,
      data: parse(s.data),
      raw: parse(s.raw),
    })),
  };
}

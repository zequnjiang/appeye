import { randomUUID, createHash } from 'node:crypto';
import { normalizeForStore, type Store } from './db.js';
import { classifyLoan } from './loan-identification.js';
import {
  normalizeDeveloperContinuation,
  parseDeveloperSourceError,
} from './developer-continuation.js';
import {
  decodeGoogleDeveloperId,
  googleDeveloperRequestUrl,
  resolveGoogleDeveloperListingLink,
} from './developer-route.js';
import { enrichmentContext } from './providers.js';
import {
  financeCollections,
  type FullScanProviders,
  type ScanPage,
  type ScanTransportRecord,
} from './full-scan-providers.js';
import {
  enrichmentKinds,
  type EnrichmentKind,
  type NormalizedApp,
  type NormalizedReview,
  type StoreName,
} from './types.js';

export interface FullScanConfig {
  countries?: string[];
  stores?: StoreName[];
  collections?: Partial<Record<StoreName, string[]>>;
  includeSearch?: boolean;
  includeExisting?: boolean;
  includeInsufficient?: boolean;
  maxReviewPages?: number; // 0 means no local cap; Apple still stops at its public page-10 boundary.
  appleSearchPages?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}
export type ScanTaskKind = 'list' | 'search' | 'detail' | 'enrich' | 'reviews';
export interface ScanTask {
  id: number;
  batch_id: string;
  task_key: string;
  kind: ScanTaskKind;
  country: string;
  store: StoreName;
  external_id: string | null;
  app_id: number | null;
  payload: string;
  status: string;
  attempts: number;
  response: string | null;
  response_at: string | null;
  error: string | null;
  page: number;
}
const time = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value ?? null);
const hash = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');

/** Separate additive batch ledger: no changes to normal queue scheduling or worker behavior. */
export function ensureFullScanSchema(store: Store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS full_scan_runs (
      id TEXT PRIMARY KEY, config TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, seeded INTEGER NOT NULL DEFAULT 0, coverage TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS full_scan_tasks (
      id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES full_scan_runs(id), task_key TEXT NOT NULL,
      kind TEXT NOT NULL, country TEXT NOT NULL, store TEXT NOT NULL, external_id TEXT, app_id INTEGER,
      payload TEXT NOT NULL, phase INTEGER NOT NULL, page INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, next_run_at TEXT NOT NULL,
      created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, response TEXT, response_at TEXT,
      result TEXT, error TEXT, stop_reason TEXT, UNIQUE(batch_id,task_key)
    );
    CREATE INDEX IF NOT EXISTS full_scan_task_queue ON full_scan_tasks(batch_id,status,next_run_at,phase,page,id);
    CREATE TABLE IF NOT EXISTS full_scan_attempts (
      id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES full_scan_tasks(id), attempt INTEGER NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, error TEXT
    );
    CREATE TABLE IF NOT EXISTS full_scan_sources (
      id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL, task_id INTEGER NOT NULL, country TEXT NOT NULL,
      store TEXT NOT NULL, external_id TEXT NOT NULL, source TEXT NOT NULL, keyword TEXT NOT NULL,
      observed_at TEXT NOT NULL, request_language TEXT NOT NULL, data TEXT NOT NULL, raw TEXT NOT NULL, app_id INTEGER, discovery_id INTEGER,
      UNIQUE(task_id,external_id)
    );
    CREATE TABLE IF NOT EXISTS full_scan_candidates (
      batch_id TEXT NOT NULL, country TEXT NOT NULL, store TEXT NOT NULL, external_id TEXT NOT NULL,
      app_id INTEGER, verdict TEXT, analysis TEXT, detail TEXT, observed_at TEXT,
      PRIMARY KEY(batch_id,country,store,external_id)
    );
    CREATE TABLE IF NOT EXISTS full_scan_review_seen (
      batch_id TEXT NOT NULL, app_id INTEGER NOT NULL, external_id TEXT NOT NULL,
      PRIMARY KEY(batch_id,app_id,external_id)
    );
    CREATE TABLE IF NOT EXISTS full_scan_http (
      id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL, task_id INTEGER, fetched_at TEXT NOT NULL,
      url TEXT NOT NULL, method TEXT NOT NULL, status INTEGER, content_type TEXT, body TEXT, error TEXT
    );
    CREATE TABLE IF NOT EXISTS full_scan_responses (
      id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, attempt_id INTEGER NOT NULL, observed_at TEXT NOT NULL, response TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS full_scan_http_batch ON full_scan_http(batch_id);
    CREATE INDEX IF NOT EXISTS full_scan_source_identity ON full_scan_sources(batch_id,country,store,external_id,discovery_id);
    CREATE INDEX IF NOT EXISTS full_scan_app_pages ON full_scan_tasks(batch_id,app_id,kind,page,status);
    CREATE INDEX IF NOT EXISTS full_scan_summary_covering ON full_scan_tasks(
      batch_id,kind,status,stop_reason,json_extract(result,'$.added'),json_extract(result,'$.updated')
    );
  `);
}

export function createFullScanRunner(options: {
  store: Store;
  providers: FullScanProviders;
  batchId?: string;
  config?: FullScanConfig;
}) {
  const { store, providers } = options;
  ensureFullScanSchema(store);
  const batchId = options.batchId ?? randomUUID();
  const prior = store.one('SELECT * FROM full_scan_runs WHERE id=?', batchId);
  const config: Required<FullScanConfig> = prior
    ? {
        ...JSON.parse(prior.config),
        ...(options.config?.maxReviewPages !== undefined
          ? { maxReviewPages: options.config.maxReviewPages }
          : {}),
      }
    : {
        countries: ['th', 'mx', 'ph', 'pk', 'id', 'ar'],
        stores: ['google-play', 'app-store'],
        collections: financeCollections,
        includeSearch: true,
        includeExisting: true,
        includeInsufficient: false,
        maxReviewPages: 0,
        appleSearchPages: 4,
        maxAttempts: 3,
        retryDelayMs: 30000,
        timeoutMs: 90000,
        ...options.config,
      };
  if (!config.countries.length || !config.stores.length)
    throw new Error('Full scan requires countries and stores');
  for (const code of config.countries)
    if (!store.getCountry(code)) throw new Error(`Unknown country: ${code}`);
  for (const name of config.stores)
    if (!['google-play', 'app-store'].includes(name)) throw new Error(`Unknown store: ${name}`);
  for (const [name, min, max] of [
    ['maxReviewPages', 0, 10000000],
    ['appleSearchPages', 4, 4],
    ['maxAttempts', 1, 10],
    ['retryDelayMs', 0, 3600000],
    ['timeoutMs', 1, 300000],
  ] as const) {
    if (!Number.isInteger(config[name]) || config[name] < min || config[name] > max)
      throw new Error(`Invalid ${name}`);
  }
  if (!prior)
    store.run(
      'INSERT INTO full_scan_runs(id,config,status,created_at,updated_at,coverage) VALUES (?,?,?,?,?,?)',
      batchId,
      json(config),
      'queued',
      time(),
      time(),
      'Finance charts and configured searches are bounded public samples, not a census. Google reviews follow tokens; Apple reviews stop at page 10.',
    );
  else store.run('UPDATE full_scan_runs SET config=? WHERE id=?', json(config), batchId);
  let activeTask: ScanTask | null = null;
  let controller: AbortController | null = null;
  let stopping = false;
  const language = (country: string) => store.getCountry(country)?.language ?? 'en';
  const taskKey = (kind: string, country: string, name: string, target: string, extra = '') =>
    json([kind, country, name, target, extra]);
  function enqueue(input: {
    kind: ScanTaskKind;
    country: string;
    store: StoreName;
    externalId?: string;
    appId?: number;
    payload?: Record<string, unknown>;
    key?: string;
    page?: number;
  }) {
    const phase = { list: 0, search: 0, detail: 1, enrich: 2, reviews: 3 }[input.kind];
    const payload: Record<string, unknown> = {
      requestLanguage: language(input.country),
      ...input.payload,
    };
    const key =
      input.key ??
      taskKey(
        input.kind,
        input.country,
        input.store,
        input.externalId ?? '',
        input.kind === 'enrich'
          ? String(payload.kind)
          : input.kind === 'reviews'
            ? String(input.page ?? 1)
            : '',
      );
    store.run(
      'INSERT OR IGNORE INTO full_scan_tasks(batch_id,task_key,kind,country,store,external_id,app_id,payload,phase,page,next_run_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      batchId,
      key,
      input.kind,
      input.country,
      input.store,
      input.externalId ?? null,
      input.appId ?? null,
      json(payload),
      phase,
      input.page ?? 1,
      time(),
      time(),
    );
  }
  function includeApp(appId: number) {
    const app = store.getApp(appId)!;
    for (const kind of enrichmentKinds)
      enqueue({
        kind: 'enrich',
        country: app.country,
        store: app.store,
        externalId: app.externalId,
        appId,
        payload: { kind },
      });
    enqueue({
      kind: 'reviews',
      country: app.country,
      store: app.store,
      externalId: app.externalId,
      appId,
      payload: { cursor: null },
      page: 1,
    });
  }
  function retryDeveloperSourceErrors(): number {
    const sourceHttpIds = new Map<number, number>();
    const tasks = store
      .all(
        "SELECT * FROM full_scan_tasks WHERE batch_id=? AND store='google-play' AND kind='enrich' AND json_extract(payload,'$.kind')='developer' AND status='succeeded' AND stop_reason='developer-degraded'",
        batchId,
      )
      .filter((task) => {
        const payload = JSON.parse(task.payload);
        if (payload.developerSourceErrorRecovery) return false;
        const response = task.response ? JSON.parse(task.response) : null;
        if (
          !Array.isArray(response?.raw?.warnings) ||
          !response.raw.warnings.some(
            (warning: any) =>
              warning.context === 'developer' && warning.reason === 'cluster-page-parse',
          )
        )
          return false;
        const record = store.one(
          "SELECT id,status,url,body FROM full_scan_http WHERE batch_id=? AND task_id=? AND url LIKE '%rpcids=qnKhOb%' ORDER BY id DESC LIMIT 1",
          batchId,
          task.id,
        );
        if (record?.status !== 200 || typeof record.body !== 'string') return false;
        try {
          const url = new URL(record.url);
          if (
            url.origin !== 'https://play.google.com' ||
            url.username ||
            url.password ||
            url.pathname !== '/_/PlayStoreUi/data/batchexecute' ||
            url.searchParams.getAll('rpcids').length !== 1 ||
            url.searchParams.get('rpcids') !== 'qnKhOb' ||
            url.searchParams.getAll('gl').length !== 1 ||
            url.searchParams.get('gl') !== task.country ||
            url.searchParams.getAll('hl').length !== 1 ||
            url.searchParams.get('hl') !== (payload.requestLanguage ?? language(task.country))
          )
            return false;
        } catch {
          return false;
        }
        if (!parseDeveloperSourceError(record.body)) return false;
        sourceHttpIds.set(task.id, record.id);
        return true;
      });
    return requeueDeveloperTasks(tasks, sourceHttpIds);
  }
  function seed() {
    if (store.one('SELECT seeded FROM full_scan_runs WHERE id=?', batchId)?.seeded) return;
    store.transaction(() => {
      for (const country of config.countries)
        for (const name of config.stores) {
          for (const collection of config.collections[name] ?? financeCollections[name])
            enqueue({
              kind: 'list',
              country,
              store: name,
              payload: { collection },
              key: taskKey('list', country, name, collection),
            });
          if (config.includeSearch)
            for (const keyword of store.getCountry(country)!.keywords)
              enqueue({
                kind: 'search',
                country,
                store: name,
                payload: { keyword },
                key: taskKey('search', country, name, keyword, '1'),
              });
        }
      // No listApps pagination limit and no excluded filter: every existing app is explicitly covered.
      if (config.includeExisting)
        for (const app of store.all('SELECT id,country,store,external_id FROM apps ORDER BY id')) {
          enqueue({
            kind: 'detail',
            country: app.country,
            store: app.store,
            externalId: app.external_id,
            appId: app.id,
          });
          includeApp(app.id); // Even an unavailable detail must not suppress other independent methods.
        }
      store.run(
        "UPDATE full_scan_runs SET seeded=1,status='running',updated_at=? WHERE id=?",
        time(),
        batchId,
      );
    });
  }
  function recover() {
    store.run(
      "UPDATE full_scan_attempts SET status='interrupted',finished_at=?,error='Process interrupted; response/cursor retained' WHERE status='running' AND task_id IN (SELECT id FROM full_scan_tasks WHERE batch_id=?)",
      time(),
      batchId,
    );
    store.run(
      "UPDATE full_scan_tasks SET status='queued',next_run_at=?,error='Interrupted; resuming durable checkpoint' WHERE batch_id=? AND status='running'",
      time(),
      batchId,
    );
    store.run(
      "UPDATE full_scan_tasks SET status='queued',next_run_at=? WHERE batch_id=? AND status='deferred' AND (?=0 OR page<=?)",
      time(),
      batchId,
      config.maxReviewPages,
      config.maxReviewPages,
    );
    stopping = false;
    store.run(
      "UPDATE full_scan_runs SET status='running',updated_at=? WHERE id=?",
      time(),
      batchId,
    );
  }
  function retryFailed(scope?: { kind?: ScanTaskKind; taskIds?: number[] }): number {
    if (scope?.kind && !['list', 'search', 'detail', 'enrich', 'reviews'].includes(scope.kind))
      throw new Error('Invalid retry kind');
    if (
      scope?.taskIds &&
      (!scope.taskIds.length ||
        scope.taskIds.length > 1000 ||
        scope.taskIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
    )
      throw new Error('retry taskIds must contain 1..1000 positive integer IDs');
    return store.transaction(() => {
      const ids = scope?.taskIds ? [...new Set(scope.taskIds)] : null;
      if (ids)
        for (const id of ids) {
          const row = store.one('SELECT batch_id,kind FROM full_scan_tasks WHERE id=?', id);
          if (!row || row.batch_id !== batchId || (scope?.kind && row.kind !== scope.kind))
            throw new Error(`Retry task ${id} does not match the selected batch/kind`);
        }
      const clauses = ['batch_id=?', "status='failed'"],
        params: (string | number)[] = [batchId];
      if (scope?.kind) {
        clauses.push('kind=?');
        params.push(scope.kind);
      }
      if (ids) {
        clauses.push(`id IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
      }
      const changed = store.run(
        `UPDATE full_scan_tasks SET status='queued',next_run_at=?,error=NULL,payload=json_set(payload,'$.recoveryAttemptBase',attempts,'$.explicitRecoveryAt',?) WHERE ${clauses.join(' AND ')}`,
        time(),
        time(),
        ...params,
      );
      if (changed.changes)
        store.run(
          "UPDATE full_scan_runs SET status='running',updated_at=? WHERE id=?",
          time(),
          batchId,
        );
      return Number(changed.changes);
    });
  }
  function retryDeveloperWarnings(): number {
    const tasks = store
      .all(
        "SELECT * FROM full_scan_tasks WHERE batch_id=? AND store='google-play' AND kind='enrich' AND json_extract(payload,'$.kind')='developer' AND status='succeeded' AND stop_reason='developer-degraded'",
        batchId,
      )
      .filter((task) => {
        const response = task.response ? JSON.parse(task.response) : null;
        if (
          !Array.isArray(response?.raw?.warnings) ||
          !response.raw.warnings.some(
            (warning: any) =>
              warning.context === 'developer' && warning.reason === 'cluster-page-parse',
          )
        )
          return false;
        // Only the final continuation can explain the parse stop. An earlier compact page
        // does not prove that a later unknown layout is recoverable with this adapter.
        const record = store.one(
          "SELECT status,body FROM full_scan_http WHERE task_id=? AND url LIKE '%rpcids=qnKhOb%' ORDER BY id DESC LIMIT 1",
          task.id,
        );
        return (
          record?.status === 200 &&
          typeof record.body === 'string' &&
          !!normalizeDeveloperContinuation(record.body).adaptation
        );
      });
    return requeueDeveloperTasks(tasks);
  }
  function requeueDeveloperTasks(
    tasks: ReturnType<Store['all']>,
    sourceHttpIds?: Map<number, number>,
  ): number {
    store.transaction(() => {
      for (const task of tasks) {
        if (
          task.response &&
          !store.one(
            'SELECT id FROM full_scan_responses WHERE task_id=? AND response=? LIMIT 1',
            task.id,
            task.response,
          )
        ) {
          const attempt = store.one(
            'SELECT id FROM full_scan_attempts WHERE task_id=? ORDER BY id DESC LIMIT 1',
            task.id,
          );
          if (!attempt)
            throw new Error(`Developer task ${task.id} has no historical attempt ledger`);
          store.run(
            'INSERT INTO full_scan_responses(task_id,attempt_id,observed_at,response) VALUES (?,?,?,?)',
            task.id,
            attempt.id,
            task.response_at,
            task.response,
          );
        }
        const payload = {
          ...JSON.parse(task.payload),
          recoveryAttemptBase: task.attempts,
          ...(sourceHttpIds?.has(task.id)
            ? {
                developerSourceErrorRecovery: {
                  reason: 'google-play-developer-rpc-5',
                  round: 1,
                  sourceHttpId: sourceHttpIds.get(task.id),
                  previousResponseAt: task.response_at,
                  queuedAt: time(),
                },
              }
            : {}),
        };
        store.run(
          "UPDATE full_scan_tasks SET status='queued',next_run_at=?,finished_at=NULL,response=NULL,response_at=NULL,result=NULL,error=NULL,payload=? WHERE id=?",
          time(),
          json(payload),
          task.id,
        );
      }
      if (tasks.length)
        store.run(
          "UPDATE full_scan_runs SET status='running',updated_at=? WHERE id=?",
          time(),
          batchId,
        );
    });
    return tasks.length;
  }
  function recordHttp(record: ScanTransportRecord, taskId = activeTask?.id ?? null) {
    const inserted = store.run(
      'INSERT INTO full_scan_http(batch_id,task_id,fetched_at,url,method,status,content_type,body,error) VALUES (?,?,?,?,?,?,?,?,?)',
      batchId,
      taskId,
      record.fetchedAt,
      record.url,
      record.method,
      record.status,
      record.contentType,
      record.body,
      record.error,
    );
    return Number(inserted.lastInsertRowid);
  }
  function developerRouting(
    task: ScanTask,
    app: NormalizedApp,
  ): {
    developerUrl?: string;
    developerSourceHttpId?: number;
  } {
    const payload = JSON.parse(task.payload);
    if (task.store !== 'google-play' || payload.kind !== 'developer' || !app.developerId) return {};
    const detail = store.one(
      "SELECT id FROM full_scan_tasks WHERE batch_id=? AND store='google-play' AND country=? AND app_id=? AND external_id=? AND kind='detail' AND status='succeeded' ORDER BY response_at DESC,id DESC LIMIT 1",
      batchId,
      task.country,
      task.app_id!,
      app.externalId,
    );
    if (!detail) return {};
    const requestLanguage = payload.requestLanguage ?? language(task.country);
    const record = store
      .all(
        'SELECT id,url FROM full_scan_http WHERE batch_id=? AND task_id=? AND status=200 ORDER BY id DESC',
        batchId,
        detail.id,
      )
      .find((row) => {
        try {
          const url = new URL(row.url);
          return (
            url.origin === 'https://play.google.com' &&
            !url.username &&
            !url.password &&
            url.pathname === '/store/apps/details' &&
            ['id', 'gl', 'hl'].every((key) => url.searchParams.getAll(key).length === 1) &&
            url.searchParams.get('id') === app.externalId &&
            url.searchParams.get('gl') === task.country &&
            url.searchParams.get('hl') === requestLanguage
          );
        } catch {
          return false;
        }
      });
    if (!record) return {};
    const body = store.one('SELECT body FROM full_scan_http WHERE id=?', record.id)?.body;
    if (typeof body !== 'string') return {};
    const developerUrl = resolveGoogleDeveloperListingLink(
      body,
      decodeGoogleDeveloperId(app.developerId),
    );
    return developerUrl ? { developerUrl, developerSourceHttpId: record.id } : {};
  }
  function attachSources(appId: number, task: ScanTask) {
    // Atomic discovery + pointer makes restarts idempotent without changing existing Store methods.
    store.transaction(() => {
      for (const source of store.all(
        'SELECT * FROM full_scan_sources WHERE batch_id=? AND country=? AND store=? AND external_id=? AND discovery_id IS NULL',
        batchId,
        task.country,
        task.store,
        task.external_id!,
      )) {
        const observation = store.recordDiscovery(appId, {
          keyword: source.keyword,
          requestCountry: source.country,
          requestLanguage: source.request_language,
          source: source.source,
          data: JSON.parse(source.data),
          raw: JSON.parse(source.raw),
          observedAt: source.observed_at,
        });
        store.run(
          'UPDATE full_scan_sources SET app_id=?,discovery_id=? WHERE id=?',
          appId,
          observation.id,
          source.id,
        );
      }
    });
  }
  async function fetchTask(task: ScanTask) {
    const payload = JSON.parse(task.payload);
    const context = {
      country: task.country,
      language: payload.requestLanguage ?? language(task.country),
      signal: controller!.signal,
    };
    const provider = providers[task.store];
    if (task.kind === 'list') return provider.list({ ...context, collection: payload.collection });
    if (task.kind === 'search')
      return provider.search({ ...context, keyword: payload.keyword, page: task.page });
    if (task.kind === 'detail') {
      if (task.store === 'app-store' && provider.appWithPeers) {
        const peers = store.all(
          "SELECT external_id FROM full_scan_tasks WHERE batch_id=? AND country=? AND store='app-store' AND kind='detail' AND status='queued' AND COALESCE(json_extract(payload,'$.requestLanguage'),?)=? ORDER BY id LIMIT 99",
          batchId,
          task.country,
          context.language,
          context.language,
        );
        const detail = await provider.appWithPeers({
          ...context,
          externalId: task.external_id!,
          batchId,
          peerExternalIds: peers.map((row) => row.external_id),
        });
        return { _fullScanDetailEnvelope: true, ...detail };
      }
      return provider.app({ ...context, externalId: task.external_id! });
    }
    if (task.kind === 'reviews')
      return provider.reviewsPage({
        ...context,
        externalId: task.external_id!,
        cursor: payload.cursor ?? null,
        page: task.page,
      });
    const app = store.getApp(task.app_id!);
    if (!app) throw new Error('Batch enrichment app missing');
    const routing = developerRouting(task, app);
    if (task.store === 'google-play' && payload.kind === 'developer') {
      // Freeze the evidence chosen for this attempt so failures use its actual request source.
      delete payload.developerUrl;
      delete payload.developerSourceHttpId;
      Object.assign(payload, routing);
      task.payload = json(payload);
      store.run('UPDATE full_scan_tasks SET payload=? WHERE id=?', task.payload, task.id);
    }
    return provider.enrich({
      ...context,
      externalId: app.externalId,
      developerId: app.developerId,
      kind: payload.kind,
      ...routing,
    });
  }
  function applyTask(
    task: ScanTask,
    response: any,
    observedAt: string,
    responseId: number,
    legacyCachedResponse = false,
  ): { result: unknown; stopReason?: string } {
    const payload = JSON.parse(task.payload);
    if (task.kind === 'list' || task.kind === 'search') {
      const page = response as ScanPage<NormalizedApp>;
      if (!Array.isArray(page.data)) throw new Error('Invalid discovery page');
      const keyword = task.kind === 'list' ? `FINANCE:${payload.collection}` : payload.keyword;
      for (const data of page.data) {
        const existing = store.one(
          'SELECT id FROM apps WHERE store=? AND country=? AND external_id=?',
          task.store,
          task.country,
          data.externalId,
        );
        store.run(
          'INSERT OR IGNORE INTO full_scan_sources(batch_id,task_id,country,store,external_id,source,keyword,observed_at,request_language,data,raw,app_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          batchId,
          task.id,
          task.country,
          task.store,
          data.externalId,
          page.source,
          keyword,
          observedAt,
          page.requestLanguage !== undefined
            ? (page.requestLanguage ?? 'und')
            : payload.requestLanguage,
          json(data),
          json(data.raw ?? data),
          existing?.id ?? null,
        );
        store.run(
          'INSERT OR IGNORE INTO full_scan_candidates(batch_id,country,store,external_id,app_id) VALUES (?,?,?,?,?)',
          batchId,
          task.country,
          task.store,
          data.externalId,
          existing?.id ?? null,
        );
        enqueue({
          kind: 'detail',
          country: task.country,
          store: task.store,
          externalId: data.externalId,
          appId: existing?.id,
          payload: { sourceKeyword: keyword },
        });
        if (existing) attachSources(existing.id, { ...task, external_id: data.externalId });
      }
      let stopReason = page.stopReason;
      if (task.kind === 'search' && task.store === 'app-store') {
        if (!page.data.length) stopReason = 'search-empty-page';
        else if (task.page >= config.appleSearchPages) stopReason = 'itunes-search-200-limit';
        else
          enqueue({
            kind: 'search',
            country: task.country,
            store: task.store,
            payload,
            page: task.page + 1,
            key: taskKey(
              'search',
              task.country,
              task.store,
              payload.keyword,
              String(task.page + 1),
            ),
          });
      }
      return {
        result: { fetched: page.data.length, warnings: page.warnings ?? [], source: page.source },
        stopReason,
      };
    }
    if (task.kind === 'detail') {
      const data = (response?._fullScanDetailEnvelope ? response.data : response) as NormalizedApp;
      if (data.externalId !== task.external_id)
        throw new Error('Detail returned a different external ID');
      const analysis = classifyLoan({
        ...data,
        country: task.country,
        store: task.store,
        sourceKeyword: payload.sourceKeyword,
        observedAt,
      });
      let appId =
        task.app_id ??
        store.one(
          'SELECT id FROM apps WHERE store=? AND country=? AND external_id=?',
          task.store,
          task.country,
          task.external_id,
        )?.id;
      if (!appId && (analysis.verdict !== 'insufficient' || config.includeInsufficient))
        appId = store.createApp({
          store: task.store,
          country: task.country,
          externalId: data.externalId,
          sourceKeyword: payload.sourceKeyword,
          data,
        }).id;
      store.run(
        'INSERT INTO full_scan_candidates(batch_id,country,store,external_id,app_id,verdict,analysis,detail,observed_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(batch_id,country,store,external_id) DO UPDATE SET app_id=excluded.app_id,verdict=excluded.verdict,analysis=excluded.analysis,detail=excluded.detail,observed_at=excluded.observed_at',
        batchId,
        task.country,
        task.store,
        task.external_id,
        appId ?? null,
        analysis.verdict,
        json(analysis),
        json(data),
        observedAt,
      );
      const result = {
        appId: appId ?? null,
        verdict: analysis.verdict,
        admitted: !!appId,
        appliedResponseId: responseId,
        provenance: response?._fullScanDetailEnvelope
          ? response.provenance
          : { method: 'individual' },
      };
      if (appId) {
        // Identity is the persisted response, not a millisecond shared by two lanes.
        // The Store retains older snapshots without rolling back newer current data.
        const previousResult = store.one(
          'SELECT result FROM full_scan_tasks WHERE id=?',
          task.id,
        )?.result;
        if (!previousResult || JSON.parse(previousResult).appliedResponseId !== responseId) {
          // Pre-receipt versions could crash after the snapshot commit. Only that
          // legacy cached path (no prior response ledger identity) may reuse a
          // snapshot, and both normalized data and complete raw must match.
          const legacySnapshot = legacyCachedResponse
            ? store.one(
                'SELECT id FROM snapshots WHERE app_id=? AND observed_at=? AND data=? AND raw=? LIMIT 1',
                appId,
                observedAt,
                json(normalizeForStore(data, task.store)),
                json(data.raw ?? data),
              )
            : undefined;
          if (legacySnapshot)
            store.run('UPDATE full_scan_tasks SET result=? WHERE id=?', json(result), task.id);
          else
            store.saveObservation(appId, data, observedAt, () =>
              store.run('UPDATE full_scan_tasks SET result=? WHERE id=?', json(result), task.id),
            );
        }
        store.run('UPDATE full_scan_tasks SET app_id=? WHERE id=?', appId, task.id);
        attachSources(appId, task);
        includeApp(appId);
      }
      return {
        result,
        stopReason: appId ? undefined : 'insufficient-kept-in-staging',
      };
    }
    if (task.kind === 'enrich') {
      const result = {
        kind: payload.kind,
        status: response.status,
        warnings: response.raw?.warnings ?? [],
        appliedResponseId: responseId,
      };
      const previousResult = store.one(
        'SELECT result FROM full_scan_tasks WHERE id=?',
        task.id,
      )?.result;
      if (!previousResult || JSON.parse(previousResult).appliedResponseId !== responseId)
        store.saveEnrichment(task.app_id!, payload.kind, response, observedAt, () => {
          store.run('UPDATE full_scan_tasks SET result=? WHERE id=?', json(result), task.id);
        });
      return {
        result,
        stopReason:
          response.status === 'unsupported'
            ? 'unsupported'
            : response.raw?.warnings?.length
              ? 'developer-degraded'
              : undefined,
      };
    }
    const page = response as ScanPage<NormalizedReview>;
    if (!Array.isArray(page.data)) throw new Error('Invalid reviews page');
    const rows = page.data;
    const fingerprint = hash(rows.map((row) => row.externalId).sort());
    const repeated =
      rows.length > 0 &&
      store
        .all(
          "SELECT result FROM full_scan_tasks WHERE batch_id=? AND app_id=? AND kind='reviews' AND status='succeeded' AND id<>?",
          batchId,
          task.app_id!,
          task.id,
        )
        .some((row) => JSON.parse(row.result)?.fingerprint === fingerprint);
    const uniqueRows = [...new Map(rows.map((row) => [row.externalId, row])).values()];
    const previousResult = store.one(
      'SELECT result FROM full_scan_tasks WHERE id=?',
      task.id,
    )?.result;
    const existingCount = uniqueRows.filter((row) =>
      store.one(
        'SELECT id FROM reviews WHERE app_id=? AND external_id=?',
        task.app_id!,
        row.externalId,
      ),
    ).length;
    const skippedOlder = uniqueRows.filter((row) =>
      store.one(
        'SELECT id FROM reviews WHERE app_id=? AND external_id=? AND fetched_at>?',
        task.app_id!,
        row.externalId,
        observedAt,
      ),
    ).length;
    const counts = previousResult
      ? JSON.parse(previousResult)
      : {
          added: uniqueRows.length - existingCount,
          updated: existingCount - skippedOlder,
          skippedOlder,
        };
    // Commit counters before upsert, then reuse them if a saved response is replayed after interruption.
    store.run('UPDATE full_scan_tasks SET result=? WHERE id=?', json(counts), task.id);
    store.saveReviews(
      task.app_id!,
      rows,
      task.store === 'app-store' ? 'und' : (payload.requestLanguage ?? language(task.country)),
      observedAt,
    );
    for (const row of rows)
      store.run(
        'INSERT OR IGNORE INTO full_scan_review_seen VALUES (?,?,?)',
        batchId,
        task.app_id!,
        row.externalId,
      );
    let stopReason: string | undefined;
    if (!rows.length && task.store === 'app-store') stopReason = 'reviews-empty-page';
    else if (repeated) stopReason = 'reviews-repeated-page';
    else if (task.store === 'app-store' && task.page >= 10)
      stopReason = 'apple-review-page-10-limit';
    else if (task.store === 'google-play' && !page.nextCursor)
      stopReason = rows.length ? 'reviews-no-next-token' : 'reviews-empty-page';
    else if (
      task.store === 'google-play' &&
      (page.nextCursor === payload.cursor ||
        store
          .all(
            "SELECT payload FROM full_scan_tasks WHERE batch_id=? AND app_id=? AND kind='reviews'",
            batchId,
            task.app_id!,
          )
          .some((row) => JSON.parse(row.payload).cursor === page.nextCursor))
    )
      stopReason = 'reviews-token-cycle';
    else {
      enqueue({
        kind: 'reviews',
        country: task.country,
        store: task.store,
        externalId: task.external_id!,
        appId: task.app_id!,
        page: task.page + 1,
        payload: {
          cursor: page.nextCursor ?? null,
          requestLanguage: payload.requestLanguage ?? language(task.country),
        },
      });
      if (config.maxReviewPages && task.page >= config.maxReviewPages) {
        stopReason = 'local-review-page-budget';
        store.run(
          "UPDATE full_scan_tasks SET status='deferred',stop_reason='local-review-page-budget' WHERE batch_id=? AND task_key=? AND status='queued'",
          batchId,
          taskKey('reviews', task.country, task.store, task.external_id!, String(task.page + 1)),
        );
      }
    }
    return {
      result: {
        fetched: rows.length,
        added: counts.added,
        updated: counts.updated,
        skippedOlder: counts.skippedOlder ?? 0,
        fingerprint,
        nextCursor: page.nextCursor ?? null,
        source: page.source,
      },
      stopReason,
    };
  }
  function summary() {
    const counts = store.all(
      'SELECT kind,status,COUNT(*) count FROM full_scan_tasks WHERE batch_id=? GROUP BY kind,status',
      batchId,
    );
    const pending = store.one(
      "SELECT COUNT(*) n FROM full_scan_tasks WHERE batch_id=? AND status IN ('queued','running','deferred')",
      batchId,
    )!.n;
    const deferred = store.one(
      "SELECT COUNT(*) n FROM full_scan_tasks WHERE batch_id=? AND status='deferred'",
      batchId,
    )!.n;
    const failures = store.one(
      "SELECT COUNT(*) n FROM full_scan_tasks WHERE batch_id=? AND status='failed'",
      batchId,
    )!.n;
    const reasons = store.all(
      'SELECT kind,stop_reason reason,COUNT(*) count FROM full_scan_tasks WHERE batch_id=? AND stop_reason IS NOT NULL GROUP BY kind,stop_reason',
      batchId,
    );
    const warnings = reasons
      .filter((row) => /cycle|repeated|degraded/.test(row.reason))
      .reduce((sum, row) => sum + row.count, 0);
    const limited = reasons.some((row) => /limit|no-pagination/.test(row.reason));
    return {
      batchId,
      status: pending
        ? stopping || pending === deferred
          ? 'paused'
          : 'running'
        : failures
          ? 'completed-with-errors'
          : warnings
            ? 'needs-review'
            : limited
              ? 'completed-source-limited'
              : 'completed',
      pending,
      deferred,
      failures,
      warnings,
      counts,
      reasons,
      candidates: store.all(
        'SELECT verdict,COUNT(*) count,SUM(app_id IS NOT NULL) admitted FROM full_scan_candidates WHERE batch_id=? GROUP BY verdict',
        batchId,
      ),
      sourceRows: store.one('SELECT COUNT(*) n FROM full_scan_sources WHERE batch_id=?', batchId)!
        .n,
      reviewCount: store.one(
        'SELECT COUNT(*) n FROM full_scan_review_seen WHERE batch_id=?',
        batchId,
      )!.n,
      reviewWrites: store.one(
        "SELECT COALESCE(SUM(json_extract(result,'$.added')),0) added,COALESCE(SUM(json_extract(result,'$.updated')),0) updated FROM full_scan_tasks WHERE batch_id=? AND kind='reviews' AND status='succeeded'",
        batchId,
      ),
      httpRequests: store.one('SELECT COUNT(*) n FROM full_scan_http WHERE batch_id=?', batchId)!.n,
      nextRunAt:
        store.one(
          "SELECT MIN(next_run_at) next FROM full_scan_tasks WHERE batch_id=? AND status='queued'",
          batchId,
        )?.next ?? null,
      coverage:
        'Bounded finance charts/search samples; no claim of complete store enumeration. Review termination reasons distinguish source limits, local budgets and errors.',
    };
  }
  async function runOnce(): Promise<boolean> {
    if (activeTask || stopping) return false;
    const task = store.one(
      "SELECT * FROM full_scan_tasks WHERE batch_id=? AND status='queued' AND next_run_at<=? ORDER BY phase,page,id LIMIT 1",
      batchId,
      time(),
    ) as ScanTask | undefined;
    if (!task) {
      const current = summary();
      store.run(
        'UPDATE full_scan_runs SET status=?,updated_at=? WHERE id=?',
        current.status,
        time(),
        batchId,
      );
      return false;
    }
    activeTask = task;
    controller = new AbortController();
    store.run(
      "UPDATE full_scan_tasks SET status='running',attempts=attempts+1,started_at=? WHERE id=?",
      time(),
      task.id,
    );
    const attempt = Number(
      store.run(
        "INSERT INTO full_scan_attempts(task_id,attempt,started_at,status) VALUES (?,?,?,'running')",
        task.id,
        task.attempts + 1,
        time(),
      ).lastInsertRowid,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = task.response
        ? JSON.parse(task.response)
        : await Promise.race([
            fetchTask(task),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller!.abort();
                reject(new Error(`Batch task timed out after ${config.timeoutMs}ms`));
              }, config.timeoutMs);
            }),
          ]);
      if (timer) clearTimeout(timer);
      const observedAt =
        task.response_at ??
        (task.kind === 'detail' && response?._fullScanDetailEnvelope
          ? response.observedAt
          : time());
      if (!Number.isFinite(Date.parse(observedAt)))
        throw new Error('Invalid source observation time');
      const cachedResponse = task.response
        ? store.one(
            'SELECT id FROM full_scan_responses WHERE task_id=? AND observed_at=? AND response=? ORDER BY id DESC LIMIT 1',
            task.id,
            observedAt,
            json(response),
          )
        : undefined;
      const responseId = cachedResponse
        ? cachedResponse.id
        : Number(
            store.run(
              'INSERT INTO full_scan_responses(task_id,attempt_id,observed_at,response) VALUES (?,?,?,?)',
              task.id,
              attempt,
              observedAt,
              json(response),
            ).lastInsertRowid,
          );
      if (!task.response) {
        store.run(
          'UPDATE full_scan_tasks SET response=?,response_at=? WHERE id=?',
          json(response),
          observedAt,
          task.id,
        );
      }
      const applied = applyTask(
        task,
        response,
        observedAt,
        responseId,
        !!task.response && !cachedResponse,
      );
      store.run(
        "UPDATE full_scan_tasks SET status='succeeded',result=?,stop_reason=?,finished_at=?,error=NULL WHERE id=?",
        json(applied.result),
        applied.stopReason ?? null,
        time(),
        task.id,
      );
      store.run(
        "UPDATE full_scan_attempts SET status='succeeded',finished_at=? WHERE id=?",
        time(),
        attempt,
      );
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
      // A structurally invalid response must not poison all retries; its complete raw remains in the response ledger.
      if (!stopping)
        store.run(
          'UPDATE full_scan_tasks SET response=NULL,response_at=NULL,result=NULL WHERE id=?',
          task.id,
        );
      const recoveryBase = Number(JSON.parse(task.payload).recoveryAttemptBase ?? 0);
      const retry = stopping || task.attempts - recoveryBase + 1 < config.maxAttempts;
      if (task.kind === 'enrich' && task.app_id && !stopping) {
        const app = store.getApp(task.app_id)!;
        const payload = JSON.parse(task.payload);
        const kind = payload.kind as EnrichmentKind;
        const requestLanguage =
          task.store === 'app-store'
            ? 'en_us'
            : (payload.requestLanguage ?? language(task.country));
        const failureContext = enrichmentContext(task.store, {
          country: task.country,
          language: requestLanguage,
          externalId: app.externalId,
          developerId: app.developerId,
          kind,
        });
        if (task.store === 'google-play' && kind === 'developer' && app.developerId) {
          const verifiedUrl = googleDeveloperRequestUrl(
            payload.developerUrl,
            decodeGoogleDeveloperId(app.developerId),
            task.country,
            requestLanguage,
          );
          if (verifiedUrl) {
            failureContext.source = verifiedUrl;
            failureContext.note += ` 目录路径取自本批次同ID应用详情链接（HTTP ${payload.developerSourceHttpId}）；本次请求失败不能据此推断开发者已下架。`;
          } else {
            failureContext.note +=
              ' 未取得可靠的同ID listing 目录链接；沿用库默认路径选择，404不能单独证明开发者目录已下架。';
          }
        }
        store.failEnrichment(app.id, kind, message, failureContext);
      }
      if (task.kind === 'detail' && task.app_id && !stopping)
        store.setAppError(task.app_id, message);
      store.run(
        'UPDATE full_scan_tasks SET status=?,error=?,next_run_at=?,finished_at=? WHERE id=?',
        retry ? 'queued' : 'failed',
        message,
        new Date(
          Date.now() +
            (stopping ? 0 : config.retryDelayMs * 2 ** Math.max(0, task.attempts - recoveryBase)),
        ).toISOString(),
        time(),
        task.id,
      );
      store.run(
        'UPDATE full_scan_attempts SET status=?,finished_at=?,error=? WHERE id=?',
        stopping ? 'interrupted' : 'failed',
        time(),
        message,
        attempt,
      );
    } finally {
      if (timer) clearTimeout(timer);
      controller = null;
      activeTask = null;
      store.run('UPDATE full_scan_runs SET updated_at=? WHERE id=?', time(), batchId);
    }
    return true;
  }
  return {
    batchId,
    config,
    seed,
    recover,
    retryFailed,
    retryDeveloperWarnings,
    retryDeveloperSourceErrors,
    recordHttp,
    captureHttpRecorder() {
      const id = activeTask?.id ?? null;
      return (record: ScanTransportRecord) => recordHttp(record, id);
    },
    summary,
    runOnce,
    pause() {
      stopping = true;
      controller?.abort();
      store.run(
        "UPDATE full_scan_runs SET status='paused',updated_at=? WHERE id=?",
        time(),
        batchId,
      );
    },
    get busy() {
      return activeTask !== null;
    },
  };
}

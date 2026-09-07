import type { Store } from './db.js';
import { classifyLoan } from './loan-identification.js';
import {
  financeCollections,
  type FullScanProviders,
  type ScanPage,
  type ScanTransportRecord,
} from './full-scan-providers.js';
import type { CollectionCycleStatus, CollectionStatus } from './market-activity.js';
import type { NormalizedApp, StoreName } from './types.js';
import { earliestKnownDiscovery } from './manual-collection.js';

type Row = Record<string, any>;
const json = (value: unknown) => JSON.stringify(value ?? null);
const HOUR = 3600000;
export interface HourlyOptions {
  store: Store;
  providers: FullScanProviders;
  now?: () => Date;
  maxAttempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  enabled?: boolean;
}

/** Durable, bounded discovery and detail work; never schedules reviews or supplements. */
export function createHourlyRunner(options: HourlyOptions) {
  const { store, providers } = options;
  const now = options.now ?? (() => new Date());
  const stamp = () => now().toISOString();
  const maxAttempts = options.maxAttempts ?? 3,
    retryDelayMs = options.retryDelayMs ?? 30000;
  const timeoutMs = options.timeoutMs ?? 90000;
  for (const [key, n, min] of [
    ['maxAttempts', maxAttempts, 1],
    ['retryDelayMs', retryDelayMs, 0],
    ['timeoutMs', timeoutMs, 1],
  ] as const)
    if (!Number.isInteger(n) || n < min) throw new Error(`Invalid ${key}`);
  let active: Row | undefined,
    controller: AbortController | undefined,
    stopped = false;
  const enabled =
    options.enabled !== false &&
    store.one("SELECT value FROM metadata WHERE key='dataset'")?.value !== 'demo';

  function enqueue(
    cycleId: number,
    kind: string,
    country: string,
    storeName: StoreName,
    target: string,
    payload: Row,
    appId: number | null = null,
  ) {
    store.run(
      'INSERT OR IGNORE INTO monitor_tasks(cycle_id,task_key,kind,country,store,external_id,app_id,payload,next_run_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      cycleId,
      json([kind, country, storeName, target]),
      kind,
      country,
      storeName,
      kind === 'detail' ? target : null,
      appId,
      json(payload),
      stamp(),
      stamp(),
    );
  }
  function seedCountries(cycle: Row) {
    const seeded = new Set<string>(JSON.parse(cycle.countries));
    for (const country of store.listCountries().filter((c) => c.enabled)) {
      if (seeded.has(country.code)) continue;
      for (const name of ['google-play', 'app-store'] as const) {
        const requestLanguage = name === 'app-store' ? 'en_us' : country.language;
        // Finite public chart/search windows; each response and its stated bound are retained.
        for (const collection of financeCollections[name])
          enqueue(cycle.id, 'list', country.code, name, collection, {
            collection,
            requestLanguage,
          });
        for (const keyword of new Set(country.keywords))
          enqueue(cycle.id, 'search', country.code, name, keyword, {
            keyword,
            page: 1,
            requestLanguage,
            coverage:
              name === 'app-store' ? 'hourly-search-first-50' : 'bounded-sdk-search-request-250',
          });
        for (const app of store.all(
          'SELECT id,external_id FROM apps WHERE country=? AND store=?',
          country.code,
          name,
        ))
          enqueue(
            cycle.id,
            'detail',
            country.code,
            name,
            app.external_id,
            { requestLanguage },
            app.id,
          );
      }
      seeded.add(country.code);
    }
    store.run('UPDATE monitor_cycles SET countries=? WHERE id=?', json([...seeded]), cycle.id);
  }
  function finishCycle() {
    const cycle = store.one("SELECT * FROM monitor_cycles WHERE status='running'");
    if (
      !cycle ||
      store.one(
        "SELECT 1 FROM monitor_tasks WHERE cycle_id=? AND status IN ('queued','running') LIMIT 1",
        cycle.id,
      )
    )
      return;
    store.run(
      "UPDATE monitor_cycles SET status=CASE WHEN EXISTS(SELECT 1 FROM monitor_tasks WHERE cycle_id=? AND status='failed') THEN 'completed-with-errors' ELSE 'completed' END,finished_at=? WHERE id=?",
      cycle.id,
      stamp(),
      cycle.id,
    );
    for (const provider of Object.values(providers))
      provider.releaseDetailCache?.(`hourly:${cycle.id}`);
  }
  function schedule() {
    if (!enabled || stopped) return null;
    return store.transaction(() => {
      const time = stamp();
      store.run('UPDATE monitor_state SET heartbeat_at=? WHERE id=1', time);
      store.run(
        "UPDATE monitor_tasks SET status='skipped',finished_at=?,error='Country paused before automatic task started' WHERE status='queued' AND country IN (SELECT code FROM countries WHERE enabled=0)",
        time,
      );
      finishCycle();
      let cycle = store.one("SELECT * FROM monitor_cycles WHERE status='running'");
      const due = store.one('SELECT next_due_at FROM monitor_state WHERE id=1')?.next_due_at;
      if (!cycle && (!due || due <= time)) {
        // One latest cycle after downtime. Do not replay every missed historical hour.
        const dueAt = due
          ? new Date(
              Date.parse(due) + Math.floor((now().getTime() - Date.parse(due)) / HOUR) * HOUR,
            ).toISOString()
          : time;
        const insert = store.run(
          'INSERT INTO monitor_cycles(due_at,started_at) VALUES (?,?)',
          dueAt,
          time,
        );
        store.run(
          'UPDATE monitor_state SET next_due_at=? WHERE id=1',
          new Date(Date.parse(dueAt) + HOUR).toISOString(),
        );
        cycle = store.one(
          'SELECT * FROM monitor_cycles WHERE id=?',
          Number(insert.lastInsertRowid),
        );
      }
      if (cycle) seedCountries(cycle);
      return cycle?.id ?? null;
    });
  }
  function recover() {
    store.transaction(() => {
      store.run(
        "UPDATE monitor_attempts SET status='interrupted',finished_at=?,error='Process interrupted; resume saved response/checkpoint' WHERE status='running'",
        stamp(),
      );
      // An interrupted attempt remains in history; recovery resumes its response with a finite budget.
      store.run(
        "UPDATE monitor_tasks SET status=CASE WHEN attempts>=? AND response_id IS NULL THEN 'failed' ELSE 'queued' END,next_run_at=?,error='Interrupted; resuming saved checkpoint' WHERE status='running'",
        maxAttempts,
        stamp(),
      );
    });
    stopped = false;
  }
  function recordHttp(
    record: ScanTransportRecord,
    jobId?: number,
    task: Row | null = active ?? null,
  ) {
    const result = store.run(
      'INSERT INTO monitor_http(cycle_id,task_id,job_id,fetched_at,url,method,status,content_type,body,error) VALUES (?,?,?,?,?,?,?,?,?,?)',
      task?.cycle_id ?? null,
      task?.id ?? null,
      jobId ?? null,
      record.fetchedAt,
      record.url,
      record.method,
      record.status,
      record.contentType,
      record.body,
      record.error,
    );
    return Number(result.lastInsertRowid);
  }
  function attachSources(appId: number, task: Row) {
    for (const source of store.all(
      'SELECT * FROM monitor_sources WHERE cycle_id=? AND country=? AND store=? AND external_id=? AND discovery_id IS NULL',
      task.cycle_id,
      task.country,
      task.store,
      task.external_id,
    )) {
      const observation = store.recordDiscovery(appId, {
        keyword: source.keyword,
        requestCountry: source.country,
        requestLanguage: source.request_language ?? 'und',
        source: source.source,
        data: JSON.parse(source.data),
        raw: JSON.parse(source.raw),
        observedAt: source.observed_at,
      });
      store.run(
        'UPDATE monitor_sources SET app_id=?,discovery_id=? WHERE id=?',
        appId,
        observation.id,
        source.id,
      );
    }
  }
  async function fetchTask(task: Row, signal: AbortSignal) {
    const payload = JSON.parse(task.payload),
      provider = providers[task.store as StoreName];
    const context = { country: task.country, language: payload.requestLanguage, signal };
    if (task.kind === 'list') return provider.list({ ...context, collection: payload.collection });
    if (task.kind === 'search')
      return provider.search({ ...context, keyword: payload.keyword, page: 1 });
    const externalId = task.external_id;
    if (task.store === 'app-store' && provider.appWithPeers) {
      const peers = store
        .all(
          "SELECT external_id FROM monitor_tasks WHERE cycle_id=? AND kind='detail' AND status='queued' AND country=? AND store=? AND json_extract(payload,'$.requestLanguage')=? ORDER BY id LIMIT 99",
          task.cycle_id,
          task.country,
          task.store,
          payload.requestLanguage,
        )
        .map((r) => String(r.external_id));
      return {
        detail: true,
        ...(await provider.appWithPeers({
          ...context,
          externalId,
          batchId: `hourly:${task.cycle_id}`,
          peerExternalIds: peers,
        })),
      };
    }
    return {
      detail: true,
      data: await provider.app({ ...context, externalId }),
      observedAt: stamp(),
      provenance: {
        method: 'individual',
        country: task.country,
        language: payload.requestLanguage,
      },
    };
  }
  function apply(task: Row, response: Row) {
    if (task.applied_response_id === response.id) return;
    const payload = JSON.parse(task.payload),
      value = JSON.parse(response.data);
    const receipt = (result: unknown) =>
      store.run(
        'UPDATE monitor_tasks SET applied_response_id=?,result=? WHERE id=?',
        response.id,
        json(result),
        task.id,
      );
    if (task.kind !== 'detail') {
      const page = value as ScanPage<NormalizedApp>;
      if (
        !Array.isArray(page.data) ||
        !page.source ||
        page.data.some((d) => !d?.externalId || !d.title)
      )
        throw new Error('Malformed discovery response');
      store.transaction(() => {
        for (const data of page.data) {
          const existing = store.one(
            'SELECT id FROM apps WHERE country=? AND store=? AND external_id=?',
            task.country,
            task.store,
            data.externalId,
          );
          store.run(
            'INSERT OR IGNORE INTO monitor_sources(cycle_id,task_id,country,store,external_id,app_id,observed_at,source,keyword,request_language,data,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            task.cycle_id,
            task.id,
            task.country,
            task.store,
            data.externalId,
            existing?.id ?? null,
            response.observed_at,
            page.source,
            payload.keyword ?? `finance:${payload.collection}`,
            page.requestLanguage === undefined ? payload.requestLanguage : page.requestLanguage,
            json(data),
            json(data.raw ?? data),
          );
          enqueue(
            task.cycle_id,
            'detail',
            task.country,
            task.store,
            data.externalId,
            {
              requestLanguage: payload.requestLanguage,
              sourceKeyword: payload.keyword ?? `finance:${payload.collection}`,
            },
            existing?.id ?? null,
          );
          if (existing) attachSources(existing.id, { ...task, external_id: data.externalId });
        }
        receipt({
          fetched: page.data.length,
          coverage: page.stopReason ?? payload.coverage ?? 'bounded-public-chart',
          requestedWindow: payload.coverage ?? null,
          warnings: page.warnings ?? [],
        });
        store.run(
          'UPDATE countries SET last_discovery_at=? WHERE code=?',
          response.observed_at,
          task.country,
        );
      });
      return;
    }
    const data = value.data as NormalizedApp;
    if (!value.detail || !data?.title || String(data.externalId) !== task.external_id)
      throw new Error('Malformed detail or mismatched externalId');
    const observedAt = value.observedAt ?? response.observed_at;
    let app = store.one(
      'SELECT id,last_fetched_at FROM apps WHERE country=? AND store=? AND external_id=?',
      task.country,
      task.store,
      task.external_id,
    );
    const analysis = classifyLoan({
      ...data,
      country: task.country,
      store: task.store,
      sourceKeyword: payload.sourceKeyword,
      observedAt,
      raw: data.raw ?? data.storeData,
    });
    if (!app && analysis.verdict === 'insufficient') {
      store.transaction(() =>
        receipt({ admitted: false, analysis, provenance: value.provenance ?? null }),
      );
      return;
    }
    if (!app) {
      app = store.createApp({
        country: task.country,
        store: task.store,
        externalId: task.external_id,
        data,
        sourceKeyword: payload.sourceKeyword,
        observedAt: earliestKnownDiscovery(
          store,
          { country: task.country, store: task.store, externalId: task.external_id },
          observedAt,
        ),
      });
    }
    const superseded = !!app.last_fetched_at && app.last_fetched_at > observedAt;
    store.saveObservation(app.id, data, observedAt, (snapshotId) => {
      store.run('UPDATE monitor_tasks SET app_id=? WHERE id=?', app!.id, task.id);
      attachSources(app!.id, task);
      receipt({
        admitted: true,
        appId: app!.id,
        snapshotId,
        sourceObservedAt: observedAt,
        supersededByLaterObservation: superseded,
        provenance: value.provenance ?? null,
      });
    });
  }
  async function runOnce() {
    if (stopped || active || !enabled) return false;
    schedule();
    const task = store.one(
      "SELECT * FROM monitor_tasks WHERE status='queued' AND next_run_at<=? ORDER BY id LIMIT 1",
      stamp(),
    );
    if (!task) {
      finishCycle();
      return false;
    }
    const attempt = store.transaction(() => {
      store.run(
        "UPDATE monitor_tasks SET status='running',attempts=attempts+1,started_at=? WHERE id=?",
        stamp(),
        task.id,
      );
      return Number(
        store.run(
          "INSERT INTO monitor_attempts(task_id,attempt,started_at,status) VALUES (?,?,?,'running')",
          task.id,
          task.attempts + 1,
          stamp(),
        ).lastInsertRowid,
      );
    });
    active = task;
    controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let response = task.response_id
        ? store.one(
            'SELECT * FROM monitor_responses WHERE id=? AND task_id=?',
            task.response_id,
            task.id,
          )
        : undefined;
      if (!response) {
        const value = await Promise.race([
          fetchTask(task, controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller!.abort();
              reject(new Error(`Hourly operation timed out after ${timeoutMs} ms`));
            }, timeoutMs);
          }),
        ]);
        const observedAt =
          value && typeof value === 'object' && 'observedAt' in value
            ? String(value.observedAt)
            : stamp();
        const id = store.transaction(() => {
          const id = Number(
            store.run(
              'INSERT INTO monitor_responses(task_id,attempt_id,observed_at,data) VALUES (?,?,?,?)',
              task.id,
              attempt,
              observedAt,
              json(value),
            ).lastInsertRowid,
          );
          store.run('UPDATE monitor_tasks SET response_id=? WHERE id=?', id, task.id);
          return id;
        });
        response = store.one('SELECT * FROM monitor_responses WHERE id=?', id)!;
      }
      apply(task, response);
      store.transaction(() => {
        store.run(
          "UPDATE monitor_tasks SET status='succeeded',finished_at=?,error=NULL WHERE id=?",
          stamp(),
          task.id,
        );
        store.run(
          "UPDATE monitor_attempts SET status='succeeded',finished_at=? WHERE id=?",
          stamp(),
          attempt,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = stopped ? 'queued' : task.attempts + 1 >= maxAttempts ? 'failed' : 'queued';
      store.transaction(() => {
        // Bad semantic payloads are retained as history, but a retry fetches fresh evidence.
        store.run(
          'UPDATE monitor_tasks SET status=?,next_run_at=?,finished_at=?,error=?,response_id=CASE WHEN applied_response_id=response_id THEN response_id ELSE NULL END WHERE id=?',
          status,
          new Date(now().getTime() + retryDelayMs * 2 ** task.attempts).toISOString(),
          status === 'failed' ? stamp() : null,
          message,
          task.id,
        );
        store.run(
          'UPDATE monitor_attempts SET status=?,finished_at=?,error=? WHERE id=?',
          stopped ? 'interrupted' : 'failed',
          stamp(),
          message,
          attempt,
        );
        if (task.app_id) store.setAppError(task.app_id, message);
      });
    } finally {
      if (timer) clearTimeout(timer);
      controller = undefined;
      active = undefined;
      store.run('UPDATE monitor_state SET heartbeat_at=? WHERE id=1', stamp());
      finishCycle();
    }
    return true;
  }
  return {
    schedule,
    recover,
    runOnce,
    recordHttp,
    captureHttpRecorder(jobId?: number) {
      const task = active ?? null;
      return (record: ScanTransportRecord) => recordHttp(record, jobId, task);
    },
    status: () =>
      getCollectionStatus(store, {
        enabled,
        now: now(),
        mode: stopped ? 'paused' : 'coordinator',
        busy: !!active,
      }),
    stop() {
      stopped = true;
      controller?.abort();
    },
    get busy() {
      return !!active;
    },
  };
}
export type HourlyRunner = ReturnType<typeof createHourlyRunner>;

/** Pure read path; safe for authenticated status requests, including a paused CLI collector. */
export function getCollectionStatus(
  store: Store,
  options: {
    enabled?: boolean;
    now?: Date;
    mode?: CollectionStatus['collector']['mode'];
    busy?: boolean;
    batchId?: string;
  } = {},
): CollectionStatus {
  const now = options.now ?? new Date();
  const cycleStatus = (row: Row | undefined): CollectionCycleStatus | null => {
    if (!row) return null;
    const counts: Record<string, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };
    for (const count of store.all(
      'SELECT status,COUNT(*) n FROM monitor_tasks WHERE cycle_id=? GROUP BY status',
      row.id,
    ))
      counts[count.status] = count.n;
    return {
      id: row.id,
      dueAt: row.due_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      queued: counts.queued!,
      running: counts.running!,
      succeeded: counts.succeeded!,
      failed: counts.failed!,
      skipped: counts.skipped!,
    };
  };
  const state = store.one('SELECT * FROM monitor_state WHERE id=1');
  const activeCycle = cycleStatus(store.one("SELECT * FROM monitor_cycles WHERE status='running'"));
  const batchTable = store.one("SELECT name FROM sqlite_master WHERE name='full_scan_runs'");
  const batch = batchTable
    ? options.batchId
      ? store.one('SELECT id,updated_at FROM full_scan_runs WHERE id=?', options.batchId)
      : store.one('SELECT id,updated_at FROM full_scan_runs ORDER BY created_at DESC LIMIT 1')
    : undefined;
  const demo = store.one("SELECT value FROM metadata WHERE key='dataset'")?.value === 'demo';
  return {
    enabled: !demo && options.enabled !== false,
    intervalMinutes: 60,
    lastSuccessAt: store.one('SELECT MAX(last_fetched_at) at FROM apps')?.at ?? null,
    nextDueAt: state?.next_due_at ?? null,
    lastCycle: cycleStatus(store.one('SELECT * FROM monitor_cycles ORDER BY id DESC LIMIT 1')),
    activeCycle,
    overdue: !!state?.next_due_at && state.next_due_at <= now.toISOString(),
    overdueApps: store.one(
      'SELECT COUNT(*) n FROM apps a JOIN countries c ON c.code=a.country WHERE c.enabled=1 AND (a.last_fetched_at IS NULL OR a.last_fetched_at<?)',
      new Date(now.getTime() - HOUR).toISOString(),
    )!.n,
    collector: {
      mode: demo ? 'demo' : (options.mode ?? 'external'),
      lastHeartbeatAt: state?.heartbeat_at ?? null,
      busy: options.busy ?? false,
    },
    batch: batch
      ? {
          id: batch.id,
          lastProgressAt: batch.updated_at,
          pending: store.one(
            "SELECT COUNT(*) n FROM full_scan_tasks WHERE batch_id=? AND status IN ('queued','running','deferred')",
            batch.id,
          )!.n,
          reviewFailed: store.one(
            "SELECT COUNT(*) n FROM full_scan_tasks WHERE batch_id=? AND kind='reviews' AND status='failed'",
            batch.id,
          )!.n,
        }
      : null,
    failures: store.all(
      "SELECT id,kind,country,store,app_id appId,error,attempts FROM monitor_tasks WHERE status='failed' ORDER BY id DESC LIMIT 20",
    ) as CollectionStatus['failures'],
  };
}

import type { Store } from './db.js';
import {
  createFullScanProviders,
  type FullScanProviderOptions,
  type FullScanProviders,
  type ScanTransportRecord,
} from './full-scan-providers.js';
import { createFullScanRunner } from './full-scan.js';
import { createHourlyRunner, getCollectionStatus, type HourlyOptions } from './hourly-monitor.js';
import { createWorker } from './worker.js';
import type { Providers } from './types.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { coalesceCoveredJobs, createManualJournal } from './manual-collection.js';

export interface CollectionLane {
  runOnce(): Promise<boolean>;
  stop?(): void;
  pause?(): void;
}
/** At most three hourly tasks before a ready batch task; one manual slot follows each round. */
export function createFairDispatcher(lanes: {
  hourly: CollectionLane;
  batch?: CollectionLane;
  manual?: CollectionLane;
}) {
  let position = 0,
    busy = false,
    stopped = false;
  const order = ['hourly', 'hourly', 'hourly', 'batch', 'manual'] as const;
  return {
    async runOnce() {
      if (busy || stopped) return false;
      busy = true;
      try {
        for (let checked = 0; checked < order.length; checked++) {
          const lane = lanes[order[position++ % order.length]!];
          if (lane && (await lane.runOnce())) return true;
        }
        return false;
      } finally {
        busy = false;
      }
    },
    stop() {
      stopped = true;
      for (const lane of Object.values(lanes)) {
        lane?.stop?.();
        lane?.pause?.();
      }
    },
    get busy() {
      return busy;
    },
  };
}

export interface CoordinatorOptions {
  store: Store;
  providers?: FullScanProviders;
  providerOptions?: Omit<FullScanProviderOptions, 'onResponse'>;
  now?: () => Date;
  enabled?: boolean;
  hourlyOptions?: Pick<HourlyOptions, 'maxAttempts' | 'retryDelayMs' | 'timeoutMs'>;
  batchId?: string;
  intervalMs?: number;
  onBatchProgress?: (
    summary: ReturnType<ReturnType<typeof createFullScanRunner>['summary']>,
  ) => void;
}

export function createCollectionCoordinator(options: CoordinatorOptions) {
  const { store } = options;
  if (store.one("SELECT value FROM metadata WHERE key='dataset'")?.value === 'demo')
    throw new Error('Demo database cannot run a live coordinator');
  type Owner = 'hourly' | 'batch' | 'manual';
  const requestOwner = new AsyncLocalStorage<Owner>();
  const requestRecorder = new AsyncLocalStorage<(record: ScanTransportRecord) => number>();
  const manualJournal = createManualJournal({ store, now: options.now });
  let hourly: ReturnType<typeof createHourlyRunner>;
  let batch: ReturnType<typeof createFullScanRunner> | undefined;
  const recordHttp = (record: ScanTransportRecord) => {
    const recorder = requestRecorder.getStore();
    if (recorder) return recorder(record);
    throw new Error('HTTP outside the single coordinator lane');
  };
  // This is the only real transport instance: both stores, all lanes and bulk requests
  // share its global pace, iTunes-specific interval and Retry-After cooldown.
  const transportProviders =
    options.providers ??
    createFullScanProviders({ ...options.providerOptions, onResponse: recordHttp });
  const providers = Object.fromEntries(
    Object.entries(transportProviders).map(([name, provider]) => {
      const wrapped = { ...provider };
      for (const method of [
        'list',
        'search',
        'app',
        'appWithPeers',
        'enrich',
        'reviewsPage',
      ] as const) {
        const operation = provider[method];
        if (!operation) continue;
        (wrapped as any)[method] = (input: any) => {
          const owner = requestOwner.getStore();
          const manualJobId =
            owner === 'manual'
              ? store.one("SELECT id FROM jobs WHERE status='running' ORDER BY id LIMIT 1")?.id
              : undefined;
          const recorder =
            owner === 'batch' && batch
              ? batch.captureHttpRecorder()
              : owner === 'hourly'
                ? hourly.captureHttpRecorder()
                : owner === 'manual'
                  ? hourly.captureHttpRecorder(manualJobId)
                  : undefined;
          if (!recorder) throw new Error('Provider called outside coordinator ownership');
          // Async context retains the original task even if its aborted request settles
          // after a timeout and the next fair lane has begun.
          return requestRecorder.run(recorder, () => {
            if (owner === 'manual' && ['app', 'reviewsPage', 'enrich'].includes(method))
              return manualJournal.invoke<unknown>(
                manualJobId,
                method === 'reviewsPage' ? 'reviews' : (method as 'app' | 'enrich'),
                input,
                () => operation(input),
              );
            return operation(input);
          });
        };
      }
      return [name, wrapped];
    }),
  ) as FullScanProviders;
  hourly = createHourlyRunner({
    ...options.hourlyOptions,
    store,
    providers,
    now: options.now,
    enabled: options.enabled,
  });
  const table = store.one("SELECT name FROM sqlite_master WHERE name='full_scan_runs'");
  const saved = table
    ? options.batchId
      ? store.one('SELECT id,seeded FROM full_scan_runs WHERE id=?', options.batchId)
      : store.one(
          "SELECT id,seeded FROM full_scan_runs r WHERE seeded=1 AND EXISTS(SELECT 1 FROM full_scan_tasks t WHERE t.batch_id=r.id AND t.status IN ('queued','running')) ORDER BY created_at DESC LIMIT 1",
        )
    : undefined;
  if (options.batchId && !saved)
    throw new Error(
      `Unknown existing batch ${options.batchId}; coordinator never creates or seeds a scan`,
    );
  if (saved) {
    if (!saved.seeded) throw new Error('Coordinator only resumes an already seeded batch');
    batch = createFullScanRunner({ store, providers, batchId: saved.id });
    batch.recover(); // Never seed: the historical cohort stays frozen.
  }
  const manualProviders = Object.fromEntries(
    Object.entries(providers).map(([name, provider]) => [
      name,
      {
        app: provider.app,
        search: async (input: Parameters<Providers['google-play']['search']>[0]) =>
          (await provider.search({ ...input, page: 1 })).data,
        reviews: async (input: Parameters<Providers['google-play']['reviews']>[0]) => {
          const page = await provider.reviewsPage({ ...input, page: 1, cursor: null });
          manualJournal.alias(page.data, page);
          return page.data;
        },
        enrich: provider.enrich,
      },
    ]),
  ) as Providers;
  const worker = createWorker({
    store,
    providers: manualProviders,
    requestDelayMs: 0,
    timeoutMs: 90000,
    schedule: false,
    observation: manualJournal.receipt,
  });
  hourly.recover();
  store.recoverRunningJobs();
  if (batch) coalesceCoveredJobs(store, batch.batchId, options.now);
  let stopped = false,
    started = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    lastPublished = 0;
  const lane = (name: Owner, run: () => Promise<boolean>) => ({
    async runOnce() {
      return requestOwner.run(name, run);
    },
  });
  const dispatcher = createFairDispatcher({
    hourly: lane('hourly', hourly.runOnce),
    batch: batch ? lane('batch', batch.runOnce) : undefined,
    manual: lane('manual', worker.runOnce),
  });
  const status = () =>
    getCollectionStatus(store, {
      enabled: options.enabled !== false,
      now: options.now?.(),
      mode: stopped ? 'paused' : 'coordinator',
      busy: dispatcher.busy,
      batchId: batch?.batchId,
    });
  async function runOnce() {
    if (stopped) return false;
    hourly.schedule();
    const done = await dispatcher.runOnce();
    store.run(
      'UPDATE monitor_state SET heartbeat_at=? WHERE id=1',
      (options.now?.() ?? new Date()).toISOString(),
    );
    if (batch && options.onBatchProgress && Date.now() - lastPublished >= 15000) {
      options.onBatchProgress(batch.summary());
      lastPublished = Date.now();
    }
    return done;
  }
  async function tick() {
    if (stopped) return;
    let done = false;
    try {
      done = await runOnce();
    } catch (error) {
      console.error('Collection coordinator tick failed', error);
    } finally {
      if (!stopped) timer = setTimeout(tick, done ? 0 : (options.intervalMs ?? 1000));
    }
  }
  return {
    hourly,
    batch,
    worker,
    providers,
    manualJournal,
    recordHttp,
    status,
    runOnce,
    start() {
      if (started || stopped) return;
      started = true;
      void tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      hourly.stop();
      worker.stop();
      batch?.pause();
      dispatcher.stop();
    },
    get busy() {
      return dispatcher.busy;
    },
  };
}

import type { Store } from './db.js';
import { enrichmentKinds, type Job, type Providers } from './types.js';
import { enrichmentContext } from './providers.js';
import type { ManualReceipt } from './manual-collection.js';

export interface WorkerOptions {
  store: Store;
  providers: Providers;
  intervalMs?: number;
  requestDelayMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  schedule?: boolean;
  observation?: (value: unknown) => ManualReceipt | undefined;
}
export function createWorker(options: WorkerOptions) {
  const { store, providers } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let busy = false;
  let lastRequestAt = 0;
  const delay = options.requestDelayMs ?? 1500;
  async function request<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const wait = Math.max(0, delay - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(() => fn(controller.signal)),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error(`采集超时（${options.timeoutMs ?? 30000} ms）`));
          }, options.timeoutMs ?? 30000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  async function execute(job: Job) {
    const country = store.getCountry(job.country);
    if (!country) throw new Error('国家配置不存在');
    const provider = providers[job.store];
    const context = { country: country.code, language: country.language };
    if (job.type === 'discover') {
      let found = 0;
      const errors: string[] = [];
      const seen = new Set<string>();
      for (const keyword of country.keywords) {
        store.updateJobProgress(job.id, `搜索：${keyword}`);
        try {
          const results = await request((signal) =>
            provider.search({ ...context, keyword, signal }),
          );
          for (const data of results) {
            const app = store.createApp({
              store: job.store,
              externalId: data.externalId,
              country: job.country,
              sourceKeyword: keyword,
              data,
            });
            store.recordDiscovery(app.id, {
              keyword,
              requestCountry: country.code,
              requestLanguage: country.language,
              source:
                job.store === 'google-play'
                  ? `https://play.google.com/store/search?c=apps&q=${encodeURIComponent(keyword)}&gl=${country.code}&hl=${country.language}`
                  : `https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&country=${country.code}&lang=${country.language}`,
              data,
              raw: data.raw ?? data,
            });
            if (app.classification !== 'excluded')
              store.enqueueJob({
                type: 'refresh',
                country: job.country,
                store: job.store,
                appId: app.id,
                maxAttempts: options.maxAttempts,
              });
            if (!seen.has(data.externalId)) {
              seen.add(data.externalId);
              found++;
            }
          }
        } catch (error) {
          errors.push(`${keyword}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (errors.length)
        throw new Error(
          `发现 ${found} 个候选；${errors.length} 个关键词失败。${errors.join('；')}`,
        );
      store.markDiscovered(job.country);
      return {
        found,
        keywords: country.keywords.length,
        coverage: '关键词搜索样本，不代表完整市场',
      };
    }
    const app = job.appId ? store.getApp(job.appId) : undefined;
    if (!app) throw new Error('任务关联的应用不存在');
    if (job.type === 'refresh') {
      store.updateJobProgress(job.id, `采集应用：${app.title}`);
      const data = await request((signal) =>
        provider.app({ ...context, externalId: app.externalId, signal }),
      );
      const receipt = options.observation?.(data);
      const snapshot = receipt?.alreadyApplied
        ? undefined
        : store.saveObservation(app.id, data, receipt?.observedAt, receipt?.onSaved);
      store.enqueueJob({
        type: 'reviews',
        country: app.country,
        store: app.store,
        appId: app.id,
        maxAttempts: options.maxAttempts,
      });
      store.enqueueJob({
        type: 'enrich',
        country: app.country,
        store: app.store,
        appId: app.id,
        maxAttempts: options.maxAttempts,
      });
      return {
        appId: app.id,
        snapshotId: snapshot?.id ?? null,
        responseId: receipt?.responseId ?? null,
        sourceObservedAt: receipt?.observedAt ?? null,
      };
    }
    if (job.type === 'enrich') {
      const errors: string[] = [];
      const results: Record<string, string> = {};
      for (const kind of enrichmentKinds) {
        const input = {
          ...context,
          externalId: app.externalId,
          developerId: app.developerId,
          kind,
        };
        store.updateJobProgress(job.id, `补充商店信息：${kind}`);
        try {
          const result = provider.enrich
            ? await request((signal) => provider.enrich!({ ...input, signal }))
            : {
                ...enrichmentContext(job.store, input),
                status: 'unsupported' as const,
                data: null,
                raw: null,
                note: '当前适配器未实现补充信息方法',
              };
          const receipt = options.observation?.(result);
          if (!receipt?.alreadyApplied)
            store.saveEnrichment(app.id, kind, result, receipt?.observedAt, receipt?.onSaved);
          results[kind] = result.status;
        } catch (error) {
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
          store.failEnrichment(app.id, kind, message, enrichmentContext(job.store, input));
          results[kind] = 'failed';
          errors.push(`${kind}: ${message}`);
        }
      }
      if (errors.length)
        throw new Error(`补充信息部分失败（其余结果已保存）：${errors.join('；')}`);
      return { appId: app.id, enrichments: results };
    }
    store.updateJobProgress(job.id, `采集最新评论：${app.title}`);
    const reviews = await request((signal) =>
      provider.reviews({ ...context, externalId: app.externalId, signal }),
    );
    const receipt = options.observation?.(reviews);
    const replayed = receipt?.alreadyApplied ?? false;
    const skippedOlder =
      receipt && !replayed
        ? [...new Set(reviews.map((row) => row.externalId))].filter((externalId) =>
            store.one(
              'SELECT id FROM reviews WHERE app_id=? AND external_id=? AND fetched_at>?',
              app.id,
              externalId,
              receipt.observedAt,
            ),
          ).length
        : 0;
    const stored = replayed
      ? 0
      : store.saveReviews(
          app.id,
          reviews,
          job.store === 'app-store' ? 'und' : country.language,
          receipt?.observedAt,
          receipt?.onSaved,
        );
    return {
      fetched: reviews.length,
      upserted: stored,
      responseId: receipt?.responseId ?? null,
      sourceObservedAt: receipt?.observedAt ?? null,
      replayed,
      skippedOlder,
      window:
        job.store === 'google-play'
          ? '最新 100 条，按配置语言及店面请求'
          : '最新第 1 页，按国家店面请求；语言未验证',
      country: app.country,
      language: job.store === 'app-store' ? 'und' : country.language,
    };
  }
  async function runOnce(): Promise<boolean> {
    if (busy) return false;
    busy = true;
    try {
      const job = store.claimJob();
      if (!job) return false;
      try {
        store.completeJob(job.id, await execute(job));
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
        if (job.appId && job.type !== 'enrich') store.setAppError(job.appId, message);
        store.failJob(
          job.id,
          message,
          (options.retryDelayMs ?? 30000) * 2 ** Math.max(0, job.attempts - 1),
        );
      }
      return true;
    } finally {
      busy = false;
    }
  }
  async function tick() {
    if (stopped) return;
    try {
      if (options.schedule !== false) store.scheduleDueJobs();
      await runOnce();
    } catch (error) {
      console.error('Worker tick failed', error);
    } finally {
      if (!stopped) timer = setTimeout(tick, options.intervalMs ?? 2000);
    }
  }
  return {
    runOnce,
    start() {
      if (!stopped) return;
      stopped = false;
      store.recoverRunningJobs();
      void tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    get busy() {
      return busy;
    },
  };
}
export type Worker = ReturnType<typeof createWorker>;

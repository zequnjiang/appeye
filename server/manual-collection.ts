import type { Store } from './db.js';
import { enrichmentKinds } from './types.js';

export interface ManualReceipt {
  responseId: number;
  observedAt: string;
  readonly alreadyApplied: boolean;
  /** Called inside the existing Store write transaction, never in a nested transaction. */
  onSaved(): void;
}

/** Successful manual payloads survive process interruption independently of job completion. */
export function createManualJournal(options: { store: Store; now?: () => Date }) {
  const { store } = options;
  const stamp = () => (options.now?.() ?? new Date()).toISOString();
  const receipts = new WeakMap<object, ManualReceipt>();
  return {
    async invoke<T>(
      jobId: number,
      kind: 'app' | 'reviews' | 'enrich',
      input: Record<string, any>,
      operation: () => Promise<T>,
    ): Promise<T> {
      const job = store.getJob(jobId);
      const app = job?.appId ? store.getApp(job.appId) : undefined;
      if (
        !job ||
        job.status !== 'running' ||
        !app ||
        job.country !== input.country ||
        app.country !== job.country ||
        app.store !== job.store ||
        app.externalId !== input.externalId
      )
        throw new Error('Manual response does not match its running job identity');
      // AbortSignal is deliberately absent. Country/language and endpoint arguments
      // are part of the cache identity; retries do not borrow another request context.
      const key = JSON.stringify({
        kind,
        country: input.country,
        language: input.language,
        externalId: input.externalId,
        enrichment: input.kind ?? null,
        developerId: input.developerId ?? null,
        page: input.page ?? null,
        cursor: input.cursor ?? null,
      });
      let row = store.one(
        'SELECT * FROM manual_responses WHERE job_id=? AND response_key=?',
        jobId,
        key,
      );
      let value: T;
      if (row) value = JSON.parse(row.data);
      else {
        value = await operation();
        if (input.signal?.aborted)
          throw new Error('Manual request aborted before response application');
        const data = value as any;
        if (
          !data ||
          typeof data !== 'object' ||
          (kind === 'app' && (!data.title || String(data.externalId) !== app.externalId)) ||
          (kind === 'reviews' &&
            (!Array.isArray(data.data) ||
              data.data.some((r: any) => !r?.externalId || typeof r.text !== 'string'))) ||
          (kind === 'enrich' && !['available', 'empty', 'unsupported'].includes(data.status))
        )
          throw new Error('Malformed manual response');
        const id = Number(
          store.run(
            'INSERT INTO manual_responses(job_id,job_attempt,kind,app_id,country,store,request_language,response_key,observed_at,data) VALUES (?,?,?,?,?,?,?,?,?,?)',
            jobId,
            job.attempts,
            kind,
            app.id,
            job.country,
            job.store,
            kind === 'enrich'
              ? (data.requestLanguage ?? null)
              : job.store === 'app-store'
                ? kind === 'app'
                  ? 'en_us'
                  : null
                : input.language,
            key,
            stamp(),
            JSON.stringify(value),
          ).lastInsertRowid,
        );
        row = store.one('SELECT * FROM manual_responses WHERE id=?', id)!;
      }
      const responseId = Number(row.id);
      receipts.set(value as object, {
        responseId,
        observedAt: row.observed_at,
        get alreadyApplied() {
          return !!store.one('SELECT applied_at FROM manual_responses WHERE id=?', responseId)
            ?.applied_at;
        },
        onSaved() {
          const written = store.run(
            'UPDATE manual_responses SET applied_at=? WHERE id=? AND applied_at IS NULL',
            stamp(),
            responseId,
          );
          if (!written.changes) throw new Error('Manual response was already applied');
        },
      });
      return value;
    },
    receipt(value: unknown): ManualReceipt | undefined {
      return value && typeof value === 'object' ? receipts.get(value) : undefined;
    },
    alias(child: object, parent: object) {
      const receipt = receipts.get(parent);
      if (receipt) receipts.set(child, receipt);
    },
  };
}

/** Replace only pre-batch queued windows that have stronger, later, durable coverage. */
export function coalesceCoveredJobs(store: Store, batchId: string, now = () => new Date()): number {
  if (!store.one("SELECT name FROM sqlite_master WHERE name='full_scan_runs'")) return 0;
  const batch = store.one('SELECT created_at FROM full_scan_runs WHERE id=? AND seeded=1', batchId);
  if (!batch) return 0;
  return store.transaction(() => {
    let count = 0;
    for (const job of store.all(
      "SELECT * FROM jobs WHERE status='queued' AND type IN ('reviews','enrich') AND created_at<=? ORDER BY id",
      batch.created_at,
    )) {
      const app = store.getApp(job.app_id),
        country = store.getCountry(job.country);
      if (!app || !country || app.country !== job.country || app.store !== job.store) continue;
      const tasks = store.all(
        'SELECT * FROM full_scan_tasks WHERE batch_id=? AND app_id=? AND kind=? ORDER BY page,id',
        batchId,
        app.id,
        job.type,
      );
      if (
        !tasks.length ||
        tasks.some(
          (t) =>
            t.status !== 'succeeded' ||
            t.country !== app.country ||
            t.store !== app.store ||
            t.external_id !== app.externalId ||
            (t.stop_reason &&
              ![
                'unsupported',
                'reviews-empty-page',
                'reviews-no-next-token',
                'apple-review-page-10-limit',
              ].includes(t.stop_reason)),
        )
      )
        continue;
      const selected = job.type === 'reviews' ? tasks.filter((t) => t.page === 1) : tasks;
      if (
        job.type === 'reviews'
          ? selected.length !== 1
          : selected.length !== enrichmentKinds.length ||
            enrichmentKinds.some(
              (kind) => !selected.some((t) => JSON.parse(t.payload).kind === kind),
            )
      )
        continue;
      const proofs: Array<{
        taskId: number;
        responseId: number;
        kind: string;
        sourceObservedAt: string;
      }> = [];
      for (const task of selected) {
        const payload = JSON.parse(task.payload);
        if (app.store === 'google-play' && payload.requestLanguage !== country.language) break;
        const response = store.one(
          "SELECT r.* FROM full_scan_responses r JOIN full_scan_attempts a ON a.id=r.attempt_id AND a.task_id=r.task_id WHERE r.task_id=? AND r.observed_at=? AND r.response=? AND a.status='succeeded' ORDER BY r.id DESC LIMIT 1",
          task.id,
          task.response_at,
          task.response,
        );
        if (!response || response.observed_at < job.created_at) break;
        const value = JSON.parse(response.response);
        if (value.warnings?.length || value.raw?.warnings?.length) break;
        if (job.type === 'reviews') {
          if (!Array.isArray(value.data)) break;
        } else if (
          !['available', 'empty', 'unsupported'].includes(value.status) ||
          (value.requestCountry != null && value.requestCountry !== app.country) ||
          (app.store === 'google-play' &&
            value.requestLanguage != null &&
            value.requestLanguage !== country.language)
        )
          break;
        proofs.push({
          taskId: task.id,
          responseId: response.id,
          kind: payload.kind ?? 'reviews',
          sourceObservedAt: response.observed_at,
        });
      }
      if (proofs.length !== selected.length) continue;
      store.run(
        "UPDATE jobs SET status='succeeded',result=?,finished_at=?,error=NULL,progress='已由较晚批次观测覆盖（未重新请求）' WHERE id=? AND status='queued'",
        JSON.stringify({
          coalesced: true,
          batchId,
          coverage: job.type === 'reviews' ? 'recent-review-page' : 'seven-enrichments',
          sourceObservedAt: proofs.map((p) => p.sourceObservedAt).sort()[0],
          proofs,
        }),
        now().toISOString(),
        job.id,
      );
      count++;
    }
    return count;
  });
}

/** Only new main records use this; historical main firstSeen values remain untouched. */
export function earliestKnownDiscovery(
  store: Store,
  identity: { country: string; store: string; externalId: string },
  fallback: string,
): string {
  const candidates = [fallback];
  for (const table of ['monitor_sources', 'full_scan_sources', 'discovery_sources']) {
    if (!store.one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table)) continue;
    const row = store.one(
      `SELECT MIN(observed_at) observed_at FROM ${table} WHERE country=? AND store=? AND external_id=?`,
      identity.country,
      identity.store,
      identity.externalId,
    );
    if (row?.observed_at && Number.isFinite(Date.parse(row.observed_at)))
      candidates.push(new Date(row.observed_at).toISOString());
  }
  const discovery = store.one(
    'SELECT MIN(d.observed_at) observed_at FROM discovery_observations d JOIN apps a ON a.id=d.app_id WHERE a.country=? AND a.store=? AND a.external_id=?',
    identity.country,
    identity.store,
    identity.externalId,
  );
  if (discovery?.observed_at && Number.isFinite(Date.parse(discovery.observed_at)))
    candidates.push(new Date(discovery.observed_at).toISOString());
  return candidates.sort()[0]!;
}

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createStore } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createFullScanRunner, type FullScanConfig } from '../server/full-scan.js';
import { createFullScanProviders } from '../server/full-scan-providers.js';
import type { StoreName } from '../server/types.js';

const help = `Appeye finance scan (public source bounds apply; not a full-store census)

Stop the ordinary worker and back up SQLite before running. The runner owns the sole writer.
FULL_SCAN_WORKER_STOPPED=true npx tsx scripts/full-scan.ts --batch-id finance-YYYY-MM-DD --serve
npx tsx scripts/full-scan.ts --batch-id finance-YYYY-MM-DD --status

  --batch-id ID           Stable ID; same ID resumes checkpoints, never redoes successful pages
  --status                Read-only status; does not migrate, create, seed or fetch anything
  --retry-failed          Requeue failed tasks in this batch; successful tasks remain untouched
  --retry-warnings        Explicitly retry only Google developer-degraded tasks, preserving old evidence
  --retry-developer-source-errors  One marked recovery round for verified Google developer RPC code 5
                                  Repeated partial results keep their warning; no completeness guarantee
  --serve                 Serve the authenticated existing dashboard with no ordinary worker
  --port 3000             Dashboard port; host defaults to HOST or 127.0.0.1
  --database PATH         Defaults to DATABASE_PATH or data/appeye.sqlite
  --countries th,mx,...   New batch discovery countries (existing apps still all included)
  --stores google-play,app-store
  --max-tasks N           Pause after N tasks; queued continuation remains resumable
  --max-minutes N         Pause after duration; does not label the slice complete
  --max-review-pages N    Optional per-app pause with durable continuation; 0 removes local cap
  --delay-ms 500          Global HTTP start interval; iTunes search/lookup still >=3100ms
  --apple-batch-size 50   Lookup cache batch size (0 disables, max100); missing IDs/screenshots use normal app()
  --timeout-ms 30000      Per HTTP timeout; a whole paginated operation has a 90s deadline
  --retry-delay-ms 30000  Initial task retry delay, then exponential backoff
  --max-attempts 3        Attempts per task before recording failure
  --report PATH          Incremental machine-readable status (default data/batches/ID.json)
  --help

Google Finance: 3 charts, no chart cursor, approximately 200 rows per chart.
Apple Finance: iPhone+iPad free/paid/grossing, at most 200 rows per chart.
Search: configured country keywords, Google max250; Apple max200, 50-row slices.
Reviews: Google token pagination to source end; Apple public pages1..10. Repeated tokens/pages need review.
New strong/possible loan apps enter the app library; insufficient matches remain in durable batch staging.
Every existing app (including excluded) receives detail, all seven supplement kinds, and review-page attempts.
`;

function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} must be an integer in ${min}..${max}`);
  return n;
}
export function readFullScanStatus(databasePath: string, batchId?: string) {
  if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='full_scan_runs'")
      .get();
    if (!table) return { batchId: batchId ?? null, status: 'not-started' };
    const run = batchId
      ? db.prepare('SELECT * FROM full_scan_runs WHERE id=?').get(batchId)
      : db.prepare('SELECT * FROM full_scan_runs ORDER BY created_at DESC LIMIT 1').get();
    if (!run) return { batchId: batchId ?? null, status: 'not-found' };
    const id = String(run.id);
    return {
      ...run,
      config: JSON.parse(String(run.config)),
      tasks: db
        .prepare(
          'SELECT kind,status,COUNT(*) count FROM full_scan_tasks WHERE batch_id=? GROUP BY kind,status',
        )
        .all(id),
      stops: db
        .prepare(
          'SELECT kind,stop_reason reason,COUNT(*) count FROM full_scan_tasks WHERE batch_id=? AND stop_reason IS NOT NULL GROUP BY kind,stop_reason',
        )
        .all(id),
      countries: db
        .prepare(
          'SELECT country,store,kind,status,COUNT(*) count FROM full_scan_tasks WHERE batch_id=? GROUP BY country,store,kind,status',
        )
        .all(id),
      candidates: db
        .prepare(
          'SELECT verdict,COUNT(*) count,SUM(app_id IS NOT NULL) admitted FROM full_scan_candidates WHERE batch_id=? GROUP BY verdict',
        )
        .all(id),
      reviewWrites: db
        .prepare(
          "SELECT COALESCE(SUM(json_extract(result,'$.added')),0) added,COALESCE(SUM(json_extract(result,'$.updated')),0) updated FROM full_scan_tasks WHERE batch_id=? AND kind='reviews' AND status='succeeded'",
        )
        .get(id),
      http: db
        .prepare(
          'SELECT status,COUNT(*) count FROM full_scan_http WHERE batch_id=? GROUP BY status',
        )
        .all(id),
      recentFailures: db
        .prepare(
          'SELECT id,kind,country,store,app_id,page,error,attempts,next_run_at FROM full_scan_tasks WHERE batch_id=? AND error IS NOT NULL ORDER BY id DESC LIMIT 30',
        )
        .all(id),
    };
  } finally {
    db.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: 'boolean' },
      status: { type: 'boolean' },
      serve: { type: 'boolean' },
      'retry-failed': { type: 'boolean' },
      'retry-warnings': { type: 'boolean' },
      'retry-developer-source-errors': { type: 'boolean' },
      'batch-id': { type: 'string' },
      database: { type: 'string' },
      countries: { type: 'string' },
      stores: { type: 'string' },
      'max-tasks': { type: 'string' },
      'max-minutes': { type: 'string' },
      'max-review-pages': { type: 'string' },
      'delay-ms': { type: 'string' },
      'apple-batch-size': { type: 'string' },
      'timeout-ms': { type: 'string' },
      'retry-delay-ms': { type: 'string' },
      'max-attempts': { type: 'string' },
      port: { type: 'string' },
      report: { type: 'string' },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  const databasePath = resolve(
    values.database ?? process.env.DATABASE_PATH ?? 'data/appeye.sqlite',
  );
  const batchId = values['batch-id'];
  if (batchId && !/^[A-Za-z0-9_-]{1,100}$/.test(batchId))
    throw new Error('batch-id must contain only letters, digits, underscores and hyphens');
  if (values.status) {
    console.log(JSON.stringify(readFullScanStatus(databasePath, batchId), null, 2));
    return;
  }
  if (!batchId) throw new Error('--batch-id is required for an explicit, resumable batch');
  if (!existsSync(databasePath))
    throw new Error('Refusing to silently create a different empty live database');
  if (process.env.DEMO_MODE === 'true') throw new Error('A full live scan cannot run in demo mode');
  const preflight = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const metadata = preflight
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'")
      .get();
    if (
      metadata &&
      preflight.prepare("SELECT value FROM metadata WHERE key='dataset'").get()?.value === 'demo'
    )
      throw new Error('Refusing to migrate or collect into a demo dataset');
  } finally {
    preflight.close();
  }
  if (process.env.FULL_SCAN_WORKER_STOPPED !== 'true')
    throw new Error(
      'Stop the ordinary worker, take a backup, then set FULL_SCAN_WORKER_STOPPED=true',
    );
  if (values.serve && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12))
    throw new Error('--serve requires ADMIN_PASSWORD of at least 12 characters');
  const delayMs = integer(values['delay-ms'], 500, 100, 60000, 'delay-ms');
  const appleBatchSize = integer(values['apple-batch-size'], 50, 0, 100, 'apple-batch-size');
  const timeoutMs = integer(values['timeout-ms'], 30000, 100, 120000, 'timeout-ms');
  const maxTasks = integer(values['max-tasks'], 0, 0, Number.MAX_SAFE_INTEGER, 'max-tasks');
  const maxMinutes = integer(values['max-minutes'], 0, 0, 100000, 'max-minutes');
  const port = integer(values.port ?? process.env.PORT, 3000, 1, 65535, 'port');
  const config: FullScanConfig = {};
  if (values.countries) config.countries = values.countries.split(',').map((x) => x.trim());
  if (values.stores) config.stores = values.stores.split(',').map((x) => x.trim()) as StoreName[];
  if (values['max-review-pages'] !== undefined)
    config.maxReviewPages = integer(values['max-review-pages'], 0, 0, 10000000, 'max-review-pages');
  if (values['retry-delay-ms'] !== undefined)
    config.retryDelayMs = integer(values['retry-delay-ms'], 30000, 0, 3600000, 'retry-delay-ms');
  if (values['max-attempts'] !== undefined)
    config.maxAttempts = integer(values['max-attempts'], 3, 1, 10, 'max-attempts');
  const reportPath = resolve(values.report ?? `data/batches/${batchId}.json`);
  const lockPath = `${databasePath}.full-scan.lock`;
  if (existsSync(lockPath)) {
    const old = JSON.parse(readFileSync(lockPath, 'utf8'));
    try {
      process.kill(Number(old.pid), 0);
      throw new Error(`Batch process ${old.pid} still holds ${lockPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    unlinkSync(lockPath);
  }
  const fd = openSync(lockPath, 'wx', 0o600);
  writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, batchId, startedAt: new Date().toISOString() }),
  );
  closeSync(fd);
  let store: ReturnType<typeof createStore> | undefined;
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  let stopping = false;
  const started = Date.now();
  let done = 0;
  let runner: ReturnType<typeof createFullScanRunner> | undefined;
  const stop = () => {
    stopping = true;
    runner?.pause();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    store = createStore(databasePath);
    store.setDataset('live');
    const providers = createFullScanProviders({
      requestDelayMs: delayMs,
      timeoutMs,
      appleBatchSize,
      onResponse: (response) => runner!.recordHttp(response),
    });
    runner = createFullScanRunner({ store, providers, batchId, config });
    runner.recover();
    runner.seed();
    if (values['retry-failed']) runner.retryFailed();
    if (values['retry-warnings'])
      console.log(
        JSON.stringify({
          event: 'developer-warnings-requeued',
          batchId,
          count: runner.retryDeveloperWarnings(),
        }),
      );
    if (values['retry-developer-source-errors'])
      console.log(
        JSON.stringify({
          event: 'developer-source-errors-requeued',
          batchId,
          count: runner.retryDeveloperSourceErrors(),
        }),
      );
    mkdirSync(dirname(reportPath), { recursive: true });
    const publish = () => {
      const report = {
        ...runner!.summary(),
        updatedAt: new Date().toISOString(),
        databasePath,
        processId: process.pid,
        taskCompletionsThisProcess: done,
        config: runner!.config,
        transport: { requestDelayMs: delayMs, iTunesDelayMs: 3100, timeoutMs, appleBatchSize },
      };
      writeFileSync(`${reportPath}.tmp`, JSON.stringify(report, null, 2));
      renameSync(`${reportPath}.tmp`, reportPath);
      return report;
    };
    console.log(JSON.stringify({ event: 'started', reportPath, ...publish() }));
    if (values.serve) {
      const app = createApp({
        store,
        password: process.env.ADMIN_PASSWORD,
        sessionSecret: process.env.SESSION_SECRET,
        secureCookies: process.env.COOKIE_SECURE === 'true',
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      });
      server = await new Promise((resolveServer, reject) => {
        const instance = app.listen(port, process.env.HOST ?? '127.0.0.1', () =>
          resolveServer(instance),
        );
        instance.on('error', reject);
      });
      console.log(JSON.stringify({ event: 'dashboard', port, worker: 'disabled', batchId }));
    }
    let previousLog = 0;
    while (!stopping) {
      if (
        (maxTasks && done >= maxTasks) ||
        (maxMinutes && Date.now() - started >= maxMinutes * 60000)
      ) {
        stop();
        break;
      }
      const executed = await runner.runOnce();
      if (executed) done++;
      const report = publish();
      if (Date.now() - previousLog >= 15000) {
        console.log(JSON.stringify({ event: 'progress', ...report }));
        previousLog = Date.now();
      }
      if (!report.pending || report.pending === report.deferred) break;
      if (!executed)
        await sleep(
          Math.min(1000, Math.max(100, Date.parse(String(report.nextRunAt)) - Date.now())),
        );
    }
    const final = publish();
    store.run(
      'UPDATE full_scan_runs SET status=?,updated_at=? WHERE id=?',
      final.status,
      final.updatedAt,
      batchId,
    );
    console.log(JSON.stringify({ event: 'stopped', ...final }));
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (server) await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    store?.close();
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

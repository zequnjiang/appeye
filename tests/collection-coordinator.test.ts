import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { createStore } from '../server/db.js';
import { createFullScanRunner, type FullScanConfig } from '../server/full-scan.js';
import {
  createCollectionCoordinator,
  createFairDispatcher,
} from '../server/collection-coordinator.js';
import { acquireCollectorLock } from '../server/collector-lock.js';
import type { ScanTransportRecord } from '../server/full-scan-providers.js';
import {
  hourlyData,
  hourlyProvider,
  hourlyProviders,
  hourlyStore,
  hourStart,
  oneCountry,
} from './hourly-fixtures.js';

const quiet: FullScanConfig = {
  countries: ['th'],
  stores: ['google-play'],
  collections: { 'google-play': [], 'app-store': [] },
  includeSearch: false,
  includeExisting: true,
  retryDelayMs: 0,
  maxAttempts: 1,
  timeoutMs: 100,
};
const source = 'https://example.invalid/synthetic';
const harmless = () =>
  hourlyProviders({
    'google-play': hourlyProvider({
      enrich: async () => ({
        status: 'unsupported',
        data: null,
        raw: null,
        source,
        requestCountry: 'th',
        requestLanguage: 'th',
      }),
      reviewsPage: async () => ({ data: [], raw: [], source, nextCursor: null }),
    }),
  });

test('HMA-05: fair dispatcher bounds hourly streaks and runs batch/manual with no overlapping calls', async () => {
  const sequence: string[] = [];
  let active = 0;
  let peak = 0;
  const lane = (name: string) => ({
    async runOnce() {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      sequence.push(name);
      active--;
      return true;
    },
  });
  const dispatcher = createFairDispatcher({
    hourly: lane('h'),
    batch: lane('b'),
    manual: lane('m'),
  });
  for (let i = 0; i < 15; i++) await dispatcher.runOnce();
  assert.equal(sequence.join(''), 'hhhbmhhhbmhhhbm');
  assert.equal(peak, 1);
  let finish!: () => void;
  const pending = createFairDispatcher({
    hourly: {
      runOnce: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return true;
      },
    },
  });
  const first = pending.runOnce();
  assert.equal(await pending.runOnce(), false);
  assert.equal(pending.busy, true);
  finish();
  await first;
  assert.equal(pending.busy, false);
  dispatcher.stop();
  assert.equal(await dispatcher.runOnce(), false);
});

test('HMA-05: idle or throwing lanes do not permanently occupy the dispatcher', async () => {
  let batch = 0;
  let manual = 0;
  let thrown = false;
  const dispatcher = createFairDispatcher({
    hourly: {
      async runOnce() {
        if (!thrown) {
          thrown = true;
          throw new Error('Synthetic lane failure');
        }
        return false;
      },
    },
    batch: {
      async runOnce() {
        batch++;
        return true;
      },
    },
    manual: {
      async runOnce() {
        manual++;
        return true;
      },
    },
  });
  await assert.rejects(dispatcher.runOnce(), /Synthetic lane failure/);
  assert.equal(dispatcher.busy, false);
  for (let i = 0; i < 6; i++) await dispatcher.runOnce();
  assert.equal(batch, 3);
  assert.equal(manual, 3);
});

test('HMA-05/06: real coordinator interleaves lanes and hourly admission never expands a seeded batch cohort', async () => {
  const store = hourlyStore();
  try {
    const old = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.old.loan',
    });
    store.updateClassification(old.id, 'excluded');
    const providers = harmless();
    providers['google-play'].list = async () => ({
      data: [hourlyData('fixture.hourly.new')],
      raw: { newField: true },
      source,
    });
    const batch = createFullScanRunner({
      store,
      providers,
      batchId: 'frozen-cohort',
      config: quiet,
    });
    batch.seed();
    const identities = store.all(
      'SELECT id,task_key,app_id,external_id,page,payload FROM full_scan_tasks ORDER BY id',
    );
    const config = store.one('SELECT config FROM full_scan_runs WHERE id=?', batch.batchId)!.config;
    const coordinator = createCollectionCoordinator({
      store,
      providers,
      batchId: batch.batchId,
      now: () => new Date(hourStart),
    });
    for (let i = 0; i < 4; i++) assert.equal(await coordinator.runOnce(), true);
    assert.equal(store.one("SELECT COUNT(*) n FROM monitor_tasks WHERE status='succeeded'")!.n, 3);
    assert.equal(
      store.one("SELECT COUNT(*) n FROM full_scan_tasks WHERE status='succeeded'")!.n,
      1,
    );
    for (let i = 0; i < 80 && (await coordinator.runOnce()); i++) assert.ok(i < 79);
    assert.ok(store.one('SELECT id FROM apps WHERE external_id=?', 'fixture.hourly.new'));
    assert.deepEqual(
      store.all(
        'SELECT id,task_key,app_id,external_id,page,payload FROM full_scan_tasks ORDER BY id',
      ),
      identities,
    );
    assert.equal(
      store.one('SELECT config FROM full_scan_runs WHERE id=?', batch.batchId)!.config,
      config,
    );
    assert.equal(
      store.one("SELECT COUNT(*) n FROM full_scan_tasks WHERE status!='succeeded'")!.n,
      0,
    );
    assert.equal(store.getApp(old.id)!.classification, 'excluded');
    assert.equal(store.one('SELECT COUNT(*) n FROM jobs')!.n, 0);
    assert.equal(coordinator.status().batch!.pending, 0);
    coordinator.stop();
    assert.equal(await coordinator.runOnce(), false);
  } finally {
    store.close();
  }
});

test('HMA-04/05/08: a timed-out hourly response keeps its original task recorder after a batch lane runs', async () => {
  const store = hourlyStore();
  let coordinator: ReturnType<typeof createCollectionCoordinator>;
  let calls = 0;
  let aborted = false;
  const record = (body: string): ScanTransportRecord => ({
    url: source,
    method: 'GET',
    status: 200,
    contentType: 'application/json',
    body,
    error: null,
    fetchedAt: new Date().toISOString(),
  });
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.late.loan',
    });
    const providers = harmless();
    providers['google-play'].app = async (input) => {
      const number = ++calls;
      if (number === 1) {
        input.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
          },
          { once: true },
        );
        await wait(30);
      }
      coordinator.recordHttp(record(number === 1 ? 'synthetic-late-hourly' : 'synthetic-batch'));
      return hourlyData(input.externalId);
    };
    const batch = createFullScanRunner({ store, providers, batchId: 'late-owner', config: quiet });
    batch.seed();
    coordinator = createCollectionCoordinator({
      store,
      providers,
      batchId: batch.batchId,
      now: () => new Date(hourStart),
      hourlyOptions: { timeoutMs: 5, retryDelayMs: 100000, maxAttempts: 2 },
    });
    coordinator.hourly.schedule();
    store.run("UPDATE monitor_tasks SET status='skipped' WHERE kind!='detail'");
    const hourlyTask = store.one("SELECT id FROM monitor_tasks WHERE kind='detail'")!.id;
    await coordinator.runOnce();
    assert.equal(aborted, true);
    assert.equal(coordinator.busy, false);
    await coordinator.runOnce();
    await wait(40);
    const late = store.one(
      'SELECT task_id,job_id FROM monitor_http WHERE body=?',
      'synthetic-late-hourly',
    )!;
    assert.equal(late.task_id, hourlyTask);
    assert.equal(late.job_id, null);
    const batchHttp = store.one(
      'SELECT task_id FROM full_scan_http WHERE body=?',
      'synthetic-batch',
    )!;
    assert.equal(
      batchHttp.task_id,
      store.one("SELECT id FROM full_scan_tasks WHERE kind='detail'")!.id,
    );
    assert.equal(
      store.one('SELECT COUNT(*) n FROM monitor_responses')!.n,
      0,
      'Late timed-out data is not applied as hourly success',
    );
    assert.equal(
      store.listSnapshots(app.id).total,
      1,
      'Only the actual batch observation is applied',
    );
    coordinator.stop();
  } finally {
    store.close();
  }
});

test('HMA-02/08: observation and applied receipt roll back together if the transaction callback fails', () => {
  const store = hourlyStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.atomic.loan',
    });
    store.saveObservation(app.id, hourlyData(app.externalId), hourStart);
    const before = {
      app: store.getApp(app.id),
      snapshots: store.listSnapshots(app.id),
      changes: store.listChanges({ appId: app.id }),
      state: store.all('SELECT * FROM monitor_state'),
    };
    assert.throws(
      () =>
        store.saveObservation(
          app.id,
          { ...hourlyData(app.externalId), version: '2' },
          '2026-09-06T17:00:00.000Z',
          () => {
            store.run('UPDATE monitor_state SET heartbeat_at=? WHERE id=1', 'synthetic-rollback');
            throw new Error('Synthetic interrupted receipt');
          },
        ),
      /Synthetic interrupted receipt/,
    );
    assert.deepEqual(
      {
        app: store.getApp(app.id),
        snapshots: store.listSnapshots(app.id),
        changes: store.listChanges({ appId: app.id }),
        state: store.all('SELECT * FROM monitor_state'),
      },
      before,
    );
  } finally {
    store.close();
  }
});

test('HMA-05: collector lock rejects parallel processes and symlink aliases; OS release on crash safely recovers a dead PID', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-lock-'));
  const database = join(directory, 'fixture.sqlite');
  writeFileSync(database, '');
  const code = `import { acquireCollectorLock } from ${JSON.stringify(pathToFileURL(resolve('server/collector-lock.ts')).href)}; acquireCollectorLock(${JSON.stringify(database)}, 'synthetic-child'); process.stdout.write('ready'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await once(child.stdout!, 'data');
    const original = readFileSync(database + '.full-scan.lock', 'utf8');
    assert.throws(() => acquireCollectorLock(database), /already owns/);
    const alias = join(directory, 'alias.sqlite');
    symlinkSync(database, alias);
    assert.throws(() => acquireCollectorLock(alias), /already owns/);
    assert.equal(readFileSync(database + '.full-scan.lock', 'utf8'), original);
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
    const recovered = acquireCollectorLock(alias, 'synthetic-recovered');
    assert.equal(JSON.parse(readFileSync(recovered.path, 'utf8')).pid, process.pid);
    recovered.release();
    recovered.release();
    assert.equal(existsSync(recovered.path), false);
    const again = acquireCollectorLock(database);
    again.release();
    writeFileSync(database + '.full-scan.lock', 'malformed');
    assert.throws(() => acquireCollectorLock(database), /Malformed/);
    assert.equal(readFileSync(database + '.full-scan.lock', 'utf8'), 'malformed');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  }
});

test('FS-AC-09/HMA-06: exact seven-review retry is atomic, bounded to batch/kind/IDs, and preserves accepted Apple failures', () => {
  const store = hourlyStore();
  try {
    for (let i = 0; i < 7; i++)
      store.createApp({ country: 'th', store: 'google-play', externalId: `fixture.retry.${i}` });
    store.createApp({ country: 'th', store: 'app-store', externalId: '123456' });
    const runner = createFullScanRunner({
      store,
      providers: harmless(),
      batchId: 'precise',
      config: quiet,
    });
    runner.seed();
    const targets = store
      .all("SELECT id FROM full_scan_tasks WHERE kind='reviews' AND store='google-play'")
      .map((r) => Number(r.id));
    assert.equal(targets.length, 7);
    for (const id of targets) {
      store.run(
        "UPDATE full_scan_tasks SET status='failed',attempts=3,error='Synthetic TLS failure' WHERE id=?",
        id,
      );
      for (let attempt = 1; attempt <= 3; attempt++)
        store.run(
          "INSERT INTO full_scan_attempts(task_id,attempt,started_at,finished_at,status,error) VALUES (?,?,?,?,'failed','Synthetic TLS failure')",
          id,
          attempt,
          hourStart,
          hourStart,
        );
    }
    const apple = store.one(
      "SELECT id FROM full_scan_tasks WHERE kind='enrich' AND store='app-store' LIMIT 1",
    )!.id;
    store.run(
      "UPDATE full_scan_tasks SET status='failed',attempts=6,error='Accepted synthetic redirect limit' WHERE id=?",
      apple,
    );
    const kept = store.one('SELECT * FROM full_scan_tasks WHERE id=?', apple);
    const history = store.all('SELECT * FROM full_scan_attempts ORDER BY id');
    assert.throws(
      () => runner.retryFailed({ kind: 'reviews', taskIds: [targets[0], apple] }),
      /does not match/,
    );
    assert.equal(
      store.one("SELECT COUNT(*) n FROM full_scan_tasks WHERE status='failed' AND kind='reviews'")!
        .n,
      7,
    );
    for (const ids of [[], [0], [-1], [Number.MAX_SAFE_INTEGER + 1], [999999]])
      assert.throws(() => runner.retryFailed({ kind: 'reviews', taskIds: ids }));
    assert.equal(runner.retryFailed({ kind: 'reviews', taskIds: [...targets, targets[0]] }), 7);
    assert.equal(runner.retryFailed({ kind: 'reviews', taskIds: targets }), 0);
    assert.deepEqual(store.one('SELECT * FROM full_scan_tasks WHERE id=?', apple), kept);
    assert.deepEqual(store.all('SELECT * FROM full_scan_attempts ORDER BY id'), history);
    for (const id of targets) {
      const task = store.one('SELECT * FROM full_scan_tasks WHERE id=?', id)!;
      assert.equal(task.attempts, 3);
      assert.equal(task.status, 'queued');
      assert.equal(JSON.parse(task.payload).recoveryAttemptBase, 3);
      assert.ok(JSON.parse(task.payload).explicitRecoveryAt);
    }
  } finally {
    store.close();
  }
});

test('FS-AC-09/HMA-06: retry-only CLI persists the scoped checkpoint and exits without fetching or seeding', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-retry-cli-'));
  const path = join(directory, 'fixture.sqlite');
  let store = oneCountry(createStore(path));
  try {
    store.createApp({ country: 'th', store: 'google-play', externalId: 'fixture.cli.loan' });
    store.createApp({ country: 'th', store: 'app-store', externalId: '123456' });
    const runner = createFullScanRunner({
      store,
      providers: harmless(),
      batchId: 'synthetic-retry-cli',
      config: quiet,
    });
    runner.seed();
    const target = store.one(
      "SELECT id FROM full_scan_tasks WHERE kind='reviews' AND store='google-play'",
    )!.id;
    const apple = store.one(
      "SELECT id FROM full_scan_tasks WHERE kind='enrich' AND store='app-store' LIMIT 1",
    )!.id;
    store.run(
      "UPDATE full_scan_tasks SET status='failed',attempts=3,error='Synthetic failure' WHERE id IN (?,?)",
      target,
      apple,
    );
    const taskCount = store.one('SELECT COUNT(*) n FROM full_scan_tasks')!.n;
    store.close();
    execFileSync(
      process.execPath,
      [
        '--import',
        resolve('node_modules/tsx/dist/loader.mjs'),
        resolve('scripts/full-scan.ts'),
        '--database',
        path,
        '--batch-id',
        'synthetic-retry-cli',
        '--retry-failed',
        '--retry-kind',
        'reviews',
        '--retry-task-ids',
        String(target),
        '--retry-only',
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          FULL_SCAN_WORKER_STOPPED: 'true',
          ADMIN_PASSWORD: 'synthetic-only-password',
          DATABASE_PATH: path,
        },
        timeout: 10000,
        stdio: 'pipe',
      },
    );
    store = createStore(path);
    assert.equal(
      store.one('SELECT status FROM full_scan_tasks WHERE id=?', target)!.status,
      'queued',
    );
    assert.equal(
      store.one('SELECT status FROM full_scan_tasks WHERE id=?', apple)!.status,
      'failed',
    );
    assert.equal(store.one('SELECT COUNT(*) n FROM full_scan_tasks')!.n, taskCount);
    assert.equal(store.one('SELECT COUNT(*) n FROM full_scan_attempts')!.n, 0);
    assert.equal(store.one('SELECT COUNT(*) n FROM full_scan_http')!.n, 0);
    assert.equal(existsSync(path + '.full-scan.lock'), false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HMA-06: batch detail receipts replay once while separate real responses at the same instant both retain snapshots', async () => {
  const store = hourlyStore();
  let calls = 0;
  try {
    const app = store.createApp({ country: 'th', store: 'app-store', externalId: '123456' });
    const runner = createFullScanRunner({
      store,
      batchId: 'same-clock-responses',
      config: { ...quiet, stores: ['app-store'] },
      providers: hourlyProviders({
        'app-store': hourlyProvider({
          appWithPeers: async () => {
            calls++;
            return {
              data: hourlyData(app.externalId),
              observedAt: hourStart,
              provenance: {
                method: 'bulk-lookup',
                source,
                batchId: 'same-clock-responses',
                country: 'th',
                language: 'en_us',
              },
            };
          },
        }),
      }),
    });
    runner.seed();
    store.run("UPDATE full_scan_tasks SET status='succeeded' WHERE kind!='detail'");
    assert.equal(await runner.runOnce(), true);
    const task = store.one("SELECT * FROM full_scan_tasks WHERE kind='detail'")!;
    const firstReceipt = JSON.parse(task.result).appliedResponseId;
    assert.ok(firstReceipt);
    assert.equal(store.listSnapshots(app.id).total, 1);
    store.run("UPDATE full_scan_tasks SET status='queued' WHERE id=?", task.id);
    assert.equal(await runner.runOnce(), true);
    assert.equal(calls, 1);
    assert.equal(store.listSnapshots(app.id).total, 1);
    assert.equal(
      JSON.parse(store.one('SELECT result FROM full_scan_tasks WHERE id=?', task.id)!.result)
        .appliedResponseId,
      firstReceipt,
    );
    store.run(
      "UPDATE full_scan_tasks SET status='queued',response=NULL,response_at=NULL WHERE id=?",
      task.id,
    );
    assert.equal(await runner.runOnce(), true);
    assert.equal(calls, 2);
    assert.equal(store.listSnapshots(app.id).total, 2);
    assert.equal(
      store.one('SELECT COUNT(*) n FROM full_scan_responses WHERE task_id=?', task.id)!.n,
      2,
    );
    const nextReceipt = JSON.parse(
      store.one('SELECT result FROM full_scan_tasks WHERE id=?', task.id)!.result,
    ).appliedResponseId;
    assert.notEqual(nextReceipt, firstReceipt);
    assert.ok(store.listSnapshots(app.id).snapshots.every((s) => s.observedAt === hourStart));
    assert.equal(store.listChanges({ appId: app.id }).total, 0);
  } finally {
    store.close();
  }
});

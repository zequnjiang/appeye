import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createStore, type Store } from '../server/db.js';
import { createFullScanRunner, ensureFullScanSchema } from '../server/full-scan.js';
import type { ScanProvider } from '../server/full-scan-providers.js';
import { normalizeReview } from '../server/normalization.js';

const indexName = 'full_scan_summary_covering';
const unused = async (): Promise<never> => {
  throw new Error('Summary tests must not invoke any provider');
};
const provider: ScanProvider = {
  list: unused,
  search: unused,
  app: unused,
  enrich: unused,
  reviewsPage: unused,
};
const options = (store: Store, batchId: string) => ({
  store,
  providers: { 'google-play': provider, 'app-store': provider },
  batchId,
  config: { countries: ['ph'], includeSearch: false },
});
function contents(store: Store) {
  return Object.fromEntries(
    store
      .all(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .map((row) => {
        const name = String(row.name);
        return [name, store.all(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)];
      }),
  );
}
function fixture(path = ':memory:') {
  const store = createStore(path);
  const runners = Object.fromEntries(
    ['primary', 'foreign', 'empty'].map((id) => [id, createFullScanRunner(options(store, id))]),
  );
  const app = store.createApp({
    store: 'google-play',
    country: 'ph',
    externalId: 'fixture.summary',
    classification: 'excluded',
  });
  store.updateClassification(app.id, 'excluded');
  store.saveObservation(
    app.id,
    {
      externalId: app.externalId,
      title: 'Synthetic persisted app',
      version: '1.0',
      raw: { untouched: 'detail' },
      storeData: { untouched: 'detail' },
    },
    '2026-01-01T00:00:00.000Z',
  );
  store.saveReviews(
    app.id,
    [
      normalizeReview(
        { id: 'retained-review', text: 'Synthetic retained observation', score: 4 },
        'en',
      ),
    ],
    'en',
    '2026-01-02T00:00:00.000Z',
  );
  const insert = store.db.prepare(
    "INSERT INTO full_scan_tasks(batch_id,task_key,kind,country,store,app_id,external_id,payload,phase,page,status,attempts,next_run_at,created_at,result,stop_reason,response,response_at) VALUES(?,? ,?,'ph','google-play',?,?,?,3,1,?,2,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',?,?,?,?)",
  );
  let key = 0;
  const task = (
    batch: string,
    kind: string,
    status: string,
    result: unknown,
    reason: string | null = null,
  ) =>
    Number(
      insert.run(
        batch,
        String(++key),
        kind,
        app.id,
        app.externalId,
        JSON.stringify({ cursor: 'synthetic-frozen-cursor', requestLanguage: 'en' }),
        status,
        result === null ? null : JSON.stringify(result),
        reason,
        JSON.stringify({ synthetic: 'preserved response', largeUnindexedField: 'x'.repeat(2048) }),
        '2026-01-02T00:00:00.000Z',
      ).lastInsertRowid,
    );
  task('primary', 'reviews', 'succeeded', null);
  task('primary', 'reviews', 'succeeded', {});
  task('primary', 'reviews', 'succeeded', { added: 0, updated: 0 });
  const observedTask = task(
    'primary',
    'reviews',
    'succeeded',
    { added: 7, updated: 3 },
    'reviews-token-cycle',
  );
  task('primary', 'reviews', 'succeeded', { added: 2 });
  task('primary', 'reviews', 'failed', { added: 900, updated: 900 });
  const waitingTask = task('primary', 'reviews', 'queued', { added: 800, updated: 800 });
  task('primary', 'reviews', 'running', { added: 700, updated: 700 });
  task('primary', 'reviews', 'deferred', { added: 600, updated: 600 });
  task('primary', 'enrich', 'succeeded', { added: 500, updated: 500 }, 'developer-degraded');
  task('primary', 'list', 'succeeded', { added: 400 }, 'chart-interface-no-pagination');
  task('primary', 'detail', 'succeeded', null);
  task(
    'foreign',
    'reviews',
    'succeeded',
    { added: 10000, updated: 20000 },
    'reviews-no-next-token',
  );
  store.run(
    "INSERT INTO full_scan_attempts(task_id,attempt,started_at,finished_at,status) VALUES(?,2,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z','succeeded')",
    observedTask,
  );
  const attempt = store.one('SELECT id FROM full_scan_attempts WHERE task_id=?', observedTask)!;
  store.run(
    "INSERT INTO full_scan_responses(task_id,attempt_id,observed_at,response) VALUES(?,?,'2026-01-02T00:00:00.000Z',?)",
    observedTask,
    attempt.id,
    JSON.stringify({ synthetic: 'immutable original response' }),
  );
  store.run(
    "INSERT INTO full_scan_http(batch_id,task_id,fetched_at,url,method,status,content_type,body,error) VALUES('primary',?,'2026-01-02T00:00:00.000Z','https://example.invalid/unchanged','GET',200,'application/json',?,NULL)",
    observedTask,
    JSON.stringify({ synthetic: 'immutable source' }),
  );
  store.run("INSERT INTO full_scan_review_seen VALUES('primary',?,'retained-review')", app.id);
  store.run(
    "INSERT INTO full_scan_candidates(batch_id,country,store,external_id,app_id,verdict) VALUES('primary','ph','google-play','fixture.summary',?,'strong')",
    app.id,
  );
  store.run(
    "INSERT INTO full_scan_sources(batch_id,task_id,country,store,external_id,source,keyword,observed_at,request_language,data,raw,app_id) VALUES('primary',?,'ph','google-play','fixture.summary','https://example.invalid/source','synthetic','2026-01-01T00:00:00.000Z','en','{}','{}',?)",
    observedTask,
    app.id,
  );
  store.db.exec(`DROP INDEX ${indexName}`);
  return { store, runners, app, observedTask, waitingTask };
}

test('SSI-01/03: the original complete summaries remain identical with the covering index across batches and missing/zero fields', (t) => {
  const h = fixture();
  try {
    const before = Object.fromEntries(
      Object.entries(h.runners).map(([id, runner]) => [id, runner.summary()]),
    );
    const beforeRows = contents(h.store);
    const beforeMs: number[] = [],
      afterMs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      h.runners.primary.summary();
      beforeMs.push(performance.now() - start);
    }
    ensureFullScanSchema(h.store);
    const after = Object.fromEntries(
      Object.entries(h.runners).map(([id, runner]) => [id, runner.summary()]),
    );
    assert.deepEqual(after, before, 'Every summary field and its JS type must remain equal');
    assert.deepEqual(
      contents(h.store),
      beforeRows,
      'DDL must not alter any persisted business evidence',
    );
    assert.deepEqual({ ...after.primary.reviewWrites }, { added: 9, updated: 3 });
    assert.equal(after.primary.pending, 3);
    assert.equal(after.primary.deferred, 1);
    assert.equal(after.primary.failures, 1);
    assert.equal(after.primary.warnings, 2);
    assert.deepEqual({ ...after.foreign.reviewWrites }, { added: 10000, updated: 20000 });
    assert.deepEqual({ ...after.empty.reviewWrites }, { added: 0, updated: 0 });
    assert.equal(after.empty.status, 'completed');
    assert.deepEqual(after.empty.counts, []);
    assert.deepEqual(after.empty.reasons, []);
    assert.equal(after.empty.nextRunAt, null);
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      h.runners.primary.summary();
      afterMs.push(performance.now() - start);
    }
    const queries = [
      'SELECT kind,status,COUNT(*) count FROM full_scan_tasks WHERE batch_id=? GROUP BY kind,status',
      'SELECT kind,stop_reason reason,COUNT(*) count FROM full_scan_tasks WHERE batch_id=? AND stop_reason IS NOT NULL GROUP BY kind,stop_reason',
      "SELECT COALESCE(SUM(json_extract(result,'$.added')),0) added,COALESCE(SUM(json_extract(result,'$.updated')),0) updated FROM full_scan_tasks WHERE batch_id=? AND kind='reviews' AND status='succeeded'",
    ];
    const plans = queries.map((sql) =>
      h.store.all('EXPLAIN QUERY PLAN ' + sql, 'primary').map((row) => String(row.detail)),
    );
    for (const plan of plans)
      assert.ok(
        plan.some((line) => line.includes(`COVERING INDEX ${indexName}`)),
        JSON.stringify(plan),
      );
    t.diagnostic(
      JSON.stringify({
        scope:
          '13-row synthetic fixture; complete runner.summary calls, not production performance',
        beforeMs,
        afterMs,
        plans,
      }),
    );
    h.store.run(
      "UPDATE full_scan_tasks SET status='succeeded',result=? WHERE id=?",
      JSON.stringify({ added: 1, updated: 2 }),
      h.waitingTask,
    );
    assert.deepEqual({ ...h.runners.primary.summary().reviewWrites }, { added: 10, updated: 5 });
  } finally {
    h.store.close();
  }
});

test('SSI-02/05: repeated initialization and file reopening create exactly one index while preserving every evidence table', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-summary-index-'));
  const path = join(directory, 'fixture.sqlite');
  const h = fixture(path);
  const before = contents(h.store);
  try {
    ensureFullScanSchema(h.store);
    ensureFullScanSchema(h.store);
    assert.deepEqual(contents(h.store), before);
    assert.equal(
      h.store.one(
        "SELECT COUNT(*) count FROM sqlite_schema WHERE type='index' AND name=?",
        indexName,
      )!.count,
      1,
    );
  } finally {
    h.store.close();
  }
  try {
    const reopened = createStore(path);
    try {
      ensureFullScanSchema(reopened);
      createFullScanRunner(options(reopened, 'primary'));
      assert.deepEqual(contents(reopened), before);
      assert.equal(
        reopened.one(
          "SELECT COUNT(*) count FROM sqlite_schema WHERE type='index' AND name=?",
          indexName,
        )!.count,
        1,
      );
      assert.equal(reopened.getApp(h.app.id)!.classification, 'excluded');
      assert.equal(reopened.getApp(h.app.id)!.manualOverride, true);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SSI-02: the real read-only status CLI does not create the missing optimization index or mutate a legacy batch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-summary-readonly-'));
  const path = join(directory, 'fixture.sqlite');
  const h = fixture(path);
  h.store.close();
  try {
    const before = readFileSync(path);
    const status = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve('scripts/full-scan.ts'),
          '--status',
          '--database',
          path,
          '--batch-id',
          'primary',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
    assert.deepEqual(status.reviewWrites, { added: 9, updated: 3 });
    assert.deepEqual(readFileSync(path), before);
    const reader = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(
        reader.prepare('SELECT COUNT(*) count FROM sqlite_schema WHERE name=?').get(indexName)!
          .count,
        0,
      );
    } finally {
      reader.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SSI-02/04: invalid legacy JSON causes an explicit index-build failure and cannot be silently skipped or changed', () => {
  const h = fixture();
  try {
    h.store.run('UPDATE full_scan_tasks SET result=? WHERE id=?', 'not-json', h.observedTask);
    const before = contents(h.store);
    assert.throws(() => ensureFullScanSchema(h.store), /malformed JSON/);
    assert.equal(
      h.store.one('SELECT COUNT(*) count FROM sqlite_schema WHERE name=?', indexName)!.count,
      0,
    );
    assert.deepEqual(contents(h.store), before);
  } finally {
    h.store.close();
  }
});

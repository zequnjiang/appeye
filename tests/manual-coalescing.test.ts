import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionCoordinator } from '../server/collection-coordinator.js';
import { createFullScanRunner, ensureFullScanSchema } from '../server/full-scan.js';
import { createStore } from '../server/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coalesceCoveredJobs, createManualJournal } from '../server/manual-collection.js';
import {
  hourlyStore,
  hourlyData,
  hourlyProvider,
  hourlyProviders,
  hourStart,
} from './hourly-fixtures.js';
import { creditReview } from './fixtures.js';
import type { JobType, StoreName } from '../server/types.js';

async function coveredFixture(type: JobType = 'reviews', platform: StoreName = 'app-store') {
  const store = hourlyStore();
  const app = store.createApp({
    country: 'th',
    store: platform,
    externalId: platform === 'app-store' ? '123456' : 'fixture.covered',
  });
  const job = store.enqueueJob({ type, country: 'th', store: platform, appId: app.id });
  store.run("UPDATE jobs SET created_at='2020-01-01T00:00:00.000Z',attempts=1 WHERE id=?", job.id);
  const provider = hourlyProvider({
    app: async (input) => hourlyData(input.externalId),
    enrich: async (input) => ({
      status: 'unsupported',
      data: null,
      raw: null,
      source: 'https://example.invalid/' + input.kind,
      requestCountry: input.country,
      requestLanguage: input.language,
    }),
    reviewsPage: async () => ({
      data: [],
      raw: [],
      source: 'https://example.invalid/reviews',
      nextCursor: null,
    }),
  });
  const runner = createFullScanRunner({
    store,
    batchId: 'covered-fixture',
    providers: hourlyProviders({ [platform]: provider }),
    config: {
      countries: ['th'],
      stores: [platform],
      collections: { 'google-play': [], 'app-store': [] },
      includeSearch: false,
      retryDelayMs: 0,
    },
  });
  runner.seed();
  let count = 0;
  while (await runner.runOnce()) assert.ok(++count < 30);
  return { store, app, job, batchId: runner.batchId };
}

test('HMA-06: covered legacy jobs reuse successful batch evidence without new attempts, network, or history writes', async () => {
  for (const platform of ['app-store', 'google-play'] as const)
    for (const type of ['reviews', 'enrich'] as const) {
      const { store, job, batchId } = await coveredFixture(type, platform);
      try {
        const before = store.one('SELECT * FROM jobs WHERE id=?', job.id)!;
        const evidence = Object.fromEntries(
          [
            'full_scan_tasks',
            'full_scan_attempts',
            'full_scan_responses',
            'snapshots',
            'reviews',
            'enrichment_history',
          ].map((t) => [t, store.all(`SELECT * FROM ${t} ORDER BY id`)]),
        );
        assert.equal(coalesceCoveredJobs(store, batchId), 1);
        assert.equal(coalesceCoveredJobs(store, batchId), 0);
        const after = store.one('SELECT * FROM jobs WHERE id=?', job.id)!;
        assert.equal(after.status, 'succeeded');
        assert.equal(after.attempts, before.attempts);
        assert.equal(after.created_at, before.created_at);
        assert.equal(after.dedupe_key, before.dedupe_key);
        assert.equal(after.started_at, before.started_at);
        const result = JSON.parse(after.result);
        assert.equal(result.coalesced, true);
        assert.equal(result.batchId, batchId);
        assert.equal(
          result.coverage,
          type === 'reviews' ? 'recent-review-page' : 'seven-enrichments',
        );
        assert.equal(result.proofs.length, type === 'reviews' ? 1 : 7);
        for (const proof of result.proofs) {
          const response = store.one(
            'SELECT * FROM full_scan_responses WHERE id=?',
            proof.responseId,
          )!;
          assert.equal(response.task_id, proof.taskId);
          assert.equal(response.observed_at, proof.sourceObservedAt);
          assert.ok(proof.sourceObservedAt >= before.created_at);
        }
        for (const [table, rows] of Object.entries(evidence))
          assert.deepEqual(store.all(`SELECT * FROM ${table} ORDER BY id`), rows, table);
      } finally {
        store.close();
      }
    }
});

test('HMA-06: coalescing refuses new requests, failed/partial coverage, missing durable evidence, and changed context', async () => {
  const cases: Array<{
    name: string;
    type: 'reviews' | 'enrich';
    change: (s: ReturnType<typeof hourlyStore>, jobId: number) => void;
  }> = [
    {
      name: 'new request',
      type: 'reviews',
      change: (s, id) =>
        s.run("UPDATE jobs SET created_at='9999-01-01T00:00:00.000Z' WHERE id=?", id),
    },
    {
      name: 'failed job',
      type: 'reviews',
      change: (s, id) => s.run("UPDATE jobs SET status='failed' WHERE id=?", id),
    },
    {
      name: 'failed stream',
      type: 'reviews',
      change: (s) => s.run("UPDATE full_scan_tasks SET status='failed' WHERE kind='reviews'"),
    },
    {
      name: 'partial stream',
      type: 'reviews',
      change: (s) =>
        s.run(
          "UPDATE full_scan_tasks SET stop_reason='reviews-repeated-page' WHERE kind='reviews'",
        ),
    },
    {
      name: 'missing response',
      type: 'reviews',
      change: (s) =>
        s.run(
          "DELETE FROM full_scan_responses WHERE task_id IN(SELECT id FROM full_scan_tasks WHERE kind='reviews')",
        ),
    },
    {
      name: 'wrong language',
      type: 'reviews',
      change: (s) => s.run("UPDATE countries SET language='es' WHERE code='th'"),
    },
    {
      name: 'wrong identity',
      type: 'reviews',
      change: (s) =>
        s.run("UPDATE full_scan_tasks SET external_id='wrong.identity' WHERE kind='reviews'"),
    },
    {
      name: 'missing one supplement',
      type: 'enrich',
      change: (s) =>
        s.run(
          "UPDATE full_scan_tasks SET payload=json_set(payload,'$.kind','unexpected-kind') WHERE kind='enrich' AND json_extract(payload,'$.kind')='privacy'",
        ),
    },
    {
      name: 'partial developer',
      type: 'enrich',
      change: (s) =>
        s.run(
          "UPDATE full_scan_tasks SET stop_reason='developer-degraded' WHERE kind='enrich' AND json_extract(payload,'$.kind')='developer'",
        ),
    },
    {
      name: 'failed supplement',
      type: 'enrich',
      change: (s) =>
        s.run(
          "UPDATE full_scan_tasks SET status='failed' WHERE kind='enrich' AND json_extract(payload,'$.kind')='privacy'",
        ),
    },
  ];
  for (const entry of cases) {
    const { store, job, batchId } = await coveredFixture(entry.type, 'google-play');
    try {
      entry.change(store, job.id);
      const before = store.one('SELECT * FROM jobs WHERE id=?', job.id);
      assert.equal(coalesceCoveredJobs(store, batchId), 0, entry.name);
      assert.deepEqual(store.one('SELECT * FROM jobs WHERE id=?', job.id), before, entry.name);
    } finally {
      store.close();
    }
  }
});

test('HMA-08: manual review evidence preserves full payload and source time; applied receipt and review upsert commit atomically', async () => {
  const store = hourlyStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.manual',
    });
    const job = store.enqueueJob({
      type: 'reviews',
      country: 'th',
      store: 'google-play',
      appId: app.id,
    });
    store.claimJob();
    const journal = createManualJournal({ store, now: () => new Date(hourStart) });
    const input = {
      country: 'th',
      language: 'th',
      externalId: app.externalId,
      page: 1,
      cursor: null,
    };
    const value = {
      data: [
        {
          ...creditReview,
          language: 'th',
          raw: { id: creditReview.externalId, unknown: { retained: true } },
        },
      ],
      raw: { futureField: 'complete' },
      source: 'https://example.invalid/reviews',
    };
    let calls = 0;
    const response = await journal.invoke(job.id, 'reviews', input, async () => {
      calls++;
      return value;
    });
    assert.deepEqual(response, value);
    const receipt = journal.receipt(response)!;
    assert.ok(receipt);
    assert.equal(receipt.observedAt, hourStart);
    assert.equal(receipt.alreadyApplied, false);
    assert.throws(
      () =>
        store.saveReviews(app.id, response.data, 'th', receipt.observedAt, () => {
          receipt.onSaved();
          throw new Error('Synthetic manual interruption');
        }),
      /Synthetic manual interruption/,
    );
    assert.equal(store.listReviews(app.id).total, 0);
    assert.equal(
      store.one('SELECT applied_at FROM manual_responses WHERE id=?', receipt.responseId)!
        .applied_at,
      null,
    );
    store.saveReviews(app.id, response.data, 'th', receipt.observedAt, receipt.onSaved);
    const row = store.one('SELECT * FROM manual_responses WHERE id=?', receipt.responseId)!;
    assert.equal(row.job_id, job.id);
    assert.equal(row.job_attempt, 1);
    assert.equal(row.app_id, app.id);
    assert.equal(row.observed_at, hourStart);
    assert.ok(row.applied_at);
    assert.deepEqual(JSON.parse(row.data), value);
    assert.equal(store.listReviews(app.id).reviews[0].fetchedAt, hourStart);
    const replay = await journal.invoke(job.id, 'reviews', input, async () => {
      calls++;
      return value;
    });
    assert.equal(calls, 1);
    assert.equal(journal.receipt(replay)!.alreadyApplied, true);
    assert.equal(store.one('SELECT COUNT(*) n FROM manual_responses')!.n, 1);
    assert.equal(store.listReviews(app.id).total, 1);
  } finally {
    store.close();
  }
});

test('HMA-08/11: real coordinator manual lane journals full review pages and recovers job completion without rewriting applied reviews', async () => {
  const store = hourlyStore();
  let calls = 0,
    writes = 0,
    firstCompletion = true;
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.manual.integration',
    });
    const job = store.enqueueJob({
      type: 'reviews',
      country: 'th',
      store: 'google-play',
      appId: app.id,
    });
    const save = store.saveReviews.bind(store);
    store.saveReviews = (...args) => {
      writes++;
      return save(...args);
    };
    const complete = store.completeJob.bind(store);
    store.completeJob = (...args) => {
      if (firstCompletion) {
        firstCompletion = false;
        throw new Error('Synthetic interruption after review commit');
      }
      return complete(...args);
    };
    let coordinator: ReturnType<typeof createCollectionCoordinator>;
    coordinator = createCollectionCoordinator({
      store,
      enabled: false,
      now: () => new Date(hourStart),
      providers: hourlyProviders({
        'google-play': hourlyProvider({
          reviewsPage: async () => {
            calls++;
            coordinator.recordHttp({
              url: 'https://example.invalid/manual-reviews',
              method: 'GET',
              status: 200,
              contentType: 'application/json',
              body: '{"synthetic":true}',
              error: null,
              fetchedAt: hourStart,
            });
            return {
              data: [
                {
                  ...creditReview,
                  language: 'th',
                  raw: { id: creditReview.externalId, futureField: { kept: true } },
                },
              ],
              raw: { data: [{ id: creditReview.externalId, futureField: { kept: true } }] },
              source: 'https://example.invalid/manual-reviews',
              nextCursor: null,
            };
          },
        }),
      }),
    });
    assert.equal(await coordinator.runOnce(), true);
    assert.equal(store.getJob(job.id)!.status, 'queued');
    const current = store.all('SELECT * FROM reviews');
    assert.equal(current.length, 1);
    assert.equal(current[0].fetched_at, hourStart);
    const response = store.one('SELECT * FROM manual_responses')!;
    assert.equal(response.job_id, job.id);
    assert.equal(response.job_attempt, 1);
    assert.ok(response.applied_at);
    assert.equal(JSON.parse(response.data).data[0].raw.futureField.kept, true);
    assert.equal(store.one('SELECT job_id FROM monitor_http')!.job_id, job.id);
    store.run("UPDATE jobs SET next_run_at='2000-01-01T00:00:00.000Z' WHERE id=?", job.id);
    assert.equal(await coordinator.runOnce(), true);
    assert.equal(store.getJob(job.id)!.status, 'succeeded');
    assert.equal(store.getJob(job.id)!.attempts, 2);
    assert.equal(calls, 1);
    assert.equal(writes, 1);
    assert.deepEqual(store.all('SELECT * FROM reviews'), current);
    assert.deepEqual(store.one('SELECT * FROM manual_responses'), response);
    assert.equal(store.one('SELECT COUNT(*) n FROM monitor_tasks')!.n, 0);
    coordinator.stop();
  } finally {
    store.close();
  }
});

test('HMA-08/11: older unapplied manual cache keeps its raw receipt without rolling back a newer review', async () => {
  const store = hourlyStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.old.manual',
    });
    const job = store.enqueueJob({
      type: 'reviews',
      country: 'th',
      store: 'google-play',
      appId: app.id,
    });
    store.claimJob();
    const journal = createManualJournal({ store, now: () => new Date(hourStart) });
    const input = {
      country: 'th',
      language: 'th',
      externalId: app.externalId,
      page: 1,
      cursor: null,
    };
    const old = {
      data: [
        { ...creditReview, text: 'Old source text', language: 'th', raw: { oldSource: true } },
      ],
      raw: { completeOldPayload: true },
      source: 'https://example.invalid/old-reviews',
      nextCursor: null,
    };
    await journal.invoke(job.id, 'reviews', input, async () => old);
    const saved = store.one('SELECT * FROM manual_responses')!;
    assert.equal(saved.applied_at, null);
    store.failJob(job.id, 'Synthetic pre-apply interruption', 0);
    store.saveReviews(
      app.id,
      [{ ...creditReview, text: 'New successful text', language: 'th', raw: { newSource: true } }],
      'th',
      '2026-09-07T16:00:00.000Z',
    );
    const current = store.all('SELECT * FROM reviews');
    let requests = 0;
    const coordinator = createCollectionCoordinator({
      store,
      enabled: false,
      now: () => new Date('2026-09-07T17:00:00.000Z'),
      providers: hourlyProviders({
        'google-play': hourlyProvider({
          reviewsPage: async () => {
            requests++;
            throw new Error('Cached response should avoid network');
          },
        }),
      }),
    });
    await coordinator.runOnce();
    assert.equal(store.getJob(job.id)!.status, 'succeeded');
    assert.equal(requests, 0);
    assert.deepEqual(store.all('SELECT * FROM reviews'), current);
    const result = store.getJob(job.id)!.result as { upserted: number; skippedOlder: number };
    assert.equal(result.upserted, 0);
    assert.equal(result.skippedOlder, 1);
    const receipt = store.one('SELECT * FROM manual_responses')!;
    assert.equal(receipt.id, saved.id);
    assert.equal(receipt.data, saved.data);
    assert.equal(receipt.observed_at, hourStart);
    assert.ok(receipt.applied_at);
    coordinator.stop();
  } finally {
    store.close();
  }
});

test('HMA-06/11: an older batch page remains observed and auditable but does not count a skipped review as an update', async () => {
  const store = hourlyStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.old.batch',
    });
    store.saveReviews(
      app.id,
      [{ ...creditReview, text: 'Newer current', language: 'th', raw: { newSource: true } }],
      'th',
      '2099-01-01T00:00:00.000Z',
    );
    const current = store.all('SELECT * FROM reviews');
    const old = {
      ...creditReview,
      text: 'Older batch observation',
      language: 'th',
      raw: { oldBatch: true },
    };
    const runner = createFullScanRunner({
      store,
      batchId: 'older-review-response',
      config: {
        countries: ['th'],
        stores: ['google-play'],
        collections: { 'google-play': [] },
        includeSearch: false,
      },
      providers: hourlyProviders({
        'google-play': hourlyProvider({
          reviewsPage: async () => ({
            data: [old],
            raw: { data: [old.raw] },
            source: 'https://example.invalid/older-batch',
            nextCursor: null,
          }),
        }),
      }),
    });
    runner.seed();
    store.run("UPDATE full_scan_tasks SET status='succeeded' WHERE kind!='reviews'");
    assert.equal(await runner.runOnce(), true);
    const task = store.one("SELECT * FROM full_scan_tasks WHERE kind='reviews'")!;
    assert.equal(task.status, 'succeeded');
    const result = JSON.parse(task.result);
    assert.equal(result.added, 0);
    assert.equal(result.updated, 0);
    assert.equal(result.skippedOlder, 1);
    assert.equal(store.one('SELECT COUNT(*) n FROM full_scan_review_seen')!.n, 1);
    assert.equal(JSON.parse(task.response).data[0].text, old.text);
    assert.deepEqual(store.all('SELECT * FROM reviews'), current);
  } finally {
    store.close();
  }
});

const coveredResponseSql =
  "SELECT r.* FROM full_scan_responses r JOIN full_scan_attempts a ON a.id=r.attempt_id AND a.task_id=r.task_id WHERE r.task_id=? AND r.observed_at=? AND r.response=? AND a.status='succeeded' ORDER BY r.id DESC LIMIT 1";

test('HMA-05/06: response lookup index removes the ledger scan while preserving the exact source and successful-attempt predicate', async () => {
  const { store, job, batchId } = await coveredFixture();
  try {
    const index = 'full_scan_response_task_time';
    assert.ok(store.one("SELECT name FROM sqlite_master WHERE type='index' AND name=?", index));
    assert.deepEqual(
      store.all(`PRAGMA index_info(${index})`).map((r) => r.name),
      ['task_id', 'observed_at', 'id'],
    );
    store.db.exec(`DROP INDEX ${index}`);
    const task = store.one("SELECT * FROM full_scan_tasks WHERE kind='reviews'")!;
    const params = [task.id, task.response_at, task.response];
    const other = store.one('SELECT * FROM full_scan_responses WHERE task_id!=? LIMIT 1', task.id)!;
    const unrelated = JSON.stringify({ syntheticPadding: 'x'.repeat(64 * 1024) });
    store.transaction(() => {
      for (let i = 0; i < 80; i++)
        store.run(
          'INSERT INTO full_scan_responses(task_id,attempt_id,observed_at,response) VALUES(?,?,?,?)',
          other.task_id,
          other.attempt_id,
          other.observed_at,
          unrelated,
        );
    });
    const failedAttempt = store.run(
      "INSERT INTO full_scan_attempts(task_id,attempt,started_at,finished_at,status,error) VALUES(?,99,?,?,'failed','Synthetic attempt failure')",
      task.id,
      task.response_at,
      task.response_at,
    ).lastInsertRowid;
    store.run(
      'INSERT INTO full_scan_responses(task_id,attempt_id,observed_at,response) VALUES(?,?,?,?)',
      task.id,
      failedAttempt,
      task.response_at,
      task.response,
    );
    const rows = store.all('SELECT * FROM full_scan_responses ORDER BY id');
    const beforePlan = store
      .all('EXPLAIN QUERY PLAN ' + coveredResponseSql, ...params)
      .map((r) => r.detail)
      .join(' | ');
    assert.match(beforePlan, /SCAN r/);
    const before = store.one(coveredResponseSql, ...params)!;
    ensureFullScanSchema(store);
    const afterPlan = store
      .all('EXPLAIN QUERY PLAN ' + coveredResponseSql, ...params)
      .map((r) => r.detail)
      .join(' | ');
    assert.match(afterPlan, /SEARCH r USING INDEX full_scan_response_task_time/);
    assert.doesNotMatch(afterPlan, /SCAN r/);
    assert.deepEqual(store.one(coveredResponseSql, ...params), before);
    assert.notEqual(before.attempt_id, Number(failedAttempt));
    assert.equal(
      store.one(coveredResponseSql, task.id, task.response_at + '-wrong', task.response),
      undefined,
    );
    assert.equal(store.one(coveredResponseSql, task.id, task.response_at, '{}'), undefined);
    assert.deepEqual(store.all('SELECT * FROM full_scan_responses ORDER BY id'), rows);
    assert.equal(coalesceCoveredJobs(store, batchId), 1);
    assert.equal(
      JSON.parse(store.one('SELECT result FROM jobs WHERE id=?', job.id)!.result).proofs[0]
        .responseId,
      before.id,
    );
  } finally {
    store.close();
  }
});

test('HMA-05/06: repeated schema initialization and file reopen retain the response index and all prior rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appeye-response-index-'));
  const path = join(dir, 'fixture.sqlite');
  let store = createStore(path);
  try {
    ensureFullScanSchema(store);
    const schema = store.all('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name');
    const countries = store.all('SELECT * FROM countries ORDER BY code');
    ensureFullScanSchema(store);
    assert.deepEqual(
      store.all('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name'),
      schema,
    );
    store.close();
    store = createStore(path);
    ensureFullScanSchema(store);
    assert.deepEqual(
      store.all('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name'),
      schema,
    );
    assert.deepEqual(store.all('SELECT * FROM countries ORDER BY code'), countries);
    assert.ok(
      store.one("SELECT name FROM sqlite_master WHERE name='full_scan_response_task_time'"),
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HMA-06: interruption after one covered job update rolls the whole coalescing transaction back', async () => {
  const { store, app, batchId } = await coveredFixture();
  try {
    const second = store.enqueueJob({
      type: 'enrich',
      country: 'th',
      store: app.store,
      appId: app.id,
    });
    store.run("UPDATE jobs SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?", second.id);
    const before = store.all('SELECT * FROM jobs ORDER BY id');
    store.db.exec(
      `CREATE TRIGGER synthetic_coalescing_failure BEFORE UPDATE ON jobs WHEN OLD.id=${second.id} AND NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'Synthetic mid-coalescing interruption'); END;`,
    );
    assert.throws(
      () => coalesceCoveredJobs(store, batchId),
      /Synthetic mid-coalescing interruption/,
    );
    assert.deepEqual(store.all('SELECT * FROM jobs ORDER BY id'), before);
    store.db.exec('DROP TRIGGER synthetic_coalescing_failure');
    assert.equal(coalesceCoveredJobs(store, batchId), 2);
    assert.ok(
      store
        .all('SELECT status,result FROM jobs')
        .every((r) => r.status === 'succeeded' && JSON.parse(r.result).coalesced),
    );
  } finally {
    store.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, type Store } from '../server/db.js';
import { ensureFullScanSchema } from '../server/full-scan.js';
import { discoveryIdentity } from '../server/extended-discovery.js';
const parse = (v: string | null) => (v ? JSON.parse(v) : null);

// Frozen pre-#49 query behavior: compare the entire public result against this baseline.
function legacyIdentity(
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

const at = '2026-09-20T04:00:00.000Z';
const target = { country: 'th', store: 'google-play', externalId: 'fixture.runtime.loan' };
function insert(store: Store, table: string, row: Record<string, any>) {
  const keys = Object.keys(row);
  store.run(
    `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
    ...Object.values(row),
  );
}
function fixture(batch = true) {
  const store = createStore();
  if (batch) ensureFullScanSchema(store);
  const app = store.createApp({ ...target, externalId: target.externalId });
  store.updateClassification(app.id, 'excluded');
  insert(store, 'discovery_candidates', {
    id: 1,
    ...{ country: target.country, store: target.store, external_id: target.externalId },
    title: 'Synthetic',
    status: 'pending',
    first_observed_at: at,
    last_observed_at: at,
    created_at: at,
    analysis: JSON.stringify({ verdict: 'direct' }),
  });
  insert(store, 'monitor_cycles', { id: 1, due_at: at, started_at: at, status: 'completed' });
  if (batch)
    insert(store, 'full_scan_runs', {
      id: 'fixture',
      config: '{}',
      status: 'completed',
      created_at: at,
      updated_at: at,
      coverage: 'synthetic',
    });
  const blob = 'synthetic-only-'.repeat(4000);
  for (let i = 1; i <= 32; i++) {
    insert(store, 'discovery_cycles', {
      id: i,
      due_at: at,
      started_at: at,
      status: 'completed',
      settings: '{}',
    });
    insert(store, 'discovery_tasks', {
      id: i,
      cycle_id: i,
      country: target.country,
      store: target.store,
      kind: i % 2 ? 'similar' : 'detail',
      candidate_id: i % 2 ? null : 1,
      payload: JSON.stringify({ unused: blob }),
      status: i % 5 === 0 ? 'failed' : 'succeeded',
      error: i % 5 === 0 ? 'source failure' : null,
      stop_reason: i % 5 === 0 ? 'related-degraded' : 'sdk-related-ended',
      created_at: at,
    });
    insert(store, 'monitor_tasks', {
      id: i,
      cycle_id: 1,
      task_key: `task${i}`,
      kind: 'detail',
      country: target.country,
      store: target.store,
      external_id: target.externalId,
      payload: JSON.stringify({ unused: blob }),
      status: 'succeeded',
      result: JSON.stringify({
        analysis: { verdict: i % 2 ? 'insufficient' : 'direct' },
        unused: blob,
      }),
      created_at: at,
      next_run_at: at,
    });
    insert(store, 'jobs', {
      id: i,
      type: i % 2 ? 'reviews' : 'refresh',
      status: i % 5 === 0 ? 'failed' : 'succeeded',
      country: target.country,
      store: target.store,
      app_id: app.id,
      dedupe_key: `fixture${i}`,
      created_at: at,
      next_run_at: at,
      result: JSON.stringify({ unused: blob }),
      error: i % 5 === 0 ? 'manual failure' : null,
    });
    if (batch)
      insert(store, 'full_scan_tasks', {
        id: i,
        batch_id: 'fixture',
        task_key: `fixture${i}`,
        kind: 'reviews',
        country: target.country,
        store: target.store,
        external_id: target.externalId,
        payload: '{}',
        phase: 1,
        status: 'succeeded',
        next_run_at: at,
        created_at: at,
        response: JSON.stringify({ unused: blob }),
        stop_reason: 'no-next-token',
      });
    if (i > 27) continue;
    const observedAt = i % 3 === 0 ? '2026-09-19T04:00:00.000Z' : at;
    const source = {
      id: i,
      country: target.country,
      store: target.store,
      external_id: target.externalId,
      task_id: i,
      source: `https://example.invalid/${i}`,
      keyword: `keyword${i}`,
      observed_at: observedAt,
      data: JSON.stringify({ externalId: target.externalId, title: `Title ${i}` }),
      raw: JSON.stringify({ i, blob }),
    };
    insert(store, 'discovery_sources', {
      ...source,
      cycle_id: i,
      origin_key: `fixture${i}`,
      kind: 'similar',
      processed_at: at,
      parent_app_id: app.id,
      request_language: null,
    });
    insert(store, 'monitor_sources', { ...source, cycle_id: 1, request_language: 'th' });
    if (batch)
      insert(store, 'full_scan_sources', {
        ...source,
        batch_id: 'fixture',
        request_language: 'th',
      });
  }
  // Wrong task market referenced by a matching source remains excluded, as before.
  insert(store, 'discovery_tasks', {
    id: 999,
    cycle_id: 1,
    country: 'mx',
    store: target.store,
    kind: 'similar',
    payload: '{}',
    created_at: at,
  });
  insert(store, 'discovery_sources', {
    cycle_id: 1,
    task_id: 999,
    origin_key: 'cross-market',
    country: target.country,
    store: target.store,
    external_id: target.externalId,
    kind: 'similar',
    observed_at: at,
    processed_at: at,
    source: 'https://example.invalid/cross',
    keyword: 'cross',
    data: '{}',
    raw: 'null',
  });
  // Same package in another country and store must not leak into the diagnostic.
  for (const identity of [
    { ...target, country: 'mx' },
    { ...target, store: 'app-store' },
  ])
    insert(store, 'discovery_sources', {
      origin_key: 'other-identity',
      country: identity.country,
      store: identity.store,
      external_id: identity.externalId,
      kind: 'search',
      observed_at: at,
      processed_at: at,
      source: 'https://example.invalid/other',
      keyword: 'other',
      data: '{}',
      raw: '{}',
    });
  return { store, app };
}

test('RUN02: diagnostic preserves complete results, mixed-channel tie ordering, offsets and identity isolation', () => {
  const { store } = fixture();
  try {
    for (const options of [
      {},
      { limit: 1 },
      { limit: 20, offset: 20 },
      { limit: 35, offset: 35 },
      { limit: 0 },
      { limit: 20, offset: 500 },
      { limit: -1, offset: 1 },
    ]) {
      const identity = { ...target, ...options };
      assert.deepEqual(discoveryIdentity(store, identity), legacyIdentity(store, identity));
    }
    const result = discoveryIdentity(store, { ...target, limit: 100 });
    assert.equal(result.sourceTotal, 82);
    assert.equal(new Set(result.sources.map((source) => source.id)).size, 82);
    assert.equal(result.tasks.filter((task) => task.channel === 'extended').length, 20);
    assert(!result.tasks.some((task) => task.id === 999));
    assert.equal(result.classification, 'excluded');
    assert.deepEqual(
      result.sources.slice(0, 3).map((source) => source.id),
      ['batch:26', 'batch:25', 'batch:23'],
    );
    for (const identity of [
      { ...target, country: 'mx' },
      { ...target, store: 'app-store' },
      { ...target, externalId: 'not.present' },
    ])
      assert.deepEqual(discoveryIdentity(store, identity), legacyIdentity(store, identity));
  } finally {
    store.close();
  }
});

test('RUN02: absence of batch schema, unknown identity and empty-page status preserve previous semantics', () => {
  const { store } = fixture(false);
  try {
    for (const identity of [
      target,
      { ...target, offset: 900 },
      { ...target, externalId: 'unknown' },
      { ...target, country: 'mx', offset: 100 },
    ])
      assert.deepEqual(discoveryIdentity(store, identity), legacyIdentity(store, identity));
    assert.equal(
      discoveryIdentity(store, { ...target, externalId: 'unknown' }).status,
      'not-discovered',
    );
    assert.equal(
      discoveryIdentity(store, { ...target, country: 'mx', offset: 100 }).status,
      'not-discovered',
    );
    store.run(
      'UPDATE apps SET last_fetched_at=?,last_error=? WHERE external_id=?',
      at,
      'previous failure',
      target.externalId,
    );
    assert.deepEqual(discoveryIdentity(store, target), legacyIdentity(store, target));
    assert.equal(discoveryIdentity(store, target).status, 'admitted');
  } finally {
    store.close();
  }
});

test('RUN02: raw hydration is bounded by requested source page and diagnostic reads do not change durable data', () => {
  const { store } = fixture();
  try {
    const queries: { sql: string; params: any[] }[] = [];
    const originalAll = store.all.bind(store),
      originalOne = store.one.bind(store);
    store.all = (sql, ...params) => {
      queries.push({ sql, params });
      return originalAll(sql, ...params);
    };
    store.one = (sql, ...params) => {
      queries.push({ sql, params });
      return originalOne(sql, ...params);
    };
    const writes = originalOne('SELECT total_changes() n')!.n;
    const result = discoveryIdentity(store, { ...target, limit: 7, offset: 21 });
    assert.equal(result.sources.length, 7);
    const rawQueries = queries.filter(({ sql }) => /\bdata,raw\b/.test(sql));
    assert.equal(rawQueries.length, 7);
    assert(rawQueries.every(({ sql, params }) => /WHERE id=\?$/.test(sql) && params.length === 1));
    assert(
      queries
        .filter(({ sql }) => sql.includes('UNION'))
        .every(({ sql }) => !sql.includes('data') && !sql.includes('raw')),
    );
    assert(
      !queries.some(({ sql }) =>
        /SELECT\s+(?:t\.)?\*\s+FROM\s+(?:discovery|monitor|full_scan)_tasks/i.test(sql),
      ),
    );
    assert(!queries.some(({ sql }) => sql.includes('t.candidate_id=? OR')));
    assert.equal(originalOne('SELECT total_changes() n')!.n, writes);
    queries.length = 0;
    const empty = discoveryIdentity(store, { ...target, limit: 20, offset: 900 });
    assert.equal(empty.sources.length, 0);
    assert.equal(queries.filter(({ sql }) => /\bdata,raw\b/.test(sql)).length, 0);
    assert.equal(empty.sourceTotal, 82);
  } finally {
    store.close();
  }
});

test('RUN02: staged batch evidence, pending candidate and failed manual import preserve status and analysis', () => {
  const store = createStore();
  ensureFullScanSchema(store);
  try {
    for (const [batchId, date, analysis] of [
      ['older', '2025-01-01', { verdict: 'direct', version: 1 }],
      ['later', '2026-01-01', { verdict: 'insufficient', version: 2 }],
    ] as const)
      insert(store, 'full_scan_candidates', {
        batch_id: batchId,
        country: target.country,
        store: target.store,
        external_id: target.externalId,
        verdict: analysis.verdict,
        analysis: JSON.stringify(analysis),
        observed_at: date,
      });
    assert.deepEqual(discoveryIdentity(store, target), legacyIdentity(store, target));
    assert.equal(discoveryIdentity(store, target).status, 'staged');
    assert.equal(discoveryIdentity(store, target).analysis.version, 2);
    insert(store, 'discovery_candidates', {
      country: target.country,
      store: target.store,
      external_id: target.externalId,
      title: 'Candidate',
      status: 'failed',
      error: 'detail failed',
      first_observed_at: at,
      last_observed_at: at,
      created_at: at,
      analysis: JSON.stringify({ verdict: 'insufficient', version: 3 }),
    });
    assert.deepEqual(discoveryIdentity(store, target), legacyIdentity(store, target));
    assert.equal(discoveryIdentity(store, target).status, 'failed');
    assert.equal(discoveryIdentity(store, target).analysis.version, 3);
    const app = store.createApp(target);
    insert(store, 'jobs', {
      type: 'refresh',
      status: 'failed',
      country: target.country,
      store: target.store,
      app_id: app.id,
      dedupe_key: 'manual-failed',
      error: 'source refused',
      created_at: at,
      next_run_at: at,
    });
    assert.deepEqual(discoveryIdentity(store, target), legacyIdentity(store, target));
    assert.equal(discoveryIdentity(store, target).status, 'failed');
    store.run("UPDATE jobs SET status='queued' WHERE app_id=?", app.id);
    assert.deepEqual(discoveryIdentity(store, target), legacyIdentity(store, target));
    assert.equal(discoveryIdentity(store, target).status, 'pending');
  } finally {
    store.close();
  }
});

test('RUN01/02: diagnostic metadata and task identity routes use their covering indexes', () => {
  const { store } = fixture();
  try {
    const calls: { sql: string; params: any[] }[] = [];
    const all = store.all.bind(store);
    store.all = (sql, ...params) => {
      calls.push({ sql, params });
      return all(sql, ...params);
    };
    discoveryIdentity(store, target);
    const union = calls.find(({ sql }) => sql.includes('SELECT channel,id,observed_at'))!;
    const plans = all('EXPLAIN QUERY PLAN ' + union.sql, ...union.params).map(
      (row) => row.detail as string,
    );
    for (const table of ['discovery_sources', 'monitor_sources', 'full_scan_sources'])
      assert(
        plans.some((plan) => plan.includes(`SEARCH ${table} USING COVERING INDEX`)),
        plans.join('\n'),
      );
    const taskIds = calls.find(({ sql }) => sql.includes('SELECT id FROM ('))!;
    const taskPlans = all('EXPLAIN QUERY PLAN ' + taskIds.sql, ...taskIds.params).map(
      (row) => row.detail as string,
    );
    assert(
      taskPlans.some((plan) => plan.includes('COVERING INDEX discovery_tasks_candidate_market')),
    );
    assert(
      taskPlans.some((plan) => plan.includes('COVERING INDEX discovery_sources_identity_task')),
    );
    assert(
      !taskPlans.some((plan) => /SCAN (?:t|discovery_tasks)\b/.test(plan)),
      taskPlans.join('\n'),
    );
  } finally {
    store.close();
  }
});

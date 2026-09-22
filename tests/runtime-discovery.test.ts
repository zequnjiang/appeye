import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, type Store } from '../server/db.js';
import {
  createDiscoveryRunner,
  findQueuedDiscoveryTask,
  reconcileDiscoveryCandidates,
} from '../server/extended-discovery.js';
import { hourlyData, hourlyProviders, hourStart } from './hourly-fixtures.js';

// Frozen production query before #49. Compare complete business rows, not only counts.
const originalReconcile = `UPDATE discovery_candidates AS c SET app_id=(SELECT a.id FROM apps a WHERE a.country=c.country AND a.store=c.store AND a.external_id=c.external_id),status='admitted'
  WHERE EXISTS(SELECT 1 FROM apps a WHERE a.country=c.country AND a.store=c.store AND a.external_id=c.external_id AND a.last_fetched_at IS NOT NULL)`;
function candidate(
  store: Store,
  input: {
    country?: string;
    market?: string;
    externalId: string;
    appId?: number | null;
    status?: string;
    served?: string | null;
    created?: string;
  },
) {
  return Number(
    store.run(
      `INSERT INTO discovery_candidates(country,store,external_id,title,app_id,status,
      first_observed_at,last_observed_at,last_served,created_at,attempts,error,analysis)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      input.country ?? 'th',
      input.market ?? 'google-play',
      input.externalId,
      `Candidate ${input.externalId}`,
      input.appId ?? null,
      input.status ?? 'pending',
      '2025-01-01',
      hourStart,
      input.served ?? null,
      input.created ?? hourStart,
      3,
      'Preserve earlier attempt error',
      JSON.stringify({ verdict: 'possible', unknown: 'x'.repeat(1200) }),
    ).lastInsertRowid,
  );
}
function originalFind(
  store: Store,
  cycle: number,
  country: string,
  market: string,
  detail: boolean,
  sourceKind?: string,
) {
  return store.one(
    `SELECT t.* FROM discovery_tasks t
    LEFT JOIN discovery_frontier f ON f.id=t.frontier_id LEFT JOIN discovery_candidates c ON c.id=t.candidate_id
    WHERE t.cycle_id=? AND t.country=? AND t.store=? AND t.status='queued'
      AND ${detail ? "t.kind='detail'" : "t.kind<>'detail'"} ${sourceKind ? 'AND t.kind=?' : ''}
    ORDER BY COALESCE(c.last_served,c.created_at,f.last_served,f.created_at,''),t.id LIMIT 1`,
    cycle,
    country,
    market,
    ...(sourceKind ? [sourceKind] : []),
  );
}

test('RUN02: candidate reconciliation preserves all original rows and only writes changed identities/statuses', () => {
  const store = createStore();
  try {
    store.run("UPDATE countries SET enabled=0 WHERE code='mx'");
    const wrong = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.wrong',
    });
    let sequence = 0;
    for (const country of ['th', 'mx']) {
      for (const status of [
        'pending',
        'staged',
        'failed',
        'admitted',
        'deferred',
        'future-status',
      ]) {
        for (const association of ['correct', 'null', 'wrong']) {
          const externalId = `fixture.reconcile.${++sequence}`;
          const app = store.createApp({ country, store: 'google-play', externalId });
          store.run(
            'UPDATE apps SET last_fetched_at=?,classification=? WHERE id=?',
            sequence % 2 ? hourStart : '',
            sequence % 2 ? 'excluded' : 'candidate',
            app.id,
          );
          candidate(store, {
            country,
            externalId,
            status,
            appId: association === 'correct' ? app.id : association === 'wrong' ? wrong.id : null,
          });
        }
      }
    }
    // A placeholder is not fetched; matching only another store/country is not identity evidence.
    for (const externalId of [
      'fixture.unfetched',
      'fixture.other-country',
      'fixture.other-store',
    ]) {
      const app = store.createApp({
        country: externalId.endsWith('country') ? 'mx' : 'th',
        store: externalId.endsWith('store') ? 'app-store' : 'google-play',
        externalId,
      });
      if (!externalId.endsWith('unfetched'))
        store.run('UPDATE apps SET last_fetched_at=? WHERE id=?', hourStart, app.id);
      candidate(store, { externalId, appId: wrong.id, status: 'failed' });
    }
    candidate(store, { externalId: 'fixture.missing', status: 'admitted', appId: wrong.id });
    const appsBefore = store.all('SELECT * FROM apps ORDER BY id');
    const before = store.all('SELECT * FROM discovery_candidates ORDER BY id');
    store.db.exec('SAVEPOINT old_reconcile');
    store.run(originalReconcile);
    const expected = store.all('SELECT * FROM discovery_candidates ORDER BY id');
    store.db.exec('ROLLBACK TO old_reconcile; RELEASE old_reconcile');
    const expectedWrites = expected.filter(
      (row, index) => row.app_id !== before[index].app_id || row.status !== before[index].status,
    ).length;
    const result = reconcileDiscoveryCandidates(store);
    assert.equal(result.changes, expectedWrites);
    assert.equal(expectedWrites, 34);
    assert.deepEqual(store.all('SELECT * FROM discovery_candidates ORDER BY id'), expected);
    assert.deepEqual(store.all('SELECT * FROM apps ORDER BY id'), appsBefore);
    assert.equal(reconcileDiscoveryCandidates(store).changes, 0);
    // Identity changes after a prior admission still repair the stale association.
    const id = before.find((r) => r.status === 'admitted')!.id;
    store.run('UPDATE discovery_candidates SET app_id=NULL WHERE id=?', id);
    assert.equal(reconcileDiscoveryCandidates(store).changes, 1);
    assert.deepEqual(store.all('SELECT * FROM discovery_candidates ORDER BY id'), expected);
  } finally {
    store.close();
  }
});

test('RUN02: enqueue still admits paused-market matches but queues only enabled pending identities', () => {
  const store = createStore();
  try {
    store.run("UPDATE countries SET enabled=CASE WHEN code='th' THEN 1 ELSE 0 END");
    for (const country of ['th', 'mx']) {
      const app = store.createApp({
        country,
        store: 'google-play',
        externalId: `fixture.${country}.fetched`,
      });
      store.run('UPDATE apps SET last_fetched_at=? WHERE id=?', hourStart, app.id);
      candidate(store, { country, externalId: app.externalId, status: 'failed' });
      candidate(store, { country, externalId: `fixture.${country}.pending` });
    }
    const runner = createDiscoveryRunner({
      store,
      providers: hourlyProviders(),
      now: () => new Date(hourStart),
    });
    runner.schedule();
    assert.equal(
      store.one("SELECT COUNT(*) n FROM discovery_candidates WHERE status='admitted'")!.n,
      2,
    );
    const tasks = store.all("SELECT * FROM discovery_tasks WHERE kind='detail'");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].country, 'th');
    assert.equal(JSON.parse(tasks[0].payload).externalId, 'fixture.th.pending');
    const before = store.all('SELECT * FROM discovery_tasks ORDER BY id');
    runner.schedule();
    assert.deepEqual(store.all('SELECT * FROM discovery_tasks ORDER BY id'), before);
  } finally {
    store.close();
  }
});

test('RUN02: ID-only task selection preserves full rows, every scope, ties and complete dequeue order', () => {
  const store = createStore();
  try {
    for (let cycle = 1; cycle <= 2; cycle++) {
      store.run(
        'INSERT INTO discovery_cycles(id,due_at,started_at,status,settings) VALUES (?,?,?,?,?)',
        cycle,
        hourStart,
        hourStart,
        'completed',
        '{}',
      );
      for (const country of ['th', 'mx'])
        for (const market of ['google-play', 'app-store']) {
          for (const kind of ['detail', 'search', 'similar', 'developer', 'catalog']) {
            for (let n = 0; n < 5; n++) {
              const target = `${cycle}:${country}:${market}:${kind}:${n}`;
              const created = n < 3 ? hourStart : '2020-01-01';
              let candidateId: number | null = null,
                frontierId: number | null = null;
              if (kind === 'detail')
                candidateId = candidate(store, {
                  country,
                  market,
                  externalId: target,
                  created,
                  served: n === 2 ? '2027-01-01' : null,
                });
              else
                frontierId = Number(
                  store.run(
                    'INSERT INTO discovery_frontier(country,store,kind,target,payload,last_served,created_at) VALUES (?,?,?,?,?,?,?)',
                    country,
                    market,
                    kind,
                    target,
                    '{}',
                    n === 2 ? '2027-01-01' : null,
                    created,
                  ).lastInsertRowid,
                );
              store.run(
                `INSERT INTO discovery_tasks(cycle_id,country,store,kind,candidate_id,frontier_id,payload,status,created_at,error)
              VALUES(?,?,?,?,?,?,?,?,?,?)`,
                cycle,
                country,
                market,
                kind,
                candidateId,
                frontierId,
                JSON.stringify({ target, retained: 'p'.repeat(16000) }),
                n === 4 ? 'failed' : 'queued',
                hourStart,
                n === 3 ? 'preserve existing error' : null,
              );
            }
          }
        }
    }
    // Null joins sort by the exact original empty-string fallback.
    store.run(
      `INSERT INTO discovery_tasks(cycle_id,country,store,kind,payload,created_at)
      VALUES(1,'th','google-play','search','{}',?)`,
      hourStart,
    );
    const originalRows = store.all('SELECT * FROM discovery_tasks ORDER BY id');
    for (let cycle = 1; cycle <= 2; cycle++)
      for (const country of ['th', 'mx', 'pk']) {
        for (const market of ['google-play', 'app-store']) {
          for (const detail of [true, false])
            for (const sourceKind of [undefined, 'search', 'similar', 'developer', 'catalog']) {
              assert.deepEqual(
                findQueuedDiscoveryTask(store, cycle, country, market, detail, sourceKind),
                originalFind(store, cycle, country, market, detail, sourceKind),
              );
            }
        }
      }
    let selected = 0;
    for (let cycle = 1; cycle <= 2; cycle++)
      for (const country of ['th', 'mx']) {
        for (const market of ['google-play', 'app-store'])
          for (const detail of [true, false]) {
            while (true) {
              const expected = originalFind(store, cycle, country, market, detail);
              const actual = findQueuedDiscoveryTask(store, cycle, country, market, detail);
              assert.deepEqual(actual, expected);
              if (!actual) break;
              store.run("UPDATE discovery_tasks SET status='running' WHERE id=?", actual.id);
              selected++;
            }
          }
      }
    assert.equal(selected, 161);
    const finalRows = store.all('SELECT * FROM discovery_tasks ORDER BY id');
    assert.deepEqual(
      finalRows.map((r) => ({ ...r, status: originalRows.find((x) => x.id === r.id)!.status })),
      originalRows.map((r) => ({ ...r })),
    );
  } finally {
    store.close();
  }
});

test('RUN02: runner retains market and source/detail alternation with limited fake HTTP budgets', async () => {
  const store = createStore();
  try {
    store.run("UPDATE countries SET enabled=CASE WHEN code IN ('th','mx') THEN 1 ELSE 0 END");
    for (const country of ['th', 'mx'])
      for (const market of ['google-play', 'app-store']) {
        candidate(store, { country, market, externalId: `fixture.${country}.${market}.pending` });
      }
    const providers = hourlyProviders();
    const runner = createDiscoveryRunner({
      store,
      providers,
      now: () => new Date(hourStart),
      sourceRequests: 1,
      detailRequests: 1,
    });
    for (const provider of Object.values(providers)) {
      provider.extendedSearch = async () => {
        runner.captureRequestBudget()();
        return {
          data: [],
          raw: [],
          source: 'https://example.invalid',
          stopReason: 'sdk-iterator-ended',
        };
      };
      provider.app = async ({ externalId }) => {
        runner.captureRequestBudget()();
        return hourlyData(externalId);
      };
    }
    for (let n = 0; n < 8; n++) assert.equal(await runner.runOnce(), true);
    const attempts = store.all(
      `SELECT t.country,t.store,t.kind FROM discovery_attempts a JOIN discovery_tasks t ON t.id=a.task_id ORDER BY a.id`,
    );
    assert.deepEqual(
      attempts.map((r) => `${r.country}/${r.store}/${r.kind}`),
      ['search', 'detail'].flatMap((kind) =>
        ['mx', 'th'].flatMap((country) =>
          ['app-store', 'google-play'].map((market) => `${country}/${market}/${kind}`),
        ),
      ),
    );
    assert.equal(store.one('SELECT COUNT(*) n FROM apps')!.n, 4);
    for (const market of store.all('SELECT * FROM discovery_markets')) {
      assert.equal(market.source_requests, 1);
      assert.equal(market.detail_requests, 1);
    }
  } finally {
    store.close();
  }
});

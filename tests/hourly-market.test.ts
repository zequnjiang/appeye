import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createHourlyRunner, getCollectionStatus } from '../server/hourly-monitor.js';
import { activityWindow, getMarketActivity, releaseEvidence } from '../server/market-activity.js';
import { accessoryFixture } from './loan-fixtures.js';
import { serve } from './http-helper.js';
import {
  drainHourly,
  hourlyData,
  hourlyProvider,
  hourlyProviders,
  hourlyStore,
  hourStart,
  oneCountry,
} from './hourly-fixtures.js';

test('HMA-01/06: six countries and both stores refresh every 60 minutes including excluded, without review or enrichment fanout', async () => {
  const store = createStore();
  let tick = new Date(hourStart);
  const calls: string[] = [];
  try {
    const old = [];
    for (const country of store.listCountries()) {
      store.upsertCountry({ ...country, keywords: ['loan'], intervalHours: 1 });
      for (const name of ['google-play', 'app-store'] as const) {
        const app = store.createApp({
          country: country.code,
          store: name,
          externalId: name === 'app-store' ? '123456' : 'fixture.hourly.loan',
          observedAt: '2026-09-01T00:00:00.000Z',
        });
        store.updateClassification(app.id, 'excluded');
        old.push(app.id);
      }
    }
    const providers = hourlyProviders(
      Object.fromEntries(
        ['google-play', 'app-store'].map((name) => [
          name,
          hourlyProvider({
            app: async (input) => {
              calls.push(`${name}:${input.country}`);
              return hourlyData(input.externalId);
            },
          }),
        ]),
      ),
    );
    const runner = createHourlyRunner({ store, providers, now: () => tick });
    const first = runner.schedule();
    assert.ok(first);
    assert.equal(store.one("SELECT COUNT(*) n FROM monitor_tasks WHERE kind='detail'")!.n, 12);
    assert.equal(
      new Set(
        store.all('SELECT country,store FROM monitor_tasks').map((r) => `${r.country}:${r.store}`),
      ).size,
      12,
    );
    const initialTaskCount = store.one('SELECT COUNT(*) n FROM monitor_tasks')!.n;
    assert.equal(runner.schedule(), first);
    assert.equal(store.one('SELECT COUNT(*) n FROM monitor_tasks')!.n, initialTaskCount);
    await drainHourly(runner);
    assert.equal(calls.length, 12);
    tick = new Date(Date.parse(hourStart) + 3599999);
    assert.equal(runner.schedule(), null);
    tick = new Date(Date.parse(hourStart) + 3600000);
    assert.notEqual(runner.schedule(), first);
    await drainHourly(runner);
    assert.equal(calls.length, 24);
    assert.equal(store.one('SELECT COUNT(*) n FROM monitor_cycles')!.n, 2);
    assert.equal(store.one('SELECT COUNT(*) n FROM jobs')!.n, 0);
    assert.equal(store.one('SELECT COUNT(*) n FROM reviews')!.n, 0);
    assert.equal(store.one('SELECT COUNT(*) n FROM enrichments')!.n, 0);
    for (const id of old) {
      assert.equal(store.getApp(id)!.classification, 'excluded');
      assert.equal(store.getApp(id)!.classificationSource, 'manual');
      assert.equal(store.getApp(id)!.firstSeenAt, '2026-09-01T00:00:00.000Z');
      assert.equal(store.listSnapshots(id).total, 2);
    }
  } finally {
    store.close();
  }
});

test('HMA-02: file restart preserves pending IDs and coalesces five missed hours to one latest cycle', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-hourly-'));
  const path = join(directory, 'fixture.sqlite');
  let store = oneCountry(createStore(path));
  let tick = new Date(hourStart);
  try {
    let runner = createHourlyRunner({ store, providers: hourlyProviders(), now: () => tick });
    runner.schedule();
    const pending = store.all('SELECT id,task_key,payload FROM monitor_tasks ORDER BY id');
    store.close();
    store = createStore(path);
    runner = createHourlyRunner({ store, providers: hourlyProviders(), now: () => tick });
    runner.recover();
    runner.schedule();
    assert.deepEqual(
      store.all('SELECT id,task_key,payload FROM monitor_tasks ORDER BY id'),
      pending,
    );
    await drainHourly(runner);
    tick = new Date(Date.parse(hourStart) + 5 * 3600000 + 1800000);
    const latest = runner.schedule();
    runner.schedule();
    assert.equal(store.one('SELECT COUNT(*) n FROM monitor_cycles')!.n, 2);
    assert.equal(
      store.one('SELECT due_at FROM monitor_cycles WHERE id=?', latest)!.due_at,
      '2026-09-06T21:00:00.000Z',
    );
    assert.equal(runner.status().nextDueAt, '2026-09-06T22:00:00.000Z');
    assert.equal(
      store.one('SELECT COUNT(*) n FROM monitor_tasks WHERE cycle_id=?', latest)!.n,
      pending.length,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HMA-03: pausing skips unstarted automatic work; a newly enabled country joins an active cycle', async () => {
  const store = hourlyStore();
  const calls: string[] = [];
  const providers = hourlyProviders({
    'google-play': hourlyProvider({
      list: async (input) => {
        calls.push(input.country);
        return { data: [], raw: [], source: 'https://example.invalid/list' };
      },
    }),
  });
  try {
    const runner = createHourlyRunner({ store, providers, now: () => new Date(hourStart) });
    runner.schedule();
    store.upsertCountry({
      code: 'vn',
      name: '越南',
      language: 'vi',
      keywords: ['vay'],
      enabled: true,
      intervalHours: 1,
    });
    runner.schedule();
    assert.ok(store.one("SELECT id FROM monitor_tasks WHERE country='vn'"));
    store.upsertCountry({ ...store.getCountry('th')!, enabled: false });
    runner.schedule();
    assert.equal(
      store.one("SELECT COUNT(*) n FROM monitor_tasks WHERE country='th' AND status!='skipped'")!.n,
      0,
    );
    await drainHourly(runner);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((country) => country === 'vn'));
    assert.deepEqual(store.getCountry('vn')!.keywords, ['vay']);
    assert.equal(store.getCountry('vn')!.language, 'vi');
  } finally {
    store.close();
  }
});

test('HMA-04: finite backoff preserves last success, and the next hourly cycle can try again', async () => {
  const store = hourlyStore();
  let tick = new Date(hourStart);
  let calls = 0;
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.hourly.loan',
      observedAt: '2026-09-01T00:00:00.000Z',
    });
    store.saveObservation(app.id, hourlyData(), '2026-09-05T00:00:00.000Z');
    const original = store.getApp(app.id)!;
    const runner = createHourlyRunner({
      store,
      providers: hourlyProviders({
        'google-play': hourlyProvider({
          app: async () => {
            calls++;
            throw new Error('Synthetic upstream unavailable');
          },
        }),
      }),
      now: () => tick,
      maxAttempts: 2,
      retryDelayMs: 1000,
    });
    runner.schedule();
    store.run("UPDATE monitor_tasks SET status='skipped' WHERE kind!='detail'");
    await runner.runOnce();
    assert.equal(calls, 1);
    assert.equal(await runner.runOnce(), false);
    tick = new Date(Date.parse(hourStart) + 1000);
    await runner.runOnce();
    assert.equal(calls, 2);
    assert.equal(
      store.one("SELECT status FROM monitor_tasks WHERE kind='detail'")!.status,
      'failed',
    );
    assert.equal(store.getApp(app.id)!.firstSeenAt, original.firstSeenAt);
    assert.equal(store.getApp(app.id)!.lastFetchedAt, original.lastFetchedAt);
    assert.deepEqual(store.getApp(app.id)!.storeData, original.storeData);
    assert.equal(store.listSnapshots(app.id).total, 1);
    assert.equal(store.listChanges({ appId: app.id }).total, 0);
    assert.equal(runner.status().failures.length, 1);
    tick = new Date(Date.parse(hourStart) + 3600000);
    runner.schedule();
    assert.equal(
      store.one(
        "SELECT COUNT(*) n FROM monitor_tasks WHERE kind='detail' AND status='queued' AND attempts=0",
      )!.n,
      1,
    );
    assert.equal(store.one('SELECT COUNT(*) n FROM monitor_attempts')!.n, 2);
  } finally {
    store.close();
  }
});

test('HMA-02/08/11: applied response replay keeps one snapshot and its original observation time', async () => {
  const store = hourlyStore();
  let calls = 0;
  let tick = new Date(hourStart);
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.hourly.loan',
    });
    const runner = createHourlyRunner({
      store,
      providers: hourlyProviders({
        'google-play': hourlyProvider({
          app: async () => {
            calls++;
            return hourlyData();
          },
        }),
      }),
      now: () => tick,
    });
    runner.schedule();
    store.run("UPDATE monitor_tasks SET status='skipped' WHERE kind!='detail'");
    await runner.runOnce();
    const task = store.one("SELECT * FROM monitor_tasks WHERE kind='detail'")!;
    assert.equal(task.response_id, task.applied_response_id);
    const snapshot = store.listSnapshots(app.id).snapshots[0];
    store.run("UPDATE monitor_tasks SET status='running' WHERE id=?", task.id);
    store.run("UPDATE monitor_attempts SET status='running' WHERE task_id=?", task.id);
    tick = new Date(Date.parse(hourStart) + 10000);
    runner.recover();
    await runner.runOnce();
    assert.equal(calls, 1);
    assert.equal(store.listSnapshots(app.id).total, 1);
    assert.deepEqual(store.listSnapshots(app.id).snapshots[0], snapshot);
    assert.equal(
      store.one('SELECT status FROM monitor_attempts ORDER BY id LIMIT 1')!.status,
      'interrupted',
    );
    assert.equal(store.one('SELECT COUNT(*) n FROM monitor_responses')!.n, 1);
    assert.equal(store.getApp(app.id)!.lastFetchedAt, hourStart);
  } finally {
    store.close();
  }
});

test('HMA-06/08: discoveries keep unknown raw fields, stage insufficient, admit strong, and retain manual exclusions', async () => {
  const store = hourlyStore();
  const positive = hourlyData('fixture.new.loan');
  const negative = {
    ...hourlyData('fixture.new.calculator'),
    ...accessoryFixture,
    externalId: 'fixture.new.calculator',
  };
  try {
    const excluded = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.excluded',
    });
    store.updateClassification(excluded.id, 'excluded');
    const runner = createHourlyRunner({
      store,
      now: () => new Date(hourStart),
      providers: hourlyProviders({
        'google-play': hourlyProvider({
          list: async () => ({
            data: [positive, negative],
            raw: { newEnvelope: true, rows: [positive, negative] },
            source: 'https://example.invalid/finance',
          }),
          app: async ({ externalId }) =>
            externalId === negative.externalId ? negative : hourlyData(externalId),
        }),
      }),
    });
    await drainHourly(runner);
    const admitted = store.one(
      'SELECT id,classification FROM apps WHERE external_id=?',
      positive.externalId,
    )!;
    assert.equal(admitted.classification, 'confirmed');
    assert.equal(
      store.one('SELECT id FROM apps WHERE external_id=?', negative.externalId),
      undefined,
    );
    assert.equal(store.getApp(excluded.id)!.classification, 'excluded');
    assert.ok(
      store.one(
        "SELECT id FROM monitor_tasks WHERE external_id=? AND json_extract(result,'$.admitted')=0",
        negative.externalId,
      ),
    );
    assert.ok(
      store.one("SELECT id FROM monitor_responses WHERE json_extract(data,'$.raw.newEnvelope')=1"),
    );
    assert.deepEqual(store.getApp(admitted.id)!.storeData!.futureField, { retained: true });
    assert.equal(store.one('SELECT COUNT(*) n FROM jobs')!.n, 0);
  } finally {
    store.close();
  }
});

test('HMA-06: earlier prefetched detail remains in ledger and cannot roll back a newer current observation', async () => {
  const store = hourlyStore();
  try {
    const app = store.createApp({ country: 'th', store: 'app-store', externalId: '123456' });
    store.saveObservation(
      app.id,
      { ...hourlyData('123456'), version: '3.0' },
      '2026-09-07T01:00:00.000Z',
    );
    const runner = createHourlyRunner({
      store,
      now: () => new Date('2026-09-07T02:00:00.000Z'),
      providers: hourlyProviders({
        'app-store': hourlyProvider({
          appWithPeers: async () => ({
            data: { ...hourlyData('123456'), version: '2.0' },
            observedAt: '2026-09-06T23:00:00.000Z',
            provenance: {
              method: 'bulk-lookup',
              source: 'https://example.invalid/lookup',
              batchId: 'hourly:1',
              country: 'th',
              language: 'en_us',
            },
          }),
        }),
      }),
    });
    runner.schedule();
    store.run("UPDATE monitor_tasks SET status='skipped' WHERE kind!='detail'");
    await runner.runOnce();
    assert.equal(store.getApp(app.id)!.version, '3.0');
    assert.equal(store.listSnapshots(app.id).total, 2);
    assert.equal(store.listSnapshots(app.id).snapshots[1].data.version, '2.0');
    assert.deepEqual(store.listSnapshots(app.id).snapshots[1].raw, hourlyData('123456').raw);
    assert.equal(
      JSON.parse(store.one("SELECT result FROM monitor_tasks WHERE kind='detail'")!.result)
        .supersededByLaterObservation,
      true,
    );
    assert.equal(
      store.one('SELECT observed_at FROM monitor_responses')!.observed_at,
      '2026-09-06T23:00:00.000Z',
    );
  } finally {
    store.close();
  }
});

test('HMA-10: Shanghai date boundaries and release precision are explicit and invalid dates/timezones fail', () => {
  assert.deepEqual(activityWindow(undefined, undefined, new Date('2026-09-06T16:00:00Z')), {
    dateMode: 'business-timezone',
    timeZone: 'Asia/Shanghai',
    date: '2026-09-07',
    windowStart: hourStart,
    windowEnd: '2026-09-07T16:00:00.000Z',
  });
  assert.equal(
    activityWindow(undefined, undefined, new Date('2026-09-06T15:59:59.999Z')).date,
    '2026-09-06',
  );
  for (const date of ['2026-02-30', '2026-13-01', '2026-9-7', 'bad'])
    assert.throws(() => activityWindow(date));
  assert.throws(() => activityWindow('2026-09-07', 'America/Mexico_City'));
  assert.deepEqual(releaseEvidence({ storeData: { released: 'Sep 7, 2026' } }), {
    releasedAt: '2026-09-07',
    releasedAtRaw: 'Sep 7, 2026',
    releasedAtPrecision: 'date',
  });
  assert.equal(
    releaseEvidence({ storeData: { releaseDate: '2026-09-06T18:00:00Z' } }).releasedAtPrecision,
    'timestamp',
  );
  assert.equal(
    releaseEvidence({ releasedAt: '2026-09-07' }).releasedAt,
    null,
    'A normalized date without source evidence is not an invented release',
  );
  assert.equal(
    releaseEvidence({ storeData: { releaseDate: '2026-09-07T12:00:00' } }).releasedAtPrecision,
    'unknown',
  );
});

test('HMA-08/12: first discovery is not its first successful detail and later observations do not rewrite that source', () => {
  const store = createStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.discovery.source',
      observedAt: hourStart,
    });
    const empty = getMarketActivity(store, { date: '2026-09-07', type: 'firstSeen' }).events[0];
    assert.equal(empty.eventAt, hourStart);
    assert.equal(empty.observedAt, null);
    assert.equal(empty.snapshotId, null);
    store.saveObservation(
      app.id,
      {
        ...hourlyData(app.externalId),
        releaseNotes: 'First successful source',
        storeUpdatedAt: '2026-08-01T00:00:00.000Z',
      },
      '2026-09-06T17:00:00.000Z',
    );
    const firstSnapshot = store.listSnapshots(app.id).snapshots[0];
    store.saveObservation(
      app.id,
      {
        ...hourlyData(app.externalId),
        version: '2',
        releaseNotes: 'Later source',
        storeUpdatedAt: '2026-09-06T18:00:00.000Z',
      },
      '2026-09-06T19:00:00.000Z',
    );
    const event = getMarketActivity(store, { date: '2026-09-07', type: 'firstSeen' }).events[0];
    assert.equal(event.eventAt, hourStart);
    assert.equal(event.observedAt, '2026-09-06T17:00:00.000Z');
    assert.equal(event.snapshotId, firstSnapshot.id);
    assert.equal(event.releaseNotes, 'First successful source');
    assert.equal(event.storeUpdatedAt, '2026-08-01T00:00:00.000Z');
    assert.equal(event.lastFetchedAt, '2026-09-06T19:00:00.000Z');
  } finally {
    store.close();
  }
});

test('HMA-08/09/11: market events separate firstSeen/release/observations, unique market IDs, and null-version restoration', () => {
  const store = createStore();
  try {
    const first = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.shared',
      observedAt: hourStart,
    });
    const other = store.createApp({
      country: 'mx',
      store: 'google-play',
      externalId: 'fixture.shared',
      observedAt: hourStart,
    });
    const end = store.createApp({
      country: 'th',
      store: 'app-store',
      externalId: '123456',
      observedAt: '2026-09-07T16:00:00.000Z',
    });
    const data = {
      ...hourlyData('fixture.shared'),
      version: '1',
      storeData: { released: '2026-08-01' },
    };
    store.saveObservation(first.id, data, hourStart);
    store.saveObservation(other.id, { ...data, storeData: { released: '2026-09-07' } }, hourStart);
    store.saveObservation(
      end.id,
      { ...hourlyData('123456'), storeData: { releaseDate: '2026-09-07T16:00:00Z' } },
      '2026-09-07T16:00:00.000Z',
    );
    store.saveObservation(first.id, data, '2026-09-06T16:01:00.000Z');
    store.saveObservation(first.id, { ...data, version: null }, '2026-09-06T17:00:00.000Z');
    store.saveObservation(first.id, data, '2026-09-06T18:00:00.000Z');
    store.saveObservation(
      first.id,
      {
        ...data,
        version: '2',
        releaseNotes: 'Complete synthetic release notes',
        score: 4.8,
        storeUpdatedAt: '2026-09-01T00:00:00.000Z',
      },
      '2026-09-06T19:00:00.000Z',
    );
    const result = getMarketActivity(store, { date: '2026-09-07' });
    assert.deepEqual(result.counts, { firstSeen: 2, storeRelease: 1, observedUpdate: 1 });
    assert.deepEqual(result.eventCounts, { firstSeen: 2, storeRelease: 1, observedUpdate: 3 });
    assert.equal(result.uniqueApps, 2);
    const updates = result.events.filter((e) => e.type === 'observedUpdate');
    assert.deepEqual(
      updates.map((e) => e.versionChanged),
      [true, false, false],
    );
    assert.equal(updates[0].observedAt, '2026-09-06T19:00:00.000Z');
    assert.equal(updates[0].storeUpdatedAt, '2026-09-01T00:00:00.000Z');
    assert.ok(
      updates[0].changes.some(
        (c) => c.field === 'releaseNotes' && c.newValue === 'Complete synthetic release notes',
      ),
    );
    const release = result.events.find((e) => e.type === 'storeRelease')!;
    assert.equal(release.appId, other.id);
    assert.equal(release.eventAt, null);
    assert.equal(release.releasedAtPrecision, 'date');
    assert.ok(release.snapshotId);
    const paged = getMarketActivity(store, {
      date: '2026-09-07',
      type: 'observedUpdate',
      limit: 1,
      offset: 1,
    });
    assert.equal(paged.total, 3);
    assert.equal(paged.uniqueApps, 1);
    assert.equal(paged.events.length, 1);
    assert.equal(paged.events[0].id, updates[1].id);
    store.updateClassification(first.id, 'excluded');
    assert.equal(
      getMarketActivity(store, { date: '2026-09-07', classification: 'excluded' }).uniqueApps,
      1,
    );
    assert.equal(
      getMarketActivity(store, { date: '2026-09-07', country: 'mx' }).counts.observedUpdate,
      0,
    );
  } finally {
    store.close();
  }
});

test('HMA-12/13: activity and collection APIs require auth, validate all filters, and status GET is read-only', async () => {
  const store = hourlyStore();
  const password = 'synthetic-hourly-password';
  const http = await serve(createApp({ store, password, allowedOrigins: [] }));
  try {
    for (const path of ['/api/market-activity', '/api/collection/status', '/api/collection/tasks'])
      assert.equal((await http.request(path)).status, 401);
    assert.equal(
      (
        await http.request('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ password }),
        })
      ).status,
      200,
    );
    for (const query of [
      'date=2026-02-30',
      'date=bad',
      'timeZone=UTC',
      'country=zz',
      'store=bad',
      'classification=loan',
      'type=release',
      'offset=-1',
      'limit=201',
      'surprise=1',
    ])
      assert.equal((await http.request('/api/market-activity?' + query)).status, 400, query);
    const before = store.all('SELECT * FROM monitor_state');
    const response = await http.request(
      '/api/market-activity?date=2026-09-07&type=firstSeen&store=google-play&country=th&classification=excluded&limit=1',
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.timeZone, 'Asia/Shanghai');
    assert.equal(data.windowStart, hourStart);
    assert.equal(data.total, 0);
    const status = await (await http.request('/api/collection/status')).json();
    assert.equal(status.intervalMinutes, 60);
    assert.equal(status.collector.mode, 'external');
    assert.deepEqual(store.all('SELECT * FROM monitor_state'), before);
    assert.equal(store.one('SELECT COUNT(*) n FROM monitor_tasks')!.n, 0);
    assert.equal(getCollectionStatus(store, { now: new Date(hourStart) }).lastSuccessAt, null);
  } finally {
    await http.close();
    store.close();
  }
});

test('HMA-06/09: late historical observations retain independent raw but cannot reverse current state or subsequent changes', () => {
  const store = hourlyStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.late',
    });
    const data = (version: string) => ({
      ...hourlyData(app.externalId),
      version,
      raw: { sourceVersion: version },
    });
    const t1 = '2026-09-07T01:00:00.000Z',
      t2 = '2026-09-07T02:00:00.000Z',
      t3 = '2026-09-07T03:00:00.000Z',
      t4 = '2026-09-07T04:00:00.000Z';
    store.saveObservation(app.id, data('1'), t1);
    store.saveObservation(app.id, data('3'), t3);
    const current = store.one('SELECT * FROM apps WHERE id=?', app.id)!;
    let receipt = 0;
    const late = store.saveObservation(app.id, data('2'), t2, (id) => {
      receipt = id;
    });
    assert.equal(receipt, late.id);
    assert.deepEqual(store.one('SELECT * FROM apps WHERE id=?', app.id), current);
    assert.equal(
      store.getApp(app.id)!.updateCount,
      2,
      'Chronological history now includes the independently observed intermediate version',
    );
    assert.deepEqual(store.getRawDetail(app.id), { sourceVersion: '3' });
    assert.deepEqual(
      store.listSnapshots(app.id).snapshots.map((s) => s.data.version),
      ['3', '2', '1'],
    );
    assert.equal(store.listChanges({ appId: app.id, field: 'version' }).total, 1);
    store.saveObservation(app.id, data('4'), t4);
    const newest = store.listChanges({ appId: app.id, field: 'version' }).changes[0];
    assert.equal(newest.oldValue, '3');
    assert.equal(newest.newValue, '4');
    const same = store.saveObservation(app.id, data('5'), t4);
    assert.equal(store.listSnapshots(app.id).total, 5);
    assert.equal(store.listSnapshots(app.id).snapshots[0].id, same.id);
    assert.equal(store.getApp(app.id)!.version, '5');
    assert.deepEqual(store.getRawDetail(app.id), { sourceVersion: '5' });
    const changes = store.listChanges({ appId: app.id, field: 'version' }).changes;
    assert.ok(changes.some((c) => c.oldValue === '4' && c.newValue === '5'));
  } finally {
    store.close();
  }
});

test('HMA-10/12: Thai Buddhist listing date is exposed through the authenticated calendar API without an invented time', async () => {
  const store = hourlyStore();
  const app = store.createApp({
    country: 'th',
    store: 'google-play',
    externalId: 'fixture.thai.date',
    observedAt: '2026-08-01T00:00:00.000Z',
  });
  store.saveObservation(
    app.id,
    { ...hourlyData(app.externalId), storeData: { released: '7 ก.ย. 2569' } },
    hourStart,
  );
  const http = await serve(
    createApp({ store, password: 'synthetic-calendar-password', allowedOrigins: [] }),
  );
  try {
    await http.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'synthetic-calendar-password' }),
    });
    const res = await http.request(
      '/api/market-activity?date=2026-09-07&type=storeRelease&country=th',
    );
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.total, 1);
    assert.equal(result.events[0].appId, app.id);
    assert.equal(result.events[0].releasedAt, '2026-09-07');
    assert.equal(result.events[0].releasedAtRaw, '7 ก.ย. 2569');
    assert.equal(result.events[0].releasedAtPrecision, 'date');
    assert.equal(result.events[0].eventAt, null);
    assert.equal(result.events[0].observedAt, hourStart);
    assert.equal(
      (
        await (
          await http.request('/api/market-activity?date=2026-09-06&type=storeRelease&country=th')
        ).json()
      ).total,
      0,
    );
  } finally {
    await http.close();
    store.close();
  }
});

test('HMA-08: an insufficient staged identity admitted on a later day retains its original discovery day', async () => {
  const store = hourlyStore();
  let tick = new Date(hourStart);
  let strong = false;
  const externalId = 'fixture.staged.before.admission';
  const provider = hourlyProvider({
    search: async () => ({
      data: [{ externalId, title: 'Synthetic staged app', raw: { unknownStageField: true } }],
      raw: { allSourceFields: 'kept' },
      source: 'https://example.invalid/staged',
      stopReason: 'search-empty-page',
    }),
    app: async () =>
      strong
        ? hourlyData(externalId)
        : { ...hourlyData(externalId), ...accessoryFixture, externalId },
  });
  try {
    const runner = createHourlyRunner({
      store,
      now: () => tick,
      providers: hourlyProviders({ 'google-play': provider }),
    });
    await drainHourly(runner);
    assert.equal(store.one('SELECT id FROM apps WHERE external_id=?', externalId), undefined);
    const first = store.one(
      'SELECT MIN(observed_at) t FROM monitor_sources WHERE external_id=?',
      externalId,
    )!.t;
    assert.equal(first, hourStart);
    tick = new Date('2026-09-07T16:00:00.000Z');
    strong = true;
    await drainHourly(runner);
    const row = store.one('SELECT id,first_seen_at FROM apps WHERE external_id=?', externalId)!;
    assert.equal(row.first_seen_at, first);
    assert.equal(store.getApp(row.id)!.lastFetchedAt, tick.toISOString());
    assert.equal(
      getMarketActivity(store, { date: '2026-09-07', type: 'firstSeen' }).counts.firstSeen,
      1,
    );
    assert.equal(
      getMarketActivity(store, { date: '2026-09-08', type: 'firstSeen' }).counts.firstSeen,
      0,
    );
  } finally {
    store.close();
  }
});

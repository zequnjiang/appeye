import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryRunner, discoveryIdentity } from '../server/extended-discovery.js';
import { hourlyStore, hourlyProviders, hourlyData, hourStart, drainHourly } from './hourly-fixtures.js';
import type { Store } from '../server/db.js';
import type { NormalizedApp } from '../server/types.js';
import { createHourlyRunner } from '../server/hourly-monitor.js';

const sixHours = 6 * 3600000;
type Runner = ReturnType<typeof createDiscoveryRunner>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function seedParent(store: Store) {
  const id = 'alex.parent';
  const app = store.createApp({ country: 'th', store: 'google-play', externalId: id, data: { ...hourlyData(id), developerId: 'alex.developer' } });
  store.updateClassification(app.id, 'confirmed');
  return app;
}
function isolateGoogle(store: Store, runner: Runner) {
  runner.schedule();
  store.run("DELETE FROM discovery_tasks WHERE store='app-store'");
  store.run("DELETE FROM discovery_markets WHERE store='app-store'");
}
const page = (data: NormalizedApp[] = []) => ({ data, raw: data, source: 'https://example.invalid/alex-source', stopReason: 'sdk-iterator-ended' });

test('Alex ED-02/03: a one-request budget rotates source kinds and services old candidates across persisted cycles', async (t) => {
  const store = hourlyStore(); t.after(() => store.close()); seedParent(store);
  let now = new Date(hourStart), runner: Runner;
  const calls: string[] = [], details: string[] = [];
  const providers = hourlyProviders();
  providers['google-play'].extendedSearch = async ({ onItem }) => {
    runner.captureRequestBudget()(); calls.push('search');
    const rows = [hourlyData('alex.old.a'), hourlyData('alex.old.b')];
    rows.forEach(row => onItem?.(row, 'https://example.invalid/search'));
    return page(rows);
  };
  providers['google-play'].related = async () => { runner.captureRequestBudget()(); calls.push('similar'); return page([hourlyData('alex.related')]); };
  providers['google-play'].enrich = async () => {
    runner.captureRequestBudget()(); calls.push('developer');
    return { status: 'available', data: [{ appId: 'alex.catalog', title: 'Loan catalog' }], raw: { unknown: true }, source: 'https://example.invalid/developer', requestCountry: 'th', requestLanguage: 'en' };
  };
  providers['google-play'].app = async ({ externalId }) => { runner.captureRequestBudget()(); details.push(externalId); return hourlyData(externalId); };
  for (let cycle = 0; cycle < 3; cycle++) {
    runner = createDiscoveryRunner({ store, providers, now: () => now, sourceRequests: 1, detailRequests: 1 });
    if (cycle) runner.recover();
    isolateGoogle(store, runner); await drainHourly(runner);
    assert.equal(runner.status().lastCycle!.status, 'limited');
    now = new Date(now.getTime() + sixHours);
  }
  assert.deepEqual(calls, ['search', 'similar', 'developer']);
  assert.deepEqual(details, ['alex.old.a', 'alex.old.b', 'alex.related']);
  assert.equal(store.one("SELECT COUNT(*) n FROM discovery_candidates WHERE external_id='alex.old.b'")!.n, 1);
  assert.equal(store.one("SELECT status FROM discovery_candidates WHERE external_id='alex.catalog'")!.status, 'pending');
});

test('Alex ED-02/05: pausing a market retains an already-started response and resumes its candidate next cycle', async (t) => {
  const store = hourlyStore(); t.after(() => store.close());
  const entered = deferred<void>(), release = deferred<void>();
  let now = new Date(hourStart), runner: Runner, detailCalls = 0;
  const providers = hourlyProviders();
  providers['google-play'].extendedSearch = async () => {
    runner.captureRequestBudget()(); entered.resolve(); await release.promise;
    return page([hourlyData('alex.pause')]);
  };
  providers['google-play'].app = async ({ externalId }) => { runner.captureRequestBudget()(); detailCalls++; return hourlyData(externalId); };
  runner = createDiscoveryRunner({ store, providers, now: () => now, sourceRequests: 1, detailRequests: 1 });
  isolateGoogle(store, runner);
  const active = runner.runOnce(); await entered.promise;
  store.upsertCountry({ ...store.getCountry('th')!, enabled: false });
  release.resolve(); await active; await drainHourly(runner);
  assert.equal(detailCalls, 0);
  assert.equal(store.one("SELECT COUNT(*) n FROM discovery_sources WHERE external_id='alex.pause'")!.n, 1);
  assert.equal(store.one("SELECT status FROM discovery_candidates WHERE external_id='alex.pause'")!.status, 'pending');
  assert.ok(store.one("SELECT 1 FROM discovery_tasks WHERE stop_reason='country-paused' AND status='deferred'"));
  assert.equal(store.one("SELECT COUNT(*) n FROM discovery_tasks WHERE kind='detail'")!.n, 0, 'paused market must not create new detail tasks; the pending candidate is the resume frontier');
  store.upsertCountry({ ...store.getCountry('th')!, enabled: true });
  now = new Date(now.getTime() + sixHours);
  runner = createDiscoveryRunner({ store, providers, now: () => now, sourceRequests: 1, detailRequests: 1 });
  runner.recover(); isolateGoogle(store, runner); await drainHourly(runner);
  assert.equal(detailCalls, 1);
  assert.equal(discoveryIdentity(store, { country: 'th', store: 'google-play', externalId: 'alex.pause' }).status, 'admitted');
});

test('Alex ED-05/06: replaying a durable old detail preserves the newer manual current and applies its snapshot only once', async (t) => {
  const store = hourlyStore(); t.after(() => store.close());
  let runner: Runner, networkDetails = 0;
  const providers = hourlyProviders();
  providers['google-play'].extendedSearch = async () => { runner.captureRequestBudget()(); return page([hourlyData('alex.replay')]); };
  providers['google-play'].app = async () => { networkDetails++; throw Error('A cached response must not fetch again'); };
  runner = createDiscoveryRunner({ store, providers, now: () => new Date(hourStart), sourceRequests: 1, detailRequests: 1 });
  isolateGoogle(store, runner); await runner.runOnce();
  const task = store.one("SELECT * FROM discovery_tasks WHERE kind='detail'")!;
  const app = store.createApp({ country: 'th', store: 'google-play', externalId: 'alex.replay', observedAt: '2026-01-01T00:00:00.000Z' });
  store.saveObservation(app.id, { ...hourlyData('alex.replay'), version: '3.0', raw: { latest: true } }, '2026-09-07T00:00:00.000Z');
  store.updateClassification(app.id, 'excluded');
  const before = store.getApp(app.id)!;
  const attempt = Number(store.run("INSERT INTO discovery_attempts(task_id,started_at,status) VALUES(?,?,'running')", task.id, hourStart).lastInsertRowid);
  const response = Number(store.run('INSERT INTO discovery_responses(task_id,attempt_id,observed_at,data) VALUES(?,?,?,?)', task.id, attempt, hourStart,
    JSON.stringify({ detail: true, data: { ...hourlyData('alex.replay'), version: '1.0', raw: { old: true } } })).lastInsertRowid);
  store.run("UPDATE discovery_tasks SET status='running',response_id=?,attempts=1 WHERE id=?", response, task.id);
  runner.recover(); await drainHourly(runner);
  const first = store.getApp(app.id)!;
  assert.equal(first.version, '3.0'); assert.equal(first.classification, 'excluded');
  assert.equal(first.firstSeenAt, before.firstSeenAt);
  assert.equal(store.listSnapshots(app.id).total, 2);
  assert.equal(store.one('SELECT applied_response_id FROM discovery_tasks WHERE id=?', task.id)!.applied_response_id, response);
  store.run("UPDATE discovery_cycles SET status='running' WHERE id=?", task.cycle_id);
  store.run("UPDATE discovery_tasks SET status='running' WHERE id=?", task.id);
  runner.recover(); await drainHourly(runner);
  assert.equal(networkDetails, 0);
  assert.equal(store.listSnapshots(app.id).total, 2);
  assert.equal(store.listDiscoveries(app.id).total, 1);
});

test('Alex ED-03/05: a timed-out source cannot spend or emit rows into the next task; its late HTTP retains its original task', async (t) => {
  const store = hourlyStore(); t.after(() => store.close()); seedParent(store);
  let runner: Runner;
  const oldStarted = deferred<void>(), oldRelease = deferred<ReturnType<typeof page>>();
  const nextStarted = deferred<void>(), nextRelease = deferred<ReturnType<typeof page>>();
  let oldBudget!: () => void, oldRecord!: ReturnType<Runner['captureHttpRecorder']>, lateItem!: () => void;
  const providers = hourlyProviders();
  providers['google-play'].extendedSearch = async ({ onItem }) => {
    oldBudget = runner.captureRequestBudget(); oldRecord = runner.captureHttpRecorder(); oldBudget();
    lateItem = () => onItem?.(hourlyData('alex.late.must.not.admit'), 'https://example.invalid/late');
    oldStarted.resolve(); return oldRelease.promise;
  };
  providers['google-play'].related = async () => { runner.captureRequestBudget()(); nextStarted.resolve(); return nextRelease.promise; };
  runner = createDiscoveryRunner({ store, providers, now: () => new Date(hourStart), timeoutMs: 40, sourceRequests: 5, detailRequests: 1 });
  isolateGoogle(store, runner);
  const timed = runner.runOnce(); await oldStarted.promise; await timed;
  const oldTask = store.one("SELECT * FROM discovery_tasks WHERE stop_reason='step-timeout-or-interrupted'")!;
  assert.ok(oldTask);
  const next = runner.runOnce(); await nextStarted.promise;
  const current = store.one("SELECT id FROM discovery_tasks WHERE status='running'")!;
  assert.notEqual(current.id, oldTask.id);
  assert.throws(oldBudget, (e: unknown) => e instanceof Error && e.name === 'AbortError');
  assert.throws(lateItem, (e: unknown) => e instanceof Error && e.name === 'AbortError');
  oldRecord({ fetchedAt: hourStart, url: 'https://example.invalid/late-http', method: 'GET', status: 200, contentType: 'text/plain', body: 'original task response', error: null });
  oldRelease.resolve(page()); nextRelease.resolve(page()); await next;
  assert.equal(store.one('SELECT task_id FROM discovery_http')!.task_id, oldTask.id);
  assert.equal(store.one('SELECT COUNT(*) n FROM discovery_sources')!.n, 0);
  assert.equal(store.one('SELECT source_requests FROM discovery_markets')!.source_requests, 2);
});

test('Alex ED-07: a known-ID placeholder with a terminal failed collection diagnoses failure, not queued work', (t) => {
  const store = hourlyStore(); t.after(() => store.close());
  const app = store.createApp({ country: 'th', store: 'google-play', externalId: 'alex.known.failed' });
  const job = store.enqueueJob({ type: 'refresh', appId: app.id, country: 'th', store: 'google-play' });
  store.run("UPDATE jobs SET status='failed',error='Store request failed after finite attempts',attempts=3 WHERE id=?", job.id);
  const identity = discoveryIdentity(store, { country: 'th', store: 'google-play', externalId: app.externalId });
  assert.equal(identity.status, 'failed');
  assert.equal(identity.lastFetchedAt, null);
  assert.equal(identity.tasks.find(task => task.channel === 'manual')!.status, 'failed');
  assert.equal(discoveryIdentity(store, { country: 'ar', store: 'google-play', externalId: app.externalId }).status, 'not-discovered');
});

test('Alex ED-03: continuous new discoveries cannot starve an older failed candidate before its finite third attempt', async (t) => {
  const store = hourlyStore(); t.after(() => store.close());
  let now = new Date(hourStart), runner: Runner, cycle = 0;
  const attempted: string[] = [], providers = hourlyProviders();
  providers['google-play'].extendedSearch = async () => {
    runner.captureRequestBudget()();
    return page([hourlyData(cycle === 0 ? 'alex.old.retry' : `alex.new.${cycle}`)]);
  };
  providers['google-play'].app = async ({ externalId }) => {
    runner.captureRequestBudget()(); attempted.push(externalId);
    if (externalId === 'alex.old.retry') throw new Error('Synthetic finite detail failure');
    return hourlyData(externalId);
  };
  for (; cycle < 4; cycle++) {
    runner = createDiscoveryRunner({ store, providers, now: () => now, sourceRequests: 1, detailRequests: 1 });
    runner.recover(); isolateGoogle(store, runner); await drainHourly(runner);
    now = new Date(now.getTime() + sixHours);
  }
  assert.deepEqual(attempted.slice(0, 3), ['alex.old.retry', 'alex.old.retry', 'alex.old.retry']);
  assert.equal(attempted[3], 'alex.new.1');
  const old = store.one("SELECT status,attempts FROM discovery_candidates WHERE external_id='alex.old.retry'")!;
  assert.equal(old.status, 'failed'); assert.equal(old.attempts, 3);
});

test('Alex ED-03: adding new confirmed titles every cycle cannot indefinitely displace a previously served keyword', async (t) => {
  const store = hourlyStore(); t.after(() => store.close());
  let now = new Date(hourStart), runner: Runner;
  const calls: string[] = [], providers = hourlyProviders();
  providers['google-play'].extendedSearch = async ({ keyword }) => { runner.captureRequestBudget()(); calls.push(keyword); return page(); };
  for (let cycle = 0; cycle < 12; cycle++) {
    const app = store.createApp({ country: 'th', store: 'google-play', externalId: `alex.title.${cycle}`, data: { ...hourlyData(`alex.title.${cycle}`), title: `New title ${cycle}` } });
    store.updateClassification(app.id, 'confirmed');
    runner = createDiscoveryRunner({ store, providers, now: () => now, sourceRequests: 1, detailRequests: 1 });
    runner.recover(); isolateGoogle(store, runner); await drainHourly(runner);
    now = new Date(now.getTime() + sixHours);
  }
  assert.equal(calls.length, 12);
  assert.ok(calls.slice(1).includes(calls[0]), 'the first keyword must be revisited despite a continuous supply of unserved new titles');
  assert.ok(new Set(calls).size > 1, 'rotation must also serve other sources');
});

test('Alex ED-07: a prior hourly-only staged identity exposes its legacy source/raw/time without pretending it was never discovered', async (t) => {
  const store = hourlyStore(); t.after(() => store.close());
  const tool = { ...hourlyData('alex.hourly.legacy.tool'), title: 'Alarm Timer', description: 'A clock with configurable alarms.', summary: 'Time management tools', genre: 'Tools', raw: { completeLegacyField: { retained: true } } };
  const providers = hourlyProviders();
  providers['google-play'].list = async () => page([tool]);
  providers['google-play'].app = async () => tool;
  const hourly = createHourlyRunner({ store, providers, now: () => new Date(hourStart) });
  await drainHourly(hourly);
  assert.equal(store.one('SELECT COUNT(*) n FROM discovery_sources')!.n, 0);
  const before = store.one('SELECT COUNT(*) n FROM monitor_tasks')!.n;
  const identity = discoveryIdentity(store, { country: 'th', store: 'google-play', externalId: tool.externalId });
  assert.equal(identity.status, 'staged');
  assert.ok(identity.sourceTotal > 0);
  assert.ok(identity.sources.some(source => source.observedAt === hourStart && source.raw.completeLegacyField.retained === true));
  assert.ok(identity.sources.every(source => String(source.id).startsWith('hourly:')));
  assert.equal(store.one('SELECT COUNT(*) n FROM monitor_tasks')!.n, before);
  assert.equal(discoveryIdentity(store, { country: 'mx', store: 'google-play', externalId: tool.externalId }).status, 'not-discovered');
});

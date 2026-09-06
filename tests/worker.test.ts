import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createWorker } from '../server/worker.js';
import { enrichmentKinds, type ProviderContext } from '../server/types.js';
import { creditApp, creditReview, fixtureProvider, fixtureProviders } from './fixtures.js';

test('AC-04/06/09/10: both injected stores propagate context and complete discovery → snapshot → reviews', async () => {
  const store = createStore();
  const calls: Array<ProviderContext & { operation: string; store: string }> = [];
  const makeProvider = (name: string) => fixtureProvider({
    search: async context => { calls.push({ ...context, operation: 'search', store: name }); return [{ ...creditApp }, { ...creditApp }]; },
    app: async context => { calls.push({ ...context, operation: 'app', store: name }); return { ...creditApp }; },
    reviews: async context => { calls.push({ ...context, operation: 'reviews', store: name }); return [{ ...creditReview }, { ...creditReview }]; },
  });
  const worker = createWorker({ store, providers: { 'google-play': makeProvider('google-play'), 'app-store': makeProvider('app-store') }, requestDelayMs: 0, schedule: false });
  try {
    store.upsertCountry({ ...store.getCountry('mx')!, keywords: ['préstamos'] });
    store.enqueueJob({ type: 'discover', country: 'mx', store: 'google-play' });
    store.enqueueJob({ type: 'discover', country: 'mx', store: 'app-store' });
    let executed = 0;
    while (await worker.runOnce()) { executed++; assert.ok(executed <= 10, 'bounded queue must drain'); }
    assert.equal(executed, 8);
    assert.equal(store.listApps().total, 2);
    assert.equal(store.listJobs({ status: 'succeeded' }).total, 8);
    assert.ok(calls.every(call => call.country === 'mx' && call.language === 'es'));
    for (const app of store.listApps().apps) {
      assert.equal(app.classification, 'candidate');
      assert.equal(store.listSnapshots(app.id).total, 1);
      assert.equal(store.listReviews(app.id).total, 1);
      assert.equal(app.updateCount, 0);
      assert.equal(store.listEnrichments(app.id).length, enrichmentKinds.length);
      assert.ok(store.listEnrichments(app.id).every(item => item.status === 'unsupported' && item.data === null));
      assert.equal(store.listDiscoveries(app.id).total, 2, 'both duplicate search rows remain as provenance while app jobs deduplicate');
    }
    assert.equal(store.listApps({ store: 'app-store' }).apps[0].installs, null);
  } finally { worker.stop(); store.close(); }
});

test('AC-04/05: rediscovery neither duplicates apps nor overwrites manual classification', async () => {
  const store = createStore();
  const worker = createWorker({ store, providers: fixtureProviders(), requestDelayMs: 0, schedule: false });
  try {
    store.upsertCountry({ ...store.getCountry('th')!, keywords: ['loan', 'credit'] });
    const app = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'th' });
    store.updateClassification(app.id, 'excluded');
    store.enqueueJob({ type: 'discover', country: 'th', store: 'google-play' });
    assert.equal(await worker.runOnce(), true);
    assert.equal(store.listApps().total, 1);
    assert.equal(store.getApp(app.id)?.classification, 'excluded');
    assert.equal(store.listJobs({ type: 'refresh' }).total, 0);
  } finally { worker.stop(); store.close(); }
});

test('AC-07/10/13: finite retries record actual error and preserve the last successful data without demo fallback', async () => {
  const store = createStore();
  let attempts = 0;
  const worker = createWorker({ store, providers: fixtureProviders({ 'google-play': fixtureProvider({ app: async () => { attempts++; throw new Error('fixture upstream unavailable'); } }) }), requestDelayMs: 0, retryDelayMs: 0, schedule: false });
  try {
    const app = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'ph' });
    store.saveObservation(app.id, creditApp);
    const before = store.getApp(app.id)!;
    const job = store.enqueueJob({ type: 'refresh', country: 'ph', store: 'google-play', appId: app.id, maxAttempts: 2 });
    await worker.runOnce();
    assert.equal(store.getJob(job.id)?.status, 'queued');
    assert.equal(store.getJob(job.id)?.attempts, 1);
    await worker.runOnce();
    assert.equal(store.getJob(job.id)?.status, 'failed');
    assert.equal(store.getJob(job.id)?.attempts, 2);
    assert.match(store.getJob(job.id)?.error ?? '', /fixture upstream unavailable/);
    assert.equal(await worker.runOnce(), false);
    assert.equal(attempts, 2);
    assert.equal(store.getApp(app.id)?.lastFetchedAt, before.lastFetchedAt);
    assert.equal(store.getApp(app.id)?.version, before.version);
    assert.equal(store.listSnapshots(app.id).total, 1);
    assert.equal(store.listApps().total, 1);
    assert.equal(store.listJobs({ type: 'reviews' }).total, 0);
  } finally { worker.stop(); store.close(); }
});

test('AC-10: timeout aborts provider signal and allows an unrelated queued task to finish', async () => {
  const store = createStore();
  let signal: AbortSignal | undefined;
  const worker = createWorker({
    store,
    providers: fixtureProviders({ 'google-play': fixtureProvider({ app: async context => { signal = context.signal; return new Promise(() => {}); } }) }),
    requestDelayMs: 0, timeoutMs: 20, retryDelayMs: 0, schedule: false,
  });
  try {
    const stuck = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'pk' });
    const healthy = store.createApp({ store: 'app-store', externalId: '123456', country: 'ar' });
    const failedJob = store.enqueueJob({ type: 'refresh', country: 'pk', store: 'google-play', appId: stuck.id, maxAttempts: 1 });
    const healthyJob = store.enqueueJob({ type: 'refresh', country: 'ar', store: 'app-store', appId: healthy.id });
    const start = Date.now();
    await worker.runOnce();
    assert.ok(Date.now() - start < 1000);
    assert.equal(signal?.aborted, true);
    assert.equal(store.getJob(failedJob.id)?.status, 'failed');
    assert.match(store.getJob(failedJob.id)?.error ?? '', /超时/);
    await worker.runOnce();
    assert.equal(store.getJob(healthyJob.id)?.status, 'succeeded');
    assert.equal(store.listSnapshots(healthy.id).total, 1);
  } finally { worker.stop(); store.close(); }
});

test('AC-10: a failed keyword does not prevent later keyword discoveries and partial failure remains visible', async () => {
  const store = createStore();
  const keywords: string[] = [];
  const worker = createWorker({ store, requestDelayMs: 0, schedule: false, providers: fixtureProviders({ 'google-play': fixtureProvider({ search: async context => {
    keywords.push(context.keyword);
    if (context.keyword === 'bad') throw new Error('fixture keyword failure');
    return [creditApp];
  } }) }) });
  try {
    store.upsertCountry({ ...store.getCountry('id')!, keywords: ['bad', 'pinjaman'] });
    const job = store.enqueueJob({ type: 'discover', country: 'id', store: 'google-play', maxAttempts: 1 });
    await worker.runOnce();
    assert.deepEqual(keywords, ['bad', 'pinjaman']);
    assert.equal(store.listApps().total, 1);
    assert.equal(store.listJobs({ type: 'refresh' }).total, 1);
    assert.equal(store.getJob(job.id)?.status, 'failed');
    assert.match(store.getJob(job.id)?.error ?? '', /1 个关键词失败/);
  } finally { worker.stop(); store.close(); }
});

test('AC-10: request spacing is bounded and simultaneous runOnce calls cannot claim overlapping work', async () => {
  const store = createStore();
  const times: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const worker = createWorker({ store, requestDelayMs: 30, schedule: false, providers: fixtureProviders({ 'google-play': fixtureProvider({ search: async () => {
    times.push(Date.now());
    if (first) { first = false; await gate; }
    return [];
  } }) }) });
  try {
    store.upsertCountry({ ...store.getCountry('th')!, keywords: ['loan', 'credit'] });
    store.enqueueJob({ type: 'discover', country: 'th', store: 'google-play' });
    const running = worker.runOnce();
    assert.equal(await worker.runOnce(), false);
    release();
    assert.equal(await running, true);
    assert.equal(times.length, 2);
    assert.ok(times[1] - times[0] >= 20, `requests were spaced by ${times[1] - times[0]} ms`);
    assert.equal(store.listJobs({ status: 'running' }).total, 0);
  } finally { release(); worker.stop(); store.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createApp } from '../server/app.js';
import {
  createDiscoveryRunner,
  discoveryIdentity,
  getDiscoveryStatus,
} from '../server/extended-discovery.js';
import {
  createFairDispatcher,
  createCollectionCoordinator,
} from '../server/collection-coordinator.js';
import {
  hourlyData,
  hourlyProviders,
  hourlyStore,
  hourStart,
  drainHourly,
} from './hourly-fixtures.js';
import { serve } from './http-helper.js';
import type { StoreName } from '../server/types.js';

test('ED-02: extended lane receives exactly one slot per eleven while all original lanes progress', async () => {
  const calls: string[] = [];
  const lane = (name: string) => ({
    runOnce: async () => {
      calls.push(name);
      return true;
    },
  });
  const d = createFairDispatcher({
    hourly: lane('h'),
    batch: lane('b'),
    manual: lane('m'),
    discovery: lane('d'),
  });
  for (let i = 0; i < 33; i++) await d.runOnce();
  assert.equal(calls.join(''), 'hhhbmhhhbmd'.repeat(3));
});

test('ED-02/03: six markets and both stores have independent budgets, durable candidates and coalesced six-hour cycles', async () => {
  const store = createStore();
  let time = new Date(hourStart),
    requests = 0;
  const providers = hourlyProviders();
  let runner: ReturnType<typeof createDiscoveryRunner>;
  for (const name of ['google-play', 'app-store'] as const) {
    providers[name].extendedSearch = async ({ country, keyword, onItem }) => {
      runner.captureRequestBudget()();
      requests++;
      const rows = [1, 2, 3].map((n) =>
        hourlyData(name === 'app-store' ? String(100000 + n) : `fixture.${country}.loan${n}`),
      );
      for (const row of rows) onItem?.(row, `https://example.invalid/${country}/${keyword}`);
      return {
        data: rows,
        raw: rows,
        source: 'https://example.invalid/search',
        stopReason: 'sdk-iterator-ended',
      };
    };
    providers[name].app = async ({ externalId }) => {
      runner.captureRequestBudget()();
      requests++;
      return hourlyData(externalId);
    };
  }
  runner = createDiscoveryRunner({
    store,
    providers,
    now: () => time,
    sourceRequests: 2,
    detailRequests: 1,
  });
  await drainHourly(runner, 400);
  assert.equal(store.one('SELECT COUNT(*) n FROM discovery_markets')!.n, 12);
  assert.equal(requests, 36);
  assert.equal(store.listApps().total, 12);
  assert.equal(getDiscoveryStatus(store).lastCycle?.status, 'limited');
  assert.equal(
    store.one("SELECT COUNT(*) n FROM discovery_candidates WHERE status='pending'")!.n,
    24,
  );
  for (const m of store.all('SELECT * FROM discovery_markets')) {
    assert.equal(m.source_requests, 2);
    assert.equal(m.detail_requests, 1);
  }
  const firstTasks = store.all('SELECT id FROM discovery_tasks');
  runner.recover();
  runner.schedule();
  assert.equal(store.all('SELECT id FROM discovery_tasks').length, firstTasks.length);
  time = new Date(time.getTime() + 18 * 3600000);
  await drainHourly(runner, 400);
  assert.equal(store.one('SELECT COUNT(*) n FROM discovery_cycles')!.n, 2);
  assert.equal(
    store.listApps().total,
    24,
    'old pending identities must receive their detail slot next cycle',
  );
  assert.equal(
    store.one('SELECT next_due_at FROM discovery_state')!.next_due_at,
    new Date(time.getTime() + 6 * 3600000).toISOString(),
  );
  store.close();
});

test('ED-04/05: old partial developer catalog discovers otherwise absent app with original date and complete source', async () => {
  const store = hourlyStore();
  const parent = store.createApp({
    country: 'th',
    store: 'google-play',
    externalId: 'fixture.parent',
    data: hourlyData('fixture.parent'),
  });
  store.updateClassification(parent.id, 'confirmed');
  const old = '2026-08-01T00:00:00.000Z';
  store.saveEnrichment(
    parent.id,
    'developer',
    {
      status: 'available',
      source: 'https://example.invalid/developer',
      requestCountry: 'th',
      requestLanguage: 'en',
      data: [
        { appId: 'fixture.hidden.loan', title: 'Hidden lender', futureField: { retained: true } },
      ],
      raw: { warnings: ['partial directory'], original: true },
    },
    old,
  );
  const runner = createDiscoveryRunner({
    store,
    providers: hourlyProviders(),
    now: () => new Date(hourStart),
  });
  await drainHourly(runner);
  const hidden = store.one("SELECT * FROM apps WHERE external_id='fixture.hidden.loan'")!;
  assert.equal(hidden.first_seen_at, old);
  assert.equal(hidden.classification, 'confirmed');
  const source = store.one(
    "SELECT * FROM discovery_sources WHERE external_id='fixture.hidden.loan'",
  )!;
  assert.equal(source.observed_at, old);
  assert.equal(source.processed_at, hourStart);
  assert.equal(source.request_language, 'en');
  assert.equal(source.parent_app_id, parent.id);
  assert.ok(source.enrichment_history_id);
  assert.equal(JSON.parse(source.raw).futureField.retained, true);
  assert.equal(
    store.one("SELECT stop_reason FROM discovery_tasks WHERE kind='catalog'")!.stop_reason,
    'saved-catalog-partial',
  );
  assert.equal(
    store.one("SELECT COUNT(*) n FROM discovery_frontier WHERE kind='similar'")!.n,
    1,
    'newly admitted app cannot recursively expand this cycle',
  );
  assert.equal(store.listDiscoveries(hidden.id).total, 1);
  store.close();
});

test('ED-04/05: interrupted search persists streamed rows, deferred state and survives recovery', async () => {
  const store = hourlyStore();
  const providers = hourlyProviders();
  providers['google-play'].extendedSearch = async ({ onItem }) => {
    onItem?.(hourlyData('fixture.partial.loan'), 'https://example.invalid/partial');
    return new Promise(() => {});
  };
  const runner = createDiscoveryRunner({
    store,
    providers,
    now: () => new Date(hourStart),
    timeoutMs: 5,
  });
  assert.equal(await runner.runOnce(), true); // Apple unsupported source, then GP in market rotation.
  for (
    let i = 0;
    i < 3 && !store.one("SELECT 1 FROM discovery_sources WHERE external_id='fixture.partial.loan'");
    i++
  )
    await runner.runOnce();
  assert.ok(store.one("SELECT 1 FROM discovery_sources WHERE external_id='fixture.partial.loan'"));
  assert.ok(
    store.one(
      "SELECT 1 FROM discovery_tasks WHERE status='deferred' AND stop_reason='step-timeout-or-interrupted'",
    ),
  );
  runner.recover();
  await drainHourly(runner);
  assert.equal(
    store.one("SELECT COUNT(*) n FROM apps WHERE external_id='fixture.partial.loan'")!.n,
    1,
  );
  assert.equal(getDiscoveryStatus(store).lastCycle?.status, 'limited');
  store.close();
});

test('ED-06: insufficient details stay staged, manual classification and country identity remain independent', async () => {
  const store = hourlyStore(),
    providers = hourlyProviders();
  providers['google-play'].extendedSearch = async ({ onItem }) => {
    const row = hourlyData('fixture.tool');
    onItem?.(row, 'https://example.invalid/tool');
    return { data: [row], raw: [row], source: 'https://example.invalid/tool' };
  };
  providers['google-play'].app = async () => ({
    externalId: 'fixture.tool',
    title: 'Weather calculator',
    description: 'No lending services; local weather tool.',
  });
  const other = store.createApp({
    country: 'ar',
    store: 'google-play',
    externalId: 'fixture.tool',
  });
  store.updateClassification(other.id, 'excluded');
  const runner = createDiscoveryRunner({ store, providers, now: () => new Date(hourStart) });
  await drainHourly(runner);
  assert.equal(store.one("SELECT COUNT(*) n FROM apps WHERE country='th'")!.n, 0);
  assert.equal(
    discoveryIdentity(store, { country: 'th', store: 'google-play', externalId: 'fixture.tool' })
      .status,
    'staged',
  );
  assert.equal(store.getApp(other.id)!.classification, 'excluded');
  store.close();
});

test('ED-01/07: diagnostic GET is authenticated and read-only; known-id import records explicit source without claiming success', async () => {
  const store = hourlyStore();
  const server = await serve(createApp({ store, password: 'independent-test-password' }));
  try {
    assert.equal((await server.request('/api/discovery/status')).status, 401);
    await server.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'independent-test-password' }),
    });
    const path =
      '/api/discovery/identity?country=ar&store=google-play&externalId=com.creditouno.loan';
    const before = store.one('SELECT COUNT(*) n FROM jobs')!.n;
    assert.equal((await (await server.request(path)).json()).status, 'not-discovered');
    assert.equal(store.one('SELECT COUNT(*) n FROM jobs')!.n, before);
    const imported = await (
      await server.request('/api/apps', {
        method: 'POST',
        body: JSON.stringify({
          country: 'ar',
          store: 'google-play',
          externalId: 'com.creditouno.loan',
        }),
      })
    ).json();
    const pending = await (await server.request(path)).json();
    assert.equal(pending.status, 'pending');
    assert.equal(pending.lastFetchedAt, null);
    assert.equal(pending.sources[0].kind, 'known-id');
    assert.equal(pending.appId, imported.app.id);
    await server.request('/api/apps', {
      method: 'POST',
      body: JSON.stringify({
        country: 'ar',
        store: 'google-play',
        externalId: 'com.creditouno.loan',
      }),
    });
    assert.equal(store.listApps().total, 1);
    assert.equal((await (await server.request(path)).json()).sourceTotal, 1);
  } finally {
    await server.close();
    store.close();
  }
});

test('ED-03: real paced transport budgets every hidden SDK request before network starts', async () => {
  const store = hourlyStore();
  let network = 0;
  const client = {
    app: async () => ({ appId: 'fixture.source', title: 'Loan' }),
    search: async () => [],
    reviews: async () => [],
    list: async () => [],
    async *searchIterator(options: any) {
      for (let n = 0; n < 5; n++) {
        try {
          await options.requestOptions.fetchImpl('https://example.invalid/source', {
            signal: options.requestOptions.signal,
          });
        } catch {
          return;
        } // Some SDK helpers swallow internal failures; the wrapper must restore them.
        yield { appId: `fixture.page${n}`, title: 'Loan', description: 'Loan service' };
      }
    },
  };
  const coordinator = createCollectionCoordinator({
    store,
    now: () => new Date(hourStart),
    discoveryOptions: { sourceRequests: 2, detailRequests: 1 },
    providerOptions: {
      googlePlayClient: client,
      appStoreClient: client,
      requestDelayMs: 0,
      fetchImpl: async () => {
        network++;
        return new Response('source body');
      },
    },
  });
  // Run the actual coordinator-owned discovery slot, with the original lanes temporarily empty.
  coordinator.hourly.stop();
  coordinator.worker.stop();
  for (
    let i = 0;
    i < 4 &&
    !store.one(
      "SELECT 1 FROM discovery_tasks WHERE country='th' AND store='google-play' AND stop_reason='http-budget'",
    );
    i++
  )
    await coordinator.runOnce();
  const m = store.one(
    "SELECT * FROM discovery_markets WHERE country='th' AND store='google-play'",
  )!;
  assert.equal(m.source_requests, 2);
  assert.equal(network, 2);
  assert.equal(store.one('SELECT COUNT(*) n FROM discovery_http')!.n, 2);
  assert.equal(
    store.one("SELECT COUNT(*) n FROM discovery_sources WHERE store='google-play'")!.n,
    2,
  );
  assert.ok(
    store.one(
      "SELECT 1 FROM discovery_tasks WHERE stop_reason='http-budget' AND status='deferred'",
    ),
  );
  coordinator.stop();
  store.close();
});

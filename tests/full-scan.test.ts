import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import {
  createFullScanProviders,
  financeCollections,
  type ScanTransportRecord,
  type ScanProvider,
  type FullScanProviders,
} from '../server/full-scan-providers.js';
import { createFullScanRunner, type FullScanConfig } from '../server/full-scan.js';
import { createStore } from '../server/db.js';
import { enrichmentKinds } from '../server/types.js';
import { facilitatorFixture } from './loan-fixtures.js';
import { permissionsResult } from './enrichment-fixtures.js';

function scanProvider(overrides: Partial<ScanProvider> = {}): ScanProvider {
  return {
    list: async () => ({
      data: [],
      raw: [],
      source: 'https://example.invalid/finance',
      stopReason: 'chart-interface-no-pagination',
    }),
    search: async () => ({
      data: [],
      raw: [],
      source: 'https://example.invalid/search',
      stopReason: 'search-empty-page',
    }),
    app: async (input) => ({
      ...facilitatorFixture,
      externalId: input.externalId,
      title: 'Synthetic Scan Loan',
      developerId: 'fixture-publisher',
      raw: { completeUnknown: { preserved: true } },
    }),
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
      raw: { data: [], futureField: 'kept' },
      source: 'https://example.invalid/reviews',
      nextCursor: null,
    }),
    ...overrides,
  };
}
function scanProviders(overrides: Partial<FullScanProviders> = {}): FullScanProviders {
  return { 'google-play': scanProvider(), 'app-store': scanProvider(), ...overrides };
}
const quietConfig: FullScanConfig = {
  countries: ['th'],
  stores: ['google-play'],
  collections: { 'google-play': [], 'app-store': [] },
  includeSearch: false,
  includeExisting: true,
  retryDelayMs: 0,
  timeoutMs: 100,
  maxAttempts: 2,
};
async function drain(runner: ReturnType<typeof createFullScanRunner>, bound = 1500) {
  let count = 0;
  while (await runner.runOnce())
    assert.ok(++count <= bound, 'batch must finish within fixture bounds');
  return count;
}

function sourceClient(overrides: Record<string, (options: any) => Promise<any>> = {}) {
  return {
    app: async () => ({ appId: 'fixture.scan', id: 123456, title: 'Synthetic scan app' }),
    list: async () => [],
    search: async () => [],
    reviews: async () => [],
    ...overrides,
  };
}

test('FS-AC-01/08: Finance sources retain country, collection, full raw rows and explicit source limits', async () => {
  const calls: Array<{ store: string; method: string; input: any }> = [];
  const raw = {
    appId: 'fixture.scan',
    id: 123456,
    title: 'Synthetic Finance app',
    unprojectedField: { zero: 0, flag: false },
  };
  const fake = (store: string) =>
    sourceClient(
      Object.fromEntries(
        ['list', 'search'].map((method) => [
          method,
          async (input: any) => {
            calls.push({ store, method, input });
            return [raw];
          },
        ]),
      ),
    );
  const providers = createFullScanProviders({
    googlePlayClient: fake('google-play'),
    appStoreClient: fake('app-store'),
    requestDelayMs: 0,
  });
  for (const country of ['th', 'mx', 'ph', 'pk', 'id', 'ar'])
    for (const store of ['google-play', 'app-store'] as const) {
      const list = await providers[store].list({
        country,
        language: 'en',
        collection: financeCollections[store][0],
      });
      assert.deepEqual(list.raw, [raw]);
      assert.deepEqual(list.data[0].raw, raw);
      assert.equal(list.stopReason, 'chart-interface-no-pagination');
      assert.ok(list.source.includes(country));
    }
  assert.equal(calls.length, 12);
  for (const { store, input } of calls) {
    assert.equal(input.category, store === 'google-play' ? 'FINANCE' : 6015);
    assert.equal(input.num, store === 'google-play' ? 500 : 200);
    assert.equal(input.fullDetail, false);
  }
  const gpSearch = await providers['google-play'].search({
    country: 'th',
    language: 'th',
    keyword: 'สินเชื่อ',
    page: 1,
  });
  assert.equal(gpSearch.stopReason, 'sdk-search-ended');
  const appleSearch = await providers['app-store'].search({
    country: 'mx',
    language: 'es',
    keyword: 'préstamo',
    page: 3,
  });
  assert.equal(new URL(appleSearch.source).searchParams.get('limit'), '150');
  assert.equal(
    appleSearch.stopReason,
    undefined,
    'Apple sources still require further page/end checks',
  );
});

test('FS-AC-05/06/08: reviews adapter exposes Google continuation and Apple page identity without conflating review language', async () => {
  const calls: any[] = [];
  const review = {
    id: 'stable-scan-review',
    text: 'Synthetic text',
    score: 4,
    unknownReview: { preserved: true },
  };
  const providers = createFullScanProviders({
    googlePlayClient: sourceClient({
      reviews: async (input) => {
        calls.push(input);
        return {
          data: [review],
          nextPaginationToken: 'next-fixture-token',
          unknownEnvelope: ['kept'],
        };
      },
    }),
    appStoreClient: sourceClient({
      reviews: async (input) => {
        calls.push(input);
        return [review];
      },
    }),
    requestDelayMs: 0,
  });
  const controller = new AbortController();
  const gp = await providers['google-play'].reviewsPage({
    externalId: 'fixture.scan',
    country: 'ph',
    language: 'en',
    page: 2,
    cursor: 'current-fixture-token',
    signal: controller.signal,
  });
  assert.equal(calls[0].paginate, true);
  assert.equal(calls[0].nextPaginationToken, 'current-fixture-token');
  assert.equal(calls[0].requestOptions.signal, controller.signal);
  assert.equal(gp.nextCursor, 'next-fixture-token');
  assert.deepEqual((gp.raw as any).unknownEnvelope, ['kept']);
  assert.equal(gp.data[0].language, 'en');
  const apple = await providers['app-store'].reviewsPage({
    externalId: '123456',
    country: 'ph',
    language: 'en',
    page: 10,
    cursor: null,
  });
  assert.equal(calls[1].page, 10);
  assert.equal(calls[1].id, '123456');
  assert.equal(apple.data[0].language, 'und');
  assert.deepEqual(apple.raw, [review]);
  assert.match(apple.source, /page=10\/id=123456/);
});

test('FS-AC-08/09: underlying HTTP response/error and timestamp are captured even outside typed projection', async () => {
  const records: ScanTransportRecord[] = [];
  let fail = false;
  const providers = createFullScanProviders({
    googlePlayClient: sourceClient({
      list: async (input) => {
        await input.requestOptions.fetchImpl('https://example.invalid/finance', {
          signal: input.requestOptions.signal,
        });
        return [];
      },
    }),
    appStoreClient: sourceClient(),
    requestDelayMs: 0,
    fetchImpl: async () => {
      if (fail) throw new Error('Synthetic network failure');
      return new Response('{"unknownTransportField":[false,0]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    onResponse: (record) => records.push(record),
  });
  await providers['google-play'].list({ country: 'id', language: 'id', collection: 'TOP_FREE' });
  assert.equal(records[0].status, 200);
  assert.equal(records[0].body, '{"unknownTransportField":[false,0]}');
  assert.ok(Number.isFinite(Date.parse(records[0].fetchedAt)));
  fail = true;
  await assert.rejects(
    providers['google-play'].list({ country: 'id', language: 'id', collection: 'TOP_FREE' }),
    /Synthetic network failure/,
  );
  assert.equal(records[1].status, null);
  assert.equal(records[1].body, null);
  assert.equal(records[1].error, 'Synthetic network failure');
});

test('FS-AC-03/04/07: all 101 existing apps, including excluded and disabled/out-of-scan countries, receive new attempts without reclassification', async () => {
  const store = createStore();
  try {
    store.upsertCountry({
      code: 'vn',
      name: 'Vietnam fixture',
      language: 'vi',
      keywords: ['fixture'],
      enabled: false,
      intervalHours: 24,
    });
    const baseline = Array.from({ length: 101 }, (_, i) => {
      const app = store.createApp({
        store: i % 2 ? 'app-store' : 'google-play',
        country: i % 3 ? 'th' : 'vn',
        externalId: i % 2 ? String(900000 + i) : `fixture.scan.${i}`,
      });
      return store.updateClassification(
        app.id,
        (['candidate', 'confirmed', 'excluded'] as const)[i % 3],
      )!;
    });
    const runner = createFullScanRunner({ store, providers: scanProviders(), config: quietConfig });
    runner.seed();
    runner.seed();
    assert.equal(store.one("SELECT COUNT(*) n FROM full_scan_tasks WHERE kind='detail'")!.n, 101);
    await drain(runner);
    assert.equal(runner.summary().pending, 0);
    assert.equal(runner.summary().failures, 0);
    for (const prior of baseline) {
      const app = store.getApp(prior.id)!;
      assert.equal(app.classification, prior.classification);
      assert.equal(app.classificationSource, 'manual');
      assert.equal(app.manualOverride, true);
      assert.equal(app.firstSeenAt, prior.firstSeenAt);
      assert.equal(store.listSnapshots(app.id).total, 1);
      const tasks = store.all('SELECT * FROM full_scan_tasks WHERE app_id=?', app.id);
      assert.equal(tasks.length, 9);
      assert.ok(
        tasks.every(
          (task) => task.status === 'succeeded' && task.attempts === 1 && task.response_at,
        ),
      );
      assert.equal(tasks.filter((task) => task.kind === 'enrich').length, enrichmentKinds.length);
      assert.equal(store.listEnrichments(app.id).length, enrichmentKinds.length);
    }
  } finally {
    store.close();
  }
});

test('FS-AC-01/02/08: scan stages weak Finance results and admits strong/possible identities while retaining all source payloads', async () => {
  const store = createStore();
  try {
    const raw = [
      { externalId: 'fixture.strong', title: 'Strong loan', raw: { unknownSearch: ['original'] } },
      {
        externalId: 'fixture.possible',
        title: 'Loan directory',
        raw: { unknownSearch: ['possible'] },
      },
      { externalId: 'fixture.wallet', title: 'Wallet expenses', raw: { unknownSearch: ['weak'] } },
    ];
    const gp = scanProvider({
      list: async () => ({
        data: raw,
        raw: { completeEnvelope: raw, newField: false },
        source: 'https://example.invalid/finance',
        stopReason: 'chart-interface-no-pagination',
      }),
      app: async ({ externalId }) => ({
        externalId,
        title: raw.find((row) => row.externalId === externalId)!.title,
        description:
          externalId === 'fixture.strong'
            ? facilitatorFixture.description
            : externalId === 'fixture.possible'
              ? 'Learn about loan offers.'
              : 'Track expenses and wallet spending.',
        raw: { unprojectedDetail: { externalId, all: true } },
      }),
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: { ...quietConfig, collections: { 'google-play': ['TOP_FREE', 'TOP_PAID'] } },
    });
    runner.seed();
    await drain(runner);
    assert.equal(store.listApps().total, 2);
    assert.equal(store.listApps({ classification: 'confirmed' }).total, 1);
    assert.equal(store.listApps({ classification: 'candidate' }).total, 1);
    const staging = store.all('SELECT * FROM full_scan_candidates');
    assert.equal(staging.length, 3);
    assert.equal(staging.find((row) => row.external_id === 'fixture.wallet')?.app_id, null);
    assert.equal(
      staging.find((row) => row.external_id === 'fixture.wallet')?.verdict,
      'insufficient',
    );
    assert.deepEqual(
      JSON.parse(staging.find((row) => row.external_id === 'fixture.wallet')!.detail).raw,
      { unprojectedDetail: { externalId: 'fixture.wallet', all: true } },
    );
    assert.equal(store.one('SELECT COUNT(*) n FROM full_scan_sources')!.n, 6);
    for (const app of store.listApps().apps) assert.equal(store.listDiscoveries(app.id).total, 2);
    const listing = store.one(
      "SELECT response,response_at FROM full_scan_tasks WHERE kind='list'",
    )!;
    assert.equal(JSON.parse(listing.response).raw.newField, false);
    assert.ok(listing.response_at);
  } finally {
    store.close();
  }
});

test('FS-AC-05/06/09: Google comments rotate across apps, preserve cross-page edits and finish only at empty/token termination', async () => {
  const store = createStore();
  const calls: Array<{ externalId: string; page: number; cursor: string | null }> = [];
  try {
    const apps = ['a', 'b', 'c'].map((suffix) =>
      store.createApp({
        store: 'google-play',
        country: 'th',
        externalId: `fixture.rotate.${suffix}`,
      }),
    );
    const gp = scanProvider({
      reviewsPage: async (input) => {
        calls.push(input);
        return {
          data:
            input.page === 1
              ? [{ externalId: 'one', text: 'First original', raw: { page: 1 } }]
              : input.page === 2
                ? [
                    { externalId: 'one', text: 'Edited review', raw: { page: 2 } },
                    { externalId: 'two', text: 'Second', raw: { nested: [false, 0] } },
                  ]
                : [],
          raw: { untouched: input.page },
          source: 'https://example.invalid/reviews',
          nextCursor: input.page < 3 ? `cursor-${input.page}` : null,
        };
      },
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: quietConfig,
    });
    runner.seed();
    await drain(runner);
    assert.deepEqual(
      calls.slice(0, 3).map((call) => call.externalId),
      apps.map((app) => app.externalId),
    );
    assert.ok(calls.slice(0, 3).every((call) => call.page === 1));
    assert.equal(calls.length, 9);
    for (const app of apps) {
      assert.equal(store.listReviews(app.id).total, 2);
      assert.equal(
        store.listReviews(app.id).reviews.find((row) => row.externalId === 'one')?.text,
        'Edited review',
      );
      assert.equal(
        store.one(
          "SELECT stop_reason FROM full_scan_tasks WHERE app_id=? AND kind='reviews' ORDER BY page DESC LIMIT 1",
          app.id,
        )!.stop_reason,
        'reviews-empty-page',
      );
    }
    assert.equal(runner.summary().reviewCount, 6);
    assert.deepEqual({ ...runner.summary().reviewWrites }, { added: 6, updated: 3 });
  } finally {
    store.close();
  }
});

test('FS-AC-05/09: failed second page preserves first page and resumes the exact cursor after runner recreation', async () => {
  const store = createStore();
  const calls: number[] = [];
  let fail = true;
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.resume',
    });
    const gp = scanProvider({
      reviewsPage: async (input) => {
        calls.push(input.page);
        if (input.page === 2 && fail) {
          assert.equal(input.cursor, 'cursor-after-one');
          throw new Error('Fixture page 2 unavailable');
        }
        return {
          data: [{ externalId: `review-${input.page}`, text: `Fixture ${input.page}` }],
          raw: { page: input.page },
          source: 'https://example.invalid/reviews',
          nextCursor: input.page === 1 ? 'cursor-after-one' : null,
        };
      },
    });
    const providers = scanProviders({ 'google-play': gp });
    const runner = createFullScanRunner({
      store,
      providers,
      batchId: 'fixture-resume-batch',
      config: { ...quietConfig, maxAttempts: 1 },
    });
    runner.seed();
    await drain(runner);
    assert.equal(store.listReviews(app.id).total, 1);
    assert.equal(runner.summary().failures, 1);
    fail = false;
    const resumed = createFullScanRunner({ store, providers, batchId: runner.batchId });
    resumed.recover();
    resumed.seed();
    resumed.retryFailed();
    await drain(resumed);
    assert.deepEqual(calls, [1, 2, 2]);
    assert.equal(store.listReviews(app.id).total, 2);
    assert.equal(resumed.summary().failures, 0);
    assert.equal(store.listSnapshots(app.id).total, 1);
  } finally {
    store.close();
  }
});

test('FS-AC-04/07: detail failure still attempts comments and every supplemental kind while preserving previous successful data', async () => {
  const store = createStore();
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.detail.failed',
    });
    store.saveEnrichment(app.id, 'permissions', permissionsResult, '2026-01-01T00:00:00.000Z');
    const gp = scanProvider({
      app: async () => {
        throw new Error('Fixture detail unavailable');
      },
      enrich: async (input) => {
        if (input.kind === 'permissions') throw new Error('Fixture permissions unavailable');
        return {
          status: 'unsupported',
          data: null,
          raw: null,
          source: 'https://example.invalid/' + input.kind,
          requestCountry: input.country,
          requestLanguage: input.language,
        };
      },
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: { ...quietConfig, maxAttempts: 1 },
    });
    runner.seed();
    await drain(runner);
    const tasks = store.all(
      'SELECT kind,attempts,status FROM full_scan_tasks WHERE app_id=?',
      app.id,
    );
    assert.equal(tasks.length, 9);
    assert.ok(tasks.every((row) => row.attempts === 1));
    assert.equal(runner.summary().failures, 2);
    const permissions = store.listEnrichments(app.id).find((row) => row.kind === 'permissions')!;
    assert.equal(permissions.status, 'failed');
    assert.deepEqual(permissions.raw, permissionsResult.raw);
    assert.equal(permissions.lastSuccessAt, '2026-01-01T00:00:00.000Z');
  } finally {
    store.close();
  }
});

test('FS-AC-05: Apple page 10 is an explicit upstream boundary and Google repeated tokens stop with a distinct reason', async () => {
  const store = createStore();
  try {
    const appleApp = store.createApp({ store: 'app-store', country: 'th', externalId: '123456' });
    const gpApp = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.cycle',
    });
    const repeated = (input: { page: number }) => ({
      data: [{ externalId: `page-${input.page}`, text: 'Synthetic review' }],
      raw: { page: input.page },
      source: 'https://example.invalid/reviews',
      nextCursor: 'fixed-token',
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({
        'google-play': scanProvider({ reviewsPage: async (input) => repeated(input) }),
        'app-store': scanProvider({ reviewsPage: async (input) => repeated(input) }),
      }),
      config: quietConfig,
    });
    runner.seed();
    await drain(runner);
    const appleTasks = store.all(
      "SELECT * FROM full_scan_tasks WHERE app_id=? AND kind='reviews'",
      appleApp.id,
    );
    const gpTasks = store.all(
      "SELECT * FROM full_scan_tasks WHERE app_id=? AND kind='reviews'",
      gpApp.id,
    );
    assert.equal(appleTasks.length, 10);
    assert.equal(appleTasks.at(-1)?.stop_reason, 'apple-review-page-10-limit');
    assert.equal(gpTasks.length, 2);
    assert.equal(gpTasks.at(-1)?.stop_reason, 'reviews-token-cycle');
    assert.ok(!gpTasks.some((row) => row.stop_reason === 'reviews-no-next-token'));
    assert.equal(runner.summary().status, 'needs-review');
  } finally {
    store.close();
  }
});

test('FS-AC-08/09: interrupted cached success replays without another network fetch or a fabricated observation time', async () => {
  const store = createStore();
  let fetched = 0;
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.cached',
    });
    const data = {
      ...facilitatorFixture,
      externalId: app.externalId,
      raw: { cachedField: ['complete'] },
    };
    const observedAt = '2026-01-03T04:05:06.000Z';
    store.saveObservation(app.id, data, observedAt);
    const providers = scanProviders({
      'google-play': scanProvider({
        app: async () => {
          fetched++;
          throw new Error('Cached task must not fetch again');
        },
      }),
    });
    const runner = createFullScanRunner({ store, providers, config: quietConfig });
    runner.seed();
    const task = store.one("SELECT id FROM full_scan_tasks WHERE kind='detail'")!;
    store.run(
      "UPDATE full_scan_tasks SET status='running',attempts=1,response=?,response_at=? WHERE id=?",
      JSON.stringify(data),
      observedAt,
      task.id,
    );
    store.run(
      "INSERT INTO full_scan_attempts(task_id,attempt,started_at,status) VALUES (?,1,?,'running')",
      task.id,
      observedAt,
    );
    const resumed = createFullScanRunner({ store, providers, batchId: runner.batchId });
    resumed.recover();
    await drain(resumed);
    assert.equal(fetched, 0);
    assert.equal(store.listSnapshots(app.id).total, 1);
    assert.equal(store.listSnapshots(app.id).snapshots[0].observedAt, observedAt);
    assert.equal(store.getApp(app.id)?.loanAnalysis?.sourceObservedAt, observedAt);
    assert.equal(
      store.one("SELECT COUNT(*) n FROM full_scan_attempts WHERE status='interrupted'")!.n,
      1,
    );
    assert.equal(
      store.one('SELECT response_at FROM full_scan_tasks WHERE id=?', task.id)!.response_at,
      observedAt,
    );
  } finally {
    store.close();
  }
});

test('FS-AC-05/09: malformed successful HTTP data is fetched again on retry instead of replaying an invalid cached payload forever', async () => {
  const store = createStore();
  let calls = 0;
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.malformed',
    });
    const gp = scanProvider({
      reviewsPage: async () => {
        calls++;
        return calls === 1
          ? {
              data: null as any,
              raw: { malformed: true },
              source: 'https://example.invalid/reviews',
            }
          : {
              data: [{ externalId: 'valid', text: 'Recovered valid data' }],
              raw: { recovered: true },
              source: 'https://example.invalid/reviews',
              nextCursor: null,
            };
      },
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: quietConfig,
    });
    runner.seed();
    await drain(runner);
    assert.equal(calls, 2, 'a malformed payload is evidence, not a replayable success');
    assert.equal(runner.summary().failures, 0);
    assert.equal(store.listReviews(app.id).total, 1);
    assert.equal(
      store.one(
        "SELECT COUNT(*) n FROM full_scan_responses r JOIN full_scan_tasks t ON t.id=r.task_id WHERE t.kind='reviews'",
      )!.n,
      2,
    );
  } finally {
    store.close();
  }
});

test('FS-AC-05/11: a local review-page budget remains visibly incomplete and retains a recoverable continuation', async () => {
  const store = createStore();
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.budget',
    });
    const pages: number[] = [];
    const gp = scanProvider({
      reviewsPage: async (input) => {
        pages.push(input.page);
        return {
          data: [{ externalId: `review-${input.page}`, text: 'Synthetic comment' }],
          raw: { page: input.page },
          source: 'https://example.invalid/reviews',
          nextCursor: input.page === 1 ? 'cursor-1' : null,
        };
      },
    });
    const providers = scanProviders({ 'google-play': gp });
    const runner = createFullScanRunner({
      store,
      providers,
      config: { ...quietConfig, maxReviewPages: 1 },
    });
    runner.seed();
    await drain(runner);
    assert.equal(store.listReviews(app.id).total, 1);
    assert.notEqual(
      runner.summary().status,
      'completed',
      'local slicing cannot mean all available comments were collected',
    );
    const continuation = store.one(
      "SELECT result FROM full_scan_tasks WHERE app_id=? AND kind='reviews'",
      app.id,
    )!;
    assert.equal(JSON.parse(continuation.result).nextCursor, 'cursor-1');
    assert.equal(runner.summary().deferred, 1);
    assert.equal(runner.summary().pending, 1);
    const resumed = createFullScanRunner({
      store,
      providers,
      batchId: runner.batchId,
      config: { maxReviewPages: 0 },
    });
    resumed.recover();
    assert.equal(
      store.one('SELECT status FROM full_scan_runs WHERE id=?', runner.batchId)!.status,
      'running',
    );
    await drain(resumed);
    assert.deepEqual(pages, [1, 2]);
    assert.equal(store.listReviews(app.id).total, 2);
    assert.equal(resumed.summary().pending, 0);
    assert.equal(resumed.summary().deferred, 0);
  } finally {
    store.close();
  }
});

test('FS-AC-01/08: discovery request language remains the source-time language after country settings change before admission', async () => {
  const store = createStore();
  try {
    store.upsertCountry({ ...store.getCountry('th')!, language: 'th' });
    const gp = scanProvider({
      list: async (input) => ({
        data: [
          {
            externalId: 'fixture.language',
            title: 'Loan language fixture',
            raw: { language: input.language },
          },
        ],
        raw: { requestLanguage: input.language },
        source: `https://example.invalid/finance?hl=${input.language}`,
        stopReason: 'chart-interface-no-pagination',
      }),
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: { ...quietConfig, collections: { 'google-play': ['TOP_FREE'] } },
    });
    runner.seed();
    await runner.runOnce();
    store.upsertCountry({ ...store.getCountry('th')!, language: 'en' });
    await drain(runner);
    const app = store.listApps().apps[0];
    const source = store.listDiscoveries(app.id).discoveries[0];
    assert.equal(source.requestLanguage, 'th');
    assert.equal((source.raw as any).language, 'th');
    assert.match(source.source, /hl=th/);
  } finally {
    store.close();
  }
});

test('FS-AC-05/06: a repeated review page is protection, not natural exhaustion, and duplicate stable IDs do not inflate retained count', async () => {
  const store = createStore();
  let pages = 0;
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.repeated',
    });
    const gp = scanProvider({
      reviewsPage: async (input) => {
        pages++;
        return {
          data: [
            { externalId: 'one', text: 'Repeated synthetic row' },
            { externalId: 'one', text: 'Repeated synthetic row' },
          ],
          raw: { repeated: true },
          source: 'https://example.invalid/reviews',
          nextCursor: `unique-token-${input.page}`,
        };
      },
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: quietConfig,
    });
    runner.seed();
    await drain(runner);
    assert.equal(pages, 2);
    assert.equal(store.listReviews(app.id).total, 1);
    assert.equal(runner.summary().reviewCount, 1);
    assert.equal(runner.summary().status, 'needs-review');
    assert.equal(
      store.one(
        "SELECT stop_reason FROM full_scan_tasks WHERE kind='reviews' ORDER BY page DESC LIMIT 1",
      )!.stop_reason,
      'reviews-repeated-page',
    );
    assert.deepEqual({ ...runner.summary().reviewWrites }, { added: 1, updated: 1 });
  } finally {
    store.close();
  }
});

test('FS-AC-08/09 / FULL-SCAN-01: provider HTTP capture persists through the real runner ledger without turning a successful request into a network failure', async () => {
  const store = createStore();
  try {
    let runner!: ReturnType<typeof createFullScanRunner>;
    const providers = createFullScanProviders({
      googlePlayClient: sourceClient({
        list: async (input) => {
          await input.requestOptions.fetchImpl(
            new Request('https://example.invalid/finance', {
              method: 'POST',
              body: 'fixture-request-body',
              signal: input.requestOptions.signal,
            }),
          );
          return [];
        },
      }),
      appStoreClient: sourceClient(),
      requestDelayMs: 0,
      fetchImpl: async (input) => {
        assert.ok(input instanceof Request);
        assert.equal(input.method, 'POST');
        assert.equal(await input.clone().text(), 'fixture-request-body');
        return new Response('{"preservedHttpBody":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      onResponse: (record) => runner.recordHttp(record),
    });
    runner = createFullScanRunner({
      store,
      providers,
      config: { ...quietConfig, collections: { 'google-play': ['TOP_FREE'] }, maxAttempts: 1 },
    });
    runner.seed();
    await drain(runner);
    assert.equal(runner.summary().failures, 0);
    assert.equal(runner.summary().httpRequests, 1);
    const http = store.one('SELECT * FROM full_scan_http')!;
    assert.equal(http.batch_id, runner.batchId);
    assert.equal(http.status, 200);
    assert.equal(http.body, '{"preservedHttpBody":true}');
    assert.equal(http.url, 'https://example.invalid/finance');
    assert.equal(http.method, 'POST');
    assert.equal(
      store.one('SELECT kind FROM full_scan_tasks WHERE id=?', http.task_id)!.kind,
      'list',
    );
  } finally {
    store.close();
  }
});

test('FS-AC-08/09: Apple developer lookup preserves native Request properties when applying the explicit public limit', async () => {
  let received: Request | undefined;
  const providers = createFullScanProviders({
    googlePlayClient: sourceClient(),
    appStoreClient: sourceClient({
      developer: async (input) => {
        const original = new Request('https://itunes.apple.com/lookup?id=123&entity=software', {
          headers: { 'x-qa-fixture': 'keep' },
          signal: input.requestOptions.signal,
        });
        await input.requestOptions.fetch(original);
        return [{ id: 999, title: 'Synthetic developer result', unknownExtra: true }];
      },
    }),
    requestDelayMs: 0,
    fetchImpl: async (input) => {
      assert.ok(input instanceof Request);
      received = input;
      return new Response('{"results":[]}');
    },
  });
  const result = await providers['app-store'].enrich({
    externalId: '123456',
    country: 'ph',
    language: 'en',
    kind: 'developer',
    developerId: '123',
  });
  assert.ok(received);
  assert.equal(new URL(received.url).searchParams.get('limit'), '200');
  assert.equal(received.headers.get('x-qa-fixture'), 'keep');
  assert.equal(result.status, 'available');
  assert.equal((result.data as any[])[0].unknownExtra, true);
});

test('FS-AC-09: batch timeout aborts its request and the other app and supplemental operations continue', async () => {
  const store = createStore();
  let signal: AbortSignal | undefined;
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.timeout',
    });
    const gp = scanProvider({
      app: async (input) => {
        signal = input.signal;
        return new Promise(() => {});
      },
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: { ...quietConfig, timeoutMs: 15, maxAttempts: 1 },
    });
    runner.seed();
    const active = runner.runOnce();
    assert.equal(await runner.runOnce(), false);
    await active;
    await drain(runner);
    assert.equal(signal?.aborted, true);
    assert.equal(runner.summary().failures, 1);
    const failed = store.one(
      "SELECT error,attempts FROM full_scan_tasks WHERE app_id=? AND kind='detail'",
      app.id,
    )!;
    assert.match(failed.error, /timed out/);
    assert.equal(failed.attempts, 1);
    assert.equal(
      store.one(
        "SELECT COUNT(*) n FROM full_scan_tasks WHERE app_id=? AND kind!='detail' AND status='succeeded'",
        app.id,
      )!.n,
      8,
    );
  } finally {
    store.close();
  }
});

test('FS-AC-07/10/11: a partial developer directory with upstream integrity warnings remains reviewable rather than silently complete', async () => {
  const store = createStore();
  try {
    store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.developer.warning',
    });
    const gp = scanProvider({
      enrich: async (input) => ({
        status: input.kind === 'developer' ? 'available' : 'unsupported',
        data: input.kind === 'developer' ? [{ appId: 'fixture.related' }] : null,
        raw:
          input.kind === 'developer'
            ? {
                data: [{ appId: 'fixture.related' }],
                warnings: [{ reason: 'token-cycle', partial: true }],
              }
            : null,
        source: 'https://example.invalid/' + input.kind,
        requestCountry: input.country,
        requestLanguage: input.language,
      }),
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: quietConfig,
    });
    runner.seed();
    await drain(runner);
    assert.equal(runner.summary().status, 'needs-review');
    const task = store.one(
      "SELECT stop_reason,result FROM full_scan_tasks WHERE kind='enrich' AND json_extract(payload,'$.kind')='developer'",
    )!;
    assert.equal(task.stop_reason, 'developer-degraded');
    assert.equal(JSON.parse(task.result).warnings[0].reason, 'token-cycle');
  } finally {
    store.close();
  }
});

test('FS-AC-01/11: a shortened local Apple search budget cannot be accepted as the public 200-result boundary', () => {
  const store = createStore();
  try {
    for (const appleSearchPages of [1, 2, 3, 5])
      assert.throws(
        () =>
          createFullScanRunner({
            store,
            providers: scanProviders(),
            config: { ...quietConfig, appleSearchPages },
          }),
        /appleSearchPages/,
      );
    const runner = createFullScanRunner({
      store,
      providers: scanProviders(),
      config: { ...quietConfig, appleSearchPages: 4 },
    });
    assert.equal(runner.config.appleSearchPages, 4);
  } finally {
    store.close();
  }
});

test('FS-AC-09/10: CLI status reads existing checkpoints without creating a database, migrating, seeding or changing attempts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-scan-status-'));
  const status = (path: string, batchId = 'fixture-status') =>
    JSON.parse(
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
          batchId,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
  try {
    const missing = join(directory, 'missing.sqlite');
    assert.throws(() => status(missing), /Database does not exist/);
    assert.equal(existsSync(missing), false);
    const untouched = join(directory, 'pre-batch.sqlite');
    const preBatch = new DatabaseSync(untouched);
    preBatch.exec(
      "CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('preserve'); PRAGMA user_version=777;",
    );
    preBatch.close();
    const before = readFileSync(untouched);
    assert.deepEqual(status(untouched), { batchId: 'fixture-status', status: 'not-started' });
    assert.deepEqual(
      readFileSync(untouched),
      before,
      'status must not migrate even an older database',
    );
    const seeded = join(directory, 'seeded.sqlite');
    const store = createStore(seeded);
    store.createApp({ store: 'google-play', country: 'th', externalId: 'fixture.status' });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders(),
      batchId: 'fixture-status',
      config: quietConfig,
    });
    runner.seed();
    runner.pause();
    store.close();
    const seededBefore = readFileSync(seeded);
    const result = status(seeded);
    assert.equal(result.id, 'fixture-status');
    assert.equal(
      result.tasks.reduce((sum: number, row: any) => sum + row.count, 0),
      9,
    );
    assert.ok(result.tasks.every((row: any) => row.status === 'queued'));
    assert.deepEqual(result.http, []);
    assert.deepEqual(readFileSync(seeded), seededBefore);
    const check = new DatabaseSync(seeded, { readOnly: true });
    try {
      assert.equal(check.prepare('SELECT COUNT(*) n FROM full_scan_attempts').get()!.n, 0);
    } finally {
      check.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('FS-AC-06/08/09: replaying a saved review response preserves the original fetch time', async () => {
  const store = createStore();
  let calls = 0;
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.cached-reviews',
    });
    const response = {
      data: [
        {
          externalId: 'saved-review',
          text: 'Synthetic retained comment',
          raw: { unknown: { saved: true } },
        },
      ],
      raw: { untouched: true },
      source: 'https://example.invalid/reviews',
      nextCursor: null,
    };
    const observedAt = '2026-01-03T04:05:06.000Z';
    const providers = scanProviders({
      'google-play': scanProvider({
        reviewsPage: async () => {
          calls++;
          throw new Error('Saved review page must not fetch');
        },
      }),
    });
    const runner = createFullScanRunner({ store, providers, config: quietConfig });
    runner.seed();
    const task = store.one("SELECT id FROM full_scan_tasks WHERE kind='reviews'")!;
    store.run(
      "UPDATE full_scan_tasks SET status='running',attempts=1,response=?,response_at=? WHERE id=?",
      JSON.stringify(response),
      observedAt,
      task.id,
    );
    const resumed = createFullScanRunner({ store, providers, batchId: runner.batchId });
    resumed.recover();
    await drain(resumed);
    assert.equal(calls, 0);
    const review = store.listReviews(app.id).reviews[0];
    assert.equal(
      review.fetchedAt,
      observedAt,
      'recovery time is not the original source fetch time',
    );
    assert.deepEqual(review.raw, response.data[0].raw);
    assert.equal(
      store.one('SELECT response_at FROM full_scan_tasks WHERE id=?', task.id)!.response_at,
      observedAt,
    );
  } finally {
    store.close();
  }
});

test('FS-AC-05/08/09: continuation and failed enrichment retain the frozen language if country settings change', async () => {
  const store = createStore();
  try {
    store.upsertCountry({ ...store.getCountry('th')!, language: 'th' });
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.frozen-language',
    });
    const calls: string[] = [];
    const gp = scanProvider({
      enrich: async (input) => {
        if (input.kind === 'permissions') throw new Error('Synthetic failed permission fetch');
        return {
          status: 'unsupported',
          data: null,
          raw: null,
          source: 'https://example.invalid/' + input.kind,
          requestCountry: input.country,
          requestLanguage: input.language,
        };
      },
      reviewsPage: async (input) => {
        calls.push(input.language);
        if (input.page === 1) store.upsertCountry({ ...store.getCountry('th')!, language: 'es' });
        return {
          data: [{ externalId: `frozen-${input.page}`, text: 'Synthetic text' }],
          raw: { page: input.page },
          source: 'https://example.invalid/reviews',
          nextCursor: input.page === 1 ? 'next' : null,
        };
      },
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: { ...quietConfig, maxAttempts: 1 },
    });
    runner.seed();
    store.upsertCountry({ ...store.getCountry('th')!, language: 'en' });
    await drain(runner);
    assert.deepEqual(calls, ['th', 'th']);
    assert.ok(store.listReviews(app.id).reviews.every((review) => review.language === 'th'));
    const failed = store.listEnrichments(app.id).find((item) => item.kind === 'permissions')!;
    assert.equal(failed.attemptRequestLanguage, 'th');
  } finally {
    store.close();
  }
});

test('FS-AC-05/11: an empty Google page with a valid continuation is not a natural end', async () => {
  const store = createStore();
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.empty-with-token',
    });
    const pages: number[] = [];
    const gp = scanProvider({
      reviewsPage: async (input) => {
        pages.push(input.page);
        return {
          data:
            input.page === 1 ? [] : [{ externalId: 'after-empty', text: 'Synthetic later page' }],
          raw: { page: input.page },
          source: 'https://example.invalid/reviews',
          nextCursor: input.page === 1 ? 'continue-after-empty' : null,
        };
      },
    });
    const runner = createFullScanRunner({
      store,
      providers: scanProviders({ 'google-play': gp }),
      config: quietConfig,
    });
    runner.seed();
    await drain(runner);
    assert.deepEqual(pages, [1, 2], 'the source explicitly advertises another page');
    assert.equal(store.listReviews(app.id).total, 1);
    assert.equal(
      store.one("SELECT stop_reason FROM full_scan_tasks WHERE kind='reviews' AND page=2")!
        .stop_reason,
      'reviews-no-next-token',
    );
  } finally {
    store.close();
  }
});

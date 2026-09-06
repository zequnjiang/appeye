import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createFullScanRunner } from '../server/full-scan.js';
import {
  createFullScanProviders,
  type ScanProvider,
  type ScanTransportRecord,
} from '../server/full-scan-providers.js';
import { facilitatorFixture } from './loan-fixtures.js';

function client(overrides: Record<string, (input: any) => Promise<any>> = {}) {
  return {
    app: async (input: any) => ({
      id: Number(input.id),
      title: 'Individual fallback',
      description: facilitatorFixture.description,
      screenshots: ['https://example.invalid/recovered.png'],
      sellerName: 'Individual Seller',
      extraIndividualField: { saved: true },
    }),
    list: async () => [],
    search: async () => [],
    reviews: async () => [],
    ...overrides,
  };
}
function row(id: number, extra: Record<string, unknown> = {}) {
  return {
    wrapperType: 'software',
    kind: 'software',
    trackId: id,
    bundleId: `fixture.bulk.${id}`,
    trackName: `Synthetic Bulk ${id}`,
    description: facilitatorFixture.description,
    artistId: id + 500,
    artistName: `Publisher ${id}`,
    sellerName: `Legal Seller ${id}`,
    sellerUrl: 'https://example.invalid/company',
    screenshotUrls: [`https://example.invalid/${id}.png`],
    unknownFuture: { zero: 0, flag: false, id },
    ...extra,
  };
}
const input = { batchId: 'synthetic-bulk', country: 'th', language: 'th' };
const emptyEnrich: ScanProvider['enrich'] = async (i) => ({
  status: 'unsupported',
  data: null,
  raw: null,
  source: 'https://example.invalid/' + i.kind,
  requestCountry: i.country,
  requestLanguage: null,
});
const emptyReviews: ScanProvider['reviewsPage'] = async () => ({
  data: [],
  raw: [],
  source: 'https://example.invalid/reviews',
});

test('FS-AC-02/08: bulk Apple lookup maps each exact ID, preserves unknown/seller fields and shares only genuine HTTP provenance', async () => {
  const records: ScanTransportRecord[] = [];
  const rows = [row(102), row(999), row(101)];
  const providers = createFullScanProviders({
    appStoreClient: client({
      app: async () => {
        throw new Error('Unexpected individual fallback');
      },
    }),
    googlePlayClient: client(),
    requestDelayMs: 0,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.pathname, '/lookup');
      assert.equal(parsed.searchParams.get('id'), '101,102');
      assert.equal(parsed.searchParams.get('country'), 'th');
      assert.equal(parsed.searchParams.get('lang'), 'en_us');
      return Response.json({
        resultCount: 3,
        results: rows,
        envelopeUnknown: ['retained only in HTTP'],
      });
    },
    onResponse: (record) => {
      records.push(record);
      return 741;
    },
  });
  const first = await providers['app-store'].appWithPeers!({
    ...input,
    externalId: '101',
    peerExternalIds: ['102', '101', 'bad-id'],
  });
  const second = await providers['app-store'].appWithPeers!({
    ...input,
    externalId: '102',
    peerExternalIds: [],
  });
  assert.equal(records.length, 1);
  for (const [result, id] of [
    [first, 101],
    [second, 102],
  ] as const) {
    assert.equal(result.data.externalId, String(id));
    assert.equal(result.data.raw?.sellerName, `Legal Seller ${id}`);
    assert.deepEqual(
      result.data.raw?._appeyeLookupRecord,
      rows.find((value) => value.trackId === id),
    );
    assert.equal(result.observedAt, records[0].fetchedAt);
    assert.equal(result.provenance.httpId, 741);
    assert.equal(result.provenance.method, 'bulk-lookup');
    assert.equal((result.data.raw?._appeyeBulkSource as any).fetchedAt, records[0].fetchedAt);
    assert.ok(!JSON.stringify(result.data.raw).includes('Legal Seller 999'));
  }
  assert.deepEqual(JSON.parse(records[0].body!).envelopeUnknown, ['retained only in HTTP']);
  assert.equal(first.data.installs, null);
});

test('FS-AC-02/08/09: prefetched rows never cross batch, country or configured-language contexts', async () => {
  let requests = 0;
  const providers = createFullScanProviders({
    appStoreClient: client(),
    googlePlayClient: client(),
    requestDelayMs: 0,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      requests++;
      return Response.json({
        results: parsed.searchParams
          .get('id')!
          .split(',')
          .map((id) =>
            row(Number(id), {
              requestMarker: requests,
              countryMarker: parsed.searchParams.get('country'),
            }),
          ),
      });
    },
  });
  const app = providers['app-store'].appWithPeers!;
  await app({ ...input, externalId: '201', peerExternalIds: ['202'] });
  const otherLanguage = await app({
    ...input,
    language: 'en',
    externalId: '202',
    peerExternalIds: [],
  });
  const otherCountry = await app({
    ...input,
    country: 'mx',
    externalId: '202',
    peerExternalIds: [],
  });
  const otherBatch = await app({
    ...input,
    batchId: 'second-batch',
    externalId: '202',
    peerExternalIds: [],
  });
  const original = await app({ ...input, externalId: '202', peerExternalIds: [] });
  assert.equal(requests, 4);
  assert.deepEqual(
    [otherLanguage, otherCountry, otherBatch, original].map(
      (result) => (result.data.raw?._appeyeLookupRecord as any).requestMarker,
    ),
    [2, 3, 4, 1],
  );
  assert.equal(otherCountry.provenance.country, 'mx');
  assert.equal(otherBatch.provenance.batchId, 'second-batch');
});

test('FS-AC-04/08: missing rows and rows without any screenshots use the individual app fallback', async () => {
  const individual: number[] = [];
  let bulk = 0;
  const providers = createFullScanProviders({
    appStoreClient: client({
      app: async (i) => {
        individual.push(Number(i.id));
        return {
          id: Number(i.id),
          title: 'Individual app',
          screenshots: ['https://example.invalid/recovered.png'],
          additionalRaw: { retained: true },
        };
      },
    }),
    googlePlayClient: client(),
    requestDelayMs: 0,
    fetchImpl: async () => {
      bulk++;
      return Response.json({
        results: [
          row(301),
          row(302, { screenshotUrls: [], ipadScreenshotUrls: [], appletvScreenshotUrls: [] }),
        ],
      });
    },
  });
  const app = providers['app-store'].appWithPeers!;
  await app({ ...input, externalId: '301', peerExternalIds: ['302', '303'] });
  const noScreenshots = await app({ ...input, externalId: '302', peerExternalIds: [] });
  const missing = await app({ ...input, externalId: '303', peerExternalIds: [] });
  assert.equal(bulk, 1);
  assert.deepEqual(individual, [302, 303]);
  assert.match(noScreenshots.provenance.fallbackReason!, /no-screenshots/);
  assert.equal(missing.provenance.fallbackReason, 'bulk-no-record');
  for (const result of [noScreenshots, missing]) {
    assert.equal(result.provenance.method, 'individual');
    assert.deepEqual(result.data.raw?.additionalRaw, { retained: true });
    assert.deepEqual(result.data.screenshots, ['https://example.invalid/recovered.png']);
  }
});

test('FS-AC-08/09: failed or malformed bulk responses are retained and fall back without fabricating bulk success', async () => {
  for (const response of [
    new Response('Temporary source failure', { status: 503 }),
    new Response('{bad json', { headers: { 'content-type': 'application/json' } }),
    Response.json({ results: 'wrong type', unknown: true }),
  ]) {
    const records: ScanTransportRecord[] = [];
    let fallbacks = 0;
    const providers = createFullScanProviders({
      appStoreClient: client({
        app: async (i) => {
          fallbacks++;
          return { id: Number(i.id), title: 'Individual success', preserved: false };
        },
      }),
      googlePlayClient: client(),
      requestDelayMs: 0,
      fetchImpl: async () => response,
      onResponse: (record) => {
        records.push(record);
      },
    });
    const result = await providers['app-store'].appWithPeers!({
      ...input,
      externalId: '401',
      peerExternalIds: [],
    });
    assert.equal(fallbacks, 1);
    assert.equal(records.length, 1);
    assert.ok(records[0].body);
    assert.equal(result.provenance.method, 'individual');
    assert.match(result.provenance.fallbackReason!, /bulk-lookup-failed/);
    assert.equal(result.data.raw?.preserved, false);
  }
});

test('FS-AC-03/04/08/10: one bulk response produces separate attempts and original-time snapshots for every admitted app', async () => {
  const store = createStore();
  try {
    const apps = [501, 502].map((id) =>
      store.createApp({ store: 'app-store', country: 'th', externalId: String(id) }),
    );
    store.updateClassification(apps[0].id, 'excluded');
    let runner: ReturnType<typeof createFullScanRunner>;
    const providers = createFullScanProviders({
      appStoreClient: client(),
      googlePlayClient: client(),
      requestDelayMs: 0,
      fetchImpl: async () => Response.json({ results: [row(501), row(502)] }),
      onResponse: (response) => runner.recordHttp(response),
    });
    providers['app-store'].enrich = emptyEnrich;
    providers['app-store'].reviewsPage = emptyReviews;
    runner = createFullScanRunner({
      store,
      providers,
      config: {
        countries: ['th'],
        stores: ['app-store'],
        collections: { 'app-store': [], 'google-play': [] },
        includeSearch: false,
        timeoutMs: 1000,
      },
    });
    runner.seed();
    let count = 0;
    while (await runner.runOnce()) assert.ok(++count < 25);
    assert.equal(runner.summary().failures, 0);
    assert.equal(runner.summary().pending, 0);
    assert.equal(count, 18);
    const http = store.one('SELECT id,fetched_at,body FROM full_scan_http')!;
    assert.equal(store.one('SELECT COUNT(*) n FROM full_scan_http')!.n, 1);
    assert.equal(JSON.parse(http.body).results.length, 2);
    for (const app of apps) {
      const task = store.one(
        "SELECT * FROM full_scan_tasks WHERE app_id=? AND kind='detail'",
        app.id,
      )!;
      assert.equal(task.attempts, 1);
      assert.equal(task.status, 'succeeded');
      assert.equal(task.response_at, http.fetched_at);
      assert.equal(JSON.parse(task.result).provenance.httpId, http.id);
      assert.equal(store.listSnapshots(app.id).snapshots[0].observedAt, http.fetched_at);
      assert.equal(
        store.one('SELECT COUNT(*) n FROM full_scan_responses WHERE task_id=?', task.id)!.n,
        1,
      );
      assert.equal(
        store.one('SELECT COUNT(*) n FROM full_scan_attempts WHERE task_id=?', task.id)!.n,
        1,
      );
    }
    assert.equal(store.getApp(apps[0].id)!.effectiveClassification, 'excluded');
    assert.equal(store.getApp(apps[0].id)!.classificationSource, 'manual');
  } finally {
    store.close();
  }
});

test('FS-AC-08/09: bulk lookup honors cancellation and never silently invokes a real client for injected fixtures', async () => {
  assert.equal(
    createFullScanProviders({ appStoreClient: client(), googlePlayClient: client() })['app-store']
      .appWithPeers,
    undefined,
  );
  assert.equal(
    createFullScanProviders({
      appleBatchSize: 0,
      appStoreClient: client(),
      googlePlayClient: client(),
      fetchImpl: async () => {
        throw new Error('Unexpected fetch');
      },
    })['app-store'].appWithPeers,
    undefined,
  );
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  let fallbacks = 0;
  const providers = createFullScanProviders({
    appStoreClient: client({
      app: async () => {
        fallbacks++;
        return {};
      },
    }),
    googlePlayClient: client(),
    requestDelayMs: 0,
    fetchImpl: async () => {
      requests++;
      return Response.json({ results: [] });
    },
  });
  await assert.rejects(
    providers['app-store'].appWithPeers!({
      ...input,
      externalId: '601',
      peerExternalIds: [],
      signal: controller.signal,
    }),
    /abort/i,
  );
  assert.equal(requests, 0);
  assert.equal(fallbacks, 0);
});

test('FS-AC-02/08: bulk requests respect their configured ID bound and duplicate returned identities use fallback', async () => {
  let received: string[] = [];
  let individual = 0;
  const providers = createFullScanProviders({
    appStoreClient: client({
      app: async (i) => {
        individual++;
        return { id: Number(i.id), title: 'Unambiguous individual result' };
      },
    }),
    googlePlayClient: client(),
    requestDelayMs: 0,
    fetchImpl: async (url) => {
      received = new URL(String(url)).searchParams.get('id')!.split(',');
      return Response.json({
        results: [
          row(801),
          row(801, { sellerName: 'Ambiguous second seller' }),
          ...received.slice(1).map((id) => row(Number(id))),
        ],
      });
    },
  });
  const result = await providers['app-store'].appWithPeers!({
    ...input,
    externalId: '801',
    peerExternalIds: Array.from({ length: 65 }, (_, i) => String(802 + i)),
  });
  assert.equal(received.length, 50);
  assert.equal(new Set(received).size, 50);
  assert.equal(result.provenance.method, 'individual');
  assert.match(result.provenance.fallbackReason!, /duplicate-id/);
  assert.equal(individual, 1);
});

test('FS-AC-04/08: runner selects only queued peers in the same batch, Apple country and frozen language', async () => {
  const store = createStore();
  try {
    store.upsertCountry({ ...store.getCountry('th')!, language: 'th' });
    for (const [id, country, name] of [
      ['901', 'th', 'app-store'],
      ['902', 'th', 'app-store'],
      ['903', 'mx', 'app-store'],
      ['904', 'th', 'app-store'],
      ['905', 'th', 'google-play'],
    ] as const)
      store.createApp({ externalId: id, country, store: name });
    const seen: any[] = [];
    const simple: ScanProvider = {
      app: async (i) => ({ ...facilitatorFixture, externalId: i.externalId }),
      list: async () => ({ data: [], raw: [], source: 'https://example.invalid/list' }),
      search: async () => ({ data: [], raw: [], source: 'https://example.invalid/search' }),
      enrich: emptyEnrich,
      reviewsPage: emptyReviews,
    };
    const apple: ScanProvider = {
      ...simple,
      appWithPeers: async (i) => {
        seen.push(i);
        return {
          data: { ...facilitatorFixture, externalId: i.externalId },
          observedAt: '2026-02-03T04:05:06.000Z',
          provenance: {
            method: 'bulk-lookup',
            batchId: i.batchId,
            country: i.country,
            language: 'en_us',
            source: 'https://example.invalid/lookup',
          },
        };
      },
    };
    const providers = { 'app-store': apple, 'google-play': simple };
    const config = {
      countries: ['th'],
      collections: { 'app-store': [], 'google-play': [] },
      includeSearch: false,
    };
    const runner = createFullScanRunner({ store, providers, batchId: 'selected-batch', config });
    runner.seed();
    store.run(
      "UPDATE full_scan_tasks SET payload=json_set(payload,'$.requestLanguage','en') WHERE batch_id=? AND external_id='904'",
      runner.batchId,
    );
    store.createApp({ externalId: '906', country: 'th', store: 'app-store' });
    createFullScanRunner({ store, providers, batchId: 'different-batch', config }).seed();
    await runner.runOnce();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].externalId, '901');
    assert.equal(seen[0].batchId, 'selected-batch');
    assert.equal(seen[0].country, 'th');
    assert.equal(seen[0].language, 'th');
    assert.deepEqual(seen[0].peerExternalIds, ['902']);
  } finally {
    store.close();
  }
});

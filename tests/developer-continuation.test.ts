import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFullScanProviders,
  type ScanTransportRecord,
  type FullScanProviders,
  type ScanProvider,
} from '../server/full-scan-providers.js';
import { createFullScanRunner } from '../server/full-scan.js';
import { createStore } from '../server/db.js';
import { normalizeDeveloperContinuation } from '../server/developer-continuation.js';

function setPath(root: any[], path: number[], value: unknown) {
  let current = root;
  for (const index of path.slice(0, -1)) current = current[index] ??= [];
  current[path.at(-1)!] = value;
}
function initialItem(index: number) {
  const item: any[] = [];
  setPath(item, [0, 0], `fixture.directory.${index}`);
  item[3] = `Synthetic Directory ${index}`;
  setPath(item, [1, 3, 2], 'https://example.invalid/icon.png');
  setPath(item, [10, 4, 2], `/store/apps/details?id=fixture.directory.${index}`);
  item[14] = 'Synthetic Publisher';
  return item;
}
function continuationItem(index: number) {
  const item: any[] = [];
  item[2] = `Synthetic Directory ${index}`;
  setPath(item, [12, 0], `fixture.directory.${index}`);
  setPath(item, [1, 1, 0, 3, 2], 'https://example.invalid/icon.png');
  setPath(item, [9, 4, 2], `/store/apps/details?id=fixture.directory.${index}`);
  setPath(item, [4, 0, 0, 0], 'Synthetic Publisher');
  return item;
}
function initialHtml() {
  const data: any[] = [],
    root: any[] = [Array.from({ length: 20 }, (_, i) => initialItem(i + 1))];
  setPath(root, [1, 3, 1], 'synthetic-next-token');
  setPath(data, [0, 1, 0, 21], root);
  return `<script>AF_initDataCallback({key: 'ds:3', hash: 'fixture', data:${JSON.stringify(data)}, sideChannel: {}});</script>`;
}
function continuation(
  layout: 'legacy' | 'compact',
  rows = Array.from({ length: 13 }, (_, i) => continuationItem(i + 21)),
  token: string | null = null,
  rpc = 'qnKhOb',
) {
  const payload: any[] = [];
  const block: any[] = [rows];
  setPath(block, [7, 1], token);
  setPath(payload, [0, layout === 'compact' ? 0 : 6], block);
  const frame = JSON.stringify([
    ['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic'],
  ]);
  return `)]}'\n${frame.length}\n${frame}\n`;
}
const context = {
  externalId: 'fixture.parent',
  developerId: '123456789',
  country: 'ar',
  language: 'es',
  kind: 'developer' as const,
};

test('FS-AC-07/08 / #13: only the recognized compact developer continuation is adapted and its source rows stay intact', () => {
  const original = continuation('compact');
  const result = normalizeDeveloperContinuation(original);
  assert.equal(result.adaptation?.kind, 'developer-compact-continuation');
  assert.equal(result.adaptation?.apps, 13);
  assert.equal(result.adaptation?.fromPath, '0.0');
  assert.equal(result.adaptation?.toPath, '0.6');
  const payload = JSON.parse(
    JSON.parse(result.body.split('\n').find((line) => line.startsWith('['))!)[0][2],
  );
  assert.deepEqual(
    payload[0][6][0],
    JSON.parse(JSON.stringify(Array.from({ length: 13 }, (_, i) => continuationItem(i + 21)))),
  );
  assert.equal(payload[0][6][7][1], null);
  const legacy = continuation('legacy');
  assert.deepEqual(normalizeDeveloperContinuation(legacy), { body: legacy });
});

test('FS-AC-07/08 / #13: unrelated RPCs and malformed/unknown row or token shapes remain original for explicit SDK errors', () => {
  const cases = [
    'not a batchexecute response',
    continuation('compact', undefined, null, 'differentRpc'),
    continuation('compact', [[null, null, 'missing required identity']]),
    continuation('compact', undefined, 123 as any),
    continuation('compact', [], 'still-has-a-continuation'),
    `)]}'\n${JSON.stringify([['wrb.fr', 'qnKhOb', JSON.stringify([[{ unrecognized: true }]])]])}\n`,
  ];
  for (const body of cases) assert.deepEqual(normalizeDeveloperContinuation(body), { body });
});

for (const layout of ['legacy', 'compact'] as const) {
  test(`FS-AC-07/08 / #13: real installed SDK parses synthetic 20 + 13 ${layout} rows offline with exact original HTTP retention`, async () => {
    const bodies = [initialHtml(), continuation(layout)],
      records: ScanTransportRecord[] = [];
    let requests = 0;
    const providers = createFullScanProviders({
      requestDelayMs: 0,
      fetchImpl: async (url) => {
        const parsed = new URL(url instanceof Request ? url.url : String(url));
        assert.equal(parsed.hostname, 'play.google.com');
        assert.equal(parsed.searchParams.get('gl'), 'ar');
        assert.equal(parsed.searchParams.get('hl'), 'es');
        if (requests === 0) assert.equal(parsed.pathname, '/store/apps/dev');
        else assert.equal(parsed.pathname, '/_/PlayStoreUi/data/batchexecute');
        assert.ok(requests < 2, 'natural end must not issue another request');
        return new Response(bodies[requests++], { headers: { 'content-type': 'text/html' } });
      },
      onResponse: (record) => {
        records.push(record);
        return records.length;
      },
    });
    const result = await providers['google-play'].enrich(context);
    assert.equal(result.status, 'available');
    assert.equal((result.data as any[]).length, 33);
    assert.equal(new Set((result.data as any[]).map((row) => row.appId)).size, 33);
    assert.deepEqual(
      (result.data as any[]).map((row) => row.appId),
      Array.from({ length: 33 }, (_, i) => `fixture.directory.${i + 1}`),
    );
    assert.deepEqual((result.raw as any).warnings, []);
    assert.equal(requests, 2);
    assert.deepEqual(
      records.map((record) => record.body),
      bodies,
      'journal retains original response bytes, not adapter output',
    );
    if (layout === 'compact') {
      const compatibility = (result.raw as any).compatibility;
      assert.ok(Array.isArray(compatibility));
      assert.equal(compatibility.length, 1);
      assert.equal(compatibility[0].sourceHttpId, 2);
      assert.equal(compatibility[0].sourceFetchedAt, records[1].fetchedAt);
      assert.equal(compatibility[0].originalHttpPreserved, true);
    }
  });
}

test('FS-AC-07/11 / #13: an unknown continuation layout stays visibly degraded instead of silently reporting the first 20 as complete', async () => {
  const bodies = [initialHtml(), continuation('compact', [[null, null, 'unknown layout']])];
  let requests = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async () => new Response(bodies[requests++]),
  });
  const result = await providers['google-play'].enrich(context);
  assert.equal((result.data as any[]).length, 20);
  assert.ok((result.raw as any).warnings.length > 0);
  assert.equal(requests, 2);
  assert.equal((result.raw as any).compatibility?.length ?? 0, 0);
});

test('FS-AC-07/09 / #13: developer-only retry preserves prior attempts/responses/history and excludes other warnings, failures and batches', async () => {
  const store = createStore();
  let recovered = false;
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'ar',
      externalId: 'fixture.retry-directory',
    });
    store.createApp({
      store: 'google-play',
      country: 'ar',
      externalId: 'fixture.unknown-layout-warning',
    });
    const provider: ScanProvider = {
      app: async (input) => ({
        externalId: input.externalId,
        title: 'Synthetic directory parent',
        developerId: '123456789',
      }),
      list: async () => ({ data: [], raw: [], source: 'https://example.invalid/list' }),
      search: async () => ({
        data: [],
        raw: [],
        source: 'https://example.invalid/search',
        stopReason: 'search-degraded',
      }),
      enrich: async (input) => {
        if (input.kind === 'permissions') throw new Error('Synthetic independent failure');
        if (input.kind !== 'developer')
          return {
            status: 'unsupported',
            data: null,
            raw: null,
            source: 'https://example.invalid/' + input.kind,
            requestCountry: input.country,
            requestLanguage: input.language,
          };
        const data = Array.from({ length: recovered ? 33 : 20 }, (_, i) => ({
          appId: `fixture.directory.${i + 1}`,
        }));
        return {
          status: 'available',
          data,
          raw: {
            data,
            warnings: recovered ? [] : [{ context: 'developer', reason: 'cluster-page-parse' }],
          },
          source: 'https://example.invalid/developer',
          requestCountry: input.country,
          requestLanguage: input.language,
        };
      },
      reviewsPage: async (input) => ({
        data: [{ externalId: `review-${input.page}`, text: 'Synthetic comment' }],
        raw: [],
        source: 'https://example.invalid/reviews',
        nextCursor: 'same-review-token',
      }),
    };
    const providers: FullScanProviders = { 'google-play': provider, 'app-store': provider };
    const config = {
      countries: ['ar'],
      stores: ['google-play' as const],
      collections: { 'google-play': [], 'app-store': [] },
      includeSearch: true,
      maxAttempts: 1,
      retryDelayMs: 0,
    };
    const runner = createFullScanRunner({
      store,
      providers,
      batchId: 'selected-directory-batch',
      config,
    });
    runner.seed();
    while (await runner.runOnce()) {}
    const other = createFullScanRunner({
      store,
      providers,
      batchId: 'unrelated-directory-batch',
      config,
    });
    other.seed();
    while (await other.runOnce()) {}
    const target = store.one(
      "SELECT * FROM full_scan_tasks WHERE batch_id=? AND stop_reason='developer-degraded'",
      runner.batchId,
    )!;
    store.run(
      'INSERT INTO full_scan_http(batch_id,task_id,fetched_at,url,method,status,content_type,body,error) VALUES (?,?,?,?,?,?,?,?,?)',
      runner.batchId,
      target.id,
      target.response_at,
      'https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=qnKhOb&gl=ar&hl=es',
      'POST',
      200,
      'application/json',
      continuation('compact'),
      null,
    );
    const unknownTail = store.one(
      "SELECT * FROM full_scan_tasks WHERE batch_id=? AND external_id='fixture.unknown-layout-warning' AND stop_reason='developer-degraded'",
      runner.batchId,
    )!;
    // An earlier repairable page cannot establish that a later unknown page is recoverable.
    for (const body of [
      continuation('compact'),
      continuation('compact', [[null, null, 'unknown final layout']]),
    ]) {
      store.run(
        'INSERT INTO full_scan_http(batch_id,task_id,fetched_at,url,method,status,content_type,body,error) VALUES (?,?,?,?,?,?,?,?,?)',
        runner.batchId,
        unknownTail.id,
        unknownTail.response_at,
        'https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=qnKhOb&gl=ar&hl=es',
        'POST',
        200,
        'application/json',
        body,
        null,
      );
    }
    const before = store.all(
      'SELECT id,status,stop_reason,response,result,attempts FROM full_scan_tasks WHERE id<>? ORDER BY id',
      target.id,
    );
    const originalHttp = store.all('SELECT * FROM full_scan_http');
    const oldResponse = store.one(
      'SELECT response FROM full_scan_responses WHERE task_id=?',
      target.id,
    )!.response;
    const historyBefore = store.listEnrichmentHistory(app.id, 'developer').total;
    const originalHistory = store.all(
      "SELECT * FROM enrichment_history WHERE app_id=? AND kind='developer' ORDER BY id",
      app.id,
    );
    assert.equal(
      runner.retryDeveloperWarnings(),
      1,
      'only the task whose latest continuation is repairable is requeued',
    );
    assert.deepEqual(
      store.all(
        'SELECT id,status,stop_reason,response,result,attempts FROM full_scan_tasks WHERE id<>? ORDER BY id',
        target.id,
      ),
      before,
    );
    recovered = true;
    assert.equal(await runner.runOnce(), true);
    assert.equal(await runner.runOnce(), false);
    const result = store.one('SELECT * FROM full_scan_tasks WHERE id=?', target.id)!;
    assert.equal(result.status, 'succeeded');
    assert.equal(result.stop_reason, null);
    assert.equal(
      store.one('SELECT COUNT(*) n FROM full_scan_responses WHERE task_id=?', target.id)!.n,
      2,
    );
    assert.equal(
      store.one('SELECT COUNT(*) n FROM full_scan_attempts WHERE task_id=?', target.id)!.n,
      2,
    );
    assert.equal(
      store.one(
        'SELECT response FROM full_scan_responses WHERE task_id=? ORDER BY id LIMIT 1',
        target.id,
      )!.response,
      oldResponse,
    );
    assert.equal(store.listEnrichmentHistory(app.id, 'developer').total, historyBefore + 1);
    assert.deepEqual(
      store.all(
        "SELECT * FROM enrichment_history WHERE app_id=? AND kind='developer' ORDER BY id LIMIT ?",
        app.id,
        historyBefore,
      ),
      originalHistory,
    );
    assert.equal(
      (store.listEnrichments(app.id).find((item) => item.kind === 'developer')!.data as any[])
        .length,
      33,
    );
    assert.deepEqual(store.all('SELECT * FROM full_scan_http'), originalHttp);
    assert.equal(runner.summary().failures, 2);
    assert.ok(
      runner.summary().warnings > 0,
      'unrelated search/review warnings still require review',
    );
  } finally {
    store.close();
  }
});

test('FS-AC-07/09 / #13: an explicit developer recovery has a finite retry budget and preserves the previous successful directory on failure', async () => {
  const store = createStore();
  let failRecovery = false;
  let recoveryCalls = 0;
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'ar',
      externalId: 'fixture.finite-directory',
    });
    const provider: ScanProvider = {
      app: async (input) => ({
        externalId: input.externalId,
        title: 'Synthetic parent',
        developerId: '123456789',
      }),
      list: async () => ({ data: [], raw: [], source: 'https://example.invalid/list' }),
      search: async () => ({ data: [], raw: [], source: 'https://example.invalid/search' }),
      reviewsPage: async () => ({ data: [], raw: [], source: 'https://example.invalid/reviews' }),
      enrich: async (input) => {
        if (input.kind !== 'developer')
          return {
            status: 'unsupported',
            data: null,
            raw: null,
            source: 'https://example.invalid/' + input.kind,
            requestCountry: input.country,
            requestLanguage: input.language,
          };
        if (failRecovery) {
          recoveryCalls++;
          throw new Error('Synthetic recovery failure');
        }
        const data = [{ appId: 'fixture.preserved-directory-entry' }];
        return {
          status: 'available',
          data,
          raw: { data, warnings: [{ context: 'developer', reason: 'cluster-page-parse' }] },
          source: 'https://example.invalid/developer',
          requestCountry: input.country,
          requestLanguage: input.language,
        };
      },
    };
    const runner = createFullScanRunner({
      store,
      providers: { 'google-play': provider, 'app-store': provider },
      config: {
        countries: ['ar'],
        stores: ['google-play'],
        collections: { 'google-play': [], 'app-store': [] },
        includeSearch: false,
        maxAttempts: 2,
        retryDelayMs: 0,
      },
    });
    runner.seed();
    while (await runner.runOnce()) {}
    const target = store.one(
      "SELECT * FROM full_scan_tasks WHERE batch_id=? AND stop_reason='developer-degraded'",
      runner.batchId,
    )!;
    store.run(
      'INSERT INTO full_scan_http(batch_id,task_id,fetched_at,url,method,status,content_type,body,error) VALUES (?,?,?,?,?,?,?,?,?)',
      runner.batchId,
      target.id,
      target.response_at,
      'https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=qnKhOb&gl=ar&hl=es',
      'POST',
      200,
      'application/json',
      continuation('compact'),
      null,
    );
    const before = store.listEnrichments(app.id).find((item) => item.kind === 'developer')!;
    assert.equal(runner.retryDeveloperWarnings(), 1);
    failRecovery = true;
    while (await runner.runOnce()) {}
    const after = store.listEnrichments(app.id).find((item) => item.kind === 'developer')!;
    assert.equal(recoveryCalls, 2);
    assert.equal(after.status, 'failed');
    assert.deepEqual(after.data, before.data);
    assert.equal(after.lastSuccessAt, before.lastSuccessAt);
    assert.equal(
      store.one('SELECT status FROM full_scan_tasks WHERE id=?', target.id)!.status,
      'failed',
    );
    assert.deepEqual(
      store
        .all('SELECT attempt FROM full_scan_attempts WHERE task_id=? ORDER BY id', target.id)
        .map((row) => row.attempt),
      [1, 2, 3],
    );
    assert.equal(
      store.one('SELECT COUNT(*) n FROM full_scan_responses WHERE task_id=?', target.id)!.n,
      1,
    );
    assert.equal(runner.summary().pending, 0);
    assert.equal(runner.summary().failures, 1);
  } finally {
    store.close();
  }
});

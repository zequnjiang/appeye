import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFullScanProviders,
  ScanSourceError,
  type ScanTransportRecord,
} from '../server/full-scan-providers.js';
import { normalizeRelatedContinuation } from '../server/related-continuation.js';
import { createDiscoveryRunner } from '../server/extended-discovery.js';
import { hourlyStore, hourlyData, hourlyProviders } from './hourly-fixtures.js';

function setPath(root: any[], path: number[], value: unknown) {
  let current = root;
  for (const index of path.slice(0, -1)) current = current[index] ??= [];
  current[path.at(-1)!] = value;
}
function item(index: number, initial = false) {
  const row: any[] = [];
  if (initial) {
    setPath(row, [0, 0], `fixture.related.${index}`);
    row[3] = `Synthetic Related ${index}`;
    setPath(row, [1, 3, 2], 'https://example.invalid/icon.png');
    setPath(row, [10, 4, 2], `/store/apps/details?id=fixture.related.${index}`);
    row[14] = 'Synthetic Publisher';
  } else {
    setPath(row, [12, 0], `fixture.related.${index}`);
    row[2] = `Synthetic Related ${index}`;
    setPath(row, [1, 1, 0, 3, 2], 'https://example.invalid/icon.png');
    setPath(row, [9, 4, 2], `/store/apps/details?id=fixture.related.${index}`);
    setPath(row, [4, 0, 0, 0], 'Synthetic Publisher');
  }
  return row;
}
function html(key: string, data: any[], rpc?: string) {
  return (
    (rpc
      ? `<script>; var AF_dataServiceRequests = {'${key}': {id: '${rpc}'}}; var AF_initDataChunkQueue=[];</script>`
      : '') +
    `<script>AF_initDataCallback({key: '${key}', hash: 'fixture', data:${JSON.stringify(data)}, sideChannel: {}});</script>`
  );
}
function seedPage() {
  const data: any[] = [],
    cluster: any[] = [];
  setPath(cluster, [21, 1, 0], 'Similar apps');
  setPath(cluster, [21, 1, 2, 4, 2], '/store/apps/collection/cluster?gsr=synthetic');
  setPath(data, [1, 1], [cluster]);
  return html('ds:1', data, 'ag2B9c');
}
function clusterPage(count = 50, token = 'next-token') {
  const data: any[] = [];
  setPath(
    data,
    [0, 1, 0, 21, 0],
    Array.from({ length: count }, (_, i) => item(i + 1, true)),
  );
  setPath(data, [0, 1, 0, 21, 1, 3, 1], token);
  return html('ds:3', data);
}
function continuation(count = 13, tokenContainer: any = null, first = 51, error: any = null) {
  const data: any[] = [];
  setPath(
    data,
    [0, 0, 0],
    Array.from({ length: count }, (_, i) => item(first + i)),
  );
  setPath(data, [0, 0, 7], tokenContainer);
  const frames = JSON.stringify([['wrb.fr', 'qnKhOb', JSON.stringify(data), null, null, error]]);
  return `)]}'\n${frames.length}\n${frames}\n`;
}
const input = { externalId: 'fixture.parent', country: 'ar', language: 'es' };
function replay(bodies: string[], beforeRequest?: () => void) {
  const records: ScanTransportRecord[] = [];
  let requests = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    beforeRequest,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.searchParams.get('gl'), 'ar');
      assert.equal(parsed.searchParams.get('hl'), requests === 0 ? 'en' : 'es');
      assert.ok(requests < bodies.length, 'SDK must not invent another continuation request');
      return new Response(bodies[requests++]);
    },
    onResponse: (r) => {
      records.push(r);
      return records.length;
    },
  });
  return { provider: providers['google-play'], records, requests: () => requests };
}

test('OI24-01: null token-container input is normalized without changing rows, enclosing fields or original bytes', () => {
  const original = continuation();
  const result = normalizeRelatedContinuation(original);
  assert.deepEqual(result.adaptation, {
    kind: 'related-null-token-container',
    apps: 13,
    path: '0.0.7',
    originalValue: null,
    sdkValue: [null, null],
  });
  const before = JSON.parse(JSON.parse(original.split('\n')[2])[0][2]);
  const after = JSON.parse(JSON.parse(result.body)[0][2]);
  before[0][0][7] = [null, null];
  assert.deepEqual(after, before);
  assert.equal(original, continuation());
});

for (const count of [48, 13, 26, 60, 2]) {
  test(`OI24-01: installed SDK preserves first 50 plus ${count} null-container continuation rows within 100-item result boundary`, async () => {
    const bodies = [seedPage(), clusterPage(), continuation(count)];
    const harness = replay(bodies);
    const result = await harness.provider.related!(input);
    assert.equal(result.data.length, Math.min(50 + count, 100));
    assert.equal(new Set(result.data.map((r) => r.externalId)).size, result.data.length);
    assert.equal(result.stopReason, count >= 50 ? 'sdk-related-result-limit' : 'sdk-related-ended');
    assert.deepEqual(result.warnings, []);
    assert.equal((result.compatibility?.[0] as any).sourceHttpId, 3);
    assert.equal((result.compatibility?.[0] as any).sourceFetchedAt, harness.records[2].fetchedAt);
    assert.deepEqual(
      harness.records.map((r) => r.body),
      bodies,
    );
    assert.equal(harness.requests(), 3);
  });
}

test('OI24-01: existing token tuples, missing token container, wrong RPC and malformed rows are untouched', () => {
  const malformed = continuation().replace('fixture.related.51', 'different.identity');
  const cases = [
    continuation(13, [null, null]),
    continuation(13, [null, 'next']),
    continuation().replace('qnKhOb', 'UsvDTd'),
    malformed,
    '<html>error</html>',
  ];
  for (const body of cases) assert.deepEqual(normalizeRelatedContinuation(body), { body });
});

test('OI24-01/02: source errors and ambiguous RPC frames remain failures with first-page partial results', async () => {
  const sourceError = [
    5,
    null,
    [['type.googleapis.com/wireless.android.finsky.boq.web.data.store.error.PlayDataError', [1]]],
  ];
  const rejected = continuation(13, null, 51, sourceError);
  assert.equal(normalizeRelatedContinuation(rejected).body, rejected);
  assert.equal(normalizeRelatedContinuation(rejected).warning?.reason, 'related-source-error');
  const frame = JSON.parse(continuation().split('\n')[2])[0];
  const ambiguous = JSON.stringify([frame, frame]);
  assert.equal(normalizeRelatedContinuation(ambiguous).warning?.reason, 'related-ambiguous-rpc');
  for (const body of [rejected, ambiguous, '<html>Unknown layout</html>']) {
    const harness = replay([seedPage(), clusterPage(), body]);
    await assert.rejects(harness.provider.related!(input), (error) => {
      assert.ok(error instanceof ScanSourceError);
      assert.equal(error.partial?.data.length, 50);
      assert.ok(error.partial?.warnings?.length);
      return true;
    });
    assert.equal(harness.records[2].body, body);
  }
});

test('OI24-02: valid continued pages and repeated token warning remain distinct from null-container recovery', async () => {
  const harness = replay([seedPage(), clusterPage(), continuation(10, [null, 'next-token'])]);
  await assert.rejects(harness.provider.related!(input), (error) => {
    assert.ok(error instanceof ScanSourceError);
    assert.equal(error.partial?.data.length, 60);
    assert.equal(error.partial?.compatibility?.length, 0);
    assert.ok(
      error.partial?.warnings?.some((warning: any) => warning.reason === 'pagination-token-cycle'),
    );
    return true;
  });
  assert.equal(harness.requests(), 3);
});

test('OI24-02: repeated app identities emit once while all raw page bytes remain retained', async () => {
  const bodies = [seedPage(), clusterPage(), continuation(13, null, 45)];
  const harness = replay(bodies);
  const seen: string[] = [];
  const result = await harness.provider.related!({
    ...input,
    onItem: (data) => {
      seen.push(data.externalId);
    },
  });
  assert.equal(
    result.raw instanceof Array && result.raw.length,
    63,
    'SDK raw sequence remains unmodified',
  );
  assert.equal(seen.length, 57);
  assert.equal(new Set(seen).size, 57);
  assert.deepEqual(
    harness.records.map((r) => r.body),
    bodies,
  );
});

test('OI24-02: streamed rows retain their own real HTTP time and asynchronous persistence is awaited', async () => {
  const harness = replay([seedPage(), clusterPage(), continuation()]);
  const times = new Map<string, string | undefined>();
  await harness.provider.related!({
    ...input,
    onItem: async (data, _source, observedAt) => {
      await Promise.resolve();
      times.set(data.externalId, observedAt);
    },
  });
  assert.equal(times.size, 63);
  assert.equal(times.get('fixture.related.1'), harness.records[1].fetchedAt);
  assert.equal(times.get('fixture.related.50'), harness.records[1].fetchedAt);
  assert.equal(times.get('fixture.related.51'), harness.records[2].fetchedAt);
  const failed = replay([seedPage(), clusterPage(), continuation()]);
  const error = new Error('Synthetic persistence rejection');
  await assert.rejects(
    failed.provider.related!({
      ...input,
      onItem: async () => {
        throw error;
      },
    }),
    (caught) => caught === error,
  );
  assert.equal(failed.requests(), 2, 'persistence failure prevents the next network request');
});

for (const scenario of ['budget', 'timeout'] as const) {
  test(`OI24-02: real runner keeps first 50 candidates when related continuation hits ${scenario}`, async () => {
    const store = hourlyStore();
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: input.externalId,
      data: hourlyData(input.externalId),
    });
    store.updateClassification(app.id, 'confirmed');
    const records: ScanTransportRecord[] = [];
    let runner: ReturnType<typeof createDiscoveryRunner>,
      requests = 0;
    const actual = createFullScanProviders({
      requestDelayMs: 0,
      beforeRequest: () => runner.captureRequestBudget()(),
      onResponse: (record) => {
        records.push(record);
        return runner.captureHttpRecorder()(record);
      },
      fetchImpl: async (_url, init) => {
        requests++;
        if (requests === 1) return new Response(seedPage());
        if (requests === 2) return new Response(clusterPage());
        if (scenario === 'budget') throw new Error('Budget check must deny the third request');
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        });
      },
    });
    const providers = hourlyProviders();
    providers['google-play'].related = actual['google-play'].related;
    runner = createDiscoveryRunner({
      store,
      providers,
      sourceRequests: scenario === 'budget' ? 2 : 3,
      timeoutMs: scenario === 'timeout' ? 40 : 1000,
    });
    runner.schedule();
    store.run("UPDATE discovery_tasks SET status='unsupported' WHERE kind<>'similar'");
    try {
      assert.equal(await runner.runOnce(), true);
      assert.equal(
        store.one("SELECT COUNT(*) n FROM discovery_sources WHERE kind='similar'")!.n,
        50,
      );
      assert.equal(store.one('SELECT COUNT(*) n FROM discovery_candidates')!.n, 50);
      assert.equal(
        store.one("SELECT status FROM discovery_tasks WHERE kind='similar'")!.status,
        'deferred',
      );
      assert.equal(
        store.one("SELECT COUNT(*) n FROM discovery_tasks WHERE kind='detail' AND status='queued'")!
          .n,
        50,
      );
      assert.equal(requests, scenario === 'budget' ? 2 : 3);
      assert.equal(
        store.one(
          "SELECT source_requests FROM discovery_markets WHERE country='th' AND store='google-play'",
        )!.source_requests,
        requests,
      );
      assert.equal(records[0].body, seedPage());
      assert.equal(records[1].body, clusterPage());
      assert.equal(
        store.one("SELECT MIN(observed_at) stamp FROM discovery_sources WHERE kind='similar'")!
          .stamp,
        records[1].fetchedAt,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      runner.stop();
      store.close();
    }
  });
}

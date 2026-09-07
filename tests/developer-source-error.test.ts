import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createFullScanRunner } from '../server/full-scan.js';
import { createFullScanProviders, type ScanProvider } from '../server/full-scan-providers.js';
import { parseDeveloperSourceError } from '../server/developer-continuation.js';

const errorType =
  'type.googleapis.com/wireless.android.finsky.boq.web.data.store.error.PlayDataError';
function sourceError(
  options: {
    rpc?: string;
    code?: unknown;
    type?: string;
    payload?: unknown;
    duplicate?: boolean;
  } = {},
) {
  const frame = [
    'wrb.fr',
    options.rpc ?? 'qnKhOb',
    options.payload ?? null,
    null,
    null,
    [options.code ?? 5, null, [[options.type ?? errorType, [1]]]],
    'generic',
  ];
  const frames = JSON.stringify(options.duplicate ? [frame, frame] : [frame]);
  return `)]}'\n${frames.length}\n${frames}\n`;
}
const sourceUrl =
  'https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=qnKhOb&gl=id&hl=id';
function setPath(root: any[], path: number[], value: unknown) {
  let current = root;
  for (const index of path.slice(0, -1)) current = current[index] ??= [];
  current[path.at(-1)!] = value;
}
function initialHtml() {
  const data: any[] = [];
  const items = Array.from({ length: 10 }, (_, index) => {
    const item: any[] = [];
    setPath(item, [0, 0], 'fixture.partial.' + index);
    item[3] = 'Synthetic partial directory ' + index;
    setPath(item, [1, 3, 2], 'https://example.invalid/icon.png');
    setPath(item, [10, 4, 2], '/store/apps/details?id=fixture.partial.' + index);
    item[14] = 'Synthetic Publisher';
    return item;
  });
  const root: any[] = [items];
  setPath(root, [1, 3, 1], 'synthetic-public-next-token');
  setPath(data, [0, 1, 0, 21], root);
  return `<script>AF_initDataCallback({key: 'ds:3', hash: 'fixture', data:${JSON.stringify(data)}, sideChannel: {}});</script>`;
}

test('FS-DR-01: only a single qnKhOb null payload with numeric PlayDataError code 5 is recognized', () => {
  assert.deepEqual(parseDeveloperSourceError(sourceError()), { code: 5, type: errorType });
  for (const body of [
    sourceError({ rpc: 'other' }),
    sourceError({ code: 4 }),
    sourceError({ code: '5' }),
    sourceError({ type: 'OtherError' }),
    sourceError({ payload: '[]' }),
    sourceError({ duplicate: true }),
    'bad JSON',
    '[]',
    JSON.stringify([['wrb.fr', 'qnKhOb', null]]),
  ])
    assert.equal(parseDeveloperSourceError(body), null);
});

test('FS-DR-03: installed SDK preserves the 10 partial entries and explicit warning after a real-shaped source error; original HTTP is retained', async () => {
  const bodies = [initialHtml(), sourceError()],
    recorded: any[] = [];
  let calls = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.searchParams.get('gl'), 'id');
      assert.equal(url.searchParams.get('hl'), 'id');
      assert.ok(calls < 2, 'a source rejection must not automatically loop');
      return new Response(bodies[calls++]);
    },
    onResponse: (record) => {
      recorded.push(record);
      return recorded.length;
    },
  });
  const result = await providers['google-play'].enrich({
    externalId: 'fixture.parent',
    developerId: '123456789',
    country: 'id',
    language: 'id',
    kind: 'developer',
  });
  assert.equal(result.status, 'available');
  assert.equal((result.data as any[]).length, 10);
  assert.ok(
    (result.raw as any).warnings.some(
      (warning: any) => warning.context === 'developer' && warning.reason === 'cluster-page-parse',
    ),
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    recorded.map((record) => record.body),
    bodies,
  );
});

async function harness(batchId = 'source-error-fixture') {
  const store = createStore();
  const app = store.createApp({
    store: 'google-play',
    country: 'id',
    externalId: 'fixture.source-error',
  });
  let mode: 'partial' | 'complete' | 'network' | 'interrupt' = 'partial';
  let runner: ReturnType<typeof createFullScanRunner>;
  let active: (() => void) | undefined;
  const provider: ScanProvider = {
    list: async () => ({ data: [], raw: [], source: 'https://example.invalid/list' }),
    search: async () => ({ data: [], raw: [], source: 'https://example.invalid/search' }),
    reviewsPage: async () => ({ data: [], raw: [], source: 'https://example.invalid/reviews' }),
    app: async () => ({
      externalId: app.externalId,
      title: 'Synthetic source error parent',
      developerId: '123456789',
    }),
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
      if (mode === 'interrupt') {
        active?.();
        await new Promise((_, reject) =>
          input.signal!.addEventListener('abort', () => reject(input.signal!.reason), {
            once: true,
          }),
        );
      }
      if (mode === 'network') throw new Error('Synthetic recoverable transport failure');
      const data = Array.from({ length: mode === 'complete' ? 13 : 10 }, (_, index) => ({
        appId: 'fixture.source-entry.' + index,
      }));
      runner.recordHttp({
        url: sourceUrl,
        method: 'POST',
        status: 200,
        fetchedAt: new Date().toISOString(),
        contentType: 'application/json',
        body:
          mode === 'complete'
            ? JSON.stringify({ synthetic: 'complete directory response' })
            : sourceError(),
        error: null,
      });
      return {
        status: 'available',
        data,
        raw: {
          data,
          warnings:
            mode === 'complete' ? [] : [{ context: 'developer', reason: 'cluster-page-parse' }],
        },
        source: 'https://play.google.com/store/apps/dev?id=123456789&gl=id&hl=id',
        requestCountry: input.country,
        requestLanguage: input.language,
      };
    },
  };
  const options = {
    store,
    providers: { 'google-play': provider, 'app-store': provider },
    batchId,
    config: {
      countries: ['id'],
      stores: ['google-play' as const],
      collections: { 'google-play': [], 'app-store': [] },
      includeSearch: false,
      retryDelayMs: 0,
      maxAttempts: 3,
    },
  };
  runner = createFullScanRunner(options);
  runner.seed();
  while (await runner.runOnce()) {}
  const task = () =>
    store.one(
      "SELECT * FROM full_scan_tasks WHERE batch_id=? AND kind='enrich' AND json_extract(payload,'$.kind')='developer'",
      batchId,
    )!;
  return {
    store,
    app,
    task,
    get runner() {
      return runner;
    },
    setMode: (value: typeof mode) => {
      mode = value;
    },
    restart: () => {
      runner = createFullScanRunner(options);
      runner.recover();
    },
    waitActive: () =>
      new Promise<void>((resolve) => {
        active = resolve;
      }),
  };
}

test('FS-DR-01/02: new recovery strictly filters task, warning, latest HTTP, batch and locale; the existing layout-retry switch excludes code 5', async () => {
  for (const condition of [
    'valid',
    'other-batch',
    'apple',
    'wrong-kind',
    'failed',
    'other-warning',
    'bad-code',
    'latest-unknown',
    'http404',
    'foreign',
    'wrong-country',
    'wrong-language',
    'duplicate-rpc',
  ] as const) {
    const h = await harness();
    try {
      const task = h.task();
      if (condition === 'other-batch') {
        h.store.run(
          "INSERT INTO full_scan_runs(id,config,status,created_at,updated_at,coverage) SELECT 'unrelated-batch',config,status,created_at,updated_at,coverage FROM full_scan_runs WHERE id=?",
          task.batch_id,
        );
        h.store.run('UPDATE full_scan_tasks SET batch_id=? WHERE id=?', 'unrelated-batch', task.id);
      }
      if (condition === 'apple')
        h.store.run("UPDATE full_scan_tasks SET store='app-store' WHERE id=?", task.id);
      if (condition === 'wrong-kind')
        h.store.run(
          "UPDATE full_scan_tasks SET payload=json_set(payload,'$.kind','privacy') WHERE id=?",
          task.id,
        );
      if (condition === 'failed')
        h.store.run("UPDATE full_scan_tasks SET status='failed' WHERE id=?", task.id);
      if (condition === 'other-warning')
        h.store.run(
          "UPDATE full_scan_tasks SET response=json_set(response,'$.raw.warnings',json(?)) WHERE id=?",
          JSON.stringify([{ context: 'reviews', reason: 'cluster-page-parse' }]),
          task.id,
        );
      const row = h.store.one('SELECT * FROM full_scan_http WHERE task_id=?', task.id)!;
      if (condition === 'bad-code')
        h.store.run(
          'UPDATE full_scan_http SET body=? WHERE id=?',
          sourceError({ code: 4 }),
          row.id,
        );
      if (condition === 'latest-unknown')
        h.store.run(
          'INSERT INTO full_scan_http(batch_id,task_id,fetched_at,url,method,status,body) VALUES (?,?,?,?,?,?,?)',
          task.batch_id,
          task.id,
          new Date().toISOString(),
          sourceUrl,
          'POST',
          200,
          'unknown latest response',
        );
      if (condition === 'http404')
        h.store.run('UPDATE full_scan_http SET status=404 WHERE id=?', row.id);
      if (['foreign', 'wrong-country', 'wrong-language', 'duplicate-rpc'].includes(condition)) {
        const url = new URL(sourceUrl);
        if (condition === 'foreign') url.hostname = 'evil.invalid';
        if (condition === 'wrong-country') url.searchParams.set('gl', 'ph');
        if (condition === 'wrong-language') url.searchParams.set('hl', 'en');
        if (condition === 'duplicate-rpc') url.searchParams.append('rpcids', 'qnKhOb');
        h.store.run('UPDATE full_scan_http SET url=? WHERE id=?', url.toString(), row.id);
      }
      assert.equal(h.runner.retryDeveloperWarnings(), 0, condition);
      assert.equal(h.runner.retryDeveloperSourceErrors(), condition === 'valid' ? 1 : 0, condition);
      assert.equal(h.runner.retryDeveloperSourceErrors(), 0, 'repeated switch must be idempotent');
    } finally {
      h.store.close();
    }
  }
});

for (const mode of ['partial', 'complete'] as const) {
  test(`FS-DR-02/03/04: ${mode} recovery appends history and retains the original response/HTTP, provenance and one-round marker`, async () => {
    const h = await harness();
    try {
      const task = h.task(),
        oldHistory = h.store.all(
          "SELECT * FROM enrichment_history WHERE app_id=? AND kind='developer'",
          h.app.id,
        ),
        oldHttp = h.store.all('SELECT * FROM full_scan_http WHERE task_id=?', task.id),
        oldResponse = task.response;
      assert.equal(h.runner.retryDeveloperSourceErrors(), 1);
      const marker = JSON.parse(h.task().payload).developerSourceErrorRecovery;
      assert.equal(marker.reason, 'google-play-developer-rpc-5');
      assert.equal(marker.sourceHttpId, oldHttp[0].id);
      assert.equal(marker.previousResponseAt, task.response_at);
      assert.equal(marker.round, 1);
      assert.ok(Number.isFinite(Date.parse(marker.queuedAt)));
      h.setMode(mode);
      while (await h.runner.runOnce()) {}
      const after = h.task();
      assert.equal(after.status, 'succeeded');
      assert.equal(after.attempts, 2);
      assert.equal(after.stop_reason, mode === 'partial' ? 'developer-degraded' : null);
      assert.equal(h.runner.retryDeveloperSourceErrors(), 0);
      assert.equal(h.runner.retryDeveloperWarnings(), 0);
      assert.equal(JSON.parse(after.response).data.length, mode === 'partial' ? 10 : 13);
      assert.equal(
        h.store.one('SELECT COUNT(*) n FROM full_scan_responses WHERE task_id=?', task.id)!.n,
        2,
      );
      assert.equal(
        h.store.one(
          'SELECT response FROM full_scan_responses WHERE task_id=? ORDER BY id LIMIT 1',
          task.id,
        )!.response,
        oldResponse,
      );
      assert.deepEqual(
        h.store.all('SELECT * FROM full_scan_http WHERE task_id=? ORDER BY id LIMIT 1', task.id),
        oldHttp,
      );
      assert.deepEqual(
        h.store.all(
          "SELECT * FROM enrichment_history WHERE app_id=? AND kind='developer' ORDER BY id LIMIT 1",
          h.app.id,
        ),
        oldHistory,
      );
      assert.equal(h.store.listEnrichmentHistory(h.app.id, 'developer').total, 2);
      assert.equal(h.runner.summary().status, mode === 'partial' ? 'needs-review' : 'completed');
    } finally {
      h.store.close();
    }
  });
}

test('FS-DR-04/05 / #15: same-millisecond fresh attempts with identical or changed data append distinct enrichment history', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-07T01:00:00Z') });
  for (const mode of ['partial', 'complete'] as const) {
    const h = await harness();
    try {
      assert.equal(h.runner.retryDeveloperSourceErrors(), 1);
      h.setMode(mode);
      while (await h.runner.runOnce()) {}
      assert.equal(h.store.listEnrichmentHistory(h.app.id, 'developer').total, 2);
      assert.equal(
        (h.store.listEnrichments(h.app.id).find((row) => row.kind === 'developer')!.data as any[])
          .length,
        mode === 'partial' ? 10 : 13,
      );
    } finally {
      h.store.close();
    }
  }
});

test('#15: recovery replays one already-applied durable response without duplicate history, response row, HTTP or new fetch', async () => {
  const h = await harness();
  try {
    const task = h.task(),
      history = h.store.listEnrichmentHistory(h.app.id, 'developer');
    h.store.run("UPDATE full_scan_tasks SET status='running' WHERE id=?", task.id);
    h.setMode('network');
    h.restart();
    while (await h.runner.runOnce()) {}
    assert.equal(h.task().status, 'succeeded');
    assert.equal(h.task().response_at, task.response_at);
    assert.deepEqual(h.store.listEnrichmentHistory(h.app.id, 'developer'), history);
    assert.equal(
      h.store.one('SELECT COUNT(*) n FROM full_scan_responses WHERE task_id=?', task.id)!.n,
      1,
    );
    assert.equal(
      h.store.one('SELECT COUNT(*) n FROM full_scan_http WHERE task_id=?', task.id)!.n,
      1,
    );
  } finally {
    h.store.close();
  }
});

test('#15: failure while storing the applied-response marker rolls back both new enrichment data and history atomically', async () => {
  const h = await harness();
  try {
    const task = h.task(),
      history = h.store.listEnrichmentHistory(h.app.id, 'developer'),
      current = h.store.listEnrichments(h.app.id);
    assert.throws(
      () =>
        h.store.saveEnrichment(
          h.app.id,
          'developer',
          {
            status: 'available',
            data: [{ appId: 'fixture.changed' }],
            raw: { newValue: true },
            source: 'https://example.invalid/new-source',
            requestCountry: 'id',
            requestLanguage: 'id',
          },
          new Date().toISOString(),
          () => {
            h.store.run(
              'UPDATE full_scan_tasks SET result=? WHERE id=?',
              JSON.stringify({ syntheticMarker: true }),
              task.id,
            );
            throw new Error('Synthetic interrupted transaction');
          },
        ),
      /Synthetic interrupted transaction/,
    );
    assert.deepEqual(h.store.listEnrichments(h.app.id), current);
    assert.deepEqual(h.store.listEnrichmentHistory(h.app.id, 'developer'), history);
    assert.equal(h.task().result, task.result);
  } finally {
    h.store.close();
  }
});

test('FS-DR-03/04: three recovery network failures retain the original successful partial data and time', async () => {
  const h = await harness();
  try {
    const before = h.store.listEnrichments(h.app.id).find((row) => row.kind === 'developer')!;
    assert.equal(h.runner.retryDeveloperSourceErrors(), 1);
    h.setMode('network');
    let runs = 0;
    while (await h.runner.runOnce()) assert.ok(++runs <= 3);
    assert.equal(runs, 3);
    assert.equal(h.task().status, 'failed');
    assert.equal(h.task().attempts, 4);
    const after = h.store.listEnrichments(h.app.id).find((row) => row.kind === 'developer')!;
    assert.equal(after.status, 'failed');
    assert.deepEqual(after.data, before.data);
    assert.deepEqual(after.raw, before.raw);
    assert.equal(after.lastSuccessAt, before.lastSuccessAt);
    assert.equal(h.runner.retryDeveloperSourceErrors(), 0);
    assert.equal(h.runner.summary().failures, 1);
  } finally {
    h.store.close();
  }
});

test('FS-DR-02/04: interrupted explicit recovery resumes its existing round after restart, without resetting marker or past attempts', async () => {
  const h = await harness();
  try {
    assert.equal(h.runner.retryDeveloperSourceErrors(), 1);
    const marker = JSON.parse(h.task().payload).developerSourceErrorRecovery;
    h.setMode('interrupt');
    const active = h.waitActive();
    const running = h.runner.runOnce();
    await active;
    h.runner.pause();
    await running;
    assert.equal(h.task().status, 'queued');
    h.setMode('partial');
    h.restart();
    assert.equal(h.runner.retryDeveloperSourceErrors(), 0);
    while (await h.runner.runOnce()) {}
    assert.equal(h.task().status, 'succeeded');
    assert.equal(h.task().stop_reason, 'developer-degraded');
    assert.deepEqual(JSON.parse(h.task().payload).developerSourceErrorRecovery, marker);
    assert.deepEqual(
      h.store
        .all(
          'SELECT attempt,status FROM full_scan_attempts WHERE task_id=? ORDER BY id',
          h.task().id,
        )
        .map((row) => ({ ...row })),
      [
        { attempt: 1, status: 'succeeded' },
        { attempt: 2, status: 'interrupted' },
        { attempt: 3, status: 'succeeded' },
      ],
    );
  } finally {
    h.store.close();
  }
});

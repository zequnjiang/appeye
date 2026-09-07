import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createFullScanRunner } from '../server/full-scan.js';
import { createFullScanProviders, type ScanProvider } from '../server/full-scan-providers.js';
import {
  decodeGoogleDeveloperId,
  resolveGoogleDeveloperListingLink,
  googleDeveloperRequestUrl,
} from '../server/developer-route.js';

const developerId = '059916517';
const listingLink = `https://play.google.com/store/apps/developer?id=${developerId}`;
const listingHtml = `<a href="/store/apps/developer?id=${developerId}&amp;gl=us&amp;hl=fr">Synthetic publisher</a>`;
const context = {
  externalId: 'fixture.numeric.publisher',
  country: 'ph',
  language: 'en',
  developerId,
  kind: 'developer' as const,
};
function setPath(root: any[], path: number[], value: unknown) {
  let current = root;
  for (const index of path.slice(0, -1)) current = current[index] ??= [];
  current[path.at(-1)!] = value;
}
function directoryHtml(layout: 'name' | 'profile') {
  const item: any[] = [],
    data: any[] = [];
  setPath(item, [0, 0], 'fixture.numeric.publisher');
  item[3] = 'Synthetic numeric publisher app';
  setPath(item, [1, 3, 2], 'https://example.invalid/icon.png');
  setPath(item, [10, 4, 2], '/store/apps/details?id=fixture.numeric.publisher');
  item[14] = developerId;
  setPath(data, [0, 1, 0, layout === 'name' ? 22 : 21], [[layout === 'name' ? [item] : item]]);
  return `<script>AF_initDataCallback({key: 'ds:3', hash: 'fixture', data:${JSON.stringify(data)}, sideChannel: {}});</script>`;
}

test('#14: official listing links preserve a numeric display name and ignore link locale in favor of the frozen request context', () => {
  assert.equal(resolveGoogleDeveloperListingLink(listingHtml, developerId), listingLink);
  assert.equal(
    resolveGoogleDeveloperListingLink(listingHtml + listingHtml, developerId),
    listingLink,
  );
  const request = new URL(
    googleDeveloperRequestUrl(listingLink + '&gl=us&hl=fr', developerId, 'ph', 'en')!,
  );
  assert.equal(request.pathname, '/store/apps/developer');
  assert.equal(request.searchParams.get('id'), '059916517');
  assert.equal(request.searchParams.get('gl'), 'ph');
  assert.equal(request.searchParams.get('hl'), 'en');
});

test('#14: external, ambiguous, wrong-identity and malformed links cannot become verified listing evidence', () => {
  const invalid = [
    `https://evil.invalid/store/apps/developer?id=${developerId}`,
    `http://play.google.com/store/apps/developer?id=${developerId}`,
    `https://play.google.com:444/store/apps/developer?id=${developerId}`,
    `https://user@play.google.com/store/apps/developer?id=${developerId}`,
    `/store/apps/developer?id=59916517`,
    `/store/apps/developer?id=${developerId}&id=${developerId}`,
    `/store/apps/developer?id=${developerId}#other`,
    `/store/apps/details?id=${developerId}`,
  ];
  for (const url of invalid) {
    assert.equal(
      resolveGoogleDeveloperListingLink(`<a href="${url}">publisher</a>`, developerId),
      null,
    );
    assert.equal(googleDeveloperRequestUrl(url, developerId, 'ph', 'en'), null);
  }
  assert.equal(
    resolveGoogleDeveloperListingLink(
      `${listingHtml}<a href="/store/apps/dev?id=${developerId}">conflict</a>`,
      developerId,
    ),
    null,
  );
  assert.equal(
    resolveGoogleDeveloperListingLink(`<script>const link='${listingLink}';</script>`, developerId),
    null,
  );
  assert.equal(googleDeveloperRequestUrl(undefined, developerId, 'ph', 'en'), null);
});

test('#14: encoded names are decoded once and literal plus signs and percent escapes retain their identity', () => {
  assert.equal(decodeGoogleDeveloperId('TEXTME+COMPANY+LIMITED'), 'TEXTME COMPANY LIMITED');
  assert.equal(decodeGoogleDeveloperId('Name%2BStudio'), 'Name+Studio');
  assert.equal(decodeGoogleDeveloperId('Name%252BStudio'), 'Name%2BStudio');
  for (const id of ['Name+Studio', 'Name%2BStudio', developerId]) {
    const link = `/store/apps/developer?${new URLSearchParams({ id })}`;
    const resolved = resolveGoogleDeveloperListingLink(`<a href="${link}">publisher</a>`, id);
    assert.ok(resolved);
    assert.equal(
      new URL(googleDeveloperRequestUrl(resolved, id, 'mx', 'es')!).searchParams.get('id'),
      id,
    );
  }
});

for (const layout of ['name', 'profile'] as const) {
  test(`#14: installed SDK uses verified ${layout} route without changing numeric ID, country, language or original HTTP`, async () => {
    const path = layout === 'name' ? 'developer' : 'dev';
    const body = directoryHtml(layout),
      records: any[] = [],
      requests: string[] = [];
    const providers = createFullScanProviders({
      requestDelayMs: 0,
      fetchImpl: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push(url.toString());
        assert.equal(url.pathname, `/store/apps/${path}`);
        assert.equal(url.searchParams.get('id'), developerId);
        assert.equal(url.searchParams.get('gl'), 'ph');
        assert.equal(url.searchParams.get('hl'), 'en');
        return new Response(body, { headers: { 'content-type': 'text/html' } });
      },
      onResponse: (record) => {
        records.push(record);
        return records.length;
      },
    });
    const result = await providers['google-play'].enrich({
      ...context,
      developerUrl: `https://play.google.com/store/apps/${path}?id=${developerId}`,
      developerSourceHttpId: 42,
    });
    assert.equal(result.status, 'available');
    assert.equal((result.data as any[]).length, 1);
    assert.equal((result.data as any[])[0].appId, context.externalId);
    assert.equal(requests.length, 1, 'a natural single-page end must not fetch another route');
    assert.equal(records[0].body, body);
    assert.equal(new URL(result.source).pathname, `/store/apps/${path}`);
    assert.equal((result.raw as any).routing.listingSourceHttpId, 42);
    assert.equal((result.raw as any).routing.developerId, developerId);
    assert.equal((result.raw as any).routing.method, 'verified-listing-link');
    assert.deepEqual((result.raw as any).warnings, []);
  });
}

test('#14: absent or untrusted listing evidence retains the SDK route and a 404 does not blindly try the other path', async () => {
  for (const developerUrl of [
    undefined,
    'https://evil.invalid/store/apps/developer?id=' + developerId,
    listingLink.replace(developerId, 'wrong'),
  ]) {
    const requests: string[] = [];
    const providers = createFullScanProviders({
      requestDelayMs: 0,
      fetchImpl: async (input) => {
        requests.push(input instanceof Request ? input.url : String(input));
        return new Response('synthetic missing directory', { status: 404 });
      },
    });
    await assert.rejects(
      providers['google-play'].enrich({ ...context, developerUrl }),
      /404|not found/i,
    );
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0]).pathname, '/store/apps/dev');
  }
});

async function scenario(
  options: {
    source?:
      | 'valid'
      | 'country'
      | 'language'
      | 'identity'
      | 'batch'
      | 'task'
      | 'status'
      | 'origin'
      | 'ambiguous';
    fail?: boolean;
  } = {},
) {
  const store = createStore();
  const app = store.createApp({
    store: 'google-play',
    country: 'ph',
    externalId: context.externalId,
  });
  store.updateClassification(app.id, 'excluded');
  let shouldFail = !!options.fail;
  let runner: ReturnType<typeof createFullScanRunner>;
  const requests: string[] = [];
  const live = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async (input) => {
      requests.push(input instanceof Request ? input.url : String(input));
      return shouldFail
        ? new Response('Synthetic failure', { status: 404 })
        : new Response(directoryHtml('name'));
    },
    onResponse: (record) => runner.recordHttp(record),
  });
  const provider: ScanProvider = {
    list: async () => ({ data: [], raw: [], source: 'https://example.invalid/list' }),
    search: async () => ({ data: [], raw: [], source: 'https://example.invalid/search' }),
    reviewsPage: async () => ({ data: [], raw: [], source: 'https://example.invalid/reviews' }),
    app: async () => {
      const url = new URL('https://play.google.com/store/apps/details');
      url.search = new URLSearchParams({ id: context.externalId, gl: 'ph', hl: 'en' }).toString();
      if (options.source === 'country') url.searchParams.set('gl', 'mx');
      if (options.source === 'language') url.searchParams.set('hl', 'es');
      if (options.source === 'identity') url.searchParams.set('id', 'fixture.other');
      if (options.source === 'origin') url.hostname = 'evil.invalid';
      const httpId = runner.recordHttp({
        url: url.toString(),
        method: 'GET',
        status: options.source === 'status' ? 404 : 200,
        body:
          options.source === 'ambiguous'
            ? listingHtml + `<a href="/store/apps/dev?id=${developerId}">conflict</a>`
            : listingHtml,
        contentType: 'text/html',
        error: null,
        fetchedAt: new Date().toISOString(),
      });
      if (options.source === 'batch')
        store.run('UPDATE full_scan_http SET batch_id=? WHERE id=?', 'unrelated-batch', httpId);
      if (options.source === 'task')
        store.run('UPDATE full_scan_http SET task_id=NULL WHERE id=?', httpId);
      return {
        externalId: context.externalId,
        title: 'Synthetic numeric publisher parent',
        developerId,
      };
    },
    enrich: async (input) =>
      input.kind === 'developer'
        ? live['google-play'].enrich(input)
        : {
            status: 'unsupported',
            data: null,
            raw: null,
            source: 'https://example.invalid/' + input.kind,
            requestCountry: input.country,
            requestLanguage: input.language,
          },
  };
  runner = createFullScanRunner({
    store,
    providers: { 'google-play': provider, 'app-store': provider },
    batchId: 'numeric-route-fixture',
    config: {
      countries: ['ph'],
      stores: ['google-play'],
      collections: { 'google-play': [], 'app-store': [] },
      includeSearch: false,
      maxAttempts: 3,
      retryDelayMs: 0,
    },
  });
  runner.seed();
  while (await runner.runOnce()) {}
  return {
    store,
    app,
    runner,
    requests,
    succeed: () => {
      shouldFail = false;
    },
  };
}

test('#14: runner only trusts successful same-batch detail HTTP with the exact app, country, language and official origin', async () => {
  for (const source of [
    'valid',
    'country',
    'language',
    'identity',
    'batch',
    'task',
    'status',
    'origin',
    'ambiguous',
  ] as const) {
    const { store, app, requests } = await scenario({ source });
    try {
      const enrichment = store.listEnrichments(app.id).find((row) => row.kind === 'developer')!;
      assert.equal(enrichment.status, 'available');
      const expectedPath = source === 'valid' ? '/store/apps/developer' : '/store/apps/dev';
      assert.equal(new URL(requests[0]).pathname, expectedPath, source);
      assert.equal(new URL(requests[0]).searchParams.get('gl'), 'ph');
      assert.equal(new URL(requests[0]).searchParams.get('hl'), 'en');
      assert.equal(Boolean((enrichment.raw as any).routing), source === 'valid');
      assert.equal(store.getApp(app.id)!.classification, 'excluded');
      if (source === 'valid') {
        const evidence = store.one(
          'SELECT * FROM full_scan_http WHERE id=?',
          (enrichment.raw as any).routing.listingSourceHttpId,
        )!;
        assert.equal(evidence.status, 200);
        assert.equal(evidence.body, listingHtml);
        assert.equal(new URL(enrichment.source!).pathname, expectedPath);
      }
    } finally {
      store.close();
    }
  }
});

test('#14: failed developer attempts freeze the verified source, and explicit retry appends attempt four without overwriting three 404s or history', async () => {
  const { store, app, runner, succeed } = await scenario({ source: 'valid', fail: true });
  try {
    const task = store.one(
      "SELECT * FROM full_scan_tasks WHERE kind='enrich' AND json_extract(payload,'$.kind')='developer'",
    )!;
    assert.equal(task.status, 'failed');
    assert.equal(task.attempts, 3);
    const attempts = store.all(
      'SELECT * FROM full_scan_attempts WHERE task_id=? ORDER BY id',
      task.id,
    );
    const http = store.all('SELECT * FROM full_scan_http WHERE task_id=? ORDER BY id', task.id);
    const history = store.all(
      "SELECT * FROM enrichment_history WHERE app_id=? AND kind='developer' ORDER BY id",
      app.id,
    );
    assert.equal(http.length, 3);
    assert.equal(history.length, 3);
    for (const record of http) assert.equal(record.status, 404);
    for (const record of history) {
      assert.equal(record.status, 'failed');
      assert.equal(new URL(record.source).pathname, '/store/apps/developer');
      assert.equal(record.request_country, 'ph');
      assert.equal(record.request_language, 'en');
    }
    runner.retryFailed();
    assert.equal(store.one("SELECT COUNT(*) n FROM full_scan_tasks WHERE status='queued'")!.n, 1);
    assert.equal(
      store.one('SELECT attempts FROM full_scan_tasks WHERE id=?', task.id)!.attempts,
      3,
    );
    succeed();
    while (await runner.runOnce()) {}
    const after = store.one('SELECT * FROM full_scan_tasks WHERE id=?', task.id)!;
    assert.equal(after.status, 'succeeded');
    assert.equal(after.attempts, 4);
    assert.deepEqual(
      store.all('SELECT * FROM full_scan_attempts WHERE task_id=? ORDER BY id LIMIT 3', task.id),
      attempts,
    );
    assert.deepEqual(
      store.all('SELECT * FROM full_scan_http WHERE task_id=? ORDER BY id LIMIT 3', task.id),
      http,
    );
    assert.deepEqual(
      store.all(
        "SELECT * FROM enrichment_history WHERE app_id=? AND kind='developer' ORDER BY id LIMIT 3",
        app.id,
      ),
      history,
    );
    assert.deepEqual(
      store
        .all('SELECT attempt FROM full_scan_attempts WHERE task_id=? ORDER BY id', task.id)
        .map((row) => row.attempt),
      [1, 2, 3, 4],
    );
    assert.equal(
      store.listEnrichments(app.id).find((row) => row.kind === 'developer')!.status,
      'available',
    );
    assert.equal(store.getApp(app.id)!.classification, 'excluded');
    assert.equal(runner.summary().failures, 0);
  } finally {
    store.close();
  }
});

test('#14: explicit retry of three failures grants only three further attempts and then remains visibly failed', async () => {
  const { store, runner } = await scenario({ source: 'valid', fail: true });
  try {
    const task = store.one("SELECT * FROM full_scan_tasks WHERE status='failed'")!;
    runner.retryFailed();
    let runs = 0;
    while (await runner.runOnce()) assert.ok(++runs <= 3, 'new recovery budget must be finite');
    assert.equal(runs, 3);
    assert.equal(
      store.one('SELECT status FROM full_scan_tasks WHERE id=?', task.id)!.status,
      'failed',
    );
    assert.deepEqual(
      store
        .all('SELECT attempt FROM full_scan_attempts WHERE task_id=? ORDER BY id', task.id)
        .map((row) => row.attempt),
      [1, 2, 3, 4, 5, 6],
    );
    assert.equal(runner.summary().failures, 1);
    assert.equal(runner.summary().pending, 0);
  } finally {
    store.close();
  }
});

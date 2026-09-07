import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createFullScanRunner } from '../server/full-scan.js';
import { createFullScanProviders, type ScanProvider } from '../server/full-scan-providers.js';
import { normalizeReview } from '../server/providers.js';
import {
  validateAppleReviewResponse,
  validateGoogleReviewResponse,
} from '../server/review-source-validation.js';

const atom = 'http://www.w3.org/2005/Atom';
const appleEmpty = `<feed xmlns="${atom}" xmlns:im="http://itunes.apple.com/rss"><id>https://itunes.apple.com/ph/rss/customerreviews/page=2/id=123456/sortby=mostRecent/xml</id><title>Synthetic reviews</title><updated>2026-09-01T00:00:00Z</updated></feed>`;
const appleMetadata = `<feed xmlns="${atom}" xmlns:im="http://itunes.apple.com/rss"><entry><id>123456</id><im:name>Synthetic application metadata</im:name></entry></feed>`;
const appleReview = `<feed xmlns="${atom}" xmlns:im="http://itunes.apple.com/rss"><entry><id>fixture-review</id><author><name>Synthetic reviewer</name><uri>https://example.invalid/reviewer</uri></author><title>Fixture title</title><content type="text">Body &amp; literal text.</content><im:rating>4</im:rating><im:version>1.0</im:version><updated>2026-09-01T00:00:00Z</updated><im:voteSum>0</im:voteSum><im:voteCount>0</im:voteCount></entry></feed>`;
function rpc(payload: unknown = null, code?: unknown, rpcId = 'UsvDTd') {
  const frames = JSON.stringify([
    [
      'wrb.fr',
      rpcId,
      payload === null ? null : JSON.stringify(payload),
      null,
      null,
      code === undefined ? null : [code, null, [['SyntheticError', [1]]]],
      'generic',
    ],
  ]);
  return `)]}'\n${frames.length}\n${frames}\n`;
}
function googleReview(token: string | null = null) {
  const row: unknown[] = [];
  row[0] = 'fixture-review';
  row[1] = ['Synthetic reviewer'];
  row[2] = 4;
  row[4] = 'Synthetic review body';
  row[5] = [1788220800, 0];
  return rpc([[row], [null, token]]);
}
const badGoogle = rpc(null, 5);
const badApple = '<html><body>Temporary upstream error</body></html>';

test('RSV-02: explicit numeric nonzero UsvDTd errors fail, including nonempty payload; unrelated RPC errors do not', () => {
  for (const code of [1, 5, -1])
    for (const payload of [null, [], [[], [null, 'next']]]) {
      assert.throws(
        () => validateGoogleReviewResponse(rpc(payload, code)),
        (error: any) =>
          error.name === 'ReviewSourceValidationError' && error.code === 'google-review-rpc-error',
      );
    }
  for (const body of [
    rpc(null),
    rpc([]),
    rpc([[]]),
    rpc(null, 0),
    rpc(null, '5'),
    rpc(null, 5, 'qnKhOb'),
    rpc(null, 5, 'other'),
  ]) {
    assert.doesNotThrow(() => validateGoogleReviewResponse(body));
  }
  const unrelated = rpc(null, 5, 'qnKhOb') + rpc([[], [null, 'next']], undefined);
  assert.doesNotThrow(() => validateGoogleReviewResponse(unrelated));
});

test('RSV-03: valid Atom reviews, genuine empty and application metadata-only feeds are accepted', () => {
  for (const body of [
    appleReview,
    appleEmpty,
    appleMetadata,
    `<feed xmlns="${atom}"/>`,
    `<?xml version="1.0"?><a:feed xmlns:a="${atom}"/>`,
  ]) {
    assert.doesNotThrow(() => validateAppleReviewResponse(body));
  }
});

test('RSV-03: HTML, error documents, invalid roots/namespaces and malformed XML are rejected', () => {
  for (const body of [
    badApple,
    '<error>Temporary source failure</error>',
    '<feed/>',
    '<feed xmlns="https://example.invalid/feed"/>',
    `<wrapper><feed xmlns="${atom}"/></wrapper>`,
    `<feed xmlns="${atom}"><entry></feed>`,
    `<feed xmlns="${atom}">`,
    `<feed xmlns="${atom}"/><error/>`,
    'not XML',
    '',
  ]) {
    assert.throws(
      () => validateAppleReviewResponse(body),
      (error: any) =>
        error.name === 'ReviewSourceValidationError' &&
        ['apple-review-invalid-xml', 'apple-review-invalid-feed'].includes(error.code),
    );
  }
  assert.throws(() =>
    validateAppleReviewResponse(
      `<!DOCTYPE feed [<!ENTITY x SYSTEM "https://example.invalid/not-fetched">]><feed xmlns="${atom}">&x;</feed>`,
    ),
  );
});

for (const storeName of ['google-play', 'app-store'] as const) {
  test(`RSV-01/07: installed ${storeName} SDK rejects source error only after retaining the unchanged HTTP 200 body`, async () => {
    const recorded: any[] = [];
    const body = storeName === 'google-play' ? badGoogle : badApple;
    let calls = 0;
    const providers = createFullScanProviders({
      requestDelayMs: 0,
      fetchImpl: async () => {
        calls++;
        return new Response(body, {
          headers: {
            'content-type': storeName === 'google-play' ? 'application/json' : 'text/html',
          },
        });
      },
      onResponse: (record) => {
        recorded.push(record);
        return recorded.length;
      },
    });
    await assert.rejects(
      providers[storeName].reviewsPage({
        externalId: storeName === 'google-play' ? 'fixture.source-validation' : '123456',
        country: 'ph',
        language: 'en',
        page: 1,
        cursor: null,
      }),
    );
    assert.equal(calls, 1);
    assert.equal(recorded.length, 1, 'validation must not manufacture a duplicate HTTP record');
    assert.equal(recorded[0].body, body);
    assert.equal(recorded[0].status, 200);
    assert.equal(
      recorded[0].error,
      null,
      'the actual successful HTTP exchange is separate from source-validation failure',
    );
    assert.ok(Number.isFinite(Date.parse(recorded[0].fetchedAt)));
  });
}

test('RSV-02/04: installed Google SDK retains legitimate null/empty responses and a new cursor on an empty page', async () => {
  const bodies = [rpc(null), rpc([]), rpc([[], [null, 'synthetic-next']])];
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async () => new Response(bodies.shift()!),
  });
  const input = {
    externalId: 'fixture.source-validation',
    country: 'ph',
    language: 'en',
    page: 1,
    cursor: null,
  };
  const first = await providers['google-play'].reviewsPage(input);
  assert.deepEqual(first.data, []);
  assert.equal(first.nextCursor, null);
  const second = await providers['google-play'].reviewsPage(input);
  assert.deepEqual(second.data, []);
  assert.equal(second.nextCursor, null);
  const third = await providers['google-play'].reviewsPage(input);
  assert.deepEqual(third.data, []);
  assert.equal(third.nextCursor, 'synthetic-next');
  assert.equal(bodies.length, 0);
});

test('RSV-03: installed Apple SDK preserves review fields and returns an empty array for a valid metadata-only feed', async () => {
  const bodies = [appleReview, appleMetadata, appleEmpty];
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async () => new Response(bodies.shift()!),
  });
  const input = { externalId: '123456', country: 'ph', language: 'und', page: 1, cursor: null };
  const review = await providers['app-store'].reviewsPage(input);
  assert.equal(review.data.length, 1);
  assert.equal(review.data[0].externalId, 'fixture-review');
  assert.equal(review.data[0].text, 'Body & literal text.');
  assert.equal(review.data[0].language, 'und');
  for (let i = 0; i < 2; i++)
    assert.deepEqual((await providers['app-store'].reviewsPage(input)).data, []);
  assert.equal(bodies.length, 0);
});

async function harness(storeName: 'google-play' | 'app-store', responses: string[]) {
  const store = createStore();
  const app = store.createApp({
    store: storeName,
    country: 'ph',
    externalId: storeName === 'google-play' ? 'fixture.source-validation' : '123456',
  });
  const originalTime = '2026-08-01T00:00:00.000Z';
  store.saveReviews(
    app.id,
    [
      normalizeReview(
        {
          id: 'baseline-review',
          userName: 'Synthetic old reviewer',
          text: 'Old immutable observation',
          score: 5,
        },
        'en',
      ),
    ],
    'en',
    originalTime,
  );
  const baseline = store.one('SELECT * FROM reviews WHERE app_id=?', app.id)!;
  let runner: ReturnType<typeof createFullScanRunner>;
  const requests: { url: string; body: string | null }[] = [];
  const actual = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      requests.push({
        url: request?.url ?? String(input),
        body:
          typeof init?.body === 'string'
            ? init.body
            : request
              ? await request.clone().text()
              : null,
      });
      assert.ok(responses.length, 'No unplanned real or synthetic request');
      return new Response(responses.shift()!);
    },
    onResponse: (record) => runner.recordHttp(record),
  });
  const fake: ScanProvider = {
    app: async () => ({ externalId: app.externalId, title: 'Synthetic original app' }),
    list: async () => ({ data: [], raw: [], source: 'https://example.invalid/list' }),
    search: async () => ({ data: [], raw: [], source: 'https://example.invalid/search' }),
    enrich: async (input) => ({
      status: 'unsupported',
      data: null,
      raw: null,
      source: 'https://example.invalid/' + input.kind,
      requestCountry: input.country,
      requestLanguage: input.language,
    }),
    reviewsPage: actual[storeName].reviewsPage,
  };
  const options = {
    store,
    providers: { 'google-play': fake, 'app-store': fake },
    batchId: `review-validation-${storeName}`,
    config: {
      countries: ['ph'],
      stores: [storeName],
      includeSearch: false,
      collections: { 'google-play': [], 'app-store': [] },
      maxAttempts: 2,
      retryDelayMs: 0,
    },
  };
  runner = createFullScanRunner(options);
  runner.seed();
  while (
    store.one(
      "SELECT COUNT(*) count FROM full_scan_tasks WHERE kind!='reviews' AND status='queued'",
    )!.count
  )
    assert.ok(await runner.runOnce());
  return {
    store,
    app,
    runner,
    options,
    requests,
    baseline,
    restart: () => {
      runner = createFullScanRunner(options);
      runner.recover();
      return runner;
    },
    page: (page: number) =>
      store.one("SELECT * FROM full_scan_tasks WHERE kind='reviews' AND page=?", page)!,
  };
}

for (const storeName of ['google-play', 'app-store'] as const) {
  test(`RSV-04/05: ${storeName} invalid second page exhausts finite attempts without a false terminal; explicit recovery preserves all old observations`, async () => {
    const bad = storeName === 'google-play' ? badGoogle : badApple;
    const goodFirst = storeName === 'google-play' ? googleReview('synthetic-next') : appleReview;
    const goodEmpty = storeName === 'google-play' ? rpc(null) : appleEmpty;
    const h = await harness(storeName, [goodFirst, bad, bad, goodEmpty]);
    try {
      assert.ok(await h.runner.runOnce());
      const pageOne = { ...h.page(1) };
      const savedFirst = {
        ...h.store.one("SELECT * FROM reviews WHERE external_id='fixture-review'")!,
      };
      assert.ok(await h.runner.runOnce());
      assert.equal(h.page(2).status, 'queued');
      assert.equal(h.page(2).attempts, 1);
      assert.equal(h.page(2).stop_reason, null);
      h.runner = h.restart();
      assert.ok(await h.runner.runOnce());
      assert.equal(h.page(2).status, 'failed');
      assert.equal(h.page(2).attempts, 2);
      assert.equal(h.page(2).response, null);
      assert.equal(h.page(2).stop_reason, null);
      assert.match(
        String(h.page(2).error),
        storeName === 'google-play' ? /UsvDTd.*code 5/ : /Apple reviews source/,
      );
      assert.equal(h.page(3), undefined);
      assert.equal(await h.runner.runOnce(), false);
      assert.deepEqual({ ...h.page(1) }, pageOne);
      assert.deepEqual(
        { ...h.store.one("SELECT * FROM reviews WHERE external_id='fixture-review'")! },
        savedFirst,
      );
      assert.deepEqual(
        h.store.one("SELECT * FROM reviews WHERE external_id='baseline-review'"),
        h.baseline,
      );
      const failedHttp = h.store.all(
        'SELECT * FROM full_scan_http WHERE task_id=? ORDER BY id',
        h.page(2).id,
      );
      assert.equal(failedHttp.length, 2);
      assert.ok(failedHttp.every((row) => row.status === 200 && row.body === bad));
      assert.equal(
        h.store.one('SELECT COUNT(*) n FROM full_scan_responses WHERE task_id=?', h.page(2).id)!.n,
        0,
      );
      h.runner.retryFailed();
      assert.equal(h.page(2).status, 'queued');
      assert.ok(await h.runner.runOnce());
      assert.equal(h.page(2).status, 'succeeded');
      assert.equal(h.page(2).attempts, 3);
      assert.equal(h.page(2).stop_reason, 'reviews-empty-page');
      assert.equal(JSON.parse(String(h.page(2).result)).added, 0);
      assert.equal(JSON.parse(String(h.page(2).result)).updated, 0);
      assert.deepEqual(
        h.store
          .all(
            'SELECT attempt,status FROM full_scan_attempts WHERE task_id=? ORDER BY id',
            h.page(2).id,
          )
          .map((row) => [row.attempt, row.status]),
        [
          [1, 'failed'],
          [2, 'failed'],
          [3, 'succeeded'],
        ],
      );
      assert.deepEqual({ ...h.page(1) }, pageOne);
      assert.deepEqual(
        { ...h.store.one("SELECT * FROM reviews WHERE external_id='fixture-review'")! },
        savedFirst,
      );
      assert.deepEqual(
        h.store.one("SELECT * FROM reviews WHERE external_id='baseline-review'"),
        h.baseline,
      );
      assert.equal(h.store.one('SELECT COUNT(*) n FROM full_scan_review_seen')!.n, 1);
      assert.equal(h.requests.length, 4);
      if (storeName === 'google-play')
        for (const request of h.requests.slice(1)) {
          assert.match(decodeURIComponent(request.body!), /synthetic-next/);
          const url = new URL(request.url);
          assert.equal(url.searchParams.get('gl'), 'ph');
          assert.equal(url.searchParams.get('hl'), 'en');
        }
      else
        for (const request of h.requests.slice(1))
          assert.match(request.url, /\/ph\/rss\/customerreviews\/page=2\/id=123456\//);
    } finally {
      h.store.close();
    }
  });
}

test('RSV-04: a legitimate Google empty page with a new cursor schedules and fetches its successor', async () => {
  const h = await harness('google-play', [rpc([[], [null, 'synthetic-next']]), rpc(null)]);
  try {
    assert.ok(await h.runner.runOnce());
    assert.equal(h.page(1).stop_reason, null);
    assert.equal(h.page(2).status, 'queued');
    assert.equal(JSON.parse(String(h.page(2).payload)).cursor, 'synthetic-next');
    assert.ok(await h.runner.runOnce());
    assert.equal(h.page(2).stop_reason, 'reviews-empty-page');
    assert.equal(h.page(3), undefined);
    assert.equal(h.requests.length, 2);
    assert.equal(h.store.one('SELECT COUNT(*) n FROM full_scan_review_seen')!.n, 0);
    assert.deepEqual(
      h.store.one("SELECT * FROM reviews WHERE external_id='baseline-review'"),
      h.baseline,
    );
  } finally {
    h.store.close();
  }
});

test('RSV-02/06: native Request bodies are preserved and source errors apply only to the requested reviews RPC', async () => {
  const url = 'https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=qnKhOb&gl=ph&hl=en';
  let selectedRpc = 'UsvDTd';
  const bodies: string[] = [],
    recorded: any[] = [];
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async (input) => {
      assert.ok(input instanceof Request);
      bodies.push(await input.text());
      return new Response(badGoogle);
    },
    onResponse: (record) => {
      recorded.push(record);
    },
    googlePlayClient: {
      app: async () => ({}),
      list: async () => [],
      search: async () => [],
      reviews: async (options: any) => {
        const body = new URLSearchParams({
          'f.req': JSON.stringify([[[selectedRpc, '[]', null, 'generic']]]),
        }).toString();
        await options.requestOptions.fetchImpl(new Request(url, { method: 'POST', body }));
        return { data: [], nextPaginationToken: null };
      },
    },
  });
  const input = {
    externalId: 'fixture.source-validation',
    country: 'ph',
    language: 'en',
    page: 1,
    cursor: null,
  };
  await assert.rejects(
    providers['google-play'].reviewsPage(input),
    (error: any) => error.code === 'google-review-rpc-error',
  );
  selectedRpc = 'qnKhOb';
  assert.deepEqual((await providers['google-play'].reviewsPage(input)).data, []);
  assert.equal(bodies.length, 2);
  assert.match(decodeURIComponent(bodies[0]), /UsvDTd/);
  assert.match(decodeURIComponent(bodies[1]), /qnKhOb/);
  assert.equal(recorded.length, 2);
  assert.ok(recorded.every((record) => record.body === badGoogle && record.status === 200));
});

test('RSV-01: an HTTP journal write failure is not mislabeled as a source validation error', async () => {
  const storageError = new Error('Synthetic HTTP journal unavailable');
  let writes = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async () => new Response(badApple),
    onResponse: () => {
      writes++;
      throw storageError;
    },
    appStoreClient: {
      app: async () => ({}),
      list: async () => [],
      search: async () => [],
      reviews: async (options: any) => {
        await options.requestOptions.fetch(
          'https://itunes.apple.com/ph/rss/customerreviews/page=1/id=123456/sortby=mostRecent/xml',
        );
        return [];
      },
    },
  });
  await assert.rejects(
    providers['app-store'].reviewsPage({
      externalId: '123456',
      country: 'ph',
      language: 'und',
      page: 1,
      cursor: null,
    }),
    (error) => error === storageError,
  );
  assert.ok(writes >= 1);
});

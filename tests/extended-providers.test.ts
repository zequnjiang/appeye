import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFullScanProviders,
  ScanSourceError,
  type ScanTransportRecord,
} from '../server/full-scan-providers.js';
import type { ScraperClient } from '../server/providers.js';

const context = { country: 'ar', language: 'es' };
const searchInput = { ...context, keyword: 'préstamos personales', limit: 1000 };
const relatedInput = { ...context, externalId: '123456' };
function client(
  overrides: Partial<ScraperClient> = {},
): ScraperClient & { list(options: any): Promise<any> } {
  return {
    app: async () => ({}),
    list: async () => [],
    search: async () => [],
    reviews: async () => [],
    ...overrides,
  };
}
function row(index: number) {
  return {
    appId: `fixture.search.${index}`,
    title: `Synthetic Search ${index}`,
    developer: 'Synthetic Publisher',
    futureField: { retained: true },
  };
}
function setPath(root: any[], path: number[], value: unknown) {
  let current = root;
  for (const index of path.slice(0, -1)) current = current[index] ??= [];
  current[path.at(-1)!] = value;
}
function item(index: number) {
  const result: any[] = [];
  setPath(result, [0, 0], `fixture.search.${index}`);
  result[3] = `Synthetic Search ${index}`;
  setPath(result, [1, 3, 2], 'https://example.invalid/icon.png');
  setPath(result, [10, 4, 2], `/store/apps/details?id=fixture.search.${index}`);
  result[14] = 'Synthetic Publisher';
  return result;
}
function firstPage(count = 30, token?: string) {
  const data: any[] = [];
  setPath(
    data,
    [0, 1, 0, 22, 0],
    Array.from({ length: count }, (_, i) => [item(i + 1)]),
  );
  if (token) setPath(data, [0, 1, 0, 22, 1, 3, 1], token);
  return `<script>; var AF_dataServiceRequests = {'ds:4': {id: 'lGYRle'}}; var AF_initDataChunkQueue = [];</script><script>AF_initDataCallback({key: 'ds:4', hash: 'fixture', data:${JSON.stringify(data)}, sideChannel: {}});</script>`;
}
function nextPage(start: number, count: number, token: string | null = null) {
  const payload: any[] = [];
  setPath(
    payload,
    [0, 0, 0],
    Array.from({ length: count }, (_, i) => item(start + i)),
  );
  setPath(payload, [0, 0, 7, 1], token);
  const frame = JSON.stringify([['wrb.fr', 'qnKhOb', JSON.stringify(payload)]]);
  return `)]}'\n${frame.length}\n${frame}\n`;
}

test('ED-AC-04: real installed GP iterator reports 30 observed rows without asserting a 250 cap or exposed cursor', async () => {
  let attempts = 0;
  const records: ScanTransportRecord[] = [];
  const body = firstPage();
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    beforeRequest: () => {
      attempts++;
    },
    fetchImpl: async () => new Response(body),
    onResponse: (record) => {
      records.push(record);
    },
  });
  const persisted: string[] = [];
  const result = await providers['google-play'].extendedSearch!({
    ...searchInput,
    onItem: (app) => {
      persisted.push(app.externalId);
    },
  });
  assert.equal(result.data.length, 30);
  assert.equal(result.stopReason, 'sdk-iterator-ended');
  assert.deepEqual(result.coverage, {
    requestedLimit: 1000,
    returnedCount: 30,
    tokenAvailability: 'not-exposed',
    restartMode: 'from-head-with-identity-deduplication',
    sourceKind: 'search',
  });
  assert.equal(result.nextCursor, undefined);
  assert.equal(attempts, 1);
  assert.equal(records[0].body, body);
  assert.deepEqual(
    persisted,
    result.data.map((app) => app.externalId),
  );
});

test('ED-AC-03/04: GP iterator follows actual continuation beyond 250 and journals every real request', async () => {
  const bodies = [firstPage(30, 'page-two'), nextPage(31, 230)];
  let requests = 0,
    budget = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    beforeRequest: () => {
      budget++;
    },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.searchParams.get('gl'), 'ar');
      assert.equal(parsed.searchParams.get('hl'), 'es');
      assert.equal(
        parsed.pathname,
        requests ? '/_/PlayStoreUi/data/batchexecute' : '/store/search',
      );
      return new Response(bodies[requests++]);
    },
  });
  const result = await providers['google-play'].extendedSearch!(searchInput);
  assert.equal(result.data.length, 260);
  assert.equal(result.stopReason, 'sdk-iterator-ended');
  assert.equal(budget, 2);
  assert.equal(requests, 2);
});

test('ED-AC-03/04: local GP result cutoff closes the iterator without making a speculative next request', async () => {
  let closed = false,
    yielded = 0;
  const providers = createFullScanProviders({
    googlePlayClient: client({
      async *searchIterator() {
        try {
          for (let i = 0; i < 1100; i++) {
            yielded++;
            yield row(i);
          }
        } finally {
          closed = true;
        }
      },
    }),
  });
  const result = await providers['google-play'].extendedSearch!({ ...searchInput, limit: 5000 });
  assert.equal(result.data.length, 1000);
  assert.equal(result.stopReason, 'local-result-limit');
  assert.equal(result.coverage?.requestedLimit, 1000);
  assert.equal(yielded, 1000);
  assert.equal(closed, true);
  assert.deepEqual(result.data[0].raw, row(0));
});

test('ED-AC-03/04: real iterator budget denial preserves first-page callbacks and prevents the next HTTP', async () => {
  const denied = Object.assign(new Error('Fixture budget exhausted'), {
    name: 'DiscoveryBudgetError',
  });
  let attempts = 0,
    requests = 0;
  const persisted: string[] = [];
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    beforeRequest: () => {
      if (++attempts > 1) throw denied;
    },
    fetchImpl: async () => {
      requests++;
      return new Response(firstPage(30, 'next-page'));
    },
  });
  await assert.rejects(
    providers['google-play'].extendedSearch!({
      ...searchInput,
      onItem: (app) => {
        persisted.push(app.externalId);
      },
    }),
    (error) => error === denied,
  );
  assert.equal(persisted.length, 30);
  assert.equal(requests, 1);
  assert.equal(attempts, 2);
});

test('ED-AC-04/05: malformed continuation is a degraded source with all preceding SDK rows retained', async () => {
  const malformed = JSON.stringify([
    [
      'wrb.fr',
      'qnKhOb',
      JSON.stringify([[[[{}]], null, null, null, null, null, null, [null, null]]]),
    ],
  ]);
  const bodies = [firstPage(30, 'next-page'), `)]}'\n${malformed.length}\n${malformed}\n`];
  let requests = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async () => new Response(bodies[requests++]),
  });
  const persisted: string[] = [];
  await assert.rejects(
    providers['google-play'].extendedSearch!({
      ...searchInput,
      onItem: (app) => {
        persisted.push(app.externalId);
      },
    }),
    (error) => {
      assert.ok(error instanceof ScanSourceError);
      assert.equal(error.partial?.data.length, 30);
      assert.ok(error.partial?.warnings?.length);
      assert.equal(error.partial?.stopReason, 'search-degraded');
      return true;
    },
  );
  assert.equal(persisted.length, 30);
});

test('ED-AC-04: repeated GP continuation tokens become a visible integrity failure', async () => {
  const bodies = [firstPage(30, 'repeated'), nextPage(31, 1, 'repeated')];
  let requests = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async () => new Response(bodies[requests++]),
  });
  await assert.rejects(providers['google-play'].extendedSearch!(searchInput), (error) => {
    assert.ok(error instanceof ScanSourceError);
    assert.equal(error.partial?.data.length, 31);
    assert.ok(error.partial?.warnings?.length);
    return true;
  });
  assert.equal(requests, 2);
});

test('ED-AC-04: ordinary GP search only reports a local cutoff when the requested 250 was actually returned', async () => {
  for (const count of [0, 30, 250]) {
    const providers = createFullScanProviders({
      googlePlayClient: client({
        search: async () => Array.from({ length: count }, (_, i) => row(i)),
      }),
    });
    const result = await providers['google-play'].search({ ...searchInput, page: 1 });
    assert.equal(result.stopReason, count === 250 ? 'local-result-limit' : 'sdk-search-ended');
    assert.equal(result.coverage?.returnedCount, count);
    assert.equal(result.coverage?.tokenAvailability, 'not-exposed');
  }
});

test('ED-AC-04: Apple expanded search uses a single 200/page1 window and preserves full SDK rows', async () => {
  let input: any;
  const raw = [{ id: 123456, title: 'Synthetic Apple loan', unknownField: ['preserved'] }];
  const providers = createFullScanProviders({
    appStoreClient: client({
      search: async (options) => {
        input = options;
        return raw;
      },
    }),
  });
  const persisted: unknown[] = [];
  const result = await providers['app-store'].extendedSearch!({
    ...searchInput,
    onItem: (app) => {
      persisted.push(app.raw);
    },
  });
  assert.equal(input.num, 200);
  assert.equal(input.page, 1);
  assert.equal(input.country, 'ar');
  assert.equal(input.lang, 'en_us');
  assert.equal(result.stopReason, 'public-search-window-ended');
  assert.equal(result.coverage?.requestedLimit, 200);
  assert.equal(result.coverage?.restartMode, 'single-window');
  assert.deepEqual(result.raw, raw);
  assert.deepEqual(persisted, raw);
});

test('ED-AC-03: a budget guard abort cannot be swallowed by the installed Apple similar implementation', async () => {
  const denied = new Error('Fixture source budget denied');
  let requests = 0,
    receipts = 0;
  const providers = createFullScanProviders({
    beforeRequest: () => {
      throw denied;
    },
    fetchImpl: async () => {
      requests++;
      return new Response('');
    },
    onResponse: () => {
      receipts++;
    },
  });
  await assert.rejects(providers['app-store'].related!(relatedInput), (error) => error === denied);
  assert.equal(requests, 0);
  assert.equal(receipts, 0, 'blocked requests must not become fictional HTTP observations');
});

test('ED-AC-04: Apple similar network and HTTP failures cannot become successful empty sources', async () => {
  const failed = new Error('Fixture transport failed');
  for (const response of ['network', 'http'] as const) {
    const records: ScanTransportRecord[] = [];
    const providers = createFullScanProviders({
      fetchImpl: async () => {
        if (response === 'network') throw failed;
        return new Response('Store unavailable', { status: 503 });
      },
      onResponse: (record) => {
        records.push(record);
      },
    });
    await assert.rejects(providers['app-store'].related!(relatedInput), (error) => {
      if (response === 'network') assert.equal(error, failed);
      else assert.match(String(error), /HTTP 503/);
      return true;
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].status, response === 'network' ? null : 503);
  }
});

test('ED-AC-04: Apple app-link empty result requires recognizable listing evidence', async () => {
  for (const recognizable of [false, true]) {
    const body = recognizable
      ? '<html><script type="application/ld+json">{"@type":"SoftwareApplication","name":"Synthetic listing"}</script></html>'
      : '<html>Verify you are human</html>';
    const providers = createFullScanProviders({ fetchImpl: async () => new Response(body) });
    if (!recognizable)
      await assert.rejects(
        providers['app-store'].related!(relatedInput),
        /recognizable listing evidence/,
      );
    else {
      const result = await providers['app-store'].related!(relatedInput);
      assert.deepEqual(result.data, []);
      assert.equal(result.stopReason, 'same-page-links-none-observed');
      assert.equal(result.coverage?.sourceKind, 'same-page-links');
    }
  }
});

test('ED-AC-04/05: installed Apple similar follows same-page app links through the paced country lookup', async () => {
  const urls: string[] = [],
    records: ScanTransportRecord[] = [];
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (urls.length === 1)
        return new Response(
          '<html><a href="https://apps.apple.com/ar/app/example/id789012">Other product</a></html>',
        );
      return Response.json({
        resultCount: 1,
        results: [
          {
            kind: 'software',
            wrapperType: 'software',
            trackId: 789012,
            trackName: 'Synthetic catalog link',
            artistName: 'Synthetic Publisher',
            screenshotUrls: ['https://example.invalid/image.png'],
          },
        ],
      });
    },
    onResponse: (record) => {
      records.push(record);
    },
  });
  const result = await providers['app-store'].related!(relatedInput);
  assert.equal(result.data[0].externalId, '789012');
  assert.equal(result.stopReason, 'same-page-links');
  assert.equal(result.requestLanguage, null);
  assert.equal(new URL(urls[1]).searchParams.get('country'), 'ar');
  assert.equal(new URL(urls[1]).searchParams.get('lang'), 'en_us');
  assert.equal(records.length, 2);
});

test('ED-AC-03: aborted Apple similar and an SDK-wrapped detail budget error retain original causes', async () => {
  const controller = new AbortController();
  const aborted = new Error('Fixture interrupted');
  controller.abort(aborted);
  let requests = 0;
  const providers = createFullScanProviders({
    fetchImpl: async () => {
      requests++;
      return new Response('');
    },
  });
  await assert.rejects(
    providers['app-store'].related!({ ...relatedInput, signal: controller.signal }),
    (error) => error === aborted,
  );
  assert.equal(requests, 0);
  const blocked = new Error('Fixture detail budget');
  const wrapped = createFullScanProviders({
    beforeRequest: () => {
      throw blocked;
    },
    googlePlayClient: client({
      app: async (options) => {
        try {
          await options.requestOptions.fetchImpl(
            'https://play.google.com/store/apps/details?id=fixture.search.1',
          );
        } catch {
          throw new Error('SDK generic error');
        }
      },
    }),
  });
  await assert.rejects(
    wrapped['google-play'].app({ ...context, externalId: 'fixture.search.1' }),
    (error) => error === blocked,
  );
});

test('ED-AC-04: missing iterator or related capabilities are explicitly unsupported', async () => {
  const providers = createFullScanProviders({
    googlePlayClient: client(),
    appStoreClient: client(),
  });
  assert.equal(
    (await providers['google-play'].extendedSearch!(searchInput)).stopReason,
    'unsupported',
  );
  assert.equal(
    (await providers['google-play'].related!({ ...context, externalId: 'fixture.parent' }))
      .stopReason,
    'unsupported',
  );
  assert.equal((await providers['app-store'].related!(relatedInput)).stopReason, 'unsupported');
});

test('ED-AC-03/05: all hidden developer HTTP attempts use the same guard and preserve a swallowed budget denial', async () => {
  const blocked = new Error('Fixture developer continuation budget');
  let guards = 0,
    requests = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    beforeRequest: () => {
      if (++guards > 1) throw blocked;
    },
    fetchImpl: async () => {
      requests++;
      return new Response('synthetic developer bytes');
    },
    googlePlayClient: client({
      developer: async (options) => {
        await options.requestOptions.fetchImpl(
          'https://play.google.com/store/apps/developer?id=fixture.publisher',
        );
        try {
          await options.requestOptions.fetchImpl('https://play.google.com/continuation');
        } catch {
          options.onDegradation({ reason: 'fixture SDK swallowed continuation failure' });
        }
        return [row(1)];
      },
    }),
  });
  await assert.rejects(
    providers['google-play'].enrich({
      ...context,
      externalId: 'fixture.search.1',
      kind: 'developer',
      developerId: 'fixture.publisher',
    }),
    (error) => error === blocked,
  );
  assert.equal(guards, 2);
  assert.equal(requests, 1);
});

test('ED-AC-04/05: Google related source truthfully records mixed request languages and its SDK result ceiling', async () => {
  const records: ScanTransportRecord[] = [];
  const providers = createFullScanProviders({
    requestDelayMs: 0,
    fetchImpl: async () => new Response('synthetic related bytes'),
    onResponse: (record) => {
      records.push(record);
    },
    googlePlayClient: client({
      similar: async (options) => {
        assert.equal(options.country, 'ar');
        assert.equal(options.lang, 'es');
        assert.equal(options.fullDetail, false);
        await options.requestOptions.fetchImpl(
          `https://play.google.com/store/apps/details?id=${options.appId}&gl=ar&hl=en`,
        );
        await options.requestOptions.fetchImpl(
          'https://play.google.com/store/apps/collection/fixture?gl=ar&hl=es',
        );
        return Array.from({ length: 100 }, (_, i) => row(i));
      },
    }),
  });
  const result = await providers['google-play'].related!({
    ...context,
    externalId: 'fixture.parent',
  });
  assert.equal(result.stopReason, 'sdk-related-result-limit');
  assert.equal(result.coverage?.requestedLimit, 100);
  assert.equal(result.coverage?.sourceKind, 'similar-cluster');
  assert.equal(result.requestLanguage, null);
  assert.deepEqual(
    records.map((record) => new URL(record.url).searchParams.get('hl')),
    ['en', 'es'],
  );
});

test('ED-AC-03: cancellation during pacing does not consume another HTTP budget or record an invented response', async () => {
  const controller = new AbortController();
  const aborted = new Error('Fixture pause during pacing');
  let guards = 0,
    requests = 0;
  const providers = createFullScanProviders({
    requestDelayMs: 1000,
    beforeRequest: () => {
      guards++;
    },
    fetchImpl: async () => {
      requests++;
      return new Response('synthetic bytes');
    },
    googlePlayClient: client({
      async *searchIterator(options) {
        await options.requestOptions.fetchImpl('https://play.google.com/first', {
          signal: options.requestOptions.signal,
        });
        yield row(1);
        setTimeout(() => controller.abort(aborted), 10);
        await options.requestOptions.fetchImpl('https://play.google.com/second', {
          signal: options.requestOptions.signal,
        });
        yield row(2);
      },
    }),
  });
  await assert.rejects(
    providers['google-play'].extendedSearch!({ ...searchInput, signal: controller.signal }),
    (error) => {
      // node:timers/promises wraps custom abort reasons in AbortError.cause.
      assert.ok(error === aborted || (error as Error).cause === aborted);
      return true;
    },
  );
  assert.equal(guards, 1);
  assert.equal(requests, 1);
});

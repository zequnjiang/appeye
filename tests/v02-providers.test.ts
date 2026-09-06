import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders, type ScraperClient } from '../server/providers.js';
import { enrichmentKinds } from '../server/types.js';

function client(overrides: Partial<ScraperClient> = {}): ScraperClient {
  return { app: async () => ({ appId: 'fixture.provider', id: 123456, title: 'Synthetic app' }), search: async () => [], reviews: async () => [], ...overrides };
}

test('V2-AC-01/11: new clients receive their actual country, language, identity, window and transport option contracts', async () => {
  const calls: Array<{ store: string; method: string; options: any }> = [];
  const fake = (store: string) => client(Object.fromEntries(['app', 'search', 'reviews'].map(method => [method, async (options: any) => {
    calls.push({ store, method, options });
    return method === 'app' ? { appId: 'fixture.provider', id: 123456, title: 'Fixture', unknown: { nested: true } } : [];
  }])));
  const providers = createProviders({ googlePlayClient: fake('google-play'), appStoreClient: fake('app-store'), timeoutMs: 321, searchLimit: 4, reviewLimit: 7, requestDelayMs: 0 });
  const signal = new AbortController().signal;
  for (const store of ['google-play', 'app-store'] as const) {
    const input = { country: 'mx', language: 'es', externalId: store === 'google-play' ? 'fixture.provider' : '123456', signal };
    await providers[store].search({ ...input, keyword: 'préstamo' });
    const app = await providers[store].app(input);
    await providers[store].reviews(input);
    assert.deepEqual(app.raw?.unknown, { nested: true });
  }
  assert.equal(calls.length, 6);
  for (const { store, method, options } of calls) {
    assert.equal(options.country, 'mx'); assert.equal(options.lang, 'es');
    assert.equal(options.requestOptions.signal, signal); assert.equal(options.requestOptions.retries, 0);
    assert.equal(options.requestOptions[store === 'google-play' ? 'timeoutMs' : 'timeout'], 321);
    assert.equal(typeof options.requestOptions[store === 'google-play' ? 'fetchImpl' : 'fetch'], 'function');
    if (method === 'search') { assert.equal(options.term, 'préstamo'); assert.equal(options.num, 4); }
    else assert.equal(options[store === 'google-play' ? 'appId' : 'id'], store === 'google-play' ? 'fixture.provider' : '123456');
    if (method === 'reviews' && store === 'google-play') assert.equal(options.num, 7);
    if (method === 'reviews' && store === 'app-store') { assert.equal(options.page, 1); assert.equal(options.num, undefined); }
  }
});

test('V2-AC-09/10: Apple original lookup JSON survives a typed projection, including seller and unknown transport fields', async () => {
  const original = { resultCount: 2, unknownEnvelope: ['preserved'], results: [{ trackId: 999, sellerName: 'Wrong Seller' }, { trackId: 123456, sellerName: 'Fixture Legal Seller', sellerUrl: 'https://example.invalid/seller', unknownFuture: { unicode: 'ชื่อ', flag: false } }] };
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(original), { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
  const fake = client({ app: async options => {
    await options.requestOptions.fetch('https://itunes.apple.com/lookup?id=123456&country=th', { signal: options.requestOptions.signal });
    return { id: 123456, title: 'Fixture Apple', developer: 'Store Display Developer', developerId: 42, unknownProjection: 'preserved' };
  } });
  const result = await createProviders({ googlePlayClient: client(), appStoreClient: fake, fetchImpl, requestDelayMs: 0 })['app-store'].app({ externalId: '123456', country: 'th', language: 'th' });
  assert.equal(result.sellerName, 'Fixture Legal Seller');
  assert.equal(result.developer, 'Store Display Developer');
  assert.equal(result.developerLegalName, null);
  assert.equal(result.raw?.unknownProjection, 'preserved');
  assert.deepEqual((result.raw?._appeyeTransport as any[])[0].body, original);
  assert.deepEqual(result.storeData, result.raw);
  assert.equal(result.installs, null);
});

test('V2-AC-01/11: fetch injection honors pre-abort and spaces concurrent transport starts without using real network', async () => {
  const starts: number[] = [];
  const fetchImpl: typeof fetch = async () => { starts.push(Date.now()); return new Response('{}'); };
  const fake = client({ search: async options => { await options.requestOptions.fetchImpl('https://example.invalid/search', { signal: options.requestOptions.signal }); return []; } });
  const providers = createProviders({ googlePlayClient: fake, appStoreClient: client(), fetchImpl, requestDelayMs: 30 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(providers['google-play'].search({ country: 'th', language: 'th', keyword: 'loan', signal: controller.signal }), { name: 'AbortError' });
  assert.equal(starts.length, 0);
  await Promise.all([1, 2].map(() => providers['google-play'].search({ country: 'th', language: 'th', keyword: 'loan' })));
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 20, `transport interval ${starts[1] - starts[0]}ms`);
});

test('V2-AC-09/11: unsupported methods, empty payload and adapter failure remain distinguishable with honest source context', async () => {
  let calls = 0;
  const gp = client({ permissions: async () => [], dataSafety: async () => ({ sharedData: [], unknown: { retained: true } }) });
  const apple = client({ privacy: async () => { throw new Error('Fixture privacy timeout'); }, permissions: async () => { calls++; return []; } });
  const providers = createProviders({ googlePlayClient: gp, appStoreClient: apple, requestDelayMs: 0 });
  const input = { externalId: 'fixture.provider', country: 'th', language: 'th' };
  const empty = await providers['google-play'].enrich!({ ...input, kind: 'permissions' });
  assert.equal(empty.status, 'empty'); assert.deepEqual(empty.raw, []); assert.match(empty.note ?? '', /不是用户实际授权/);
  const safety = await providers['google-play'].enrich!({ ...input, kind: 'dataSafety' });
  assert.equal(safety.status, 'available'); assert.equal(safety.requestCountry, null); assert.equal(new URL(safety.source).searchParams.has('gl'), false);
  assert.deepEqual(safety.raw, { sharedData: [], unknown: { retained: true } });
  const unsupported = await providers['app-store'].enrich!({ ...input, externalId: '123456', kind: 'permissions' });
  assert.equal(unsupported.status, 'unsupported'); assert.equal(unsupported.data, null); assert.equal(calls, 0); assert.equal(unsupported.requestLanguage, null);
  await assert.rejects(providers['app-store'].enrich!({ ...input, externalId: '123456', kind: 'privacy' }), /Fixture privacy timeout/);
  const missing = createProviders({ googlePlayClient: client(), appStoreClient: client(), fetchImpl: async () => { throw new Error('Unexpected network'); } });
  for (const store of ['google-play', 'app-store'] as const) for (const kind of enrichmentKinds) assert.equal((await missing[store].enrich!({ ...input, kind })).status, 'unsupported');
});

test('V2-AC-10/11: encoded Google developer IDs are decoded once and developer directory evidence has the correct source', async () => {
  const observed: any[] = [];
  const providers = createProviders({ googlePlayClient: client({ developer: async options => { observed.push(options); return [{ appId: 'fixture.other' }]; } }), appStoreClient: client(), requestDelayMs: 0 });
  const input = { externalId: 'fixture.provider', country: 'th', language: 'th', kind: 'developer' as const };
  await assert.rejects(providers['google-play'].enrich!(input), /缺少开发者 ID/);
  assert.equal(observed.length, 0);
  const text = await providers['google-play'].enrich!({ ...input, developerId: 'FICTIONAL+COMPANY%2BLIMITED' });
  assert.equal(observed[0].devId, 'FICTIONAL COMPANY+LIMITED');
  assert.equal(new URL(text.source).pathname, '/store/apps/developer');
  assert.equal(new URL(text.source).searchParams.get('id'), 'FICTIONAL COMPANY+LIMITED');
  assert.equal(observed[0].num, 20);
  const numeric = await providers['google-play'].enrich!({ ...input, developerId: '123456789' });
  assert.equal(observed[1].devId, '123456789');
  assert.equal(new URL(numeric.source).pathname, '/store/apps/dev');
});

test('V2-AC-01/11: malformed upstream collections reject; null optional fields and unverified review language stay explicit', async () => {
  const bad = createProviders({ googlePlayClient: client({ search: async () => null, reviews: async () => ({ unexpected: [] }) }), appStoreClient: client({ app: async () => ({ id: 123456, title: 'Fixture', futureNull: null }), reviews: async () => [{ id: 'r1', text: 'Fixture review', customReviewField: [false] }] }) });
  await assert.rejects(bad['google-play'].search({ country: 'ph', language: 'en', keyword: 'loan' }), /不是应用列表/);
  await assert.rejects(bad['google-play'].reviews({ country: 'ph', language: 'en', externalId: 'fixture.provider' }), /不是评论列表/);
  const apple = await bad['app-store'].app({ country: 'ph', language: 'en', externalId: '123456' });
  assert.equal(apple.developerLegalName, null); assert.equal(apple.sellerName, null); assert.equal(apple.raw?.futureNull, null);
  const reviews = await bad['app-store'].reviews({ country: 'ph', language: 'en', externalId: '123456' });
  assert.equal(reviews[0].language, 'und'); assert.deepEqual(reviews[0].raw?.customReviewField, [false]);
});

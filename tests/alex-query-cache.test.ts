import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryCache } from '../src/query-cache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('Alex SR-03/05: session reset rejects late success/error and same-key requests have one owner', async () => {
  const requests: Array<{ key: string; signal: AbortSignal } & ReturnType<typeof deferred<unknown>>> = [];
  const cache = createQueryCache({ fetcher: (key, signal) => {
    const request = { key, signal, ...deferred<unknown>() }; requests.push(request); return request.promise;
  } });
  const first = cache.fetch('/apps?country=ar');
  assert.equal(cache.fetch('/apps?country=ar'), first);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  cache.clear();
  assert.equal(requests[0].signal.aborted, true);
  const fresh = cache.fetch('/apps?country=ar');
  await Promise.resolve();
  requests[1].resolve({ apps: ['new-session'] });
  await fresh;
  requests[0].resolve({ apps: ['old-session'] });
  await first;
  assert.deepEqual(cache.read('/apps?country=ar').data, { apps: ['new-session'] });
  const stale = cache.fetch('/apps?country=mx'); await Promise.resolve();
  cache.clear();
  requests[2].reject(new Error('Old session failed'));
  await stale;
  assert.deepEqual(cache.keys(), []);
  assert.equal(cache.read('/apps?country=mx').error, '');
});

test('Alex SR-01/03: failed background refresh preserves data/time; keys are isolated and recover independently', async () => {
  let fail = false, now = 10;
  const cache = createQueryCache({ now: () => now, fetcher: async (key) => {
    if (fail && key.includes('ar')) throw new Error('Temporary source failure');
    return { key, generation: now };
  } });
  const ar = '/apps?country=ar&offset=20', mx = '/apps?country=mx&offset=20';
  await cache.fetch(ar); await cache.fetch(mx);
  fail = true; now = 20;
  const refresh = cache.fetch(ar);
  assert.equal(cache.read(ar).fetching, true);
  assert.deepEqual(cache.read(ar).data, { key: ar, generation: 10 });
  await refresh;
  assert.equal(cache.read(ar).error, 'Temporary source failure');
  assert.equal(cache.read(ar).updatedAt, 10);
  assert.equal(cache.read(mx).error, '');
  assert.deepEqual(cache.read(mx).data, { key: mx, generation: 10 });
  fail = false; now = 30; await cache.fetch(ar);
  assert.equal(cache.read(ar).error, '');
  assert.equal(cache.read(ar).updatedAt, 30);
  assert.deepEqual(cache.read(ar).data, { key: ar, generation: 30 });
});

test('Alex SR-03/05: the 21st query evicts an abandoned request; resubscription survives StrictMode cleanup', async () => {
  const old = deferred<unknown>(); let oldSignal: AbortSignal | undefined;
  const cache = createQueryCache({ fetcher: async (key, signal) => {
    if (key === 'old') { oldSignal = signal; return old.promise; }
    return key;
  } });
  const abandoned = cache.fetch('old'); await Promise.resolve();
  for (let i = 0; i < 20; i++) await cache.fetch(`query-${i}`);
  assert.equal(cache.keys().length, 20);
  assert.equal(oldSignal!.aborted, true);
  old.resolve('late evicted value'); await abandoned;
  assert.equal(cache.read('old').data, null);
  assert.equal(cache.keys().includes('old'), false);
  const pending = deferred<unknown>(); let activeSignal: AbortSignal | undefined;
  const subscribed = createQueryCache({ fetcher: async (_key, signal) => { activeSignal = signal; return pending.promise; } });
  const unsubscribe = subscribed.subscribe('current', () => {});
  const request = subscribed.fetch('current'); await Promise.resolve();
  unsubscribe();
  const unsubscribeAgain = subscribed.subscribe('current', () => {});
  await Promise.resolve();
  assert.equal(activeSignal!.aborted, false);
  unsubscribeAgain(); await Promise.resolve();
  assert.equal(activeSignal!.aborted, true);
  pending.resolve('ignored after unmount'); await request;
  assert.equal(subscribed.read('current').data, null);
  assert.equal(subscribed.read('current').fetching, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryCache } from '../src/query-cache.js';

const key = '/apps?country=ar&offset=0';
const list = (ids: number[], total = ids.length) => ({ apps: ids.map(id => ({ id, title: `Loan ${id}` })), total });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('Alex LRR: displayed members/total remain frozen while the newest pending payload replaces earlier pending; equivalent data is not a change', async () => {
  let value: unknown = list([1, 2], 30);
  const cache = createQueryCache({ fetcher: async () => structuredClone(value), stageUpdates: path => path.startsWith('/apps?') });
  await cache.fetch(key);
  const original = cache.read(key).data;
  value = { total: 30, apps: [{ title: 'Loan 1', id: 1 }, { title: 'Loan 2', id: 2 }] };
  await cache.fetch(key);
  assert.equal(cache.read(key).data, original);
  assert.equal(cache.read(key).hasPending, false);
  value = list([3, 1], 31); await cache.fetch(key);
  assert.equal(cache.read(key).data, original);
  assert.deepEqual(cache.read(key).pendingData, value);
  assert.equal(cache.read(key).hasPending, true);
  value = list([4], 1); await cache.fetch(key);
  assert.equal(cache.read(key).data, original);
  assert.deepEqual(cache.read(key).pendingData, value);
  value = list([1, 2], 30); await cache.fetch(key);
  assert.equal(cache.read(key).data, original);
  assert.equal(cache.read(key).hasPending, false);
  assert.equal(cache.read(key).pendingData, null);
});

test('Alex LRR: accepting pending is network-free; manual refresh joins one flight and only its success applies; later background data stages again', async () => {
  let value = list([1]), calls = 0;
  let gate: ReturnType<typeof deferred<ReturnType<typeof list>>> | null = null;
  const cache = createQueryCache({ fetcher: async () => { calls++; return gate ? gate.promise : value; }, stageUpdates: () => true });
  await cache.fetch(key); value = list([2]); await cache.fetch(key);
  gate = deferred(); const poll = cache.fetch(key); await Promise.resolve();
  const requestsBeforeApply = calls;
  assert.equal(cache.applyPending(key), true);
  assert.deepEqual(cache.read(key).data, list([2]));
  assert.equal(cache.read(key).hasPending, false);
  assert.equal(cache.applyPending(key), false);
  gate.resolve(list([3])); await poll;
  assert.equal(calls, requestsBeforeApply);
  assert.deepEqual(cache.read(key).data, list([2]));
  assert.deepEqual(cache.read(key).pendingData, list([3]));
  gate = deferred(); const nextPoll = cache.fetch(key); await Promise.resolve();
  const manual = cache.fetch(key, { apply: true });
  assert.equal(manual, nextPoll);
  assert.deepEqual(cache.read(key).data, list([2]), 'manual request is not a premature pending application');
  gate.resolve(list([4])); await manual;
  assert.equal(calls, requestsBeforeApply + 1);
  assert.deepEqual(cache.read(key).data, list([4]));
  assert.equal(cache.read(key).hasPending, false);
  gate = null; value = list([5]); await cache.fetch(key);
  assert.deepEqual(cache.read(key).data, list([4]));
  assert.deepEqual(cache.read(key).pendingData, list([5]));
});

test('Alex LRR: background failure preserves displayed and pending data; query switch/session clear never leaks old pending or late errors', async () => {
  let value = list([1]); let failure = false;
  let gate: ReturnType<typeof deferred<ReturnType<typeof list>>> | null = null;
  const other = '/apps?country=mx&offset=0';
  const cache = createQueryCache({ fetcher: async path => { if (gate) return gate.promise; if (failure) throw new Error('Synthetic background failure'); return path === other ? list([91]) : value; }, stageUpdates: () => true });
  await cache.fetch(key); value = list([2]); await cache.fetch(key);
  failure = true; await cache.fetch(key);
  assert.deepEqual(cache.read(key).data, list([1]));
  assert.deepEqual(cache.read(key).pendingData, list([2]));
  assert.match(cache.read(key).error, /Synthetic/);
  await cache.fetch(key, { apply: true });
  assert.deepEqual(cache.read(key).data, list([1]));
  assert.deepEqual(cache.read(key).pendingData, list([2]));
  failure = false; await cache.fetch(other);
  assert.deepEqual(cache.read(other).data, list([91]));
  assert.equal(cache.read(other).hasPending, false);
  gate = deferred(); const old = cache.fetch(key); await Promise.resolve();
  cache.clear(); gate.reject(new Error('Old session late failure')); gate = null; await old;
  assert.equal(cache.read(key).data, null); assert.equal(cache.read(key).pendingData, null);
  assert.equal(cache.read(key).error, ''); assert.equal(cache.read(other).data, null);
  value = list([5]); await cache.fetch(key);
  assert.deepEqual(cache.read(key).data, list([5])); assert.equal(cache.read(key).hasPending, false);
});

test('Alex LRR: staging applies only to selected library keys and both snapshots obey the same bounded cache', async () => {
  let value = list([1]);
  const cache = createQueryCache({ fetcher: async () => value, capacity: 2, stageUpdates: path => path.startsWith('/apps?') });
  await cache.fetch(key); value = list([2]); await cache.fetch(key);
  await cache.fetch('/apps/1'); value = list([3]); await cache.fetch('/apps/1');
  assert.deepEqual(cache.read('/apps/1').data, list([3]));
  assert.equal(cache.read('/apps/1').hasPending, false);
  await cache.fetch('/apps?country=mx');
  assert.equal(cache.keys().length, 2);
  assert.equal(cache.read(key).data, null); assert.equal(cache.read(key).pendingData, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryCache } from '../src/query-cache';

test('frontend #25: displayed records and totals stay atomic while the newest pending response replaces older candidates', async () => {
  let data = { apps: ['one'], total: 1 },
    fail = false,
    calls = 0,
    now = 1;
  const cache = createQueryCache({
    stageUpdates: () => true,
    now: () => now,
    fetcher: async () => {
      calls++;
      if (fail) throw new Error('Unavailable');
      return JSON.parse(JSON.stringify(data));
    },
  });
  await cache.fetch('list');
  const displayed = cache.read('list').data;
  data = { apps: ['two', 'one'], total: 2 };
  now = 2;
  await cache.fetch('list');
  assert.equal(cache.read('list').data, displayed);
  assert.equal(cache.read('list').displayedAt, 1);
  assert.deepEqual(cache.read('list').pendingData, data);
  data = { apps: ['three', 'two', 'one'], total: 3 };
  now = 3;
  await cache.fetch('list');
  const newest = cache.read('list').pendingData;
  assert.deepEqual(newest, data);
  fail = true;
  await cache.fetch('list', { apply: true });
  assert.equal(
    cache.read('list').data,
    displayed,
    'failed explicit refresh cannot apply prior pending',
  );
  assert.equal(cache.read('list').pendingData, newest);
  const before = calls;
  assert.equal(cache.applyPending('list'), true);
  assert.equal(
    calls,
    before,
    'applying a known successful candidate does not need another request',
  );
  assert.equal(cache.read('list').data, newest);
  assert.equal(cache.read('list').hasPending, false);
  assert.equal(cache.applyPending('list'), false);
});

test('frontend #25: unchanged JSON keeps its data identity; key order is immaterial and reverting to displayed clears a stale notice', async () => {
  let response: unknown = { rows: [{ id: 1, title: 'One' }], total: 1 };
  const cache = createQueryCache({ stageUpdates: () => true, fetcher: async () => response });
  await cache.fetch('list');
  const original = cache.read('list').data;
  response = { total: 1, rows: [{ title: 'One', id: 1 }] };
  await cache.fetch('list');
  assert.equal(cache.read('list').data, original);
  assert.equal(cache.read('list').hasPending, false);
  response = { total: 2, rows: [{ id: 2 }, { id: 1 }] };
  await cache.fetch('list');
  assert.equal(cache.read('list').hasPending, true);
  response = { total: 1, rows: [{ title: 'One', id: 1 }] };
  await cache.fetch('list');
  assert.equal(cache.read('list').data, original);
  assert.equal(cache.read('list').hasPending, false);
  assert.equal(cache.read('list').pendingData, null);
});

test('frontend #25: an explicit refresh joins a pending flight and only applies its eventual success', async () => {
  let resolve!: (data: unknown) => void;
  let delayed = false,
    calls = 0;
  const cache = createQueryCache({
    stageUpdates: () => true,
    fetcher: async () => {
      calls++;
      return delayed
        ? new Promise((done) => {
            resolve = done;
          })
        : { apps: ['one'], total: 1 };
    },
  });
  await cache.fetch('list');
  delayed = true;
  const background = cache.fetch('list');
  await Promise.resolve();
  assert.equal(cache.fetch('list', { apply: true }), background);
  assert.deepEqual(cache.read('list').data, { apps: ['one'], total: 1 });
  resolve({ apps: ['two'], total: 1 });
  await background;
  assert.deepEqual(cache.read('list').data, { apps: ['two'], total: 1 });
  assert.equal(cache.read('list').hasPending, false);
  assert.equal(calls, 2);
});

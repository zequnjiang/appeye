import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApp, normalizeReview } from '../server/providers.js';
import { createStore } from '../server/db.js';

test('AC-06/08: adapter normalizes source values, unknowns, raw evidence and App Store rating count', () => {
  const raw = { appId: 'fixture.credit', title: 'Fixture', ratings: 250, reviews: 45, score: '4.2', released: '2025-01-02', updated: 1738540800000, installs: '10,000+', minInstalls: 10000, price: 0, currency: 'THB' };
  const gp = normalizeApp(raw, 'google-play');
  assert.equal(gp.externalId, 'fixture.credit');
  assert.equal(gp.score, 4.2);
  assert.equal(gp.ratings, 250);
  assert.equal(gp.reviewCount, 45);
  assert.equal(gp.price, 0);
  assert.equal(gp.releasedAt, '2025-01-02T00:00:00.000Z');
  assert.equal(gp.raw, raw);
  const apple = normalizeApp({ id: 123456, appId: 'fixture.bundle', title: 'Apple Fixture', reviews: 123, installs: 999, minInstalls: 888, maxInstalls: 777 }, 'app-store');
  assert.equal(apple.externalId, '123456');
  assert.equal(apple.bundleId, 'fixture.bundle');
  assert.equal(apple.ratings, 123);
  assert.equal(apple.reviewCount, null);
  assert.deepEqual([apple.installs, apple.minInstalls, apple.maxInstalls], [null, null, null]);
  assert.equal(apple.releasedAt, null);
  assert.equal(normalizeApp({ appId: 'fixture.empty', title: 'Empty', score: 'bad', released: 'bad date' }, 'google-play').score, null);
  assert.throws(() => normalizeApp({ title: 'No ID' }, 'google-play'), /缺少应用 ID/);
  assert.throws(() => normalizeApp({ appId: 'fixture.id' }, 'google-play'), /缺少应用 ID 或名称/);
});

test('AC-09 / ALEX-01 regression: reviews without upstream ID receive stable documented content IDs and deduplicate', () => {
  const raw = { userName: 'Example', text: 'Fixture review', score: 4, date: '2025-01-02T00:00:00Z' };
  const first = normalizeReview(raw, 'th');
  const repeated = normalizeReview({ ...raw }, 'th');
  const changed = normalizeReview({ ...raw, text: 'Different fixture review' }, 'th');
  assert.match(first.externalId, /^content:[a-f0-9]{64}$/);
  assert.equal(repeated.externalId, first.externalId);
  assert.notEqual(changed.externalId, first.externalId);
  assert.equal((first.raw as { _appeye: { reviewIdSource: string } })._appeye.reviewIdSource, 'content-hash');
  assert.equal((first.raw as { text: string }).text, raw.text);
  assert.equal(first.reviewedAt, '2025-01-02T00:00:00.000Z');
  const store = createStore();
  try {
    const app = store.createApp({ country: 'th', store: 'google-play', externalId: 'fixture.credit' });
    store.saveReviews(app.id, [first, repeated, changed]);
    assert.equal(store.listReviews(app.id).total, 2);
  } finally { store.close(); }
});

test('AC-09: stable upstream review IDs remain unchanged and unknown App Store language is explicit', () => {
  const raw = { id: 12345, text: 'Example', score: '5', updated: '2025-02-01' };
  const review = normalizeReview(raw, 'und');
  assert.equal(review.externalId, '12345');
  assert.equal(review.score, 5);
  assert.equal(review.language, 'und');
  assert.equal(review.raw, raw);
  assert.equal(review.reviewedAt, '2025-02-01T00:00:00.000Z');
});

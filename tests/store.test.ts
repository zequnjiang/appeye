import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/db.js';
import { creditApp, creditReview } from './fixtures.js';

test('AC-03: six countries and editable country settings survive reopening SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-alex-country-'));
  const path = join(directory, 'test.sqlite');
  let store = createStore(path);
  try {
    assert.deepEqual(store.listCountries().map(c => c.code).sort(), ['ar', 'id', 'mx', 'ph', 'pk', 'th']);
    assert.ok(store.listCountries().every(c => c.enabled && c.keywords.length > 0));
    const country = { code: 'vn', name: '越南', language: 'vi', keywords: ['vay', 'tín dụng'], enabled: false, intervalHours: 48 };
    store.upsertCountry(country);
    store.close();
    store = createStore(path);
    const restored = store.getCountry('vn');
    assert.ok(restored);
    for (const [key, value] of Object.entries(country)) assert.deepEqual(restored[key as keyof typeof restored], value);
    assert.equal(store.listCountries().length, 7);
    assert.equal(store.one('PRAGMA foreign_keys')?.foreign_keys, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('AC-04/05: identity is unique within country/store and isolated across both', () => {
  const store = createStore();
  try {
    const input = { store: 'google-play' as const, externalId: creditApp.externalId, country: 'th', data: creditApp };
    const first = store.createApp(input);
    store.updateClassification(first.id, 'confirmed');
    const duplicate = store.createApp({ ...input, sourceKeyword: 'loan' });
    const otherCountry = store.createApp({ ...input, country: 'mx' });
    const otherStore = store.createApp({ ...input, store: 'app-store' });
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.firstSeenAt, first.firstSeenAt);
    assert.equal(duplicate.classification, 'confirmed');
    assert.equal(otherCountry.classification, 'candidate');
    assert.equal(otherStore.classification, 'candidate');
    assert.equal(new Set([first.id, otherCountry.id, otherStore.id]).size, 3);
    assert.equal(store.listApps().total, 3);
    assert.throws(() => store.createApp({ ...input, country: 'zz' }), /FOREIGN KEY/);
  } finally { store.close(); }
});

test('AC-06/08: first observation differs from release date, unknowns are null, App Store installs are never fabricated', () => {
  const store = createStore();
  try {
    const gp = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'th' });
    assert.equal(gp.releasedAt, null);
    assert.equal(gp.score, null);
    assert.equal(gp.lastFetchedAt, null);
    store.saveObservation(gp.id, creditApp);
    const current = store.getApp(gp.id)!;
    assert.equal(current.firstSeenAt, gp.firstSeenAt);
    assert.equal(current.releasedAt, creditApp.releasedAt);
    assert.notEqual(current.firstSeenAt, current.releasedAt);
    assert.equal(current.installs, '10,000+');
    assert.deepEqual(store.listSnapshots(gp.id).snapshots[0].raw, { fixture: true });
    const apple = store.createApp({ store: 'app-store', externalId: '123456', country: 'th', data: { ...creditApp, externalId: '123456' } });
    store.saveObservation(apple.id, { ...creditApp, externalId: '123456' });
    const appleCurrent = store.getApp(apple.id)!;
    assert.deepEqual([appleCurrent.installs, appleCurrent.minInstalls, appleCurrent.maxInstalls], [null, null, null]);
    assert.equal(store.listSnapshots(apple.id).snapshots[0].data.installs, null);
  } finally { store.close(); }
});

test('AC-07: repeated observation creates history without false changes; actual changes preserve both values', () => {
  const store = createStore();
  try {
    const app = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'ph' });
    store.saveObservation(app.id, creditApp, '2026-01-01T00:00:00.000Z');
    assert.equal(store.listChanges({ appId: app.id }).total, 0);
    store.saveObservation(app.id, creditApp, '2026-01-02T00:00:00.000Z');
    assert.equal(store.listSnapshots(app.id).total, 2);
    assert.equal(store.listChanges({ appId: app.id }).total, 0);
    const revision = { ...creditApp, version: '2.0.0', description: 'Changed fixture description', score: 4.2, ratings: 200 };
    const changedSnapshot = store.saveObservation(app.id, revision, '2026-01-03T00:00:00.000Z');
    const changes = store.listChanges({ appId: app.id });
    assert.deepEqual(changes.changes.map(c => c.field).sort(), ['description', 'ratings', 'score', 'version']);
    assert.equal(changes.changes.find(c => c.field === 'version')?.oldValue, '1.0.0');
    assert.equal(changes.changes.find(c => c.field === 'version')?.newValue, '2.0.0');
    assert.ok(changes.changes.every(c => c.snapshotId === changedSnapshot.id), 'each change links to its observation evidence');
    assert.equal(store.getApp(app.id)?.updateCount, 1);
    assert.equal(store.getApp(app.id)?.observedUpdateIntervalDays, null);
    store.saveObservation(app.id, { ...revision, score: 4.5 }, '2026-01-04T00:00:00.000Z');
    assert.equal(store.getApp(app.id)?.updateCount, 1, 'score changes are not version updates');
    store.saveObservation(app.id, { ...revision, version: '3.0.0' }, '2026-01-10T00:00:00.000Z');
    assert.equal(store.getApp(app.id)?.updateCount, 2);
    assert.equal(store.getApp(app.id)?.observedUpdateIntervalDays, 7);
  } finally { store.close(); }
});

test('AC-05/07: manual classification persists; wrong provider identity cannot overwrite latest successful state', () => {
  const store = createStore();
  try {
    const app = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'id' });
    store.updateClassification(app.id, 'excluded');
    store.saveObservation(app.id, creditApp);
    const successful = store.getApp(app.id)!;
    assert.equal(successful.classification, 'excluded');
    assert.throws(() => store.saveObservation(app.id, { ...creditApp, externalId: 'wrong.id', title: 'Wrong' }), /different externalId/);
    store.setAppError(app.id, 'Fixture request failed');
    assert.equal(store.getApp(app.id)?.title, successful.title);
    assert.equal(store.getApp(app.id)?.lastFetchedAt, successful.lastFetchedAt);
    assert.equal(store.listSnapshots(app.id).total, 1);
    assert.equal(store.getApp(app.id)?.lastError, 'Fixture request failed');
  } finally { store.close(); }
});

test('AC-09: review IDs deduplicate within an app and preserve collection country/language', () => {
  const store = createStore();
  try {
    const one = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'ph' });
    const two = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'mx' });
    store.saveReviews(one.id, [creditReview, creditReview]);
    store.saveReviews(one.id, [{ ...creditReview, text: 'Edited review', replyText: 'Developer reply' }]);
    store.saveReviews(two.id, [{ ...creditReview, language: 'es' }]);
    assert.equal(store.listReviews(one.id).total, 1);
    const review = store.listReviews(one.id).reviews[0];
    assert.equal(review.text, 'Edited review');
    assert.equal(review.replyText, 'Developer reply');
    assert.equal(review.country, 'ph');
    assert.equal(review.language, 'en');
    assert.equal(review.version, '1.0.0');
    assert.equal(store.listReviews(two.id).reviews[0].country, 'mx');
    assert.equal(store.listReviews(two.id, { score: 1 }).total, 0);
  } finally { store.close(); }
});

test('AC-07 / ALEX-04 regression: missing version and recovery do not count as releases; a new known version counts once', () => {
  const store = createStore();
  try {
    const app = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'th' });
    store.saveObservation(app.id, creditApp, '2026-01-01T00:00:00.000Z');
    store.saveObservation(app.id, { ...creditApp, version: null }, '2026-01-02T00:00:00.000Z');
    store.saveObservation(app.id, creditApp, '2026-01-03T00:00:00.000Z');
    assert.equal(store.getApp(app.id)?.updateCount, 0, 'version disappearance/recovery is not a release');
    store.saveObservation(app.id, { ...creditApp, version: null }, '2026-01-04T00:00:00.000Z');
    store.saveObservation(app.id, { ...creditApp, version: '2.0.0' }, '2026-01-05T00:00:00.000Z');
    assert.equal(store.getApp(app.id)?.updateCount, 1, 'known version transition across a missing observation counts once');
    assert.equal(store.getApp(app.id)?.observedUpdateIntervalDays, null);
    assert.ok(store.listChanges({ appId: app.id, field: 'version' }).changes.some(change => change.newValue === null), 'raw missing-data changes remain auditable');
  } finally { store.close(); }
});

test('AC-09 / ALEX-05 regression: a stable review ID remains unique when collection language changes', () => {
  const store = createStore();
  try {
    const app = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'pk' });
    store.saveReviews(app.id, [{ ...creditReview, language: 'en' }]);
    store.upsertCountry({ ...store.getCountry('pk')!, language: 'ur' });
    store.saveReviews(app.id, [{ ...creditReview, language: 'ur', text: 'Updated collected review' }]);
    assert.equal(store.listReviews(app.id).total, 1, 'one upstream review must not become two sample records');
    assert.equal(store.listReviews(app.id).reviews[0].language, 'ur');
    assert.equal(store.listReviews(app.id).reviews[0].country, 'pk');
    assert.equal(store.listReviews(app.id).reviews[0].text, 'Updated collected review');
  } finally { store.close(); }
});

test('AC-09 / ALEX-05 migration: legacy duplicate review languages collapse to the latest collected representation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-alex-review-migration-'));
  const path = join(directory, 'test.sqlite');
  let store = createStore(path);
  try {
    const app = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'pk' });
    store.saveReviews(app.id, [{ ...creditReview, language: 'en' }]);
    // Recreate the pre-004 layout and data without modifying any production database.
    store.run('DROP INDEX reviews_stable_identity');
    store.run('DELETE FROM schema_migrations WHERE version=?', '004_review_identity.sql');
    store.run(`INSERT INTO reviews(app_id,external_id,country,language,user_name,title,text,score,version,reviewed_at,reply_text,fetched_at,raw)
      SELECT app_id,external_id,country,'ur',user_name,title,'Latest legacy representation',score,version,reviewed_at,reply_text,'2099-01-01T00:00:00.000Z',raw FROM reviews WHERE app_id=?`, app.id);
    assert.equal(store.listReviews(app.id).total, 2);
    store.close();
    store = createStore(path);
    const migrated = store.listReviews(app.id);
    assert.equal(migrated.total, 1);
    assert.equal(migrated.reviews[0].language, 'ur');
    assert.equal(migrated.reviews[0].text, 'Latest legacy representation');
    store.saveReviews(app.id, [creditReview]);
    assert.equal(store.listReviews(app.id).total, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('AC-11: country, store, classification, literal text and pagination filters compose', () => {
  const store = createStore();
  try {
    const special = store.createApp({ store: 'google-play', externalId: 'fixture.one', country: 'th', title: '100%_Credit' });
    store.updateClassification(special.id, 'confirmed');
    store.createApp({ store: 'google-play', externalId: 'fixture.two', country: 'th', title: 'Other Credit' });
    store.createApp({ store: 'app-store', externalId: '456789', country: 'mx', title: 'Credit' });
    const result = store.listApps({ country: 'th', store: 'google-play', classification: 'confirmed', q: '%_' });
    assert.equal(result.total, 1);
    assert.equal(result.apps[0].id, special.id);
    assert.equal(store.listApps({ q: "' OR 1=1 --" }).total, 0);
    const page = store.listApps({ q: 'Credit', limit: 1, offset: 1 });
    assert.equal(page.total, 3);
    assert.equal(page.apps.length, 1);
    assert.equal(store.listApps({ limit: 1, offset: 100 }).apps.length, 0);
  } finally { store.close(); }
});

test('AC-10: pending/running jobs survive restart, attempts remain finite and future jobs are not claimed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-alex-job-'));
  const path = join(directory, 'test.sqlite');
  let store = createStore(path);
  try {
    const retryable = store.enqueueJob({ type: 'discover', country: 'th', store: 'google-play', maxAttempts: 2 });
    const final = store.enqueueJob({ type: 'discover', country: 'mx', store: 'google-play', maxAttempts: 1 });
    const future = store.enqueueJob({ type: 'discover', country: 'ph', store: 'google-play', nextRunAt: '2099-01-01T00:00:00.000Z' });
    assert.equal(store.enqueueJob({ type: 'discover', country: 'th', store: 'google-play' }).id, retryable.id);
    assert.equal(store.claimJob()?.id, retryable.id);
    assert.equal(store.claimJob()?.id, final.id);
    store.close();
    store = createStore(path);
    assert.equal(store.recoverRunningJobs(), 2);
    assert.equal(store.getJob(retryable.id)?.status, 'queued');
    assert.equal(store.getJob(final.id)?.status, 'failed');
    assert.equal(store.getJob(future.id)?.status, 'queued');
    assert.equal(store.claimJob()?.id, retryable.id);
    store.failJob(retryable.id, 'Second failure', 0);
    assert.equal(store.getJob(retryable.id)?.attempts, 2);
    assert.equal(store.getJob(retryable.id)?.status, 'failed');
    assert.equal(store.claimJob(), undefined);
    assert.equal(store.retryJob(final.id)?.attempts, 0);
    assert.equal(store.claimJob()?.id, final.id);
    store.completeJob(final.id, { recovered: true });
    assert.equal(store.getJob(final.id)?.status, 'succeeded');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('AC-10: schedule honors enabled countries, due interval, active dedupe and excluded applications', () => {
  const store = createStore();
  try {
    for (const country of store.listCountries()) store.upsertCountry({ ...country, enabled: country.code === 'th', intervalHours: 24 });
    const app = store.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'th' });
    const excluded = store.createApp({ store: 'google-play', externalId: 'fixture.excluded', country: 'th' });
    store.updateClassification(excluded.id, 'excluded');
    assert.equal(store.scheduleDueJobs('2026-01-01T00:00:00.000Z'), 2);
    const first = store.listJobs().jobs;
    assert.ok(first.every(job => job.country === 'th'));
    assert.ok(first.some(job => job.type === 'discover' && job.store === 'google-play'));
    assert.ok(first.some(job => job.type === 'discover' && job.store === 'app-store'));
    assert.ok(first.some(job => job.type === 'refresh' && job.appId === app.id));
    assert.ok(!first.some(job => job.appId === excluded.id));
    const initialCount = first.length;
    assert.equal(store.scheduleDueJobs('2026-01-01T01:00:00.000Z'), 0);
    assert.equal(store.scheduleDueJobs('2026-01-02T01:00:00.000Z'), 2);
    assert.equal(store.listJobs().total, initialCount, 'active jobs should deduplicate across due schedules');
    const country = store.getCountry('th')!;
    store.upsertCountry({ ...country, enabled: false });
    assert.equal(store.scheduleDueJobs('2026-01-03T01:00:00.000Z'), 0);
    assert.equal(store.listJobs().total, initialCount);
  } finally { store.close(); }
});

test('AC-13: separate database files isolate demonstration observations from live observations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-alex-isolation-'));
  const live = createStore(join(directory, 'live.sqlite'));
  const demo = createStore(join(directory, 'demo.sqlite'));
  try {
    live.setDataset('live');
    demo.setDataset('demo');
    assert.throws(() => demo.setDataset('live'), /拒绝以 live 模式打开/);
    assert.throws(() => live.setDataset('demo'), /拒绝以 demo 模式打开/);
    const app = demo.createApp({ store: 'google-play', externalId: creditApp.externalId, country: 'ar' });
    demo.saveObservation(app.id, creditApp);
    assert.equal(demo.listApps().total, 1);
    assert.equal(live.listApps().total, 0);
    assert.equal(live.overview().stats.changes7d, 0);
  } finally { live.close(); demo.close(); rmSync(directory, { recursive: true, force: true }); }
});

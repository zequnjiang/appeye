import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { normalizeApp } from '../server/normalization.js';
import { facilitatorFixture } from './loan-fixtures.js';
import { permissionsResult, applePrivacyResult } from './enrichment-fixtures.js';

test('V2-AC-05: new strong analysis can confirm, all manual decisions survive refresh, and only explicit auto restores automation', () => {
  const store = createStore();
  try {
    const data = { ...facilitatorFixture, version: '1.0' };
    const app = store.createApp({ store: data.store, country: data.country, externalId: data.externalId, data });
    assert.equal(app.manualOverride, false);
    assert.equal(app.classificationSource, 'auto');
    assert.equal(app.classification, 'confirmed');
    for (const classification of ['candidate', 'excluded', 'confirmed'] as const) {
      store.updateClassification(app.id, classification);
      store.saveObservation(app.id, data);
      const result = store.getApp(app.id)!;
      assert.equal(result.classification, classification);
      assert.equal(result.effectiveClassification, classification);
      assert.equal(result.classificationSource, 'manual');
      assert.equal(result.manualOverride, true);
      assert.equal(result.loanAnalysis?.verdict, 'strong');
    }
    store.updateClassification(app.id, 'excluded');
    const automatic = store.setClassificationMode(app.id, 'auto')!;
    assert.equal(automatic.manualOverride, false);
    assert.equal(automatic.classificationSource, 'auto');
    assert.equal(automatic.classification, 'confirmed');
    assert.equal(store.listApps({ classification: 'confirmed', loanVerdict: 'strong' }).total, 1);
  } finally { store.close(); }
});

test('V2-AC-09/11: failed and unsupported enrichment retain the last successful payload and separately report attempt context', () => {
  const store = createStore();
  try {
    const app = store.createApp({ store: 'google-play', country: 'th', externalId: 'fixture.enrichment' });
    assert.deepEqual(store.listEnrichments(app.id), []);
    store.saveEnrichment(app.id, 'permissions', permissionsResult, '2026-01-01T00:00:00.000Z');
    const failure = store.failEnrichment(app.id, 'permissions', 'Fixture timeout', {
      source: 'https://example.invalid/changed-source', requestCountry: 'mx', requestLanguage: 'es',
    }, '2026-01-02T00:00:00.000Z');
    assert.equal(failure.status, 'failed');
    assert.equal(failure.error, 'Fixture timeout');
    assert.deepEqual(failure.data, permissionsResult.data);
    assert.deepEqual(failure.raw, permissionsResult.raw);
    assert.equal(failure.lastSuccessAt, '2026-01-01T00:00:00.000Z');
    assert.equal(failure.fetchedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(failure.lastAttemptAt, '2026-01-02T00:00:00.000Z');
    assert.equal(failure.source, permissionsResult.source);
    assert.equal(failure.requestCountry, 'th');
    assert.equal(failure.attemptRequestCountry, 'mx');
    assert.equal(failure.attemptRequestLanguage, 'es');
    const unsupported = store.saveEnrichment(app.id, 'permissions', {
      status: 'unsupported', data: null, raw: null, source: 'https://example.invalid/unsupported',
      requestCountry: 'th', requestLanguage: 'th', note: 'No compatible adapter',
    }, '2026-01-03T00:00:00.000Z');
    assert.equal(unsupported.status, 'unsupported');
    assert.deepEqual(unsupported.raw, permissionsResult.raw);
    assert.equal(unsupported.lastSuccessAt, '2026-01-01T00:00:00.000Z');
    const history = store.listEnrichmentHistory(app.id, 'permissions');
    assert.equal(history.total, 3);
    assert.deepEqual(history.history.map(item => item.status), ['unsupported', 'failed', 'available']);
    assert.equal(history.history[1].error, 'Fixture timeout');
    assert.deepEqual(history.history[2].raw, permissionsResult.raw);
  } finally { store.close(); }
});

test('V2-AC-09/11: first failure is not an empty success; successful empty response is distinguishable and updates success time', () => {
  const store = createStore();
  try {
    const app = store.createApp({ store: 'app-store', country: 'th', externalId: '123456' });
    const failure = store.failEnrichment(app.id, 'privacy', 'Fixture unavailable', {
      source: applePrivacyResult.source, requestCountry: 'th', requestLanguage: null,
    }, '2026-01-01T00:00:00.000Z');
    assert.equal(failure.status, 'failed');
    assert.equal(failure.data, null);
    assert.equal(failure.raw, null);
    assert.equal(failure.lastSuccessAt, null);
    store.saveEnrichment(app.id, 'privacy', applePrivacyResult, '2026-01-02T00:00:00.000Z');
    const empty = store.saveEnrichment(app.id, 'privacy', {
      ...applePrivacyResult, status: 'empty', data: [], raw: [],
    }, '2026-01-03T00:00:00.000Z');
    assert.equal(empty.status, 'empty');
    assert.deepEqual(empty.data, []);
    assert.deepEqual(empty.raw, []);
    assert.equal(empty.error, null);
    assert.equal(empty.lastSuccessAt, '2026-01-03T00:00:00.000Z');
    assert.equal(store.listEnrichmentHistory(app.id, 'privacy', 1, 1).history[0].status, 'available');
    assert.equal(store.listEnrichmentHistory(app.id, 'privacy', 1, 1).total, 3);
    assert.equal(store.listEnrichmentHistory(app.id, 'permissions').total, 0);
  } finally { store.close(); }
});

test('V2-AC-09: unknown nested detail/search/review fields survive normalization and all repeated search responses remain inspectable', () => {
  const store = createStore();
  try {
    const raw = {
      appId: 'fixture.raw.complete', title: 'Fixture Raw', developer: 'Display Brand',
      developerLegalName: 'Stated Development Entity', sellerName: 'Stated Sales Entity',
      descriptionHTML: '<p>Untouched original</p><img src=x onerror="alert(1)">',
      newUpstreamField: { values: ['คำ', 0, false, null], nested: { untouched: true } },
      developerEmail: 'fixture@example.invalid', screenshots: ['https://example.invalid/shot.png'],
    };
    const normalized = normalizeApp(raw, 'google-play');
    const app = store.createApp({ store: 'google-play', country: 'th', externalId: raw.appId });
    store.saveObservation(app.id, normalized);
    assert.deepEqual(store.getRawDetail(app.id), raw);
    assert.deepEqual(store.getApp(app.id)?.storeData, raw);
    assert.equal(store.getApp(app.id)?.developer, 'Display Brand');
    assert.equal(store.getApp(app.id)?.developerLegalName, 'Stated Development Entity');
    assert.equal(store.getApp(app.id)?.sellerName, 'Stated Sales Entity');
    store.recordDiscovery(app.id, { keyword: 'loan', requestCountry: 'th', requestLanguage: 'th', source: 'fixture-search', data: normalized, raw });
    const changedSearch = { ...raw, unseenSearchField: { secondObservation: true } };
    store.recordDiscovery(app.id, { keyword: 'credit', requestCountry: 'th', requestLanguage: 'en', source: 'fixture-search', data: normalized, raw: changedSearch });
    assert.equal(store.listDiscoveries(app.id).total, 2);
    assert.deepEqual(store.listDiscoveries(app.id).discoveries[0].raw, changedSearch);
    assert.equal(store.listDiscoveries(app.id).discoveries[0].requestLanguage, 'en');
    assert.deepEqual(store.listDiscoveries(app.id, 1, 1).discoveries[0].raw, raw);
    store.saveReviews(app.id, [{ externalId: 'fixture-review', text: 'Text', raw: { unknownReviewField: { preserved: true } } }]);
    assert.deepEqual(store.listReviews(app.id).reviews[0].raw, { unknownReviewField: { preserved: true } });
  } finally { store.close(); }
});

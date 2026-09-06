import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createApp } from '../server/app.js';
import { normalizeApp } from '../server/normalization.js';
import { serve } from './http-helper.js';
import { facilitatorFixture } from './loan-fixtures.js';
import { permissionsResult } from './enrichment-fixtures.js';

async function harness(demoMode = false) {
  const store = createStore();
  const http = await serve(createApp({ store, password: 'fixture-v02-password', demoMode }));
  return {
    store,
    http,
    login: () =>
      http.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'fixture-v02-password' }),
      }),
    async close() {
      await http.close();
      store.close();
    },
  };
}

test('V2-AC-05/09/10/12: authenticated full detail retains unknown data, separates companies, exposes provenance and preserves manual precedence', async () => {
  const h = await harness();
  try {
    const raw = {
      appId: 'fixture.full.api',
      title: facilitatorFixture.title,
      description: facilitatorFixture.description,
      developer: 'Fixture Display Brand',
      developerLegalName: 'Fixture Development Entity',
      sellerName: 'Fixture Seller Entity',
      unknownFutureField: { nested: [false, null, 'ไทย'] },
      descriptionHTML: '<img src=x onerror="alert(1)">',
      url: 'javascript:alert(1)',
    };
    const app = h.store.createApp({ store: 'google-play', country: 'ph', externalId: raw.appId });
    h.store.saveObservation(app.id, normalizeApp(raw, 'google-play'));
    h.store.saveEnrichment(app.id, 'permissions', permissionsResult, '2026-01-01T00:00:00.000Z');
    h.store.failEnrichment(
      app.id,
      'permissions',
      'Fixture timeout',
      { ...permissionsResult, requestLanguage: 'en' },
      '2026-01-02T00:00:00.000Z',
    );
    assert.equal((await h.http.request(`/api/apps/${app.id}/enrichments`)).status, 401);
    assert.equal((await h.http.request(`/api/apps/${app.id}/discoveries`)).status, 401);
    assert.equal(
      (await h.http.request(`/api/apps/${app.id}/enrichments/permissions/history`)).status,
      401,
    );
    await h.login();
    const detail = await (await h.http.request(`/api/apps/${app.id}`)).json();
    assert.deepEqual(detail.rawDetail, raw);
    assert.deepEqual(detail.app.storeData, raw);
    assert.equal(detail.app.developer, 'Fixture Display Brand');
    assert.equal(detail.app.developerLegalName, 'Fixture Development Entity');
    assert.equal(detail.app.sellerName, 'Fixture Seller Entity');
    assert.equal(detail.app.loanAnalysis.verdict, 'strong');
    assert.ok(detail.app.loanAnalysis.ruleVersion);
    assert.equal(detail.enrichments[0].status, 'failed');
    assert.equal(detail.enrichments[0].error, 'Fixture timeout');
    assert.deepEqual(detail.enrichments[0].raw, permissionsResult.raw);
    assert.equal(detail.enrichments[0].lastSuccessAt, '2026-01-01T00:00:00.000Z');
    assert.equal(detail.enrichments[0].attemptRequestLanguage, 'en');
    const patch = (body: unknown) =>
      h.http.request(`/api/apps/${app.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    assert.equal((await patch({ classification: 'excluded' })).status, 200);
    h.store.saveObservation(app.id, normalizeApp(raw, 'google-play'));
    assert.equal(
      (await (await h.http.request('/api/apps?classification=excluded&loanVerdict=strong')).json())
        .total,
      1,
    );
    assert.equal(
      (await (await h.http.request('/api/apps?classification=confirmed')).json()).total,
      0,
    );
    const auto = await (await patch({ mode: 'auto' })).json();
    assert.equal(auto.app.classificationSource, 'auto');
    assert.equal(auto.app.manualOverride, false);
    assert.equal(auto.app.classification, 'confirmed');
    assert.equal((await patch({ mode: 'auto', classification: 'excluded' })).status, 400);
    assert.equal((await h.http.request('/api/apps?loanVerdict=licensed')).status, 400);
  } finally {
    await h.close();
  }
});

test('V2-AC-09/11/12: complete discovery/enrichment history is paginated beyond detail previews and invalid routes are bounded', async () => {
  const h = await harness();
  try {
    const app = h.store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: 'fixture.history.api',
    });
    for (let index = 0; index < 23; index++)
      h.store.recordDiscovery(app.id, {
        keyword: `fixture-${index}`,
        requestCountry: 'th',
        requestLanguage: 'th',
        source: 'https://example.invalid/search',
        data: { externalId: app.externalId, title: 'Fixture' },
        raw: { futureIndex: index, unknown: ['full'] },
      });
    h.store.saveEnrichment(app.id, 'permissions', permissionsResult, '2026-01-01T00:00:00.000Z');
    h.store.failEnrichment(
      app.id,
      'permissions',
      'Fixture failure',
      permissionsResult,
      '2026-01-02T00:00:00.000Z',
    );
    await h.login();
    assert.equal(
      (await (await h.http.request(`/api/apps/${app.id}`)).json()).discoveries.length,
      20,
    );
    const rest = await (
      await h.http.request(`/api/apps/${app.id}/discoveries?limit=20&offset=20`)
    ).json();
    assert.equal(rest.total, 23);
    assert.equal(rest.discoveries.length, 3);
    assert.deepEqual(rest.discoveries.at(-1).raw, { futureIndex: 0, unknown: ['full'] });
    const history = await (
      await h.http.request(`/api/apps/${app.id}/enrichments/permissions/history?limit=1&offset=1`)
    ).json();
    assert.equal(history.total, 2);
    assert.equal(history.history[0].status, 'available');
    assert.deepEqual(history.history[0].raw, permissionsResult.raw);
    for (const path of [
      `/api/apps/${app.id}/enrichments/manifest/history`,
      `/api/apps/${app.id}/enrichments/privacy/history?offset=-1`,
      `/api/apps/${app.id}/discoveries?limit=1001`,
    ])
      assert.equal((await h.http.request(path)).status, 400, path);
    assert.equal((await h.http.request('/api/apps/999999/enrichments')).status, 404);
    const job = await h.http.request('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ type: 'enrich', appId: app.id }),
    });
    assert.equal(job.status, 202);
    assert.equal(h.store.listJobs({ type: 'enrich' }).total, 1);
  } finally {
    await h.close();
  }
});

test('V2-AC-11/12: demo rejects enrichment collection while preserving safe local classification controls', async () => {
  const h = await harness(true);
  try {
    const app = h.store.createApp({
      store: 'google-play',
      country: 'ph',
      externalId: facilitatorFixture.externalId,
      data: facilitatorFixture,
    });
    await h.login();
    assert.equal(
      (
        await h.http.request('/api/jobs', {
          method: 'POST',
          body: JSON.stringify({ type: 'enrich', appId: app.id }),
        })
      ).status,
      409,
    );
    assert.equal(h.store.listJobs().total, 0);
    assert.equal(
      (
        await h.http.request(`/api/apps/${app.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ classification: 'excluded' }),
        })
      ).status,
      200,
    );
    assert.equal(h.store.getApp(app.id)?.classification, 'excluded');
  } finally {
    await h.close();
  }
});

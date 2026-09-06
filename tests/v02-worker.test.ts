import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createWorker } from '../server/worker.js';
import { enrichmentKinds, type EnrichmentKind } from '../server/types.js';
import { creditApp, fixtureProvider, fixtureProviders } from './fixtures.js';
import { permissionsResult } from './enrichment-fixtures.js';

test('V2-AC-09/11: failed enrichment is independently retryable, retains old success and allows other kinds and app detail to succeed', async () => {
  const store = createStore();
  const calls: EnrichmentKind[] = [];
  const provider = fixtureProvider({
    enrich: async (input) => {
      calls.push(input.kind);
      assert.equal(input.developerId, 'fixture-developer');
      assert.ok(input.signal instanceof AbortSignal);
      if (input.kind === 'permissions') throw new Error('Fixture permissions failed');
      return {
        status: 'available',
        data: { kind: input.kind, unknownField: [0, false] },
        raw: { untouched: input.kind },
        source: 'https://example.invalid/' + input.kind,
        requestCountry: input.country,
        requestLanguage: input.language,
      };
    },
  });
  const worker = createWorker({
    store,
    providers: fixtureProviders({ 'google-play': provider }),
    requestDelayMs: 0,
    retryDelayMs: 0,
    maxAttempts: 2,
    schedule: false,
  });
  try {
    const app = store.createApp({
      store: 'google-play',
      country: 'th',
      externalId: creditApp.externalId,
    });
    store.saveObservation(app.id, { ...creditApp, developerId: 'fixture-developer' });
    store.saveEnrichment(app.id, 'permissions', permissionsResult, '2026-01-01T00:00:00.000Z');
    const job = store.enqueueJob({
      type: 'enrich',
      appId: app.id,
      country: 'th',
      store: 'google-play',
      maxAttempts: 2,
    });
    assert.equal(await worker.runOnce(), true);
    assert.equal(store.getJob(job.id)?.status, 'queued');
    assert.equal(store.listEnrichments(app.id).length, enrichmentKinds.length);
    assert.equal(
      store.listEnrichments(app.id).filter((item) => item.status === 'available').length,
      enrichmentKinds.length - 1,
    );
    assert.equal(await worker.runOnce(), true);
    assert.equal(store.getJob(job.id)?.status, 'failed');
    assert.equal(store.getJob(job.id)?.attempts, 2);
    assert.equal(await worker.runOnce(), false);
    assert.equal(calls.length, enrichmentKinds.length * 2);
    const failed = store.listEnrichments(app.id).find((item) => item.kind === 'permissions')!;
    assert.deepEqual(failed.raw, permissionsResult.raw);
    assert.equal(failed.lastSuccessAt, '2026-01-01T00:00:00.000Z');
    assert.match(failed.error ?? '', /Fixture permissions failed/);
    assert.equal(store.listEnrichmentHistory(app.id, 'permissions').total, 3);
    assert.equal(store.getApp(app.id)?.lastError, null);
    assert.equal(store.listSnapshots(app.id).total, 1);
  } finally {
    worker.stop();
    store.close();
  }
});

test('V2-AC-11: a hanging supplemental method is aborted while the other six fields are persisted', async () => {
  const store = createStore();
  let timedOut: AbortSignal | undefined;
  const provider = fixtureProvider({
    enrich: async (input) => {
      if (input.kind === 'privacy') {
        timedOut = input.signal;
        return new Promise(() => {});
      }
      return {
        status: 'unsupported',
        data: null,
        raw: null,
        source: 'https://example.invalid/' + input.kind,
        requestCountry: input.country,
        requestLanguage: null,
      };
    },
  });
  const worker = createWorker({
    store,
    providers: fixtureProviders({ 'app-store': provider }),
    requestDelayMs: 0,
    retryDelayMs: 0,
    timeoutMs: 20,
    schedule: false,
  });
  try {
    const app = store.createApp({ store: 'app-store', country: 'id', externalId: '123456' });
    const job = store.enqueueJob({
      type: 'enrich',
      appId: app.id,
      country: 'id',
      store: 'app-store',
      maxAttempts: 1,
    });
    await worker.runOnce();
    assert.equal(timedOut?.aborted, true);
    assert.equal(store.getJob(job.id)?.status, 'failed');
    assert.equal(store.listEnrichments(app.id).length, enrichmentKinds.length);
    assert.equal(
      store.listEnrichments(app.id).filter((item) => item.status === 'unsupported').length,
      enrichmentKinds.length - 1,
    );
    const privacy = store.listEnrichments(app.id).find((item) => item.kind === 'privacy')!;
    assert.equal(privacy.status, 'failed');
    assert.equal(privacy.data, null);
    assert.equal(privacy.lastSuccessAt, null);
    assert.equal(store.getApp(app.id)?.lastError, null);
  } finally {
    worker.stop();
    store.close();
  }
});

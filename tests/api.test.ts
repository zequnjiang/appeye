import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createApp } from '../server/app.js';
import { creditApp, creditReview } from './fixtures.js';
import { serve } from './http-helper.js';

const password = 'local-test-only-password';
async function harness(options: { demoMode?: boolean; password?: string } = {}) {
  const store = createStore();
  const http = await serve(createApp({ store, password: options.password ?? password, sessionSecret: 'test-session-key', demoMode: options.demoMode, allowedOrigins: [] }));
  return { store, http, async login() { const response = await http.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); assert.equal(response.status, 200); return response; }, async close() { await http.close(); store.close(); } };
}

test('AC-02: protected endpoints require login, valid credentials set protected cookie, logout invalidates the old session', async () => {
  const h = await harness();
  try {
    assert.equal((await h.http.request('/api/health')).status, 200);
    assert.equal((await (await h.http.request('/api/auth/session')).json()).authenticated, false);
    for (const path of ['/api/overview', '/api/apps', '/api/countries', '/api/jobs', '/api/export/apps.csv']) assert.equal((await h.http.request(path)).status, 401, path);
    assert.equal((await h.http.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'wrong-password' }) })).status, 401);
    const loggedIn = await h.login();
    const setCookie = loggedIn.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const validCookie = h.http.cookie;
    assert.equal((await (await h.http.request('/api/auth/session')).json()).authenticated, true);
    assert.equal((await h.http.request('/api/overview')).status, 200);
    assert.equal((await h.http.request('/api/overview', { headers: { cookie: 'appeye_session=bad.' + 'a'.repeat(64) } })).status, 401);
    assert.equal((await h.http.request('/api/auth/logout', { method: 'POST' })).status, 200);
    assert.equal((await h.http.request('/api/overview', { headers: { cookie: validCookie } })).status, 401);
  } finally { await h.close(); }
});

test('AC-02: unconfigured password cannot authenticate', async () => {
  const h = await harness({ password: '' });
  try {
    const session = await (await h.http.request('/api/auth/session')).json();
    assert.equal(session.configured, false);
    assert.equal((await h.http.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: '' }) })).status, 503);
  } finally { await h.close(); }
});

test('AC-02: foreign Origin and cross-site mutations fail even with a valid session', async () => {
  const h = await harness();
  try {
    assert.equal((await h.http.request('/api/auth/login', { method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: JSON.stringify({ password }) })).status, 403);
    await h.login();
    const body = JSON.stringify({ enabled: false });
    assert.equal((await h.http.request('/api/countries/th', { method: 'PATCH', headers: { origin: 'https://attacker.invalid' }, body })).status, 403);
    assert.equal((await h.http.request('/api/countries/th', { method: 'PATCH', headers: { origin: h.http.baseUrl, 'sec-fetch-site': 'cross-site' }, body })).status, 403);
    assert.equal(h.store.getCountry('th')?.enabled, true);
    assert.equal((await h.http.request('/api/countries/th', { method: 'PATCH', headers: { origin: h.http.baseUrl }, body })).status, 200);
    assert.equal(h.store.getCountry('th')?.enabled, false);
  } finally { await h.close(); }
});

test('AC-03/05/10: valid configuration/manual tracking/classification work and invalid requests fail without side effects', async () => {
  const h = await harness();
  try {
    await h.login();
    const country = { code: 'vn', name: '越南', language: 'vi', keywords: ['vay', 'vay', 'tín dụng'], enabled: false, intervalHours: 1 };
    assert.equal((await h.http.request('/api/countries', { method: 'POST', body: JSON.stringify(country) })).status, 201);
    assert.deepEqual(h.store.getCountry('vn')?.keywords, ['vay', 'tín dụng']);
    assert.equal((await h.http.request('/api/countries', { method: 'POST', body: JSON.stringify(country) })).status, 409);
    for (const body of [{ ...country, code: 'abc' }, { ...country, code: 'us', intervalHours: 0 }, { ...country, code: 'us', intervalHours: 24 }, { ...country, code: 'us', keywords: [] }]) assert.equal((await h.http.request('/api/countries', { method: 'POST', body: JSON.stringify(body) })).status, 400);
    const input = { store: 'google-play', country: 'th', externalId: 'fixture.example.credit' };
    const added = await h.http.request('/api/apps', { method: 'POST', body: JSON.stringify(input) });
    assert.equal(added.status, 201);
    const data = await added.json();
    assert.equal(data.app.classification, 'candidate');
    assert.equal(data.job.type, 'refresh');
    const repeated = await (await h.http.request('/api/apps', { method: 'POST', body: JSON.stringify(input) })).json();
    assert.equal(repeated.app.id, data.app.id);
    assert.equal(repeated.job.id, data.job.id);
    for (const value of ['confirmed', 'excluded', 'candidate']) assert.equal((await h.http.request(`/api/apps/${data.app.id}`, { method: 'PATCH', body: JSON.stringify({ classification: value }) })).status, 200);
    assert.equal((await h.http.request(`/api/apps/${data.app.id}`, { method: 'PATCH', body: JSON.stringify({ classification: 'bank' }) })).status, 400);
    for (const body of [{ ...input, externalId: 'bad package' }, { ...input, store: 'app-store', externalId: 'bundle.id' }, { ...input, store: 'unknown' }]) assert.equal((await h.http.request('/api/apps', { method: 'POST', body: JSON.stringify(body) })).status, 400);
    assert.equal((await h.http.request('/api/apps', { method: 'POST', body: JSON.stringify({ ...input, country: 'zz' }) })).status, 404);
    assert.equal((await h.http.request('/api/jobs', { method: 'POST', body: JSON.stringify({ type: 'refresh', appId: data.app.id, country: 'mx' }) })).status, 400);
    assert.equal((await h.http.request('/api/jobs', { method: 'POST', body: JSON.stringify({ type: 'refresh' }) })).status, 400);
    assert.equal((await h.http.request('/api/jobs', { method: 'POST', body: JSON.stringify({ type: 'discover', appId: data.app.id }) })).status, 400);
    assert.equal((await h.http.request(`/api/jobs/${data.job.id}/retry`, { method: 'POST' })).status, 409);
    assert.equal(h.store.listApps().total, 1);
    assert.equal(h.store.listJobs().total, 1);
  } finally { await h.close(); }
});

test('AC-07/09/11/12: application filter/detail/history/review APIs return persisted data and bounded pages', async () => {
  const h = await harness();
  try {
    const one = h.store.createApp({ store: 'google-play', country: 'th', externalId: creditApp.externalId });
    h.store.saveObservation(one.id, creditApp);
    h.store.saveObservation(one.id, { ...creditApp, version: '2.0.0' });
    h.store.updateClassification(one.id, 'confirmed');
    h.store.saveReviews(one.id, [creditReview, { ...creditReview, externalId: 'review-2', score: 1 }]);
    h.store.createApp({ store: 'app-store', country: 'mx', externalId: '123456', title: 'Other' });
    await h.login();
    const selected = await (await h.http.request('/api/apps?country=th&store=google-play&classification=confirmed&q=Fixture&limit=1&offset=0')).json();
    assert.equal(selected.total, 1);
    assert.equal(selected.apps[0].id, one.id);
    const page = await (await h.http.request('/api/apps?limit=1&offset=1')).json();
    assert.equal(page.total, 2);
    assert.equal(page.apps.length, 1);
    const detail = await (await h.http.request(`/api/apps/${one.id}`)).json();
    assert.equal(detail.app.version, '2.0.0');
    assert.equal(detail.snapshots.length, 2);
    assert.equal(detail.changes.length, 1);
    assert.equal(detail.reviews.length, 2);
    assert.ok(detail.limitations.some((s: string) => s.includes('累计')));
    const snapshots = await (await h.http.request(`/api/apps/${one.id}/snapshots?limit=1&offset=1`)).json();
    assert.equal(snapshots.total, 2);
    assert.equal(snapshots.snapshots[0].data.version, '1.0.0');
    assert.equal((await (await h.http.request(`/api/apps/${one.id}/changes`)).json()).total, 1);
    const reviews = await (await h.http.request(`/api/apps/${one.id}/reviews?score=1&language=en`)).json();
    assert.equal(reviews.total, 1);
    assert.equal(reviews.reviews[0].score, 1);
    for (const path of ['/api/apps?limit=-1', '/api/apps?limit=1001', '/api/apps?offset=-1', '/api/apps?store=bad', '/api/apps/not-an-id', `/api/apps/${one.id}/reviews?score=6`, '/api/changes?since=not-a-date', '/api/jobs?status=unknown']) assert.equal((await h.http.request(path)).status, 400, path);
    assert.equal((await h.http.request('/api/apps/999999')).status, 404);
    assert.equal((await h.http.request('/api/unknown')).status, 404);
    assert.equal((await h.http.request('/api/countries', { method: 'POST', body: '{invalid json' })).status, 400);
  } finally { await h.close(); }
});

test('AC-10: API creates selected discovery tasks and retries a terminal failure', async () => {
  const h = await harness();
  try {
    await h.login();
    const response = await h.http.request('/api/jobs', { method: 'POST', body: JSON.stringify({ type: 'discover', country: 'pk' }) });
    assert.equal(response.status, 202);
    const data = await response.json();
    assert.deepEqual(data.jobs.map((job: { store: string }) => job.store).sort(), ['app-store', 'google-play']);
    const failed = h.store.enqueueJob({ type: 'discover', country: 'ar', store: 'google-play', maxAttempts: 1 });
    while (h.store.getJob(failed.id)?.status === 'queued') {
      const claimed = h.store.claimJob()!;
      if (claimed.id === failed.id) h.store.failJob(claimed.id, 'fixture terminal error', 0);
      else h.store.completeJob(claimed.id, {});
    }
    const retry = await h.http.request(`/api/jobs/${failed.id}/retry`, { method: 'POST' });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).job.attempts, 0);
    const listed = await (await h.http.request('/api/jobs?status=queued&country=ar&limit=1')).json();
    assert.equal(listed.total, 1);
    assert.equal(listed.jobs[0].id, failed.id);
  } finally { await h.close(); }
});

test('AC-08: CSV quotes fields, neutralizes spreadsheet formulas and includes dataset/download scope', async () => {
  const h = await harness();
  try {
    const app = h.store.createApp({ store: 'google-play', country: 'th', externalId: creditApp.externalId });
    h.store.saveObservation(app.id, { ...creditApp, title: '=HYPERLINK("https://attacker.invalid")', developer: '+SUM(1,2)', version: '@formula' });
    await h.login();
    const response = await h.http.request('/api/export/apps.csv?country=th');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/csv/);
    const csv = await response.text();
    assert.ok(csv.includes('"\'=HYPERLINK(""https://attacker.invalid"")"'));
    assert.ok(csv.includes('"\'+SUM(1,2)"'));
    assert.ok(csv.includes('"\'@formula"'));
    assert.ok(csv.includes('"live"'));
    assert.ok(csv.includes('store-public-cumulative-not-country-downloads'));
    assert.ok(!csv.includes('dailyDownloads'));
  } finally { await h.close(); }
});

test('AC-13: demo API discloses dataset and rejects tracking, job creation and job retry', async () => {
  const h = await harness({ demoMode: true });
  try {
    await h.login();
    assert.equal((await (await h.http.request('/api/health')).json()).dataset, 'demo');
    assert.equal((await (await h.http.request('/api/overview')).json()).dataset, 'demo');
    assert.equal((await h.http.request('/api/apps', { method: 'POST', body: JSON.stringify({ store: 'google-play', country: 'th', externalId: creditApp.externalId }) })).status, 409);
    assert.equal((await h.http.request('/api/jobs', { method: 'POST', body: JSON.stringify({ type: 'discover', country: 'th' }) })).status, 409);
    assert.equal((await h.http.request('/api/jobs/1/retry', { method: 'POST' })).status, 409);
    assert.equal(h.store.listApps().total, 0);
    assert.equal(h.store.listJobs().total, 0);
  } finally { await h.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, type Store } from '../server/db.js';
import { createApp } from '../server/app.js';
import { serve } from './http-helper.js';
import { creditApp } from './fixtures.js';
import { strongLoanFixtures } from './loan-fixtures.js';

const platformPassword = 'fixture-platform-password',
  userPassword = 'fixture-customer-password';
function client(base: string) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value;
    },
    async request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + path, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const next = response.headers.getSetCookie();
      if (next.length) cookie = next.map((v) => v.split(';')[0]).join('; ');
      return response;
    },
    async json(path: string, method = 'GET', body?: unknown, expected = 200) {
      const response = await this.request(path, method, body);
      const data = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
      return data;
    },
  };
}
async function harness(path = ':memory:') {
  const store = createStore(path),
    http = await serve(createApp({ store, password: platformPassword, allowedOrigins: [] })),
    platform = client(http.baseUrl);
  await platform.json('/api/auth/login', 'POST', { password: platformPassword });
  async function workspace(name: string) {
    return (await platform.json('/api/workspaces', 'POST', { name }, 201)).workspace;
  }
  async function member(workspaceId: number, email: string, role = 'admin') {
    const invitation = await platform.json(
        `/api/workspaces/${workspaceId}/invitations`,
        'POST',
        { email, role },
        201,
      ),
      user = client(http.baseUrl);
    const session = await user.json(
      '/api/auth/accept',
      'POST',
      { token: invitation.token, name: email.split('@')[0], password: userPassword },
      201,
    );
    return { user, session, invitation };
  }
  return {
    store,
    http,
    platform,
    workspace,
    member,
    async close() {
      await http.close();
      store.close();
    },
  };
}
function addApp(store: Store, index = 1, overrides: Record<string, unknown> = {}) {
  const data = {
    ...creditApp,
    externalId: `fixture.loan.app${index}`,
    title: `Loan ${index}`,
    minInstalls: index * 1000,
    ...overrides,
  };
  const app = store.createApp({ country: 'th', store: 'google-play', externalId: data.externalId });
  store.saveObservation(app.id, data);
  store.updateClassification(app.id, 'confirmed');
  return store.getApp(app.id)!;
}

test('RWP accounts, sessions and full query snapshots survive restart; logout revokes persisted token', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'appeye-research-')),
    path = join(folder, 'research.sqlite');
  let h = await harness(path);
  try {
    const workspace = await h.workspace('Workspace A'),
      { user, session } = await h.member(workspace.id, 'a@example.test');
    addApp(h.store);
    assert.equal(session.user.role, 'admin');
    assert.equal(session.user.workspaceId, workspace.id);
    assert.match(
      h.store.one('SELECT password_hash FROM research_users')!.password_hash,
      /^[a-f0-9]{32}:[a-f0-9]{128}$/,
    );
    const frozen = await user.json('/api/market/apps'),
      cookie = user.cookie;
    await h.close();
    h = await harness(path);
    const restored = client(h.http.baseUrl);
    restored.cookie = cookie;
    assert.equal((await restored.json('/api/auth/session')).user.id, session.user.id);
    const page = await restored.json(`/api/market/apps?snapshot=${frozen.snapshot}`);
    assert.deepEqual(page.apps, frozen.apps);
    await restored.json('/api/auth/logout', 'POST', {});
    restored.cookie = cookie;
    assert.equal((await restored.request('/api/research/state')).status, 401);
  } finally {
    await h.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('RWP tenant boundaries protect direct objects, legacy evidence, exports, and viewer writes', async () => {
  const h = await harness();
  try {
    const a = await h.workspace('A'),
      b = await h.workspace('B'),
      alice = await h.member(a.id, 'alice@example.test'),
      bob = await h.member(b.id, 'bob@example.test'),
      viewer = await h.member(a.id, 'view@example.test', 'viewer'),
      app = addApp(h.store);
    const group = await bob.user.json('/api/research/groups', 'POST', { name: 'Private B' }, 201),
      collection = await bob.user.json(
        '/api/research/collections',
        'POST',
        { name: 'Collection B' },
        201,
      );
    assert.equal(
      (await alice.user.request(`/api/research/groups/${group.id}`, 'PATCH', { name: 'hijack' }))
        .status,
      404,
    );
    assert.equal(
      (await alice.user.request(`/api/research/favorites/${app.id}`, 'PUT', { groupId: group.id }))
        .status,
      404,
    );
    assert.equal(
      (
        await alice.user.request('/api/research/entries', 'POST', {
          appId: app.id,
          collectionId: collection.id,
          kind: 'note',
          text: 'bad',
        })
      ).status,
      404,
    );
    assert.equal(
      (await alice.user.request(`/api/research/export?collectionId=${collection.id}`)).status,
      404,
    );
    assert.equal((await alice.user.request('/api/research/state?workspaceId=2')).status, 400);
    assert.equal((await h.platform.request('/api/research/state')).status, 403);
    const candidate = h.store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.unconfirmed.app',
    });
    for (const path of [
      '/api/apps',
      '/api/overview',
      '/api/changes',
      '/api/jobs',
      '/api/discovery/status',
      '/api/export/apps.csv',
    ])
      assert.equal((await alice.user.request(path)).status, 403, path);
    for (const suffix of [
      '',
      '/snapshots',
      '/reviews',
      '/changes',
      '/enrichments',
      '/enrichments/permissions/history',
      '/discoveries',
    ])
      assert.equal(
        (await alice.user.request(`/api/apps/${candidate.id}${suffix}`)).status,
        404,
        suffix,
      );
    assert.equal((await alice.user.request(`/api/apps/${app.id}`)).status, 200);
    for (const [path, method, body] of [
      ['/api/research/groups', 'POST', { name: 'bad' }],
      [`/api/research/favorites/${app.id}`, 'PUT', {}],
      [`/api/research/read/firstSeen:${app.id}`, 'PUT', {}],
      [
        '/api/research/requests',
        'POST',
        { country: 'th', store: 'google-play', externalId: 'test.app' },
      ],
    ] as const)
      assert.equal((await viewer.user.request(path, method, body)).status, 403, path);
    assert.equal((await viewer.user.request('/api/research/export')).status, 200);
    assert.equal((await alice.user.json('/api/research/state')).groups.length, 0);
  } finally {
    await h.close();
  }
});

test('RWP invitations are single-use, reissue revokes old link, expiration and last-admin protection are enforced', async () => {
  const h = await harness();
  try {
    const w = await h.workspace('Invites');
    const first = await h.platform.json(
      `/api/workspaces/${w.id}/invitations`,
      'POST',
      { email: 'one@example.test', role: 'admin' },
      201,
    );
    const second = await h.platform.json(
      `/api/workspaces/${w.id}/invitations`,
      'POST',
      { email: 'one@example.test', role: 'admin' },
      201,
    );
    assert.equal(
      (await client(h.http.baseUrl).request(`/api/auth/invitations/${first.token}`)).status,
      410,
    );
    const c1 = client(h.http.baseUrl),
      c2 = client(h.http.baseUrl),
      body = { token: second.token, name: 'One', password: userPassword };
    const results = await Promise.all([
      c1.request('/api/auth/accept', 'POST', body),
      c2.request('/api/auth/accept', 'POST', body),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 410]);
    const winner = results[0]!.status === 201 ? c1 : c2,
      actor = (await winner.json('/api/auth/session')).user;
    assert.equal(
      (await winner.request(`/api/workspaces/${w.id}/members/${actor.id}`, 'DELETE', {})).status,
      409,
    );
    assert.equal(
      (
        await h.platform.request(`/api/workspaces/${w.id}/members/${actor.id}`, 'PATCH', {
          role: 'viewer',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await winner.request(`/api/workspaces/${w.id}/invitations`, 'POST', {
          email: 'evil@example.test',
          role: 'platform',
        })
      ).status,
      400,
    );
    const exp = await h.platform.json(
      `/api/workspaces/${w.id}/invitations`,
      'POST',
      { email: 'expire@example.test', role: 'researcher' },
      201,
    );
    h.store.run(
      'UPDATE research_invitations SET expires_at=? WHERE id=?',
      '2000-01-01T00:00:00.000Z',
      exp.invitation.id,
    );
    assert.equal(
      (
        await c2.request('/api/auth/accept', 'POST', {
          token: exp.token,
          name: 'Expired',
          password: userPassword,
        })
      ).status,
      410,
    );
    const raw = h.store.one(
      'SELECT token_hash FROM research_invitations WHERE id=?',
      second.invitation.id,
    )!.token_hash;
    assert.notEqual(raw, second.token);
    assert.equal(
      JSON.stringify(h.store.all('SELECT * FROM research_audit')).includes(second.token),
      false,
    );
  } finally {
    await h.close();
  }
});

test('RWP role changes revoke old sessions/snapshots; existing accounts require original password for another workspace', async () => {
  const h = await harness();
  try {
    const a = await h.workspace('A'),
      b = await h.workspace('B'),
      admin = await h.member(a.id, 'admin@example.test'),
      researcher = await h.member(a.id, 'research@example.test', 'researcher');
    addApp(h.store);
    const snap = await researcher.user.json('/api/market/apps');
    const invite = await h.platform.json(
      `/api/workspaces/${b.id}/invitations`,
      'POST',
      { email: 'research@example.test', role: 'admin' },
      201,
    );
    const other = client(h.http.baseUrl);
    assert.equal(
      (
        await other.request('/api/auth/accept', 'POST', {
          token: invite.token,
          name: 'Override',
          password: 'different-long-password',
        })
      ).status,
      401,
    );
    await other.json(
      '/api/auth/accept',
      'POST',
      { token: invite.token, name: 'Original', password: userPassword },
      201,
    );
    assert.equal((await other.request(`/api/market/apps?snapshot=${snap.snapshot}`)).status, 410);
    await other.json('/api/auth/workspace', 'POST', { workspaceId: a.id });
    assert.equal((await other.json('/api/auth/session')).user.role, 'researcher');
    await admin.user.json(
      `/api/workspaces/${a.id}/members/${researcher.session.user.id}`,
      'PATCH',
      { role: 'viewer' },
    );
    assert.equal(
      (await researcher.user.request(`/api/market/apps?snapshot=${snap.snapshot}`)).status,
      401,
    );
    assert.equal((await other.request('/api/research/state')).status, 401);
    const signed = await researcher.user.json('/api/auth/login', 'POST', {
      email: 'research@example.test',
      password: userPassword,
      workspaceId: a.id,
    });
    assert.equal(signed.user.role, 'viewer');
  } finally {
    await h.close();
  }
});

test('RWP query snapshots freeze all pages, probe exact-query changes, validate filters and nine-field ordering', async () => {
  const h = await harness();
  try {
    const w = await h.workspace('Sorting'),
      { user } = await h.member(w.id, 'sort@example.test');
    const apps = Array.from({ length: 23 }, (_, i) =>
      addApp(h.store, i + 1, {
        developer: `Company ${i % 3}`,
        minInstalls: i === 0 ? 0 : i === 1 ? null : 1000 * (i % 5),
        score: i === 1 ? null : i % 5,
        ratings: i % 4,
        releasedAt: '2026-08-01T00:00:00Z',
        storeUpdatedAt: '2026-09-01T00:00:00Z',
      }),
    );
    const first = await user.json('/api/market/apps?limit=10'),
      ids = first.apps.map((a: any) => a.id);
    const second = await user.json(
      `/api/market/apps?limit=10&offset=10&snapshot=${first.snapshot}`,
    );
    addApp(h.store, 50, { minInstalls: 999999 });
    h.store.saveObservation(apps[0]!.id, {
      ...creditApp,
      externalId: apps[0]!.externalId,
      title: 'Changed',
      minInstalls: 888888,
    });
    assert.equal(
      (await user.json(`/api/market/apps?limit=10&snapshot=${first.snapshot}&probe=1`)).changed,
      true,
    );
    assert.deepEqual(
      (await user.json(`/api/market/apps?limit=10&snapshot=${first.snapshot}`)).apps.map(
        (a: any) => a.id,
      ),
      ids,
    );
    assert.deepEqual(
      (await user.json(`/api/market/apps?limit=10&offset=10&snapshot=${first.snapshot}`)).apps,
      second.apps,
    );
    assert.equal(new Set([...ids, ...second.apps.map((a: any) => a.id)]).size, 20);
    assert.equal(
      (await user.request(`/api/market/apps?country=mx&snapshot=${first.snapshot}`)).status,
      409,
    );
    const th = await user.json('/api/market/apps?country=th');
    const unrelated = h.store.createApp({
      country: 'mx',
      store: 'google-play',
      externalId: 'fixture.mexico.app',
    });
    h.store.saveObservation(unrelated.id, { ...creditApp, externalId: unrelated.externalId });
    assert.equal(
      (await user.json(`/api/market/apps?country=th&snapshot=${th.snapshot}&probe=1`)).changed,
      false,
    );
    for (const sort of [
      'title',
      'developer',
      'firstSeenAt',
      'releasedAt',
      'storeUpdatedAt',
      'lastFetchedAt',
      'score',
      'ratings',
      'minInstalls',
    ])
      for (const direction of ['asc', 'desc']) {
        const result = await user.json(
          `/api/market/apps?sort=${sort}&direction=${direction}&limit=100`,
        );
        let hitNull = false;
        for (let i = 0; i < result.apps.length; i++) {
          const value = result.apps[i][sort];
          if (value == null || value === '') hitNull = true;
          else assert.equal(hitNull, false, `${sort}/${direction} null tail`);
        }
        assert.equal(new Set(result.apps.map((app: any) => app.id)).size, result.total);
      }
    const filtered = await user.json(
      '/api/market/apps?from=2026-08-01&to=2026-08-31&minScore=3&minInstalls=1000',
    );
    assert.ok(
      filtered.apps.every(
        (a: any) => a.score >= 3 && a.minInstalls >= 1000 && a.releasedAt.startsWith('2026-08'),
      ),
    );
    const invalidPage = await user.json('/api/market/apps?limit=10&offset=999');
    assert.equal(invalidPage.offset, 20);
    h.store.updateClassification(invalidPage.apps[0].id, 'excluded');
    assert.equal(
      (await user.request(`/api/market/apps?limit=10&snapshot=${invalidPage.snapshot}`)).status,
      410,
    );
    assert.ok(h.store.one('SELECT COUNT(*) n FROM research_query_snapshots')!.n <= 20);
  } finally {
    await h.close();
  }
});

test('RWP research citations preserve actual source and shared edits conflict; private historical research survives loss of public visibility', async () => {
  const h = await harness();
  try {
    const w = await h.workspace('Research'),
      a = await h.member(w.id, 'author@example.test'),
      b = await h.member(w.id, 'editor@example.test', 'researcher'),
      app = addApp(h.store),
      other = addApp(h.store, 2);
    const snapshot = h.store.listSnapshots(app.id).snapshots[0]!,
      foreign = h.store.listSnapshots(other.id).snapshots[0]!;
    const collection = await a.user.json(
      '/api/research/collections',
      'POST',
      { name: 'Source collection' },
      201,
    );
    const body = {
      appId: app.id,
      collectionId: collection.id,
      kind: 'excerpt',
      text: 'My independent research',
      citation: { kind: 'snapshot', recordId: snapshot.id, field: 'description' },
    };
    assert.equal(
      (
        await a.user.request('/api/research/entries', 'POST', {
          ...body,
          citation: { ...body.citation, recordId: foreign.id },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await a.user.request('/api/research/entries', 'POST', {
          ...body,
          citation: { ...body.citation, quote: 'invented unsupported passage' },
        })
      ).status,
      400,
    );
    const entry = (await a.user.json('/api/research/entries', 'POST', body, 201)).entry;
    const edited = (
      await b.user.json(`/api/research/entries/${entry.id}`, 'PATCH', {
        text: 'Shared edit',
        revision: entry.revision,
      })
    ).entry;
    assert.equal(edited.revision, 2);
    assert.equal(
      (
        await a.user.request(`/api/research/entries/${entry.id}`, 'PATCH', {
          text: 'stale',
          revision: 1,
        })
      ).status,
      409,
    );
    await a.user.json(`/api/research/read/firstSeen:${app.id}`, 'PUT', {});
    assert.equal((await b.user.json('/api/research/state')).readStates.length, 0);
    h.store.saveObservation(app.id, {
      ...creditApp,
      externalId: app.externalId,
      description: 'new description',
    });
    h.store.updateClassification(app.id, 'excluded');
    const archived = (await a.user.json('/api/research/state')).entries[0];
    assert.equal(archived.appVisible, false);
    assert.equal(archived.citation.quote, creditApp.description);
    assert.equal(archived.citation.sourceObservedAt, snapshot.observedAt);
    const download = await b.user.request(`/api/research/export?collectionId=${collection.id}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition')!, /attachment/);
    const text = await download.text();
    assert.match(text, /Shared edit/);
    assert.match(text, /Source collection/);
    assert.ok(text.includes(snapshot.observedAt));
    assert.equal((await a.user.request(`/api/apps/${app.id}/snapshots`)).status, 404);
  } finally {
    await h.close();
  }
});

test('RWP intake completion requires real linked successful detail, is idempotent, and rule settings preserve manual decisions', async () => {
  const h = await harness();
  try {
    const w = await h.workspace('Intake'),
      { user } = await h.member(w.id, 'request@example.test');
    const input = {
      country: 'ar',
      store: 'google-play',
      externalId: 'fixture.real.request',
      note: 'Check Argentina',
    };
    const request = (await user.json('/api/research/requests', 'POST', input, 201)).request;
    assert.equal(
      (await user.json('/api/research/requests', 'POST', input, 201)).request.id,
      request.id,
    );
    let processed = (
      await h.platform.json(`/api/platform/requests/${request.id}/process`, 'POST', {
        action: 'collect',
      })
    ).request;
    assert.equal(processed.status, 'processing');
    const repeated = (
      await h.platform.json(`/api/platform/requests/${request.id}/process`, 'POST', {
        action: 'collect',
      })
    ).request;
    assert.equal(repeated.jobId, processed.jobId);
    h.store.completeJob(processed.jobId, { placeholder: true });
    assert.equal((await user.json('/api/research/state')).requests[0].status, 'failed');
    processed = (
      await h.platform.json(`/api/platform/requests/${request.id}/process`, 'POST', {
        action: 'collect',
      })
    ).request;
    assert.notEqual(processed.jobId, repeated.jobId);
    h.store.saveObservation(processed.appId, { ...creditApp, externalId: input.externalId });
    h.store.updateClassification(processed.appId, 'confirmed');
    h.store.completeJob(processed.jobId, { detail: true });
    assert.equal((await user.json('/api/research/state')).requests[0].status, 'admitted');
    const auto = h.store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'fixture.auto.rules',
    });
    h.store.saveObservation(auto.id, {
      ...creditApp,
      externalId: auto.externalId,
      description: strongLoanFixtures[0]!.description,
    });
    assert.equal(h.store.getApp(auto.id)!.classification, 'confirmed');
    const sourceTime = h.store.getApp(auto.id)!.lastFetchedAt;
    await h.platform.json('/api/platform/rules', 'PATCH', { autoConfirmStrong: false });
    await h.platform.json('/api/platform/rules/reanalyze', 'POST', {});
    assert.equal(h.store.getApp(auto.id)!.classification, 'candidate');
    assert.equal(h.store.getApp(auto.id)!.loanAnalysis!.configurationVersion, 2);
    assert.equal(h.store.getApp(auto.id)!.loanAnalysis!.sourceObservedAt, sourceTime);
    assert.equal(h.store.getApp(processed.appId)!.classification, 'confirmed');
    assert.equal(
      (await user.request('/api/platform/rules', 'PATCH', { autoConfirmStrong: true })).status,
      403,
    );
  } finally {
    await h.close();
  }
});

test('RWP customer CSV exports the whole authorized frozen query and guards formulas and revoked snapshots', async () => {
  const h = await harness();
  try {
    const w = await h.workspace('Export'),
      { user } = await h.member(w.id, 'export@example.test'),
      other = await h.member(w.id, 'other-export@example.test', 'viewer');
    for (let index = 0; index < 24; index++)
      addApp(h.store, index, {
        title: index === 0 ? '=CMD(1)' : `Saved ${index}`,
        minInstalls: index === 0 ? 0 : index === 1 ? null : 1000,
      });
    const page = await user.json('/api/market/apps?limit=10');
    assert.equal((await user.request('/api/market/apps.csv')).status, 400);
    assert.equal(
      (await other.user.request(`/api/market/apps.csv?snapshot=${page.snapshot}`)).status,
      410,
    );
    addApp(h.store, 90, { title: 'Added after snapshot' });
    const response = await user.request(
      `/api/market/apps.csv?snapshot=${page.snapshot}&limit=10&offset=10`,
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition')!, /attachment/);
    const csv = await response.text();
    assert.equal(csv.trimEnd().split('\r\n').length, 25);
    assert.ok(csv.includes('"\'=CMD(1)"'));
    assert.ok(!csv.includes('Added after snapshot'));
    const zeroRow = csv.split('\r\n').find((row) => row.includes('fixture.loan.app0'))!;
    assert.ok(zeroRow.includes(',"0",'));
    const nullRow = csv.split('\r\n').find((row) => row.includes('fixture.loan.app1"'))!;
    assert.equal([...nullRow.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)][10]![1], '');
    assert.equal(
      (await user.request(`/api/market/apps.csv?snapshot=${page.snapshot}&country=mx`)).status,
      409,
    );
    h.store.updateClassification(page.apps[0].id, 'excluded');
    assert.equal(
      (await user.request(`/api/market/apps.csv?snapshot=${page.snapshot}`)).status,
      410,
    );
  } finally {
    await h.close();
  }
});

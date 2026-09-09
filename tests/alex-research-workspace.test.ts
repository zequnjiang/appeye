import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStore, type Store } from '../server/db.js';
import { createApp } from '../server/app.js';
import { normalizeApp } from '../server/normalization.js';
import { createWorker } from '../server/worker.js';
import { creditApp, creditReview, fixtureProviders } from './fixtures.js';
import { strongLoanFixtures } from './loan-fixtures.js';
import { serve } from './http-helper.js';

// Every identity, provider response and database below is synthetic and isolated.
const platformPassword = 'alex-isolated-platform-password';
const password = 'alex-isolated-member-password';
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
      const result = await fetch(base + path, {
        method,
        headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const cookies = result.headers.getSetCookie();
      if (cookies.length) cookie = cookies.map((value) => value.split(';')[0]).join('; ');
      return result;
    },
    async json(path: string, method = 'GET', body?: unknown, expected = 200): Promise<any> {
      const response = await this.request(path, method, body);
      const value = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
      return value;
    },
  };
}
async function setup() {
  const store = createStore(':memory:');
  const http = await serve(createApp({ store, password: platformPassword, allowedOrigins: [] }));
  const platform = client(http.baseUrl);
  await platform.json('/api/auth/login', 'POST', { password: platformPassword });
  const space = async (name: string) =>
    (await platform.json('/api/workspaces', 'POST', { name }, 201)).workspace;
  const member = async (workspaceId: number, email: string, role = 'admin') => {
    const invite = await platform.json(
      `/api/workspaces/${workspaceId}/invitations`,
      'POST',
      { email, role },
      201,
    );
    const user = client(http.baseUrl);
    const session = await user.json(
      '/api/auth/accept',
      'POST',
      { token: invite.token, name: email.split('@')[0], password },
      201,
    );
    return { user, session };
  };
  return {
    store,
    http,
    platform,
    space,
    member,
    async close() {
      await http.close();
      store.close();
    },
  };
}
function app(store: Store, index = 1, overrides: Record<string, any> = {}) {
  const { country = 'th', store: storeName = 'google-play', ...fields } = overrides;
  const externalId =
    storeName === 'app-store' ? String(800000 + index) : `alex.fixture.loan${index}`;
  const entity = store.createApp({ country, store: storeName, externalId });
  const data = {
    ...creditApp,
    externalId,
    title: `Alex app ${index}`,
    url: `https://example.test/app/${index}`,
    ...fields,
  };
  store.saveObservation(entity.id, data, '2026-09-07T01:00:00.000Z');
  store.updateClassification(entity.id, 'confirmed');
  return store.getApp(entity.id)!;
}
function privateDigest(store: Store) {
  const tables = [
    'research_groups',
    'research_favorites',
    'research_collections',
    'research_collection_apps',
    'research_entries',
    'research_reads',
    'research_requests',
    'research_audit',
  ];
  return createHash('sha256')
    .update(
      JSON.stringify(
        tables.map((table) => [table, store.all(`SELECT * FROM ${table} ORDER BY rowid`)]),
      ),
    )
    .digest('hex');
}

function readCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('Alex RWP CSV exports every frozen row safely and repeated revoked tokens remain explicitly revoked across JSON/CSV/probe', async () => {
  const h = await setup();
  try {
    const space = await h.space('CSV scope'), { user } = await h.member(space.id, 'csv@alex.test');
    const peer = await h.member(space.id, 'csv-peer@alex.test', 'viewer');
    const items = Array.from({length: 25}, (_, index) => app(h.store, index + 1, {
      title: index === 0 ? '=SUM(1,2)\n"quoted"' : `Frozen ${index}`,
      minInstalls: index === 0 ? 0 : index === 1 ? null : 100,
    }));
    const page = await user.json('/api/market/apps?limit=2&sort=title');
    const snapshot = page.snapshot;
    const url = `/api/market/apps.csv?limit=2&offset=20&sort=title&snapshot=${snapshot}`;
    const before = await user.request(url);
    assert.equal(before.status, 200);
    const text = await before.text(), parsed = readCsv(text), [header, ...data] = parsed;
    assert.equal(data.length, 25, 'all frozen rows, not only limit=2 or offset=20');
    const title = header.indexOf('title'), installs = header.indexOf('minInstalls'), id = header.indexOf('id');
    const formula = data.find(row => row[id] === String(items[0].id))!;
    assert.equal(formula[title], "'=SUM(1,2)\n\"quoted\"");
    assert.equal(formula[installs], '0');
    assert.equal(data.find(row => row[id] === String(items[1].id))![installs], '');
    h.store.saveObservation(items[0].id, { ...creditApp, externalId: items[0].externalId, title: 'New live title' }, '2026-09-08T00:00:00Z');
    app(h.store, 90);
    assert.equal(await (await user.request(url)).text(), text, 'export preserves rows and display fields despite live changes');
    assert.equal((await peer.user.request(url)).status, 410);
    assert.equal((await user.request('/api/market/apps.csv')).status, 400);
    h.store.run('UPDATE research_query_snapshots SET expires_at=? WHERE id=?', '2000-01-01T00:00:00.000Z', snapshot);
    h.store.updateClassification(items[0].id, 'excluded');
    for (const path of [url, `/api/market/apps?sort=title&snapshot=${snapshot}&probe=1`, `/api/market/apps?sort=title&snapshot=${snapshot}`, url]) {
      const response = await user.request(path);
      assert.equal(response.status, 410);
      assert.equal((await response.json()).code, 'SNAPSHOT_SCOPE_REVOKED');
    }
    assert.equal(h.store.one('SELECT rows FROM research_query_snapshots WHERE id=?', snapshot)!.rows, '[]');
    const fresh = await user.json('/api/market/apps?sort=title&limit=100');
    assert.equal(fresh.apps.some((row: any) => row.id === items[0].id), false);
    h.store.run('DELETE FROM research_query_snapshots WHERE id=?', fresh.snapshot);
    const lost = await user.request(`/api/market/apps?sort=title&snapshot=${fresh.snapshot}`);
    assert.equal(lost.status, 410);
    assert.equal((await lost.json()).code, 'SNAPSHOT_SCOPE_REVOKED', 'missing token cannot establish continued visibility and must clear client data');
  } finally { await h.close(); }
});

test('Alex RWP direct private-object and viewer/platform mutation matrices preserve every private row', async () => {
  const h = await setup();
  try {
    const a = await h.space('Private Alpha'),
      b = await h.space('Private Beta');
    const owner = await h.member(a.id, 'alpha@alex.test');
    const other = await h.member(b.id, 'beta@alex.test');
    const viewer = await h.member(a.id, 'reader@alex.test', 'viewer');
    const item = app(h.store);
    const group = await owner.user.json(
      '/api/research/groups',
      'POST',
      { name: 'Secret group' },
      201,
    );
    const collection = await owner.user.json(
      '/api/research/collections',
      'POST',
      { name: 'Secret collection' },
      201,
    );
    const entry = (
      await owner.user.json(
        '/api/research/entries',
        'POST',
        { appId: item.id, collectionId: collection.id, kind: 'note', text: 'Alpha private note' },
        201,
      )
    ).entry;
    await owner.user.json(`/api/research/favorites/${item.id}`, 'PUT', { groupId: group.id });
    await owner.user.json(`/api/research/collections/${collection.id}/apps/${item.id}`, 'PUT', {});
    await owner.user.json(`/api/research/read/firstSeen:${item.id}`, 'PUT', {});
    const operations: [string, string, unknown][] = [
      ['/api/research/groups', 'POST', { name: 'New' }],
      [`/api/research/groups/${group.id}`, 'PATCH', { name: 'Overwrite' }],
      [`/api/research/groups/${group.id}`, 'DELETE', {}],
      ['/api/research/collections', 'POST', { name: 'New' }],
      [`/api/research/collections/${collection.id}`, 'PATCH', { name: 'Overwrite' }],
      [`/api/research/collections/${collection.id}`, 'DELETE', {}],
      [`/api/research/collections/${collection.id}/apps/${item.id}`, 'PUT', {}],
      [`/api/research/collections/${collection.id}/apps/${item.id}`, 'DELETE', {}],
      [`/api/research/favorites/${item.id}`, 'PUT', { groupId: group.id }],
      [`/api/research/favorites/${item.id}`, 'DELETE', {}],
      ['/api/research/entries', 'POST', { appId: item.id, kind: 'note', text: 'Bad' }],
      [`/api/research/entries/${entry.id}`, 'PATCH', { text: 'Bad', revision: 1 }],
      [`/api/research/entries/${entry.id}`, 'DELETE', { revision: 1 }],
      [`/api/research/read/firstSeen:${item.id}`, 'PUT', {}],
      [`/api/research/read/firstSeen:${item.id}`, 'DELETE', {}],
      [
        '/api/research/requests',
        'POST',
        { country: 'th', store: 'google-play', externalId: 'alex.new.loan' },
      ],
    ];
    const before = privateDigest(h.store);
    for (const actor of [viewer.user, h.platform])
      for (const [path, method, body] of operations)
        assert.equal((await actor.request(path, method, body)).status, 403, `${method} ${path}`);
    for (const [path, method, body] of operations.filter(([path]) =>
      /\/(groups|collections|entries)\/\d/.test(path),
    ))
      assert.equal(
        (await other.user.request(path, method, body)).status,
        404,
        `foreign ${method} ${path}`,
      );
    assert.equal(
      (await other.user.request(`/api/research/favorites/${item.id}`, 'PUT', { groupId: group.id }))
        .status,
      404,
    );
    assert.equal(
      (await other.user.request(`/api/research/export?collectionId=${collection.id}`)).status,
      404,
    );
    assert.equal((await h.platform.request('/api/research/export')).status, 403);
    assert.deepEqual((await other.user.json('/api/research/state')).entries, []);
    assert.equal(
      (await viewer.user.json('/api/research/state')).entries[0].text,
      'Alpha private note',
    );
    assert.equal(
      privateDigest(h.store),
      before,
      'all denied mutations leave data and audit unchanged',
    );
  } finally {
    await h.close();
  }
});

test('Alex RWP server snapshots enforce hard eviction, expiration, principal isolation and workspace disable', async () => {
  const h = await setup();
  try {
    const space = await h.space('Snapshot owner');
    const owner = await h.member(space.id, 'snapshot@alex.test');
    const peer = await h.member(space.id, 'peer@alex.test', 'researcher');
    app(h.store);
    const first = await owner.user.json('/api/market/apps');
    for (let i = 0; i < 20; i++) await owner.user.json(`/api/market/apps?q=${i}`);
    assert.equal(h.store.one('SELECT COUNT(*) n FROM research_query_snapshots')!.n, 20);
    assert.equal(
      (await owner.user.request(`/api/market/apps?snapshot=${first.snapshot}`)).status,
      410,
    );
    const latest = await owner.user.json('/api/market/apps');
    assert.equal(
      (await peer.user.request(`/api/market/apps?snapshot=${latest.snapshot}`)).status,
      410,
    );
    assert.equal(
      (await h.platform.request(`/api/market/apps?snapshot=${latest.snapshot}`)).status,
      410,
    );
    const count = h.store.one('SELECT COUNT(*) n FROM research_query_snapshots')!.n;
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await owner.user.json(`/api/market/apps?snapshot=${latest.snapshot}&probe=1`)).changed,
        false,
      );
    assert.equal(
      h.store.one('SELECT COUNT(*) n FROM research_query_snapshots')!.n,
      count,
      'probes never allocate snapshots',
    );
    h.store.run(
      'UPDATE research_query_snapshots SET expires_at=? WHERE id=?',
      '2000-01-01T00:00:00.000Z',
      latest.snapshot,
    );
    assert.equal(
      (await owner.user.request(`/api/market/apps?snapshot=${latest.snapshot}`)).status,
      410,
    );
    await owner.user.json('/api/market/apps');
    await h.platform.json(`/api/workspaces/${space.id}`, 'PATCH', { enabled: false });
    assert.equal((await owner.user.request('/api/research/state')).status, 401);
    assert.equal((await peer.user.request('/api/market/apps')).status, 401);
    assert.equal(h.store.one('SELECT COUNT(*) n FROM research_query_snapshots')!.n, 0);
  } finally {
    await h.close();
  }
});

test('Alex RWP actual normalized multilingual release sources agree between list, date filters and market events', async () => {
  const h = await setup();
  try {
    const space = await h.space('Calendar dates'),
      { user } = await h.member(space.id, 'calendar@alex.test');
    const samples = [
      ['th', '๗ ก.ย. ๒๕๖๙', '2026-09-07'],
      ['ar', '7 dic 2025', '2025-12-07'],
      ['id', '3 Agu 2018', '2018-08-03'],
      ['mx', 'Sep 17, 2025', '2025-09-17'],
    ];
    for (const [index, [country, released, expected]] of samples.entries()) {
      const data = normalizeApp(
        {
          appId: `alex.calendar.app${index}`,
          title: `Calendar ${index}`,
          released,
          url: 'https://play.google.com/store/apps/details?id=alex.calendar',
          description: 'Synthetic calendar source',
        },
        'google-play',
      );
      const item = h.store.createApp({
        country: country!,
        store: 'google-play',
        externalId: data.externalId,
      });
      h.store.saveObservation(item.id, data, '2026-09-08T00:00:00.000Z');
      h.store.updateClassification(item.id, 'confirmed');
      const events = await user.json(
        `/api/market/activity?date=${expected}&country=${country}&type=storeRelease`,
      );
      assert.equal(events.events[0].id, `storeRelease:${item.id}`);
      assert.equal(events.events[0].releasedAtPrecision, 'date');
      const filtered = await user.json(
        `/api/market/apps?country=${country}&from=${expected}&to=${expected}&sort=releasedAt`,
      );
      assert.deepEqual(
        filtered.apps.map((row: any) => row.id),
        [item.id],
        `${released}: list must include the same source-backed day as activity`,
      );
      assert.equal(
        filtered.apps[0].releasedAt,
        expected,
        'calendar precision remains a date, not fabricated midnight',
      );
    }
  } finally {
    await h.close();
  }
});

test('Alex RWP emitted localized-release events can be marked read without inventing a normalized timestamp', async () => {
  const h = await setup();
  try {
    const space = await h.space('Calendar read'),
      { user } = await h.member(space.id, 'read-calendar@alex.test');
    const data = normalizeApp(
      { appId: 'alex.calendar.read', title: 'Thai calendar', released: '๗ ก.ย. ๒๕๖๙' },
      'google-play',
    );
    const item = h.store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: data.externalId,
    });
    h.store.saveObservation(item.id, data);
    h.store.updateClassification(item.id, 'confirmed');
    const activity = await user.json('/api/market/activity?date=2026-09-07&type=storeRelease');
    assert.equal(activity.events.length, 1);
    await user.json(`/api/research/read/${activity.events[0].id}`, 'PUT', {});
    assert.equal(
      (await user.json('/api/research/state')).readStates[0].eventId,
      activity.events[0].id,
    );
  } finally {
    await h.close();
  }
});

test('Alex RWP ambiguous or impossible raw calendar dates cannot fall back to a fabricated normalized release', async () => {
  const h = await setup();
  try {
    const space = await h.space('Invalid calendar'),
      { user } = await h.member(space.id, 'invalid-calendar@alex.test');
    for (const [index, raw] of ['Feb 30, 2026', '09/07/2026'].entries()) {
      const data = normalizeApp(
        { appId: `alex.invalid.date${index}`, title: 'Invalid calendar source', released: raw },
        'google-play',
      );
      const item = h.store.createApp({
        country: 'th',
        store: 'google-play',
        externalId: data.externalId,
      });
      h.store.saveObservation(item.id, data);
      h.store.updateClassification(item.id, 'confirmed');
      const stored = h.store.one('SELECT data FROM apps WHERE id=?', item.id)!.data;
      const result = await user.json(`/api/market/apps?q=${data.externalId}`);
      assert.equal(result.apps[0].releasedAt, null, raw);
      assert.equal(result.apps[0].releasedAtPrecision, 'unknown');
      assert.equal(result.apps[0].releasedAtRaw, raw);
      const detail = await user.json(`/api/apps/${item.id}`);
      assert.equal(detail.app.releasedAt, null, 'detail cannot resurrect the rejected raw date');
      assert.equal(
        h.store.one('SELECT data FROM apps WHERE id=?', item.id)!.data,
        stored,
        'projection must never rewrite old source',
      );
    }
  } finally {
    await h.close();
  }
});

test('Alex RWP invitation acceptance rolls back user, membership and consumption when the audit transaction fails', async () => {
  const h = await setup();
  try {
    const space = await h.space('Atomic invite');
    const invite = await h.platform.json(
      `/api/workspaces/${space.id}/invitations`,
      'POST',
      { email: 'atomic@alex.test', role: 'admin' },
      201,
    );
    h.store.db.exec(
      "CREATE TEMP TRIGGER alex_fail_accept BEFORE INSERT ON research_audit WHEN NEW.action='invitation.accept' BEGIN SELECT RAISE(ABORT,'Synthetic invite audit failure'); END",
    );
    const user = client(h.http.baseUrl),
      body = { token: invite.token, name: 'Atomic user', password };
    assert.equal((await user.request('/api/auth/accept', 'POST', body)).status, 500);
    assert.equal(
      h.store.one("SELECT COUNT(*) n FROM research_users WHERE email='atomic@alex.test'")!.n,
      0,
    );
    assert.equal(
      h.store.one('SELECT COUNT(*) n FROM research_memberships WHERE workspace_id=?', space.id)!.n,
      0,
    );
    assert.equal(
      h.store.one('SELECT status FROM research_invitations WHERE id=?', invite.invitation.id)!
        .status,
      'pending',
    );
    assert.equal((await user.json('/api/auth/session')).authenticated, false);
    h.store.db.exec('DROP TRIGGER alex_fail_accept');
    await user.json('/api/auth/accept', 'POST', body, 201);
    assert.equal(
      h.store.one("SELECT COUNT(*) n FROM research_audit WHERE action='invitation.accept'")!.n,
      1,
    );
    assert.equal(
      (await client(h.http.baseUrl).request('/api/auth/accept', 'POST', body)).status,
      410,
    );
  } finally {
    await h.close();
  }
});

test('Alex RWP source citations reject foreign IDs, forged fields/time and failed attempts; valid originals survive later writes', async () => {
  const h = await setup();
  try {
    const space = await h.space('Evidence'),
      { user } = await h.member(space.id, 'evidence@alex.test');
    const item = app(h.store),
      foreign = app(h.store, 2);
    h.store.saveReviews(
      item.id,
      [{ ...creditReview, text: 'Original source quote <script>fixture</script>' }],
      'en',
      '2026-09-07T02:00:00.000Z',
    );
    h.store.saveReviews(
      foreign.id,
      [{ ...creditReview, externalId: 'foreign-review' }],
      'en',
      '2026-09-07T02:00:00.000Z',
    );
    const review = h.store.one('SELECT * FROM reviews WHERE app_id=?', item.id)!;
    const foreignReview = h.store.one('SELECT id FROM reviews WHERE app_id=?', foreign.id)!;
    const context = {
      source: 'https://example.test/permissions',
      requestCountry: 'th',
      requestLanguage: 'th',
    };
    h.store.saveEnrichment(
      item.id,
      'permissions',
      {
        ...context,
        status: 'available',
        data: [{ type: 'fixture', permission: 'Synthetic permission' }],
        raw: { unknown: 'preserved' },
      },
      '2026-09-07T02:00:00.000Z',
    );
    const successHistory = h.store.one(
      "SELECT id FROM enrichment_history WHERE app_id=? AND status='available'",
      item.id,
    )!.id;
    h.store.failEnrichment(
      item.id,
      'permissions',
      'Synthetic transport failed',
      context,
      '2026-09-08T02:00:00.000Z',
    );
    const failureHistory = h.store.one(
      "SELECT id FROM enrichment_history WHERE app_id=? AND status='failed'",
      item.id,
    )!.id;
    const draft = {
      appId: item.id,
      kind: 'excerpt',
      text: 'Member interpretation, separately labeled',
    };
    for (const [citation, expected] of [
      [{ kind: 'review', recordId: foreignReview.id }, 404],
      [{ kind: 'review', recordId: review.id, field: 'userName' }, 400],
      [{ kind: 'review', recordId: review.id, quote: 'Not in source' }, 400],
      [{ kind: 'review', recordId: review.id, sourceObservedAt: '2000-01-01' }, 400],
      [{ kind: 'review', recordId: review.id, sourceUrl: 'https://forged.test' }, 400],
      [{ kind: 'enrichment', recordId: failureHistory }, 400],
      [{ kind: 'app', recordId: foreignReview.id, field: 'description' }, 400],
    ] as const)
      assert.equal(
        (await user.request('/api/research/entries', 'POST', { ...draft, citation })).status,
        expected,
      );
    const previousSuccess = (
      await user.json(
        '/api/research/entries',
        'POST',
        { ...draft, citation: { kind: 'enrichment', recordId: successHistory } },
        201,
      )
    ).entry;
    assert.equal(previousSuccess.citation.sourceObservedAt, '2026-09-07T02:00:00.000Z');
    assert.match(previousSuccess.citation.quote, /Synthetic permission/);
    const entry = (
      await user.json(
        '/api/research/entries',
        'POST',
        {
          ...draft,
          citation: { kind: 'review', recordId: review.id, quote: 'Original source quote' },
        },
        201,
      )
    ).entry;
    assert.equal(entry.citation.sourceObservedAt, '2026-09-07T02:00:00.000Z');
    h.store.saveReviews(
      item.id,
      [{ ...creditReview, text: 'Later source replacement' }],
      'en',
      '2026-09-08T02:00:00.000Z',
    );
    h.store.updateClassification(item.id, 'excluded');
    const historical = (await user.json('/api/research/state')).entries[0];
    assert.deepEqual(historical.citation, entry.citation);
    assert.equal(historical.appVisible, false);
    assert.equal((await user.request(`/api/apps/${item.id}/reviews`)).status, 404);
    assert.equal(
      (
        await user.request('/api/research/entries', 'POST', {
          ...draft,
          citation: { kind: 'review', recordId: review.id },
        })
      ).status,
      404,
    );
  } finally {
    await h.close();
  }
});

test('Alex RWP session secret and platform password rotation reject old cookies without changing customer credentials', async () => {
  const store = createStore(':memory:');
  const first = await serve(
    createApp({
      store,
      password: platformPassword,
      sessionSecret: 'isolated-key-one',
      allowedOrigins: [],
    }),
  );
  let second: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    const platform = client(first.baseUrl);
    await platform.json('/api/auth/login', 'POST', { password: platformPassword });
    const oldPlatformCookie = platform.cookie;
    await platform.json('/api/auth/login', 'POST', { password: platformPassword });
    const saltOne = store.one('SELECT platform_auth FROM research_sessions')!.platform_auth;
    assert.match(saltOne, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
    const secondPlatform = client(first.baseUrl);
    await secondPlatform.json('/api/auth/login', 'POST', { password: platformPassword });
    const hashes = store
      .all('SELECT platform_auth FROM research_sessions')
      .map((row) => row.platform_auth);
    assert.equal(new Set(hashes).size, 2, 'same platform password uses independent salts');
    assert.equal(
      hashes.includes(createHash('sha256').update(platformPassword).digest('hex')),
      false,
    );
    const space = (
      await platform.json('/api/workspaces', 'POST', { name: 'Persistent permission' }, 201)
    ).workspace;
    const invite = await platform.json(
      `/api/workspaces/${space.id}/invitations`,
      'POST',
      { email: 'persist@alex.test', role: 'admin' },
      201,
    );
    const customer = client(first.baseUrl);
    await customer.json(
      '/api/auth/accept',
      'POST',
      { token: invite.token, name: 'Persistent customer', password },
      201,
    );
    const userBefore = JSON.stringify(store.all('SELECT * FROM research_users'));
    const customerCookie = customer.cookie;
    const audit = store.one("SELECT * FROM research_audit WHERE action='invitation.accept'")!;
    assert.ok(audit);
    assert.equal(JSON.stringify(audit).includes(invite.token), false);
    const snapshot = await customer.json('/api/market/apps');
    await first.close();
    second = await serve(
      createApp({
        store,
        password: 'different-platform-password',
        sessionSecret: 'isolated-key-one',
        allowedOrigins: [],
      }),
    );
    const restored = client(second.baseUrl);
    restored.cookie = customerCookie;
    assert.equal(
      (await restored.json(`/api/market/apps?snapshot=${snapshot.snapshot}`)).snapshot,
      snapshot.snapshot,
    );
    const obsolete = client(second.baseUrl);
    obsolete.cookie = secondPlatform.cookie;
    assert.equal(
      (await obsolete.request('/api/workspaces')).status,
      401,
      'changed platform credential rejects previous platform session',
    );
    obsolete.cookie = oldPlatformCookie;
    assert.equal(
      (await obsolete.request('/api/workspaces')).status,
      401,
      'explicit login rotation already invalidated the older cookie',
    );
    await second.close();
    second = await serve(
      createApp({
        store,
        password: platformPassword,
        sessionSecret: 'isolated-key-two',
        allowedOrigins: [],
      }),
    );
    const rotated = client(second.baseUrl);
    rotated.cookie = customerCookie;
    assert.equal(
      (await rotated.request('/api/research/state')).status,
      401,
      'changed HMAC key invalidates customer cookie',
    );
    assert.equal(JSON.stringify(store.all('SELECT * FROM research_users')), userBefore);
  } finally {
    if (second) await second.close();
    else await first.close();
    store.close();
  }
});

test('Alex RWP fine classification and real zero values use one market scope without rewriting shared observations', async () => {
  const h = await setup();
  try {
    const space = await h.space('Fine classification'),
      { user } = await h.member(space.id, 'category@alex.test');
    const zero = app(h.store, 1, {
      minInstalls: 0,
      score: 0,
      storeData: { released: '2026-09-07' },
    });
    const unknown = app(h.store, 2, {
      minInstalls: null,
      score: null,
      storeData: { released: '2026-09-07' },
    });
    const other = app(h.store, 3, {
      minInstalls: 500,
      score: 5,
      storeData: { released: '2026-09-07' },
    });
    const excluded = app(h.store, 4, { minInstalls: 999999 });
    h.store.updateClassification(excluded.id, 'excluded');
    const snapshotsBefore = JSON.stringify(h.store.all('SELECT * FROM snapshots ORDER BY id'));
    const appsBefore = JSON.stringify(h.store.all('SELECT * FROM apps ORDER BY id'));
    await h.platform.json(`/api/platform/apps/${zero.id}/category`, 'PATCH', {
      category: 'personal',
      reason: 'Independent fixture review',
    });
    await h.platform.json(`/api/platform/apps/${other.id}/category`, 'PATCH', {
      category: 'other',
      reason: 'Independent fixture review',
    });
    assert.equal(
      JSON.stringify(h.store.all('SELECT * FROM snapshots ORDER BY id')),
      snapshotsBefore,
    );
    assert.equal(JSON.stringify(h.store.all('SELECT * FROM apps ORDER BY id')), appsBefore);
    const defaultRows = await user.json('/api/market/apps');
    assert.deepEqual(
      defaultRows.apps.map((row: any) => row.id),
      [zero.id, unknown.id],
    );
    assert.equal(defaultRows.apps[1].category, 'unknown');
    assert.equal(defaultRows.apps[1].categorySource, 'unclassified');
    assert.deepEqual(
      (await user.json('/api/market/apps?loanScope=personal&minInstalls=0&minScore=0')).apps.map(
        (row: any) => row.id,
      ),
      [zero.id],
    );
    assert.deepEqual(
      (await user.json('/api/market/apps?loanScope=other')).apps.map((row: any) => row.id),
      [other.id],
    );
    assert.equal((await user.json('/api/market/apps?loanScope=all')).total, 3);
    const events = await user.json('/api/market/activity?date=2026-09-07&type=storeRelease');
    assert.deepEqual(
      events.events.map((event: any) => event.appId).sort(),
      [zero.id, unknown.id].sort(),
    );
    const country = events.countries.find((row: any) => row.country === 'th');
    assert.equal(country.apps, 2);
    assert.equal((await user.request('/api/market/apps?classification=candidate')).status, 400);
    assert.equal((await user.request('/api/market/apps?from=2026-02-30')).status, 400);
    assert.equal((await user.request('/api/market/apps?minInstalls=-1')).status, 400);
    const audit = h.store.all("SELECT * FROM research_audit WHERE action LIKE '%category%'");
    assert.equal(audit.length, 2);
  } finally {
    await h.close();
  }
});

test('Alex RWP full Markdown export includes more than one page, selected collection and original source, never other tenants', async () => {
  const h = await setup();
  try {
    const a = await h.space('Alpha export'),
      b = await h.space('Beta export');
    const owner = await h.member(a.id, 'export-owner@alex.test'),
      viewer = await h.member(a.id, 'export-viewer@alex.test', 'viewer'),
      outsider = await h.member(b.id, 'export-outsider@alex.test');
    const item = app(h.store),
      selected = await owner.user.json(
        '/api/research/collections',
        'POST',
        { name: 'Chosen collection' },
        201,
      );
    for (let i = 0; i < 27; i++)
      await owner.user.json(
        '/api/research/entries',
        'POST',
        {
          appId: item.id,
          collectionId: selected.id,
          kind: 'note',
          text: `Alpha marker ${String(i).padStart(2, '0')}`,
        },
        201,
      );
    await owner.user.json(
      '/api/research/entries',
      'POST',
      { appId: item.id, kind: 'note', text: 'Outside collection marker' },
      201,
    );
    await outsider.user.json(
      '/api/research/entries',
      'POST',
      { appId: item.id, kind: 'note', text: 'Beta confidential marker' },
      201,
    );
    const exported = await viewer.user.request(`/api/research/export?collectionId=${selected.id}`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type')!, /text\/markdown.*charset=utf-8/);
    assert.match(
      exported.headers.get('content-disposition')!,
      /attachment; filename="appeye-research-/,
    );
    const text = await exported.text();
    for (let i = 0; i < 27; i++)
      assert.ok(text.includes(`Alpha marker ${String(i).padStart(2, '0')}`));
    assert.equal(text.includes('Outside collection marker'), false);
    assert.equal(text.includes('Beta confidential marker'), false);
    assert.match(
      await (await owner.user.request('/api/research/export')).text(),
      /Outside collection marker/,
    );
    assert.equal(
      (await owner.user.request(`/api/research/export?workspaceId=${b.id}`)).status,
      400,
    );
  } finally {
    await h.close();
  }
});

test('Alex RWP simultaneous note edits conflict and removing author preserves shared research and peer access', async () => {
  const h = await setup();
  try {
    const space = await h.space('Concurrent research');
    const admin = await h.member(space.id, 'concurrent-admin@alex.test'),
      author = await h.member(space.id, 'concurrent-author@alex.test', 'researcher');
    const item = app(h.store);
    const entry = (
      await author.user.json(
        '/api/research/entries',
        'POST',
        { appId: item.id, kind: 'note', text: 'Original' },
        201,
      )
    ).entry;
    const edits = await Promise.all([
      author.user.request(`/api/research/entries/${entry.id}`, 'PATCH', {
        revision: 1,
        text: 'Author edit',
      }),
      admin.user.request(`/api/research/entries/${entry.id}`, 'PATCH', {
        revision: 1,
        text: 'Admin edit',
      }),
    ]);
    assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
    const before = h.store.one('SELECT * FROM research_entries WHERE id=?', entry.id)!;
    assert.equal(before.revision, 2);
    await admin.user.json(
      `/api/workspaces/${space.id}/members/${author.session.user.id}`,
      'DELETE',
      {},
    );
    assert.equal((await author.user.request('/api/research/state')).status, 401);
    assert.deepEqual(h.store.one('SELECT * FROM research_entries WHERE id=?', entry.id), before);
    assert.equal(
      (await admin.user.json('/api/research/state')).entries[0].createdBy,
      author.session.user.id,
    );
    assert.equal((await admin.user.request(`/api/research/entries/${entry.id}`, 'DELETE', { revision: 1 })).status, 409);
    assert.deepEqual(h.store.one('SELECT * FROM research_entries WHERE id=?', entry.id), before);
    assert.equal((await admin.user.request(`/api/research/entries/${entry.id}`, 'DELETE', {})).status, 400);
    await admin.user.json(`/api/research/entries/${entry.id}`, 'DELETE', { revision: before.revision });
    assert.equal(h.store.one('SELECT * FROM research_entries WHERE id=?', entry.id), undefined);
  } finally {
    await h.close();
  }
});

test('Alex RWP intake uses the real worker path, shares only collection work and preserves excluded decisions and private notes', async () => {
  const h = await setup();
  try {
    const a = await h.space('Intake A'),
      b = await h.space('Intake B');
    const first = await h.member(a.id, 'intake-a@alex.test'),
      second = await h.member(b.id, 'intake-b@alex.test');
    const input = { country: 'ar', store: 'google-play', externalId: 'alex.intake.shared' };
    const ar = (
      await first.user.json('/api/research/requests', 'POST', { ...input, note: 'Secret A' }, 201)
    ).request;
    const br = (
      await second.user.json('/api/research/requests', 'POST', { ...input, note: 'Secret B' }, 201)
    ).request;
    const ap = (
      await h.platform.json(`/api/platform/requests/${ar.id}/process`, 'POST', {
        action: 'collect',
      })
    ).request;
    const bp = (
      await h.platform.json(`/api/platform/requests/${br.id}/process`, 'POST', {
        action: 'collect',
      })
    ).request;
    assert.equal(ap.appId, bp.appId);
    assert.equal(ap.jobId, bp.jobId);
    let calls = 0;
    const providers = fixtureProviders();
    providers['google-play'].app = async ({ externalId, country }) => {
      calls++;
      assert.equal(country, 'ar');
      assert.equal(externalId, input.externalId);
      return {
        ...creditApp,
        externalId,
        description: strongLoanFixtures[0]!.description,
        raw: { fixture: true, origin: 'independent-provider' },
      };
    };
    const worker = createWorker({
      store: h.store,
      providers,
      schedule: false,
      requestDelayMs: 0,
      retryDelayMs: 0,
    });
    assert.equal(await worker.runOnce(), true);
    assert.equal(calls, 1);
    const resultA = (await first.user.json('/api/research/state')).requests;
    const resultB = (await second.user.json('/api/research/state')).requests;
    assert.equal(resultA.length, 1);
    assert.equal(resultB.length, 1);
    assert.equal(resultA[0].status, 'admitted');
    assert.equal(resultB[0].status, 'admitted');
    assert.equal(resultA[0].note, 'Secret A');
    assert.equal(resultB[0].note, 'Secret B');
    const job = h.store.one('SELECT result FROM jobs WHERE id=?', ap.jobId)!;
    const snapshotId = JSON.parse(job.result).snapshotId;
    assert.equal(
      h.store.one('SELECT observed_at FROM snapshots WHERE id=?', snapshotId)!.observed_at,
      resultA[0].resultObservedAt,
    );
    h.store.updateClassification(ap.appId, 'excluded');
    assert.equal((await first.user.json('/api/research/state')).requests[0].status, 'review');
    assert.equal((await first.user.request(`/api/apps/${ap.appId}`)).status, 404);
    const retried = (
      await h.platform.json(`/api/platform/requests/${ar.id}/process`, 'POST', {
        action: 'collect',
      })
    ).request;
    // Existing child jobs are irrelevant to this targeted detail-worker attempt.
    h.store.run(
      "UPDATE jobs SET status='succeeded' WHERE id<>? AND status='queued'",
      retried.jobId,
    );
    await worker.runOnce();
    assert.equal(h.store.getApp(ap.appId)!.classification, 'excluded');
    assert.equal((await first.user.json('/api/research/state')).requests[0].status, 'review');
  } finally {
    await h.close();
  }
});

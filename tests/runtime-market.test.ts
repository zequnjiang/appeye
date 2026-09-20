import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, type Store } from '../server/db.js';
import { getMarketActivity } from '../server/market-activity.js';
import { libraryRows, workspaceActivity } from '../server/workspace-market.js';

function fixture(padding = 0) {
  const store = createStore();
  const countries = store.listCountries();
  let n = 0;
  for (const country of countries) {
    for (const market of ['google-play', 'app-store'] as const) {
      for (const category of ['personal', 'other', 'unknown']) {
        n++;
        const firstSeen = '2026-09-19T17:00:00.000Z';
        const app = store.createApp({
          country: country.code,
          store: market,
          externalId: String(n),
          observedAt: firstSeen,
        });
        const data = {
          icon: null,
          title: `App ${n}`,
          developer: 'Synthetic publisher',
          score: n % 3 === 0 ? 0 : 4.1,
          ratings: 0,
          minInstalls: market === 'app-store' ? null : 0,
          summary: 'Synthetic',
          version: '9',
          url: `https://example.test/${country.code}/${n}`,
          releaseNotes: 'Current notes',
          releasedAt: '1999-01-01',
          storeUpdatedAt: '2026-09-20T06:00:00.000Z',
          storeData: {
            released: country.code === 'th' ? '20 ก.ย. 2569' : '2026-09-20',
            ignored: 'x'.repeat(padding),
          },
          raw: { unknown: 'y'.repeat(padding) },
        };
        store.run(
          "UPDATE apps SET classification='confirmed',title=?,developer=?,data=?,last_fetched_at=? WHERE id=?",
          data.title,
          data.developer,
          JSON.stringify(data),
          '2026-09-20T07:00:00.000Z',
          app.id,
        );
        if (category !== 'unknown')
          store.run(
            'INSERT INTO research_app_categories VALUES (?,?,?,?,?)',
            app.id,
            category,
            'fixture',
            0,
            firstSeen,
          );
        for (let version = 1; version <= 9; version++) {
          const at = `2026-09-20T0${version - 1}:00:00.000Z`;
          const observed = {
            ...data,
            raw: { fixture: true },
            storeData: { released: version === 1 ? '2012-05-08' : data.storeData.released },
            version: String(version),
            releaseNotes: `Observed ${version}`,
            url: `https://example.test/snapshot/${n}/${version}`,
          };
          const id = Number(
            store.run(
              'INSERT INTO snapshots(app_id,observed_at,data,raw) VALUES (?,?,?,?)',
              app.id,
              at,
              JSON.stringify(observed),
              '{}',
            ).lastInsertRowid,
          );
          if (version > 1) {
            store.run(
              'INSERT INTO changes(app_id,snapshot_id,field,old_value,new_value,observed_at) VALUES (?,?,?,?,?,?)',
              app.id,
              id,
              'version',
              JSON.stringify(String(version - 1)),
              JSON.stringify(String(version)),
              at,
            );
            store.run(
              'INSERT INTO changes(app_id,snapshot_id,field,old_value,new_value,observed_at) VALUES (?,?,?,?,?,?)',
              app.id,
              id,
              'score',
              'null',
              '0',
              at,
            );
          }
        }
      }
    }
  }
  for (const classification of ['candidate', 'excluded']) {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: classification,
      observedAt: '2026-09-20T00:00:00.000Z',
    });
    store.run('UPDATE apps SET classification=? WHERE id=?', classification, app.id);
  }
  return store;
}

// The original public composition deliberately repeats calls. It is a separate
// oracle for ensuring the optimized workspace path never derives full-scope
// cards/highlights from a paginated result or a broader category set.
function originalComposition(store: Store, input: Record<string, any>) {
  const query = { loanScope: 'cash-priority', type: 'all', limit: 50, offset: 0, ...input };
  const selected = libraryRows(store, query as any);
  const common = {
    ...query,
    classification: 'confirmed' as const,
    appIds: selected.map((a) => a.id),
  };
  const all = getMarketActivity(store, common as any);
  const complete = getMarketActivity(store, { ...common, limit: 200, offset: 0 } as any);
  return {
    ...all,
    unknownTotal: selected.filter((a) => a.category === 'unknown').length,
    featuredEvents: complete.events.slice(0, 4),
    countries: all.countries.map((country) => {
      const one = getMarketActivity(store, {
        ...common,
        country: country.country,
        limit: 1,
        offset: 0,
        appIds: selected.filter((a) => a.country === country.country).map((a) => a.id),
      } as any);
      return {
        ...country,
        apps: selected.filter((a) => a.country === country.country).length,
        unknownApps: selected.filter(
          (a) => a.country === country.country && a.category === 'unknown',
        ).length,
        latestEvent: one.events[0] ?? null,
        latestEventAt: one.events[0]?.eventAt ?? null,
      };
    }),
  };
}

test('#49 market result stays deeply equal across scopes, types, markets, empty days and pagination beyond 200', () => {
  const store = fixture();
  try {
    const before = store.all('SELECT * FROM apps');
    for (const loanScope of ['cash-priority', 'personal', 'other', 'unknown', 'all']) {
      for (const type of ['all', 'firstSeen', 'storeRelease', 'observedUpdate']) {
        for (const filter of [
          {},
          { country: 'th', store: 'google-play' },
          { country: 'ar', store: 'app-store' },
        ]) {
          const input = {
            date: '2026-09-20',
            timeZone: 'Asia/Shanghai',
            loanScope,
            type,
            limit: 3,
            offset: 203,
            ...filter,
          };
          assert.deepEqual(workspaceActivity(store, input), originalComposition(store, input));
        }
      }
    }
    for (const date of ['1999-01-01', '2012-05-08', '2026-09-19', '2026-09-21']) {
      const input = { date, limit: 1, offset: 1 };
      assert.deepEqual(workspaceActivity(store, input), originalComposition(store, input));
    }
    const full = workspaceActivity(store, {
      date: '2026-09-20',
      loanScope: 'all',
      limit: 1,
      offset: 250,
    });
    assert.equal(full.total, 360);
    assert.equal(full.events.length, 1);
    assert.equal(full.featuredEvents.length, 4);
    assert.equal(full.unknownTotal, 12);
    for (const country of full.countries) {
      assert.deepEqual(country.counts, { firstSeen: 6, storeRelease: 6, observedUpdate: 6 });
      assert.deepEqual(country.eventCounts, { firstSeen: 6, storeRelease: 6, observedUpdate: 48 });
      assert.equal(country.apps, 6);
      assert.equal(country.unknownApps, 2);
      assert.equal(country.latestEvent?.country, country.country);
      assert.equal(country.latestEvent?.observedAt, '2026-09-20T08:00:00.000Z');
    }
    assert.deepEqual(store.all('SELECT * FROM apps'), before);
  } finally {
    store.close();
  }
});

test('#49 projection preserves invalid and missing source types, first-snapshot evidence and raw changes without guessing dates', () => {
  const store = fixture();
  try {
    const id = 1;
    const original = store.one('SELECT data FROM apps WHERE id=?', id)!.data;
    for (const raw of [
      true,
      false,
      0,
      { unknown: 'source' },
      ['2026-09-20'],
      '',
      null,
      '2026-02-31',
      '20 ก.ย. 2569',
    ]) {
      const data = { ...JSON.parse(original), storeData: { released: raw } };
      store.run('UPDATE apps SET data=? WHERE id=?', JSON.stringify(data), id);
      const activity = getMarketActivity(store, { date: '2026-09-20', appIds: [id] });
      const first = activity.events.find((e) => e.type === 'firstSeen')!;
      assert.equal(first.releasedAt, '2012-05-08');
      assert.equal(first.sourceUrl, 'https://example.test/snapshot/1/1');
      assert.equal(first.releaseNotes, 'Observed 1');
      assert.equal(first.eventAt, '2026-09-19T17:00:00.000Z');
      const updates = activity.events.filter((e) => e.type === 'observedUpdate');
      assert.equal(updates.length, 8);
      assert.ok(updates.every((e) => e.versionChanged));
      assert.deepEqual(
        updates[0].changes.map((c) => [c.field, c.oldValue, c.newValue]),
        [
          ['version', '8', '9'],
          ['score', null, 0],
        ],
      );
      assert.equal(
        activity.events.filter((e) => e.type === 'storeRelease').length,
        raw === '20 ก.ย. 2569' ? 1 : 0,
      );
      const row = libraryRows(store, { store: 'google-play' }).find(
        (r) => r.id === id,
      )!;
      assert.deepEqual(row.releasedAtRaw, raw);
      assert.equal(
        row.releasedAt,
        raw === null || raw === ''
          ? '1999-01-01'
          : raw === '20 ก.ย. 2569'
            ? '2026-09-20'
            : typeof raw === 'number'
              ? '1970-01-01T00:00:00.000Z'
              : null,
      );
    }
    assert.equal(getMarketActivity(store, { date: '2026-09-20', appIds: [] }).total, 0);
    assert.equal(getMarketActivity(store, { date: '2026-09-20', appIds: [999999] }).total, 0);
    assert.throws(() => workspaceActivity(store, { date: '2026-02-31' }), /无效日期/);
    assert.throws(() => workspaceActivity(store, { country: 'zz' }), /国家不存在/);
    assert.throws(() => getMarketActivity(store, { limit: 201 }), /分页参数/);
    assert.throws(() => getMarketActivity(store, { offset: -1 }), /分页参数/);
  } finally {
    store.close();
  }
});

test('#49 one workspace request reads one event population and does not transfer unused large source data', (t) => {
  const store = fixture(128_000);
  const read = store.all.bind(store);
  let populationReads = 0,
    fullPayloadBytes = 0;
  store.all = ((sql: string, ...params: any[]) => {
    const rows = read(sql, ...params);
    if (sql.includes('FROM apps') && sql.includes('first_seen_at')) {
      populationReads++;
      for (const row of rows) fullPayloadBytes += Buffer.byteLength(String(row.data ?? ''));
    }
    return rows;
  }) as Store['all'];
  try {
    const start = performance.now();
    const result = workspaceActivity(store, { date: '2026-09-20', loanScope: 'all' });
    const elapsedMs = performance.now() - start;
    assert.equal(result.total, 360);
    assert.equal(populationReads, 1);
    assert.ok(fullPayloadBytes < 25_000, `${fullPayloadBytes} transferred bytes`);
    assert.equal(
      store.one("SELECT SUM(length(data)) bytes FROM apps WHERE classification='confirmed'")!
        .bytes > 9_000_000,
      true,
    );
    t.diagnostic(
      JSON.stringify({ synthetic: true, apps: 36, populationReads, fullPayloadBytes, elapsedMs }),
    );
  } finally {
    store.close();
  }
});

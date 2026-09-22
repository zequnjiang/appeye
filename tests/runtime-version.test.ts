import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, type Store } from '../server/db.js';

test('#49 version index preserves all observed transitions, timestamp ties and JSON types', () => {
  const store = createStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'runtime.version',
    });
    store.db.exec('DROP INDEX snapshots_app_version_time');
    for (const [n, version] of [
      null,
      '1',
      ' 1 ',
      '',
      'unknown',
      '2',
      '2',
      0,
      false,
      'vary',
      '3',
      { legacy: true },
      '4',
    ].entries()) {
      store.run(
        'INSERT INTO snapshots(app_id,observed_at,data,raw) VALUES (?,?,?,?)',
        app.id,
        `2026-09-${String(10 + Math.floor(n / 2)).padStart(2, '0')}T12:00:00.000Z`,
        JSON.stringify({ version, original: 'x'.repeat(10000) }),
        '{}',
      );
    }
    const other = store.createApp({
      country: 'mx',
      store: 'google-play',
      externalId: 'runtime.version',
    });
    store.run(
      'INSERT INTO snapshots(app_id,observed_at,data,raw) VALUES (?,?,?,?)',
      other.id,
      '2020-01-01',
      JSON.stringify({ version: 'unrelated' }),
      '{}',
    );
    const sql =
      "SELECT json_extract(data,'$.version') version,observed_at FROM snapshots WHERE app_id=? AND json_extract(data,'$.version') IS NOT NULL ORDER BY observed_at,id";
    const before = store.getApp(app.id);
    const observations = store.all(sql, app.id);
    store.db.exec(
      "CREATE INDEX snapshots_app_version_time ON snapshots(app_id,observed_at,id,json_extract(data,'$.version')) WHERE json_extract(data,'$.version') IS NOT NULL",
    );
    assert.deepEqual(store.all(sql, app.id), observations);
    assert.deepEqual(store.getApp(app.id), before);
    assert.equal(before?.updateCount, 5);
    assert.ok(
      store
        .all('EXPLAIN QUERY PLAN ' + sql, app.id)
        .some((row) => row.detail.includes('snapshots_app_version_time')),
    );
    store.run(
      'INSERT INTO snapshots(app_id,observed_at,data,raw) VALUES (?,?,?,?)',
      app.id,
      '2026-09-20T12:00:00.000Z',
      JSON.stringify({ version: '5' }),
      '{}',
    );
    assert.equal(store.getApp(app.id)?.updateCount, 6);
  } finally {
    store.close();
  }
});

test('#49 discovery receipt needs only existing identity and preserves the original observation', () => {
  const store = createStore();
  try {
    const app = store.createApp({
      country: 'th',
      store: 'google-play',
      externalId: 'runtime.receipt',
    });
    const all = store.all.bind(store);
    store.all = ((sql: string, ...args: any[]) => {
      assert.ok(!sql.includes('snapshots'), 'receipt insertion must not reread version history');
      return all(sql, ...args);
    }) as Store['all'];
    const input = {
      keyword: 'loan',
      requestCountry: 'th',
      requestLanguage: 'th',
      source: 'search',
      data: { externalId: 'runtime.receipt', title: 'Original title' },
      raw: { original: true },
      observedAt: '2026-09-01T12:00:00.000Z',
    };
    const receipt = store.recordDiscovery(app.id, input);
    assert.equal(receipt.observedAt, input.observedAt);
    const row = store.one('SELECT * FROM discovery_observations WHERE id=?', receipt.id)!;
    assert.equal(row.app_id, app.id);
    assert.deepEqual(JSON.parse(row.raw), input.raw);
    assert.deepEqual(JSON.parse(row.data), input.data);
    assert.equal(row.request_country, input.requestCountry);
    assert.throws(() => store.recordDiscovery(app.id + 999, input), /App not found/);
    assert.equal(store.one('SELECT COUNT(*) n FROM discovery_observations')?.n, 1);
  } finally {
    store.close();
  }
});

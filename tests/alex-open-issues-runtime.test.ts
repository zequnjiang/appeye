import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, type Store } from '../server/db.js';
import { createFullScanRunner, ensureFullScanSchema } from '../server/full-scan.js';
import type { FullScanProviders } from '../server/full-scan-providers.js';

function prepareLegacySeen(store: Store) {
  store.db.exec(`CREATE TABLE full_scan_review_seen (
    batch_id TEXT NOT NULL, app_id INTEGER NOT NULL, external_id TEXT NOT NULL,
    PRIMARY KEY(batch_id,app_id,external_id));
    INSERT INTO full_scan_review_seen VALUES
      ('one',1,'same'),('one',2,'same'),('one',1,'other'),('two',1,'same');`);
}
function assertCounts(store: Store, batches = ['one', 'two', 'empty', 'moved']) {
  for (const batch of batches) {
    const actual = store.one(
      'SELECT COUNT(*) n FROM full_scan_review_seen WHERE batch_id=?',
      batch,
    )!.n;
    const derived =
      store.one('SELECT review_count n FROM full_scan_seen_counts WHERE batch_id=?', batch)?.n ?? 0;
    assert.equal(derived, actual, batch);
  }
}
function runner(store: Store, batchId: string) {
  return createFullScanRunner({
    store,
    batchId,
    providers: {} as FullScanProviders,
    config: {
      countries: ['th'],
      stores: ['google-play'],
      includeExisting: false,
      includeSearch: false,
      collections: { 'google-play': [] },
    },
  });
}

test('Alex RUN02: exact legacy seen initialization, repeated ensure and persisted reopen preserve every original identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alex-seen-counter-')),
    file = join(dir, 'isolated.sqlite');
  let store = createStore(file);
  try {
    prepareLegacySeen(store);
    const original = store.all(
      'SELECT * FROM full_scan_review_seen ORDER BY batch_id,app_id,external_id',
    );
    ensureFullScanSchema(store);
    assertCounts(store);
    const counters = store.all('SELECT * FROM full_scan_seen_counts ORDER BY batch_id');
    ensureFullScanSchema(store);
    assert.deepEqual(store.all('SELECT * FROM full_scan_seen_counts ORDER BY batch_id'), counters);
    assert.deepEqual(
      store.all('SELECT * FROM full_scan_review_seen ORDER BY batch_id,app_id,external_id'),
      original,
    );
    store.close();
    store = createStore(file);
    ensureFullScanSchema(store);
    assertCounts(store);
    assert.deepEqual(
      store.all('SELECT * FROM full_scan_review_seen ORDER BY batch_id,app_id,external_id'),
      original,
    );
    assert.equal(runner(store, 'empty').summary().reviewCount, 0);
    assert.equal(runner(store, 'one').summary().reviewCount, 3);
    assert.equal(runner(store, 'two').summary().reviewCount, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Alex RUN02: ignored duplicates, app-local IDs, delete and batch move keep precise counts and rollback together', () => {
  const store = createStore();
  try {
    prepareLegacySeen(store);
    ensureFullScanSchema(store);
    const insert = store.db.prepare('INSERT OR IGNORE INTO full_scan_review_seen VALUES(?,?,?)');
    insert.run('one', 1, 'same');
    assertCounts(store);
    insert.run('one', 3, 'same');
    insert.run('two', 3, 'same');
    assertCounts(store);
    store.run(
      "UPDATE full_scan_review_seen SET external_id='renamed',app_id=30 WHERE batch_id='one' AND app_id=3",
    );
    assertCounts(store);
    store.run(
      "UPDATE full_scan_review_seen SET batch_id='moved' WHERE batch_id='one' AND app_id=30",
    );
    assertCounts(store);
    store.run("UPDATE full_scan_review_seen SET batch_id='one' WHERE batch_id='one'");
    assertCounts(store);
    assert.throws(
      () =>
        store.run(
          "UPDATE full_scan_review_seen SET batch_id='two' WHERE batch_id='one' AND app_id=1 AND external_id='same'",
        ),
      /UNIQUE/,
    );
    assertCounts(store);
    const rows = store.all(
      'SELECT * FROM full_scan_review_seen ORDER BY batch_id,app_id,external_id',
    );
    const counts = store.all('SELECT * FROM full_scan_seen_counts ORDER BY batch_id');
    assert.throws(
      () =>
        store.transaction(() => {
          insert.run('one', 100, 'rolled-back');
          store.run("DELETE FROM full_scan_review_seen WHERE batch_id='two'");
          store.run(
            "UPDATE full_scan_review_seen SET batch_id='moved' WHERE batch_id='one' AND external_id='other'",
          );
          assertCounts(store);
          throw new Error('Alex synthetic interrupted write');
        }),
      /interrupted write/,
    );
    assert.deepEqual(
      store.all('SELECT * FROM full_scan_review_seen ORDER BY batch_id,app_id,external_id'),
      rows,
    );
    assert.deepEqual(store.all('SELECT * FROM full_scan_seen_counts ORDER BY batch_id'), counts);
    store.run("DELETE FROM full_scan_review_seen WHERE batch_id='one'");
    assertCounts(store);
    store.run("DELETE FROM full_scan_review_seen WHERE batch_id='one'");
    assertCounts(store);
    assert.equal(runner(store, 'one').summary().reviewCount, 0);
  } finally {
    store.close();
  }
});

test('Alex RUN02: failed first backfill rolls derived schema back and retry reconstructs the exact existing total', () => {
  const store = createStore();
  try {
    prepareLegacySeen(store);
    const exec = store.db.exec.bind(store.db);
    store.db.exec = (sql: string) => {
      if (
        /INSERT INTO full_scan_seen_counts\(batch_id,review_count\)\s+SELECT batch_id,COUNT/.test(
          sql,
        )
      )
        throw new Error('Alex interrupted initialization');
      return exec(sql);
    };
    try {
      assert.throws(() => ensureFullScanSchema(store), /interrupted initialization/);
    } finally {
      store.db.exec = exec;
    }
    assert.equal(
      store.one(
        "SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('full_scan_seen_counts','full_scan_seen_insert','full_scan_seen_delete','full_scan_seen_move')",
      )!.n,
      0,
    );
    assert.equal(store.one('SELECT COUNT(*) n FROM full_scan_review_seen')!.n, 4);
    ensureFullScanSchema(store);
    assertCounts(store);
    assert.equal(runner(store, 'one').summary().reviewCount, 3);
  } finally {
    store.close();
  }
});

test('Alex RUN02: subsequent summary is read-only and uses the persisted exact total without scanning seen identities', () => {
  const store = createStore();
  try {
    prepareLegacySeen(store);
    ensureFullScanSchema(store);
    const scan = runner(store, 'one');
    const before = scan.summary(),
      changes = store.one('SELECT total_changes() n')!.n;
    const query = store.one.bind(store),
      observed: string[] = [];
    store.one = (sql: string, ...args: any[]) => {
      observed.push(sql);
      assert.doesNotMatch(sql, /COUNT\s*\([^)]*\)[\s\S]*FROM\s+full_scan_review_seen/i);
      return query(sql, ...args);
    };
    try {
      assert.deepEqual(scan.summary(), before);
      assert.deepEqual(scan.summary(), before);
    } finally {
      store.one = query;
    }
    assert.equal(store.one('SELECT total_changes() n')!.n, changes);
    assert.ok(observed.some((sql) => sql.includes('full_scan_seen_counts')));
    assert.match(
      store
        .all(
          'EXPLAIN QUERY PLAN SELECT review_count FROM full_scan_seen_counts WHERE batch_id=?',
          'one',
        )
        .map((row) => row.detail)
        .join(' '),
      /SEARCH/,
    );
  } finally {
    store.close();
  }
});

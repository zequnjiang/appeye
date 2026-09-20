import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { ensureFullScanSchema } from '../server/full-scan.js';

test('RUN02 exact review counts initialize from old identities and remain transactional without repeated scans', () => {
  const store = createStore();
  try {
    ensureFullScanSchema(store);
    store.db
      .exec(`DROP TRIGGER full_scan_seen_insert; DROP TRIGGER full_scan_seen_delete; DROP TRIGGER full_scan_seen_move; DROP TABLE full_scan_seen_counts;
      INSERT INTO full_scan_review_seen VALUES('old',1,'a'),('old',1,'b'),('second',2,'a');`);
    const original = store.all(
      'SELECT * FROM full_scan_review_seen ORDER BY batch_id,app_id,external_id',
    );
    ensureFullScanSchema(store);
    const check = () =>
      assert.deepEqual(
        store.all(
          'SELECT batch_id,review_count FROM full_scan_seen_counts WHERE review_count>0 ORDER BY batch_id',
        ),
        store.all(
          'SELECT batch_id,COUNT(*) review_count FROM full_scan_review_seen GROUP BY batch_id ORDER BY batch_id',
        ),
      );
    check();
    ensureFullScanSchema(store);
    assert.deepEqual(
      store.all('SELECT * FROM full_scan_review_seen ORDER BY batch_id,app_id,external_id'),
      original,
    );
    store.run("INSERT OR IGNORE INTO full_scan_review_seen VALUES('old',1,'a')");
    store.run("INSERT OR IGNORE INTO full_scan_review_seen VALUES('old',1,'c')");
    check();
    assert.throws(
      () =>
        store.transaction(() => {
          store.run("DELETE FROM full_scan_review_seen WHERE batch_id='old'");
          throw new Error('rollback');
        }),
      /rollback/,
    );
    check();
    store.run(
      "UPDATE full_scan_review_seen SET batch_id='moved' WHERE batch_id='old' AND external_id='a'",
    );
    store.run("DELETE FROM full_scan_review_seen WHERE batch_id='second'");
    check();
    assert.equal(
      store.one("SELECT review_count FROM full_scan_seen_counts WHERE batch_id='second'")!
        .review_count,
      0,
    );
    const plan = store.all(
      "EXPLAIN QUERY PLAN SELECT review_count FROM full_scan_seen_counts WHERE batch_id='old'",
    );
    assert.ok(plan.every((r) => !String(r.detail).includes('SCAN ')));
    const candidatePlan = store.all(
      "EXPLAIN QUERY PLAN SELECT verdict,COUNT(*) count,SUM(app_id IS NOT NULL) admitted FROM full_scan_candidates WHERE batch_id='old' GROUP BY verdict",
    );
    assert.ok(
      candidatePlan.some((r) =>
        String(r.detail).includes('COVERING INDEX full_scan_candidate_summary'),
      ),
    );
    assert.ok(candidatePlan.every((r) => !String(r.detail).includes('TEMP')));
  } finally {
    store.close();
  }
});

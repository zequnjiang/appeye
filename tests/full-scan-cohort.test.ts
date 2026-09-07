import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStore } from '../server/db.js';
import { createFullScanRunner } from '../server/full-scan.js';
import type { FullScanProviders } from '../server/full-scan-providers.js';

test('HMA-AC-06: read-only batch audit excludes later hourly apps and independently detects lost initial members', () => {
  const directory = mkdtempSync(join(tmpdir(), 'appeye-cohort-'));
  const database = join(directory, 'fixture.sqlite'),
    baselinePath = join(directory, 'baseline.json');
  const batchId = 'frozen-fixture';
  try {
    let store = createStore(database);
    const members = ['initial.one', 'initial.two'].map((externalId) =>
      store.createApp({ store: 'google-play', country: 'th', externalId }),
    );
    const runner = createFullScanRunner({
      store,
      batchId,
      providers: {} as FullScanProviders,
      config: {
        countries: ['th'],
        stores: ['google-play'],
        collections: { 'google-play': [] },
        includeSearch: false,
      },
    });
    runner.seed();
    store.createApp({ store: 'google-play', country: 'th', externalId: 'later.hourly' });
    writeFileSync(
      baselinePath,
      JSON.stringify({
        batchId,
        members: members.map((a) => ({
          id: a.id,
          country: a.country,
          store: a.store,
          external_id: a.externalId,
        })),
      }),
    );
    store.close();
    const digest = () => createHash('sha256').update(readFileSync(database)).digest('hex');
    const audit = (baseline = true) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            resolve('scripts/full-scan-audit.ts'),
            '--database',
            database,
            '--batch-id',
            batchId,
            ...(baseline ? ['--baseline', baselinePath] : []),
          ],
          { encoding: 'utf8' },
        ),
      );
    const before = digest(),
      first = audit();
    assert.equal(digest(), before, 'operational audit must not write/migrate');
    assert.equal(first.totals.allDatabaseMainApps, 3);
    assert.equal(first.totals.batchMainApps, 2);
    assert.equal(first.cohort.expectedMembers, 2);
    assert.equal(first.cohort.initialMembershipVerified, true);
    assert.deepEqual(first.baseline.preservationMismatches, []);
    for (const key of [
      'missingDetailTasks',
      'mainAppsWithoutSevenSupplements',
      'mainAppsWithoutReviewStream',
    ])
      assert.equal(first.invariants[key], 0);
    store = createStore(database);
    store.run('DELETE FROM full_scan_tasks WHERE batch_id=? AND app_id=?', batchId, members[0]!.id);
    store.close();
    const missing = audit();
    for (const key of [
      'missingDetailTasks',
      'mainAppsWithoutSevenSupplements',
      'mainAppsWithoutReviewStream',
    ])
      assert.equal(missing.invariants[key], 1);
    assert.equal(missing.cohort.expectedMembers, 2);
    assert.deepEqual(missing.baseline.preservationMismatches, [
      { id: members[0]!.id, fields: ['missing-from-batch-detail-targets'] },
    ]);
    const unanchored = audit(false);
    assert.equal(unanchored.cohort.initialMembershipVerified, false);
    assert.match(unanchored.cohort.limitation, /cannot be verified/);
    store = createStore(database);
    store.run(
      "DELETE FROM full_scan_tasks WHERE batch_id=? AND app_id=? AND kind='detail'",
      batchId,
      members[1]!.id,
    );
    store.close();
    assert.equal(
      audit(false).invariants.missingDetailTasks,
      1,
      'other same-batch references independently retain a member missing its detail task',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, type Store } from '../server/db.js';
import { createHourlyRunner } from '../server/hourly-monitor.js';
import { hourlyProviders, hourStart } from './hourly-fixtures.js';

test('#49 hourly scheduling avoids the queue pause scan while all countries are enabled', () => {
  const store = createStore();
  try {
    const runner = createHourlyRunner({
      store,
      providers: hourlyProviders(),
      now: () => new Date(hourStart),
    });
    runner.schedule();
    const before = store.all('SELECT * FROM monitor_tasks ORDER BY id');
    assert.ok(before.length > 0);
    const run = store.run.bind(store);
    let pauseUpdates = 0;
    store.run = ((sql: string, ...args: any[]) => {
      if (sql.includes('Country paused before automatic task started')) pauseUpdates++;
      return run(sql, ...args);
    }) as Store['run'];
    runner.schedule();
    runner.schedule();
    assert.equal(pauseUpdates, 0);
    assert.deepEqual(store.all('SELECT * FROM monitor_tasks ORDER BY id'), before);
  } finally {
    store.close();
  }
});

test('#49 hourly pause changes take effect in the next transaction with the original exact task outcome', () => {
  const store = createStore();
  try {
    let now = new Date(hourStart);
    const runner = createHourlyRunner({ store, providers: hourlyProviders(), now: () => now });
    runner.schedule();
    const active = store.one(
      "SELECT id FROM monitor_tasks WHERE country='th' ORDER BY id LIMIT 1",
    )!;
    store.run("UPDATE monitor_tasks SET status='running' WHERE id=?", active.id);
    store.run("UPDATE countries SET enabled=0 WHERE code='th'");
    const before = store.all('SELECT * FROM monitor_tasks ORDER BY id');
    now = new Date(now.getTime() + 1000);
    runner.schedule();
    const expected = before.map((row) =>
      row.country === 'th' && row.status === 'queued'
        ? {
            ...row,
            status: 'skipped',
            finished_at: now.toISOString(),
            error: 'Country paused before automatic task started',
          }
        : { ...row },
    );
    assert.deepEqual(
      store.all('SELECT * FROM monitor_tasks ORDER BY id').map((row) => ({ ...row })),
      expected,
    );
    store.run("UPDATE countries SET enabled=1 WHERE code='th'");
    runner.schedule();
    assert.deepEqual(
      store.all('SELECT * FROM monitor_tasks ORDER BY id').map((row) => ({ ...row })),
      expected,
    );
  } finally {
    store.close();
  }
});

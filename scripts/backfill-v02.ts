import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../server/db.js';

// Run while the sole server/worker is stopped and after taking an online SQLite backup.
// Migration preserves all historical observations and classifications. This script makes no network requests.
const databasePath = resolve(process.env.DATABASE_PATH ?? 'data/appeye.sqlite');
if (!existsSync(databasePath)) throw new Error(`数据库不存在，拒绝新建空库：${databasePath}`);
const old = new DatabaseSync(databasePath, { readOnly: true });
const before = Object.fromEntries(
  ['apps', 'snapshots', 'changes', 'reviews', 'jobs'].map((table) => [
    table,
    old.prepare(`SELECT COUNT(*) count FROM ${table}`).get()!.count,
  ]),
);
old.close();
const store = createStore(databasePath);
try {
  const recomputed = process.argv.includes('--force-analysis')
    ? store.backfillLoanAnalyses(true)
    : 0;
  const after = Object.fromEntries(
    ['apps', 'snapshots', 'changes', 'reviews', 'jobs'].map((table) => [
      table,
      store.one(`SELECT COUNT(*) count FROM ${table}`)!.count,
    ]),
  );
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('迁移前后历史记录数量不一致，请保留备份并检查');
  const integrity = store.one('PRAGMA quick_check');
  console.log(
    JSON.stringify(
      {
        databasePath,
        networkRequests: 0,
        before,
        after,
        integrity,
        analyzedApps: store.one('SELECT COUNT(*) count FROM apps WHERE loan_analysis IS NOT NULL')!
          .count,
        preservedOverrides: store.one('SELECT COUNT(*) count FROM apps WHERE manual_override=1')!
          .count,
        forceRecomputed: recomputed,
        note: '现有分类保留，未伪造新快照或发现历史。需要自动分类时在后台明确选择自动模式。',
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}

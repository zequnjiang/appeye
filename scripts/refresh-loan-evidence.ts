import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from '../server/db.js';
import { acquireCollectorLock } from '../server/collector-lock.js';
import { refreshLoanEvidence } from '../server/loan-evidence-refresh.js';

// Explicit, idempotent maintenance. Stop the sole worker and take a consistent
// backup first; refuses an active collector and never invokes store HTTP calls.
if (!process.argv.includes('--apply'))
  throw new Error('Stop the collector, back up the database, then pass --apply.');
const path = resolve(process.env.DATABASE_PATH ?? 'data/appeye.sqlite');
if (!existsSync(path)) throw new Error('Database not found; refusing to create an empty database');
const lock = acquireCollectorLock(path, 'loan-evidence-maintenance');
try {
  const store = createStore(path);
  try {
    console.log(JSON.stringify(refreshLoanEvidence(store), null, 2));
  } finally {
    store.close();
  }
} finally {
  lock.release();
}

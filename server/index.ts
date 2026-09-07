import 'dotenv/config';
import { resolve, basename, dirname } from 'node:path';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { createStore } from './db.js';
import { createApp } from './app.js';
import { createCollectionCoordinator } from './collection-coordinator.js';
import { acquireCollectorLock } from './collector-lock.js';

function configuredNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
  integer = false,
) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(`${name} 必须为 ${min}–${max} 之间的${integer ? '整数' : '数字'}`);
  return value;
}
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 12)
  throw new Error('ADMIN_PASSWORD 至少需要 12 个字符');
const demoMode = process.env.DEMO_MODE === 'true';
const databasePath = resolve(
  process.env.DATABASE_PATH ?? (demoMode ? 'data/demo.sqlite' : 'data/appeye.sqlite'),
);
if (demoMode && !/demo/i.test(basename(databasePath)))
  throw new Error('DEMO_MODE 必须使用名称含 demo 的独立数据库，如 data/demo.sqlite');
if (!demoMode && /demo/i.test(basename(databasePath)))
  throw new Error('正式模式不能使用 demo 数据库，请更改 DATABASE_PATH 或启用 DEMO_MODE');
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD)
  throw new Error('生产环境必须设置 ADMIN_PASSWORD');
const requestDelayMs = configuredNumber('SCRAPE_DELAY_MS', 500, 100, 60000);
const timeoutMs = configuredNumber('SCRAPE_TIMEOUT_MS', 30000, 100, 120000);
const lock = acquireCollectorLock(
  databasePath,
  demoMode ? 'demo-server' : 'collection-coordinator',
);
const store = createStore(databasePath);
store.setDataset(demoMode ? 'demo' : 'live');
const coordinator =
  !demoMode && process.env.ADMIN_PASSWORD
    ? createCollectionCoordinator({
        store,
        enabled: process.env.AUTO_SCHEDULE !== 'false',
        providerOptions: { timeoutMs, requestDelayMs, appleBatchSize: 50 },
        discoveryOptions: {
          enabled: process.env.EXTENDED_DISCOVERY_ENABLED !== 'false',
          sourceRequests: configuredNumber('DISCOVERY_SOURCE_REQUESTS', 60, 1, 1000, true),
          detailRequests: configuredNumber('DISCOVERY_DETAIL_REQUESTS', 60, 1, 1000, true),
          timeoutMs: configuredNumber('DISCOVERY_STEP_TIMEOUT_MS', 20000, 100, 60000, true),
          searchResults: configuredNumber('DISCOVERY_SEARCH_RESULTS', 1000, 1, 1000, true),
        },
        intervalMs: configuredNumber('WORKER_INTERVAL_MS', 1000, 50, 60000),
        batchId: process.env.FULL_SCAN_BATCH_ID || undefined,
        onBatchProgress(summary) {
          if (!/^[A-Za-z0-9_-]{1,100}$/.test(summary.batchId))
            throw new Error('Unsafe batch report ID');
          const reportPath = resolve(dirname(databasePath), 'batches', `${summary.batchId}.json`);
          mkdirSync(dirname(reportPath), { recursive: true });
          const report = {
            ...summary,
            updatedAt: new Date().toISOString(),
            databasePath,
            processId: process.pid,
            collector: 'hourly-and-full-scan-coordinator',
            transport: { requestDelayMs, iTunesDelayMs: 3100, timeoutMs, appleBatchSize: 50 },
          };
          writeFileSync(`${reportPath}.tmp`, JSON.stringify(report, null, 2));
          renameSync(`${reportPath}.tmp`, reportPath);
        },
      })
    : undefined;
const app = createApp({
  store,
  worker: coordinator?.worker,
  collection: coordinator,
  password: process.env.ADMIN_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET,
  demoMode,
  secureCookies: process.env.COOKIE_SECURE === 'true',
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
const host = process.env.HOST ?? '127.0.0.1';
const port = configuredNumber('PORT', 3000, 1, 65535, true);
const server = app.listen(port, host, () => {
  console.log(`Appeye ${demoMode ? 'DEMO' : 'LIVE'}: http://${host}:${port}`);
  if (!process.env.ADMIN_PASSWORD) console.warn('设置 ADMIN_PASSWORD 后重启才能登录。');
  coordinator?.start();
});
server.on('error', (error) => {
  console.error(error);
  coordinator?.stop();
  if (!coordinator?.busy) {
    store.close();
    lock.release();
  }
  process.exit(1);
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  coordinator?.stop();
  server.close();
  const deadline = Date.now() + 35000;
  while (coordinator?.busy && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (!coordinator?.busy) {
    store.close();
    lock.release();
  }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

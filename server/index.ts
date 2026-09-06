import 'dotenv/config';
import { resolve, basename } from 'node:path';
import { createStore } from './db.js';
import { createApp } from './app.js';
import { createProviders } from './providers.js';
import { createWorker } from './worker.js';

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
const store = createStore(databasePath);
store.setDataset(demoMode ? 'demo' : 'live');
const worker = createWorker({
  store,
  providers: createProviders(),
  requestDelayMs: configuredNumber('SCRAPE_DELAY_MS', 1500, 0, 60000),
  timeoutMs: configuredNumber('SCRAPE_TIMEOUT_MS', 30000, 100, 300000),
  intervalMs: configuredNumber('WORKER_INTERVAL_MS', 2000, 50, 60000),
  schedule: process.env.AUTO_SCHEDULE !== 'false',
});
const app = createApp({
  store,
  worker,
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
  if (!demoMode && process.env.ADMIN_PASSWORD) worker.start();
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  worker.stop();
  server.close();
  const deadline = Date.now() + 35000;
  while (worker.busy && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (!worker.busy) store.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

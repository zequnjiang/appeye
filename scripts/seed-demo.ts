import 'dotenv/config';
import { basename, resolve } from 'node:path';
import { createStore } from '../server/db.js';
import type { NormalizedApp, StoreName } from '../server/types.js';

if (process.env.DEMO_MODE !== 'true') throw new Error('显式设置 DEMO_MODE=true 后才能创建演示数据');
const path = resolve(process.env.DATABASE_PATH ?? 'data/demo.sqlite');
if (!/demo/i.test(basename(path)))
  throw new Error('演示数据库文件名必须包含 demo，禁止向正式库写入样例');
const store = createStore(path);
store.setDataset('demo');
if (store.listApps().total) {
  console.log(`演示库已有数据，保留现有记录：${path}`);
  store.close();
  process.exit(0);
}
const names: Record<string, [string, string, string]> = {
  th: ['Siam Credit', 'Baht Wallet', 'Lotus Cash'],
  mx: ['Crédito Claro', 'Peso Directo', 'Sol Préstamo'],
  ph: ['Peso Circle', 'Bayan Credit', 'Kaya Cash'],
  pk: ['Rupee Bridge', 'Aasaan Credit', 'Naya Cash'],
  id: ['Dana Cerah', 'Pinjam Saku', 'Kredit Nusantara'],
  ar: ['Crédito Sur', 'Plata Simple', 'Sol Crédito'],
};
const base = Date.now();
let n = 0;
for (const country of store.listCountries()) {
  for (let k = 0; k < 3; k++) {
    n++;
    const platform: StoreName = k === 1 ? 'app-store' : 'google-play';
    const externalId =
      platform === 'google-play' ? `demo.appeye.${country.code}.${k}` : `9900000${n}`;
    const app = store.createApp({
      store: platform,
      country: country.code,
      externalId,
      title: `${names[country.code]![k]} · 演示`,
      sourceKeyword: country.keywords[0],
    });
    store.updateClassification(app.id, k === 2 ? 'candidate' : 'confirmed');
    const firstSeenAt = new Date(base - (22 + k * 2) * 86400000).toISOString();
    store.run('UPDATE apps SET first_seen_at=? WHERE id=?', firstSeenAt, app.id);
    for (let version = 0; version < 3; version++) {
      const at = new Date(base - (20 - version * 9 + k) * 86400000).toISOString();
      const data: NormalizedApp = {
        externalId,
        title: `${names[country.code]![k]} · 演示`,
        developer: `Appeye Fictional Studio ${country.code.toUpperCase()}`,
        url:
          platform === 'google-play'
            ? `https://play.google.com/store/apps/details?id=${externalId}`
            : `https://apps.apple.com/${country.code}/app/id${externalId}`,
        summary: '用于展示市场观察流程的虚构应用，无实际金融服务。',
        description: `这是 ${country.name} 市场的虚构演示应用。所有指标、评论和版本均为合成样例，不能用于商业决策。`,
        version: `2.${version}.${k}`,
        score: Math.round((3.7 + k * 0.2 + version * 0.1) * 10) / 10,
        ratings: 1600 + n * 410 + version * 130,
        installs: platform === 'google-play' ? '100,000+' : null,
        minInstalls: platform === 'google-play' ? 100000 : null,
        maxInstalls: platform === 'google-play' ? 500000 : null,
        releasedAt: new Date(base - 150 * 86400000).toISOString(),
        storeUpdatedAt: at,
        releaseNotes: `演示版本 2.${version}.${k}：优化申请进度展示，修复已知问题。`,
        genre: 'Finance',
        raw: { demo: true, source: 'synthetic', externalId, version: `2.${version}.${k}` },
      };
      store.saveObservation(app.id, data, at);
    }
    store.saveReviews(app.id, [
      {
        externalId: `demo-review-${n}-1`,
        userName: 'Demo User',
        title: '演示评价',
        text: '申请进度页面清楚，但希望还款提醒更及时。这是一条虚构演示评论。',
        score: 4,
        version: `2.2.${k}`,
        reviewedAt: new Date(base - 86400000).toISOString(),
        language: platform === 'app-store' ? 'und' : country.language,
        raw: { demo: true },
      },
      {
        externalId: `demo-review-${n}-2`,
        userName: 'Sample Reader',
        title: '演示反馈',
        text: '希望费用说明能更清晰。这是一条虚构演示评论。',
        score: 2,
        version: `2.1.${k}`,
        reviewedAt: new Date(base - 3 * 86400000).toISOString(),
        language: platform === 'app-store' ? 'und' : country.language,
        raw: { demo: true },
      },
    ]);
    store.enqueueJob({ type: 'refresh', country: country.code, store: platform, appId: app.id });
    const job = store.claimJob()!;
    store.completeJob(job.id, { demo: true, snapshots: 3 });
  }
  store.markDiscovered(country.code);
}
console.log(`已创建 ${n} 个虚构应用、${n * 3} 个快照和 ${n * 2} 条评论。隔离数据库：${path}`);
store.close();

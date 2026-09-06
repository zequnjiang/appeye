/** Manual UI QA only: synthetic in-memory data, no worker, no external requests. Run: npx tsx tests/v02-ui-preview.ts */
import 'dotenv/config';
import { createStore } from '../server/db.js';
import { createApp } from '../server/app.js';
import { normalizeApp } from '../server/normalization.js';
import { facilitatorFixture } from './loan-fixtures.js';
import { permissionsResult, applePrivacyResult } from './enrichment-fixtures.js';

if (!process.env.ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD for local QA preview');
const store = createStore();
const raw = {
  appId: 'fixture.v02.ui', title: 'QA Fixture Loan — 合成测试样本', description: facilitatorFixture.description + ' Loan provider: Fictional Lender Corporation. Developer legal entity: Fictional Technology Limited.',
  developer: 'Fixture Display Brand', developerId: 'fixture-developer', developerLegalName: 'Fixture Technology Limited', sellerName: 'Fixture Seller Company',
  developerEmail: 'fixture@example.invalid', developerUrl: 'javascript:alert("QA_BAD_URL")', url: 'javascript:alert("QA_BAD_URL")',
  descriptionHTML: '<img src=x onerror="alert(\'QA_HTML_EXECUTED\')"><script>alert("QA_SCRIPT")</script>',
  unknownFutureField: { unicode: ['ไทย', 'español'], meaningfulFalse: false, meaningfulZero: 0, fullText: 'Complete synthetic field remains inspectable.' },
  version: '1.0.0', score: 4.2, ratings: 30, installs: '1,000+', minInstalls: 1000,
};
const gp = store.createApp({ store: 'google-play', country: 'ph', externalId: raw.appId });
store.saveObservation(gp.id, normalizeApp(raw, 'google-play'));
store.updateClassification(gp.id, 'candidate');
store.saveEnrichment(gp.id, 'permissions', { ...permissionsResult, requestCountry: 'ph', requestLanguage: 'en' }, '2026-01-01T00:00:00.000Z');
store.failEnrichment(gp.id, 'permissions', 'QA simulated timeout — old successful permissions retained', { source: 'https://example.invalid/new-permissions', requestCountry: 'ph', requestLanguage: 'en' }, '2026-01-02T00:00:00.000Z');
store.saveEnrichment(gp.id, 'dataSafety', { status: 'empty', data: [], raw: [], source: 'https://example.invalid/data-safety', requestCountry: null, requestLanguage: 'en' });
for (let i = 0; i < 23; i++) store.recordDiscovery(gp.id, { keyword: `fixture-${i}`, requestCountry: 'ph', requestLanguage: 'en', source: 'https://example.invalid/search', data: normalizeApp(raw, 'google-play'), raw: { ...raw, searchIndex: i } });
const apple = store.createApp({ store: 'app-store', country: 'ph', externalId: '123456' });
store.saveObservation(apple.id, normalizeApp({ ...raw, id: 123456, title: 'QA Apple Fixture — 合成测试样本' }, 'app-store'));
store.saveEnrichment(apple.id, 'privacy', applePrivacyResult);
store.saveEnrichment(apple.id, 'permissions', { status: 'unsupported', data: null, raw: null, source: applePrivacyResult.source, requestCountry: 'ph', requestLanguage: null });
const app = createApp({ store, password: process.env.ADMIN_PASSWORD, demoMode: true });
const server = app.listen(3001, '127.0.0.1', () => console.log('Synthetic V0.2 UI QA preview: http://127.0.0.1:3001'));
const close = () => server.close(() => { store.close(); process.exit(0); });
process.once('SIGINT', close); process.once('SIGTERM', close);

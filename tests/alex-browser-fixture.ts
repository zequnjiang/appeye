import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

export function alexApp(id: number) {
  return {
    id, country: id > 90 ? 'mx' : 'ar', store: 'google-play', externalId: `alex.fixture.${id}`,
    title: `Loan Marker ${id}`, developer: 'Synthetic QA Publisher', classification: 'confirmed',
    effectiveClassification: 'confirmed', classificationSource: 'auto', manualOverride: false,
    firstSeenAt: '2026-01-01T00:00:00.000Z', lastFetchedAt: '2026-01-02T00:00:00.000Z',
    score: 4, ratings: 100, installs: '10,000+', version: '1.0', updateCount: 0,
    description: 'Synthetic personal loan description.', summary: 'Synthetic fixture',
    icon: null, url: null, storeUpdatedAt: null, releasedAt: null,
    loanAnalysis: null,
  };
}

export async function alexBrowserHarness() {
  let server: ViteDevServer | undefined, browser: Browser | undefined;
  try {
    server = await createServer({ configFile: false, plugins: [react()], cacheDir: '.artifacts/alex-vite-cache', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
    await server.listen();
    const base = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
    return {
      async fixture(width = 1280, options: { height?: number; clock?: boolean } = {}) {
        const context: BrowserContext = await browser!.newContext({ viewport: { width, height: options.height ?? 900 } });
        const page = await context.newPage();
        if (options.clock) await page.clock.install();
        const state = {
          rows: Array.from({ length: 120 }, (_, i) => alexApp(i + 1)), calls: [] as string[],
          failed: false, gate: null as Promise<void> | null, pageErrors: [] as string[], documents: 0, completed: 0,
        };
        page.on('pageerror', error => state.pageErrors.push(error.message));
        page.on('request', request => { if (request.isNavigationRequest()) state.documents++; });
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
        await page.route('**/api/**', async route => {
          const url = new URL(route.request().url()); let body: unknown;
          if (url.pathname === '/api/auth/session') body = { authenticated: true, configured: true, dataset: 'demo', demoMode: true };
          else if (url.pathname === '/api/countries') body = { countries: ['ar', 'mx'].map(code => ({ code, name: code === 'ar' ? '阿根廷' : '墨西哥', language: 'es', keywords: ['loan'], enabled: true, intervalHours: 1 })) };
          else if (url.pathname === '/api/overview') body = { stats: { apps: 120, candidates: 0, confirmed: 120, reviews: 0, changes7d: 0, jobsFailed: 0, newApps7d: 0 }, countries: [], recentChanges: [], recentDiscoveries: [], recentJobs: [], limitations: [] };
          else if (url.pathname === '/api/apps') {
            state.calls.push(url.search);
            const rows = state.rows.filter(row => (!url.searchParams.get('country') || row.country === url.searchParams.get('country')) && (!url.searchParams.get('store') || row.store === url.searchParams.get('store')) && (!url.searchParams.get('classification') || row.classification === url.searchParams.get('classification')) && (!url.searchParams.get('q') || row.title.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase())));
            const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 20);
            body = JSON.parse(JSON.stringify({ apps: rows.slice(offset, offset + limit), total: rows.length }));
            const gate = state.gate; if (gate) await gate;
            if (state.failed) { await route.fulfill({ status: 503, json: { error: 'Alex synthetic refresh failure' } }).catch(() => {}); state.completed++; return; }
          } else if (/^\/api\/apps\/\d+$/.test(url.pathname)) body = { app: alexApp(Number(url.pathname.split('/').at(-1))), snapshots: [], changes: [], reviews: [], enrichments: [], rawDetail: { original: { preserved: true } } };
          else body = { changes: [], reviews: [], discoveries: [], history: [], total: 0 };
          await route.fulfill({ json: body }).catch(() => {});
          if (url.pathname === '/api/apps') state.completed++;
        });
        await page.goto(base);
        await page.getByRole('navigation').getByRole('button', { name: '应用库', exact: true }).click();
        await page.locator('[data-library-row]').first().waitFor();
        return { context, page, state };
      },
      async close() { await browser?.close(); await server?.close(); },
    };
  } catch (error) { await browser?.close(); await server?.close(); throw error; }
}

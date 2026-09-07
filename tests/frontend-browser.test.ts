import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
let server: ViteDevServer, browser: Browser, base: string;
before(async () => {
  await mkdir('.artifacts/frontend', { recursive: true });
  server = await createServer({
    configFile: false,
    plugins: [react()],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({
    channel: process.env.CI ? undefined : 'chrome',
    headless: true,
  });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
function app(id: number, country = 'ar') {
  return {
    id,
    country,
    store: 'google-play',
    externalId: `fixture.loan.${id}`,
    title: `Loan ${id}`,
    developer: 'Fixture Publisher',
    classification: 'confirmed',
    classificationSource: 'auto',
    manualOverride: false,
    firstSeenAt: '2026-01-01T00:00:00Z',
    lastFetchedAt: '2026-01-01T00:00:00Z',
    score: 4,
    ratings: 100,
    installs: '10,000+',
    version: '1.0',
    description: 'A fixture loan app',
    icon: null,
    url: null,
    storeUpdatedAt: null,
    updateCount: 0,
    releasedAt: null,
  };
}
async function fixture(mobile = false, clock = false) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  const state = {
    rows: Array.from({ length: 60 }, (_, i) => app(i + 1)),
    calls: [] as string[],
    failed: false,
    delay: null as Promise<void> | null,
  };
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    let body: any;
    if (u.pathname === '/api/auth/session')
      body = { authenticated: true, configured: true, dataset: 'demo' };
    else if (u.pathname === '/api/countries')
      body = {
        countries: ['ar', 'th'].map((code) => ({
          code,
          name: code === 'ar' ? '阿根廷' : '泰国',
          language: 'es',
          keywords: ['loan'],
          enabled: true,
          intervalHours: 1,
        })),
      };
    else if (u.pathname === '/api/overview')
      body = {
        stats: {
          apps: 60,
          candidates: 0,
          confirmed: 60,
          reviews: 0,
          changes7d: 0,
          jobsFailed: 0,
          newApps7d: 0,
        },
        countries: [],
        recentChanges: [],
        recentDiscoveries: [],
        recentJobs: [],
        limitations: [],
      };
    else if (u.pathname === '/api/apps') {
      state.calls.push(u.search);
      if (state.delay) await state.delay;
      if (state.failed) {
        await route
          .fulfill({ status: 503, json: { error: 'Fixture temporarily unavailable' } })
          .catch(() => {});
        return;
      }
      const rows = state.rows.filter(
        (r) =>
          (!u.searchParams.get('country') || r.country === u.searchParams.get('country')) &&
          (!u.searchParams.get('q') || r.title.includes(u.searchParams.get('q')!)),
      );
      const offset = Number(u.searchParams.get('offset') || 0),
        limit = Number(u.searchParams.get('limit') || 20);
      body = { apps: rows.slice(offset, offset + limit), total: rows.length };
    } else if (/^\/api\/apps\/\d+$/.test(u.pathname))
      body = {
        app: app(Number(u.pathname.split('/').at(-1))),
        snapshots: [],
        changes: [],
        reviews: [],
        rawDetail: { preserved: { nested: 'value' } },
        enrichments: [],
      };
    else if (u.pathname.endsWith('/reviews'))
      body = {
        reviews: [
          {
            id: 1,
            externalId: 'review-one',
            country: 'ar',
            language: 'es',
            title: 'Review',
            text: 'Review text',
            score: 5,
            raw: { a: 'text' },
          },
        ],
        total: 1,
      };
    else if (u.pathname.endsWith('/snapshots'))
      body = {
        snapshots: [
          {
            id: 99,
            observedAt: '2026-01-01T00:00:00Z',
            data: { version: '1.0' },
            raw: { nested: { untouched: 'fixture' } },
          },
        ],
        total: 1,
      };
    else body = { changes: [], discoveries: [], history: [], total: 0 };
    await route.fulfill({ json: body }).catch(() => {});
  });
  await page.goto(base);
  await page.getByRole('navigation').getByRole('button', { name: '应用库', exact: true }).click();
  await page.locator('[data-library-row]').first().waitFor();
  return { context, page, state };
}
async function queryKey(page: Page) {
  return page
    .locator('[data-library-row]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-library-row')));
}

test('frontend: two real polls preserve the table DOM and apply new content automatically; failure retains rows', async () => {
  const { context, page, state } = await fixture();
  try {
    await page.locator('[data-library-table]').evaluate((el) => ((el as any).proof = 'same-dom'));
    state.rows[0]!.title = 'Updated automatically';
    await page.getByText('Updated automatically', { exact: true }).waitFor({ timeout: 18000 });
    const first = state.calls.length;
    await page.waitForFunction(() => document.querySelector('[data-library-table]') !== null);
    await page.waitForTimeout(15500);
    assert.ok(state.calls.length > first);
    assert.equal(
      await page.locator('[data-library-table]').evaluate((el) => (el as any).proof),
      'same-dom',
    );
    state.failed = true;
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((button) => button.click());
    await page.getByRole('alert').filter({ hasText: 'Fixture temporarily unavailable' }).waitFor();
    assert.equal(await page.locator('[data-library-row]').count(), 20);
    assert.equal(
      await page.locator('[data-library-table]').evaluate((el) => (el as any).proof),
      'same-dom',
    );
  } finally {
    await context.close();
  }
});

test('frontend: detail return preserves filters, non-first page, cached rows, reading anchor and focus on desktop and mobile', async () => {
  for (const mobile of [false, true]) {
    const { context, page, state } = await fixture(mobile);
    try {
      await page.getByLabel('筛选国家', { exact: true }).selectOption('ar');
      await page.getByLabel('搜索应用', { exact: true }).fill('Loan');
      await page.waitForTimeout(350);
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await page.locator('[data-library-row="21"]').waitFor();
      await page.locator('[data-library-row="27"]').scrollIntoViewIfNeeded();
      const target = page.locator('[data-library-row="27"] .app-cell');
      await target.focus();
      const before = await page.locator('[data-library-row="27"]').boundingBox();
      await target.click();
      await page.getByRole('button', { name: '返回应用库' }).waitFor();
      let release!: () => void;
      state.delay = new Promise((resolve) => {
        release = resolve;
      });
      await page.getByRole('button', { name: '返回应用库' }).click();
      await page.locator('[data-library-row="27"]').waitFor();
      assert.equal(await page.getByLabel('筛选国家', { exact: true }).inputValue(), 'ar');
      assert.equal(await page.getByLabel('搜索应用', { exact: true }).inputValue(), 'Loan');
      assert.equal((await queryKey(page))[0], '21');
      const after = await page.locator('[data-library-row="27"]').boundingBox();
      assert.ok(
        Math.abs(before!.y - after!.y) < 3,
        `${mobile}: before=${before!.y}, after=${after!.y}`,
      );
      assert.equal(
        await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.focusKey),
        'app-27',
      );
      release();
      state.delay = null;
    } finally {
      await context.close();
    }
  }
});

test('frontend: inserted/removed rows preserve a surviving reading anchor; filters do not issue new-country old-offset', async () => {
  const { context, page, state } = await fixture();
  try {
    await page.locator('[data-library-row="8"]').scrollIntoViewIfNeeded();
    const before = await page.locator('[data-library-row="8"]').boundingBox();
    state.rows.unshift(app(1000));
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((button) => button.click());
    await page.locator('[data-library-row="1000"]').waitFor();
    const after = await page.locator('[data-library-row="8"]').boundingBox();
    assert.ok(Math.abs(before!.y - after!.y) < 3, `${before!.y} vs ${after!.y}`);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('[data-library-row="20"]').waitFor();
    state.rows.push(...Array.from({ length: 5 }, (_, i) => app(2000 + i, 'th')));
    const index = state.calls.length;
    await page.getByLabel('筛选国家', { exact: true }).selectOption('th');
    await page.locator('[data-library-row="2000"]').waitFor();
    assert.ok(
      state.calls
        .slice(index)
        .filter((q) => q.includes('country=th'))
        .every((q) => new URLSearchParams(q).get('offset') === '0'),
    );
    assert.equal(await page.locator('[data-library-row]').count(), 5);
  } finally {
    await context.close();
  }
});

test('frontend: removal uses a surviving neighbor and a reduced last page returns to a valid page', async () => {
  const { context, page, state } = await fixture();
  try {
    await page.locator('[data-library-row="8"]').scrollIntoViewIfNeeded();
    const visible = await page.locator('[data-library-row]').evaluateAll((rows) =>
      rows
        .filter((r) => r.getBoundingClientRect().bottom > 0)
        .slice(0, 2)
        .map((r) => ({
          id: Number(r.getAttribute('data-library-row')),
          y: r.getBoundingClientRect().top,
        })),
    );
    state.rows = state.rows.filter((r) => r.id !== visible[0]!.id);
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((b) => b.click());
    await page.locator(`[data-library-row="${visible[0]!.id}"]`).waitFor({ state: 'detached' });
    const survivor = await page.locator(`[data-library-row="${visible[1]!.id}"]`).boundingBox();
    assert.ok(
      Math.abs(survivor!.y - visible[1]!.y) < 3,
      `${visible[1]!.id}: ${survivor!.y} vs ${visible[1]!.y}`,
    );
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('[data-library-row="22"]').waitFor();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('[data-library-row="42"]').waitFor();
    state.rows = state.rows.slice(0, 5);
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((b) => b.click());
    await page.locator('[data-library-row]').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-library-row]').length === 5);
    assert.equal(new URLSearchParams(state.calls.at(-1)).get('offset'), '0');
    state.rows = [];
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((b) => b.click());
    await page.locator('[data-library-row]').first().waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-library-row]').count(), 0);
  } finally {
    await context.close();
  }
});

test('frontend: a slow flight survives timer ticks, hidden pages pause and visibility resumes one flight without stealing focus', async () => {
  const { context, page, state } = await fixture(false, true);
  try {
    let release!: () => void;
    state.delay = new Promise((resolve) => {
      release = resolve;
    });
    const baseline = state.calls.length;
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((b) => b.click());
    await page.waitForTimeout(50);
    assert.equal(state.calls.length, baseline + 1);
    await page.clock.fastForward(45000);
    await page.waitForTimeout(50);
    assert.equal(state.calls.length, baseline + 1, 'ticks must not abort/restart the slow flight');
    await page.getByLabel('搜索应用', { exact: true }).focus();
    release();
    state.delay = null;
    await page.waitForTimeout(50);
    assert.equal(
      await page.evaluate(() => (document.activeElement as HTMLElement).dataset.focusKey),
      'library-search',
    );
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const count = state.calls.length;
    await page.clock.fastForward(60000);
    await page.waitForTimeout(50);
    assert.equal(state.calls.length, count);
    state.delay = new Promise((resolve) => {
      release = resolve;
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(50);
    assert.equal(state.calls.length, count + 1);
    release();
    state.delay = null;
  } finally {
    await context.close();
  }
});

test('frontend: snapshot and review evidence remain expanded across resource refreshes', async () => {
  const { context, page } = await fixture();
  try {
    await page.locator('[data-library-row="1"] .app-cell').click();
    await page.getByRole('tab', { name: '用户评价', exact: true }).click();
    const review = page.locator('.review .field-tree').first();
    await review.locator(':scope > summary').click();
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((b) => b.click());
    await page.waitForTimeout(100);
    assert.equal(await review.evaluate((el) => (el as HTMLDetailsElement).open), true);
    await page.getByRole('tab', { name: '采集快照', exact: true }).click();
    const history = page.locator('.observation-history').filter({ hasText: '全部详情快照' });
    const row = history.locator('.field-tree').first();
    await row.locator(':scope > summary').click();
    await row.evaluate((el) => {
      (el as any).proof = 'kept';
    });
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((b) => b.click());
    await page.waitForTimeout(100);
    assert.equal(await row.evaluate((el) => (el as HTMLDetailsElement).open), true);
    assert.equal(await row.evaluate((el) => (el as any).proof), 'kept');
  } finally {
    await context.close();
  }
});

test('frontend: discovery diagnostics submit reads only, show mixed source evidence and add a known identity explicitly', async () => {
  for (const mobile of [false, true]) {
    const { context, page } = await fixture(mobile);
    let reads = 0,
      posts = 0;
    const apiCalls: string[] = [];
    try {
      await page.route('**/api/discovery/**', async (route) => {
        const u = new URL(route.request().url());
        apiCalls.push(u.pathname + u.search);
        if (u.pathname.includes('/tasks/'))
          await route.fulfill({
            json: {
              task: { id: 3, stop_reason: 'local-result-limit' },
              responses: [{ id: 1, data: { raw: 'saved-sdk-record' } }],
              http: [
                {
                  id: Number(u.searchParams.get('offset')) + 1,
                  body: Number(u.searchParams.get('offset'))
                    ? 'second-saved-http-page'
                    : 'first-saved-http-page',
                },
              ],
              httpTotal: 21,
              responsesTotal: 1,
            },
          });
        else if (u.pathname.endsWith('/status'))
          await route.fulfill({
            json: {
              intervalHours: 6,
              nextDueAt: null,
              heartbeatAt: '2026-01-01T00:00:00Z',
              activeCycle: null,
              lastCycle: {
                id: 'cycle-1',
                dueAt: '2026-01-01T00:00:00Z',
                startedAt: null,
                finishedAt: null,
                status: 'limited',
                counts: { deferred: 3 },
                markets: [
                  { country: 'ar', store: 'google-play', sourceRequests: 60, detailRequests: 20 },
                ],
              },
              totals: { pending: 2, staged: 1, failed: 1, admitted: 0 },
              limits: {
                sourceRequests: 60,
                detailRequests: 60,
                timeoutMs: 20000,
                searchResults: 1000,
              },
              coverageNote: 'Actual window fixture: 30 returned, no public resume cursor.',
            },
          });
        else if (u.pathname.endsWith('/candidates'))
          await route.fulfill({
            json: {
              candidates: [
                {
                  id: 1,
                  country: 'ar',
                  store: 'google-play',
                  externalId: 'candidate.one',
                  title: 'Candidate one',
                  appId: null,
                  status: 'staged',
                  firstObservedAt: '2025-01-01T00:00:00Z',
                  lastObservedAt: '2026-01-01T00:00:00Z',
                  error: null,
                  verdict: 'insufficient',
                  sourceCount: 1,
                },
              ],
              total: 1,
            },
          });
        else {
          reads++;
          const externalId = u.searchParams.get('externalId');
          await route.fulfill({
            json: {
              country: 'ar',
              store: 'google-play',
              externalId,
              status: externalId === 'candidate.one' ? 'staged' : 'not-discovered',
              appId: null,
              classification: null,
              lastFetchedAt: null,
              error: null,
              sources:
                externalId === 'candidate.one'
                  ? [
                      {
                        id: 'extended:1',
                        kind: 'catalog',
                        source: 'javascript:alert(1)',
                        observedAt: '2025-01-01T00:00:00Z',
                        processedAt: '2026-01-01T00:00:00Z',
                        keyword: null,
                        parentAppId: 12,
                        enrichmentHistoryId: 99,
                        data: { observed: 30 },
                        raw: { preserved: '<script>window.fixtureUnsafe=true</script>' },
                      },
                    ]
                  : [],
              sourceTotal: externalId === 'candidate.one' ? 1 : 0,
              tasks: [
                {
                  id: 3,
                  channel: 'extended',
                  kind: 'search',
                  status: 'deferred',
                  stopReason: 'local-result-limit',
                  error: null,
                },
              ],
              analysis: { verdict: 'insufficient' },
            },
          });
        }
      });
      await page.route('**/api/apps', async (route) => {
        if (route.request().method() === 'POST') {
          posts++;
          await route.fulfill({ json: { app: { id: 77 } } });
        } else await route.fallback();
      });
      await page
        .getByRole('navigation')
        .getByRole('button', { name: '发现诊断', exact: true })
        .click();
      await page.getByText('Candidate one', { exact: true }).waitFor();
      await page.getByLabel('诊断应用ID', { exact: true }).fill('missing.loan');
      assert.equal(reads, 0, 'typing must not trigger identity requests');
      await page.getByRole('button', { name: '查询已保存来源' }).click();
      await page
        .getByText(
          '系统尚未发现这个市场身份，不代表商店中不存在。可明确加入跟踪并采集详情；排队不等于采集成功。',
        )
        .waitFor();
      assert.equal(posts, 0);
      await page.getByText('Candidate one', { exact: true }).click();
      await page.locator('.diagnostic-source > summary').click();
      const raw = page
        .locator('.diagnostic-source .field-tree')
        .filter({ hasText: '完整原始返回' })
        .first();
      await page.getByText('<script>window.fixtureUnsafe=true</script>', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => (window as any).fixtureUnsafe), undefined);
      assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
      await page.getByText('最近任务与停止原因（1）').click();
      await page.getByText('local-result-limit', { exact: true }).waitFor();
      assert.match(
        (await page
          .getByRole('link', { name: '完整采集记录（原始 JSON）' })
          .getAttribute('href')) || '',
        /^\/api\/discovery\/tasks\/3\?/,
      );
      await page.getByRole('button', { name: '页内查看完整记录' }).click();
      const evidence = page.getByLabel('完整采集记录', { exact: true });
      await evidence.getByRole('button', { name: '诊断下一页' }).click();
      await page.waitForTimeout(100);
      assert.ok(apiCalls.some((u) => u.includes('/tasks/3?') && u.includes('offset=20')));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `.artifacts/frontend/discovery-${mobile ? 'mobile' : 'desktop'}.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: '加入跟踪并采集详情' }).click();
      await page.getByRole('heading', { name: 'Loan 77', exact: true }).waitFor();
      assert.equal(posts, 1);
    } finally {
      await context.close();
    }
  }
});

test('frontend: detail can return while its uncached request is pending or failed', async () => {
  const { context, page } = await fixture();
  try {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/apps/1', async (route) => {
      await waiting;
      await route.fulfill({ status: 503, json: { error: 'Detail unavailable' } }).catch(() => {});
    });
    await page.locator('[data-library-row="1"] .app-cell').click();
    await page.getByRole('button', { name: '返回应用库' }).click();
    await page.locator('[data-library-row="1"]').waitFor();
    release();
    await page.locator('[data-library-row="1"] .app-cell').click();
    await page.getByRole('alert').filter({ hasText: 'Detail unavailable' }).waitFor();
    await page.getByRole('button', { name: '返回应用库' }).click();
    await page.locator('[data-library-row="1"]').waitFor();
  } finally {
    await context.close();
  }
});

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
async function fixture(mobile = false, clock = false, timezoneId?: string) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    timezoneId,
  });
  const page = await context.newPage();
  if (clock) await page.clock.install();
  const state = {
    rows: Array.from({ length: 60 }, (_, i) => app(i + 1)),
    calls: [] as string[],
    failed: false,
    delay: null as Promise<void> | null,
  };
  const snapshots = new Map<string, ReturnType<typeof app>[]>();
  let sequence = 0;
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    let body: any;
    if (u.pathname === '/api/auth/session')
      body = {
        authenticated: true,
        configured: true,
        dataset: 'demo',
        user: { id: 0, name: 'Platform QA', email: null, role: 'platform', workspaceId: null },
        workspaces: [],
        authorizationVersion: 'v1',
      };
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
    else if (u.pathname === '/api/market/activity')
      body = {
        date: '2026-09-09',
        counts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        eventCounts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        countries: [],
        featuredEvents: [],
        events: [],
        total: 0,
        uniqueApps: 0,
      };
    else if (u.pathname === '/api/market/apps') {
      state.calls.push(u.search);
      if (state.delay) await state.delay;
      if (state.failed) {
        await route
          .fulfill({ status: 503, json: { error: 'Fixture temporarily unavailable' } })
          .catch(() => {});
        return;
      }
      const live = state.rows.filter(
        (r) =>
          (!u.searchParams.get('country') || r.country === u.searchParams.get('country')) &&
          (!u.searchParams.get('q') || r.title.includes(u.searchParams.get('q')!)),
      );
      let snapshot = u.searchParams.get('snapshot') || '';
      if (u.searchParams.get('probe'))
        body = {
          changed: JSON.stringify(live) !== JSON.stringify(snapshots.get(snapshot)),
          revision: String(sequence),
        };
      else {
        if (!snapshot) {
          snapshot = `query-${++sequence}`;
          snapshots.set(snapshot, structuredClone(live));
        }
        const rows = snapshots.get(snapshot)!;
        const limit = Number(u.searchParams.get('limit') || 20);
        const offset = Math.min(
          Number(u.searchParams.get('offset') || 0),
          Math.max(0, Math.floor((rows.length - 1) / limit) * limit),
        );
        body = {
          apps: rows.slice(offset, offset + limit),
          total: rows.length,
          offset,
          limit,
          snapshot,
          revision: String(sequence),
          createdAt: '2026-09-09T00:00:00Z',
          expiresAt: '2026-09-09T12:00:00Z',
        };
      }
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
  if (mobile) await page.getByRole('button', { name: '切换导航', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '应用库', exact: true }).click();
  await page.locator('[data-library-row]').first().waitFor();
  return { context, page, state };
}
async function queryKey(page: Page) {
  return page
    .locator('[data-library-row]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-library-row')));
}

test('frontend #25: two real polls preserve the displayed list until the latest pending result is explicitly applied; failure retains rows', async () => {
  const { context, page, state } = await fixture();
  try {
    await page.locator('[data-library-table]').evaluate((el) => ((el as any).proof = 'same-dom'));
    state.rows[0]!.title = 'First pending title';
    await page
      .getByText('有新数据，当前清单保持不变。', { exact: true })
      .waitFor({ timeout: 18000 });
    assert.equal(await page.getByText('Loan 1', { exact: true }).count(), 1);
    state.rows[0]!.title = 'Latest pending title';
    const first = state.calls.length;
    await page.waitForFunction(() => document.querySelector('[data-library-table]') !== null);
    await page.waitForTimeout(15500);
    assert.ok(state.calls.length > first);
    assert.equal(await page.getByText('Loan 1', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '更新清单', exact: true }).evaluate((b) => b.click());
    await page.getByText('Latest pending title', { exact: true }).waitFor();
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
      await page.getByRole('button', { name: '搜索', exact: true }).click();
      await page.waitForTimeout(100);
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
    assert.match(await page.locator('.research-pagination').innerText(), /1–5/);
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
      if (mobile) await page.getByRole('button', { name: '切换导航', exact: true }).click();
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

test('frontend refresh regression: a new first row must not scroll a user away from top controls at 817x863', async () => {
  const { context, page, state } = await fixture();
  try {
    await page.setViewportSize({ width: 817, height: 863 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => ({
      y: scrollY,
      heading: document.querySelector('h1')!.getBoundingClientRect().top,
    }));
    state.rows.unshift(app(8000));
    await page.getByRole('button', { name: '刷新当前数据' }).evaluate((b) => b.click());
    await page.locator('[data-library-row="8000"]').waitFor();
    const after = await page.evaluate(() => ({
      y: scrollY,
      heading: document.querySelector('h1')!.getBoundingClientRect().top,
    }));
    assert.deepEqual(after, before, `top controls moved: ${JSON.stringify({ before, after })}`);
  } finally {
    await context.close();
  }
});

test('frontend #25: detection, pending notices and failures never move the 817px viewport or change displayed rows', async () => {
  const { context, page, state } = await fixture(false, true);
  try {
    await page.setViewportSize({ width: 817, height: 863 });
    await page
      .getByRole('navigation')
      .getByRole('button', { name: '应用库', exact: true })
      .waitFor();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(80);
    const initial = await page.evaluate(() => ({
      y: scrollY,
      table: document.querySelector('[data-library-table]')!.getBoundingClientRect().top,
    }));
    await page.evaluate(() => {
      const win = window as any;
      win.scrollCalls = 0;
      const by = window.scrollBy.bind(window),
        to = window.scrollTo.bind(window);
      window.scrollBy = ((...args: any[]) => {
        win.scrollCalls++;
        return (by as any)(...args);
      }) as typeof window.scrollBy;
      window.scrollTo = ((...args: any[]) => {
        win.scrollCalls++;
        return (to as any)(...args);
      }) as typeof window.scrollTo;
    });
    await page.clock.fastForward(15001);
    await page.waitForTimeout(80);
    assert.equal(await page.getByText('有新数据，当前清单保持不变。', { exact: true }).count(), 0);
    state.rows.unshift(app(9000));
    await page.clock.fastForward(15001);
    await page.getByText('有新数据，当前清单保持不变。', { exact: true }).waitFor();
    assert.equal((await queryKey(page))[0], '1');
    assert.equal(await page.evaluate(() => (window as any).scrollCalls), 0);
    state.failed = true;
    await page.clock.fastForward(15001);
    await page.getByRole('alert').filter({ hasText: 'Fixture temporarily unavailable' }).waitFor();
    assert.deepEqual(
      await page.evaluate(() => ({
        y: scrollY,
        table: document.querySelector('[data-library-table]')!.getBoundingClientRect().top,
      })),
      initial,
    );
    assert.equal(await page.evaluate(() => (window as any).scrollCalls), 0);
    state.failed = false;
    await page.getByRole('button', { name: '更新清单', exact: true }).evaluate((b) => b.click());
    await page.locator('[data-library-row="9000"]').waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0);
  } finally {
    await context.close();
  }
});

test('formal market: pages keep the original server snapshot despite inserted rows until an explicit replacement', async () => {
  const { context, page, state } = await fixture(false, true);
  try {
    const initial = new URLSearchParams(state.calls[0]);
    assert.equal(initial.get('sort'), 'minInstalls');
    assert.equal(initial.get('direction'), 'desc');
    assert.equal(initial.get('loanScope'), 'cash-priority');
    state.rows.unshift(app(7000));
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('[data-library-row="21"]').waitFor();
    assert.equal(new URLSearchParams(state.calls.at(-1)).get('snapshot'), 'query-1');
    await page.clock.fastForward(15000);
    await page.getByText('有新数据，当前清单保持不变。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('[data-library-row="41"]').waitFor();
    assert.equal(new URLSearchParams(state.calls.at(-1)).get('snapshot'), 'query-1');
    await page.getByRole('button', { name: '更新清单', exact: true }).click();
    await page.locator('[data-library-row="40"]').waitFor();
    assert.equal(new URLSearchParams(state.calls.at(-1)).has('snapshot'), false);
  } finally {
    await context.close();
  }
});

test('formal detail: real screenshot keyboard loop restores trigger focus; permission summaries stay compact and unsafe links are not actionable', async () => {
  const { context, page } = await fixture();
  try {
    await page.route('**/fixture-shot.svg', (r) =>
      r.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="140"><rect width="80" height="140" fill="#089d94"/></svg>',
      }),
    );
    await page.route('**/api/apps/1', (r) =>
      r.fulfill({
        json: {
          app: {
            ...app(1),
            developerWebsite: 'javascript:alert(1)',
            privacyPolicy: 'https://example.test/privacy',
            screenshots: [`${base}fixture-shot.svg`, `${base}fixture-shot.svg?second=1`],
          },
          snapshots: [],
          changes: [],
          reviews: [],
          rawDetail: {},
          enrichments: [
            {
              kind: 'permissions',
              status: 'available',
              lastSuccessAt: '2026-01-01T00:00:00Z',
              data: Array.from({ length: 9 }, (_, i) => ({ permission: `Permission ${i + 1}` })),
            },
          ],
        },
      }),
    );
    await page.locator('[data-library-row="1"] .app-cell').click();
    const trigger = page.getByRole('button', { name: 'Loan 1 商店截图 1', exact: true });
    await trigger.focus();
    await trigger.press('Enter');
    await page.getByRole('dialog', { name: '商店截图 1 / 2' }).waitFor();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('dialog', { name: '商店截图 2 / 2' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForTimeout(50);
    assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
    assert.match(
      (await page
        .getByRole('link', { name: 'fixture.loan.1 · Google Play', exact: true })
        .getAttribute('href'))!,
      /gl=ar/,
    );
    await page.getByRole('tab', { name: '权限与隐私', exact: true }).click();
    assert.equal(await page.locator('.permission-list li').count(), 6);
    await page.getByRole('button', { name: '展开全部 9 项权限', exact: true }).click();
    assert.equal(await page.locator('.permission-list li').count(), 9);
    await page.getByRole('button', { name: '收起权限', exact: true }).click();
    assert.equal(await page.locator('.permission-list li').count(), 6);
  } finally {
    await context.close();
  }
});

test('formal CSV: export uses the displayed snapshot and full query, downloads full results without replacing the list', async () => {
  const { context, page, state } = await fixture();
  try {
    const captured: string[] = [];
    let expired = false;
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.route('**/api/market/apps.csv?*', (r) => {
      captured.push(r.request().url());
      if (expired) return r.fulfill({ status: 410, json: { error: 'Frozen export expired' } });
      return r.fulfill({
        contentType: 'text/csv;charset=utf-8',
        body: 'id,title\r\n1,First frozen row\r\n60,Last frozen row\r\n',
      });
    });
    const before = state.calls.length,
      rows = await queryKey(page);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出当前清单 CSV', exact: true }).click();
    const file = await downloaded;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    assert.match(Buffer.concat(chunks).toString(), /60,Last frozen row/);
    assert.equal(file.suggestedFilename(), 'appeye-market-snapshot.csv');
    const params = new URL(captured[0]!).searchParams;
    assert.equal(params.get('snapshot'), 'query-1');
    assert.equal(params.get('sort'), 'minInstalls');
    assert.equal(params.get('direction'), 'desc');
    assert.equal(params.get('loanScope'), 'cash-priority');
    assert.equal(state.calls.length, before);
    assert.deepEqual(await queryKey(page), rows);
    expired = true;
    await page.getByRole('button', { name: '导出当前清单 CSV', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Frozen export expired' }).waitFor();
    assert.equal(downloads, 1, '410 response must not be saved as CSV');
    assert.deepEqual(await queryKey(page), rows);
    assert.equal(
      await page.getByRole('button', { name: '导出当前清单 CSV', exact: true }).isDisabled(),
      true,
    );
  } finally {
    await context.close();
  }
});

test('formal access: natural expiry retains a displayed page, but scope revocation clears all cached queries and compare selections until explicit reload', async () => {
  const { context, page, state } = await fixture(false, true);
  try {
    let mode: 'normal' | 'expired' | 'revoked' = 'normal';
    await page.route('**/api/market/apps?*', async (r) => {
      const u = new URL(r.request().url());
      if (u.searchParams.has('probe') && mode !== 'normal')
        return r.fulfill({
          status: 410,
          json: {
            error: mode === 'expired' ? 'Natural snapshot expiry' : 'Public scope revoked',
            ...(mode === 'revoked' ? { code: 'SNAPSHOT_SCOPE_REVOKED' } : {}),
          },
        });
      return r.fallback();
    });
    await page.getByLabel('筛选国家', { exact: true }).selectOption('ar');
    await page.locator('[data-library-row="1"]').waitFor();
    mode = 'expired';
    await page.clock.fastForward(15000);
    await page.getByRole('alert').filter({ hasText: 'Natural snapshot expiry' }).waitFor();
    assert.equal(await page.locator('[data-library-row]').count(), 20);
    assert.equal(
      await page.getByRole('button', { name: '导出当前清单 CSV', exact: true }).isDisabled(),
      true,
    );
    mode = 'normal';
    await page.getByRole('button', { name: '更新清单', exact: true }).click();
    await page.waitForFunction(
      () => !document.body.textContent?.includes('Natural snapshot expiry'),
    );
    await page.getByRole('checkbox', { name: '对比 Loan 1', exact: true }).check();
    mode = 'revoked';
    await page.clock.fastForward(15000);
    await page.locator('[data-library-row]').first().waitFor({ state: 'detached' });
    assert.equal(await page.locator('.research-compare-tray').count(), 0);
    const before = state.calls.length;
    await page.clock.fastForward(45000);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-library-row]').count(), 0);
    assert.equal(
      state.calls.length,
      before,
      'revoke must not silently acquire a replacement query',
    );
    await page.getByLabel('筛选国家', { exact: true }).selectOption('');
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator('[data-library-row]').count(),
      0,
      'second old query must not replay revoked rows',
    );
    assert.equal(state.calls.length, before);
    mode = 'normal';
    state.rows = state.rows.filter((r) => r.id !== 1);
    await page.getByRole('button', { name: '更新清单', exact: true }).click();
    await page.locator('[data-library-row="2"]').waitFor();
    assert.equal(await page.locator('[data-library-row="1"]').count(), 0);
  } finally {
    await context.close();
  }
});

test('formal detail: Mexico browser preserves a date-only release and renders complete timestamps in Beijing time', async () => {
  const { context, page } = await fixture(false, false, 'America/Mexico_City');
  try {
    await page.route('**/api/apps/1', (r) =>
      r.fulfill({
        json: {
          app: { ...app(1), releasedAt: '2026-09-07', storeUpdatedAt: '2026-09-07T01:30:00Z' },
          snapshots: [],
          changes: [],
          reviews: [],
          enrichments: [],
          rawDetail: {},
        },
      }),
    );
    await page.locator('[data-library-row="1"] .app-cell').click();
    const facts = page.locator('dl.facts');
    assert.equal(
      await facts
        .locator('div')
        .filter({ has: page.getByText('商店发布日期', { exact: true }) })
        .locator('dd')
        .innerText(),
      '2026-09-07',
    );
    assert.equal(
      await facts
        .locator('div')
        .filter({ has: page.getByText('商店更新时间', { exact: true }) })
        .locator('dd')
        .innerText(),
      '2026/09/07 09:30',
    );
  } finally {
    await context.close();
  }
});

async function customerFixture(page: Page, research: Record<string, unknown>) {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        authenticated: true,
        configured: true,
        dataset: 'demo',
        user: {
          id: 9,
          name: 'Research QA',
          email: 'qa@example.test',
          role: 'researcher',
          workspaceId: 1,
        },
        workspaces: [{ id: 1, name: 'QA space', role: 'researcher' }],
        authorizationVersion: 'v1',
      },
    }),
  );
  await page.route('**/api/research/state', (r) =>
    r.fulfill({
      json: {
        workspace: { id: 1, name: 'QA space' },
        groups: [],
        favorites: [],
        collections: [],
        entries: [],
        apps: [],
        readStates: [],
        requests: [],
        ...research,
      },
    }),
  );
}

test('formal detail: transient failure retains the selected event, but 404 removes its original text and active research dialog', async () => {
  const { context, page } = await fixture(false, true);
  try {
    await customerFixture(page, {});
    let mode: 'ok' | 'transient' | 'revoked' = 'ok';
    const event = {
      id: 'change-77',
      type: 'observedUpdate',
      appId: 1,
      externalId: 'fixture.loan.1',
      title: 'Loan 1',
      country: 'ar',
      store: 'google-play',
      classification: 'confirmed',
      eventAt: '2026-09-07T01:30:00Z',
      observedAt: '2026-09-07T01:30:00Z',
      releasedAt: null,
      releasedAtPrecision: 'unknown',
      snapshotId: 99,
      sourceUrl: 'https://example.test/event',
      versionChanged: false,
      releaseNotes: 'Selected event source text',
      changes: [
        {
          id: 77,
          field: 'description',
          oldValue: 'Original event before text',
          newValue: 'Original event after text',
        },
      ],
    };
    await page.route('**/api/market/activity?*', (r) =>
      r.fulfill({
        json: {
          date: '2026-09-09',
          counts: { firstSeen: 0, storeRelease: 0, observedUpdate: 1 },
          eventCounts: { firstSeen: 0, storeRelease: 0, observedUpdate: 1 },
          countries: [],
          featuredEvents: [event],
          events: [event],
          total: 1,
          uniqueApps: 1,
        },
      }),
    );
    await page.route('**/api/apps/1', (r) =>
      mode === 'ok'
        ? r.fallback()
        : r.fulfill({
            status: mode === 'transient' ? 503 : 404,
            json: { error: mode === 'transient' ? 'Transient detail failure' : 'No longer public' },
          }),
    );
    await page.reload();
    await page.getByRole('button', { name: '查看 Loan 1 观测更新', exact: true }).click();
    await page.getByText('Original event before text', { exact: true }).waitFor();
    await page.getByRole('button', { name: '写备注', exact: true }).waitFor();
    mode = 'transient';
    await page.clock.fastForward(15000);
    await page.getByRole('alert').filter({ hasText: 'Transient detail failure' }).waitFor();
    assert.equal(await page.getByText('Original event before text', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '写备注', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    mode = 'revoked';
    await page.clock.fastForward(15000);
    await page.getByRole('alert').filter({ hasText: 'No longer public' }).waitFor();
    assert.equal(await page.locator('.selected-event').count(), 0);
    assert.equal(await page.locator('.research-detail-actions').count(), 0);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.getByText('Original event before text', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '返回今日市场', exact: true }).count(), 1);
  } finally {
    await context.close();
  }
});

test('formal research: delete sends the displayed entry revision and preserves the newer entry on conflict', async () => {
  const { context, page } = await fixture();
  try {
    const entry = {
      id: 4,
      appId: 1,
      kind: 'note',
      text: 'Original private note',
      revision: 2,
      updatedAt: '2026-09-07T01:00:00Z',
      appIdentity: { id: 1, title: 'Loan 1' },
      appVisible: true,
    };
    await customerFixture(page, { entries: [entry], apps: [app(1)] });
    const bodies: unknown[] = [];
    await page.route('**/api/research/entries/4', (r) => {
      assert.equal(r.request().method(), 'DELETE');
      bodies.push(r.request().postDataJSON());
      entry.revision = 3;
      entry.text = 'Newer concurrent private note';
      return r.fulfill({
        status: 409,
        json: { error: 'Entry changed; reload the current revision' },
      });
    });
    await page.reload();
    await page
      .getByRole('navigation')
      .getByRole('button', { name: '研究空间', exact: true })
      .click();
    await page.getByText('Original private note', { exact: true }).waitFor();
    await page.locator('.research-note').getByRole('button', { name: '删除', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Entry changed; reload the current revision' })
      .waitFor();
    await page.getByText('Newer concurrent private note', { exact: true }).waitFor();
    assert.deepEqual(bodies, [{ revision: 2 }]);
    assert.equal(await page.locator('.research-note').count(), 1);
  } finally {
    await context.close();
  }
});

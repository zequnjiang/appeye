import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';
import { alexApp, alexBrowserHarness } from './alex-browser-fixture.js';

let harness: Awaited<ReturnType<typeof alexBrowserHarness>>;
before(async () => {
  harness = await alexBrowserHarness();
});
after(async () => {
  await harness?.close();
});

test('Alex OI46: success-empty exposes the authoritative earlier privacy record, but null or foreign API evidence never falls back to stale current data', async () => {
  const { context, page, state } = await harness.fixture(390, { clock: true });
  try {
    const saved = {
      appId: 1,
      url: 'https://example.test/old-success',
      source: 'https://apps.apple.com/ar/app/id1',
      fetchedAt: '2025-02-03T01:02:03Z',
      requestCountry: 'AR',
      requestLanguage: 'en',
      historyId: 987,
    };
    let mode: 'empty' | 'null' | 'foreign' = 'empty';
    await page.route('**/api/apps/1', (r) =>
      r.fulfill({
        json: detail(
          { ...alexApp(1), privacyPolicy: null },
          {
            enrichments: [
              {
                appId: 1,
                kind: 'privacy',
                status: mode === 'empty' ? 'empty' : 'available',
                requestCountry: 'ar',
                lastSuccessAt: '2026-01-01T00:00:00Z',
                data:
                  mode === 'empty'
                    ? null
                    : { privacyPolicyUrl: 'https://example.test/stale-current' },
              },
            ],
            historicalPrivacy:
              mode === 'null' ? null : mode === 'foreign' ? { ...saved, appId: 2 } : saved,
          },
        ),
      }),
    );
    await page.locator('[data-library-row="1"] .app-cell').click();
    const link = page.getByRole('link', { name: '历史隐私协议', exact: true });
    await expect(link).toHaveAttribute('href', saved.url);
    await expect(page.locator('.historical-source-note')).toContainText('2025/02/03 09:02');
    await expect(page.locator('.historical-source-note')).toContainText('历史记录 #987');
    for (const next of ['null', 'foreign'] as const) {
      mode = next;
      const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/apps/1');
      await page.getByRole('button', { name: '刷新当前数据', exact: true }).click();
      await loaded;
      await expect(link).toHaveCount(0);
      assert.equal(await page.locator('a[href="https://example.test/stale-current"]').count(), 0);
    }
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});
async function nav(page: Page, name: string) {
  const target = page.getByRole('navigation').getByRole('button', { name, exact: true });
  if (!(await target.isVisible()))
    await page.getByRole('button', { name: '切换导航', exact: true }).click();
  await target.click();
}
const detail = (app: unknown, extra: object = {}) => ({
  app,
  snapshots: [],
  changes: [],
  reviews: [],
  enrichments: [],
  rawDetail: {},
  ...extra,
});

test('Alex OI33: text conversion does not swallow mathematical comparison text or activate encoded source markup', async () => {
  const { context, page, state } = await harness.fixture();
  try {
    const source =
      'Keep a<b and c>d; amount < 30.\n<p>Line &quot;two&quot;</p><br>泰文 &amp; 中文<script>window.alexSourceExecution=1</script>&lt;img src=x onerror=alert(1)&gt;';
    await page.route('**/api/apps/1', (r) =>
      r.fulfill({
        json: detail(
          { ...alexApp(1), releaseNotes: source },
          { rawDetail: { releaseNotes: source } },
        ),
      }),
    );
    await page.locator('[data-library-row="1"] .app-cell').click();
    const notes = page.getByRole('heading', { name: '本次更新说明', exact: true }).locator('+ p');
    await expect(notes).toContainText('a<b and c>d');
    await expect(notes).toContainText('Line "two"');
    await expect(notes).toContainText('泰文 & 中文');
    assert.equal(await notes.locator('img,script,a').count(), 0);
    assert.equal(await page.evaluate(() => (window as any).alexSourceExecution), undefined);
    await page.getByRole('tab', { name: '公司与商店信息', exact: true }).click();
    await expect(page.getByText(source, { exact: true })).toBeVisible();
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

test('Alex OI30/31/46: sorted actual times cross the year, zero is a point, missing values are not; current privacy wins over old evidence', async () => {
  const { context, page, state } = await harness.fixture(390, { clock: true });
  try {
    let snapshots = [
      { id: 3, observedAt: '2026-12-31T23:49:24.647Z', data: { score: 0, ratings: null } },
      { id: 1, observedAt: '2026-12-31T17:32:52.667Z', data: { score: 4, ratings: null } },
      { id: 2, observedAt: '2026-12-31T18:00:00.000Z', data: { score: null, ratings: 0 } },
    ];
    const app = {
      ...alexApp(1),
      releasedAt: '2021-08-10',
      releasedAtPrecision: 'date',
      releasedAtRaw: '10 ส.ค. 2564',
      privacyPolicy: 'https://example.test/current-policy',
    };
    await page.route('**/api/apps/1', (r) =>
      r.fulfill({
        json: detail(app, {
          snapshots,
          enrichments: [
            {
              appId: 1,
              kind: 'privacy',
              status: 'failed',
              requestCountry: 'ar',
              lastSuccessAt: '2020-01-01T00:00:00Z',
              data: { privacyPolicyUrl: 'https://example.test/old-policy' },
              source: 'https://example.test/old-source',
            },
          ],
        }),
      }),
    );
    await page.locator('[data-library-row="1"] .app-cell').click();
    await expect(page.locator('.trend')).toContainText('2027/01/01 01:32');
    await expect(page.locator('.trend')).toContainText('2027/01/01 07:49');
    await expect(page.locator('.trend')).toContainText('2 次有效观测');
    const points = (await page.locator('.trend polyline').getAttribute('points'))!.split(' ');
    assert.equal(points.length, 2);
    assert.ok(!points.join('').includes('NaN'));
    await expect(page.locator('dl.facts')).toContainText('2021-08-10');
    assert.equal(await page.getByText('已取得原文，日期待解析', { exact: true }).count(), 0);
    await expect(
      page.locator('dl.facts a[href="https://example.test/current-policy"]'),
    ).toBeVisible();
    assert.equal(await page.locator('.historical-source-note').count(), 0);
    await page.getByLabel('趋势指标').selectOption('ratings');
    await expect(
      page.getByText('需要至少两个有效观测点才能显示趋势', { exact: true }),
    ).toBeVisible();
    snapshots = [];
    await page.getByRole('button', { name: '刷新当前数据', exact: true }).click();
    await expect(
      page.getByText('需要至少两个有效观测点才能显示趋势', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: '.artifacts/alex-open-issues-detail-390.png', fullPage: true });
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

test('Alex OI27/28: nonfirst-page reading position and expanded identity survive return and a failed background read without creating a job', async () => {
  const { context, page, state } = await harness.fixture(817, { height: 863, clock: true });
  page.setDefaultTimeout(6000);
  try {
    let fail = false;
    const methods: string[] = [];
    await page.route('**/api/collection/status', (r) =>
      r.fulfill({
        json: {
          enabled: true,
          intervalMinutes: 60,
          activeCycle: null,
          lastCycle: null,
          collector: {},
          failures: [],
          countries: [],
          batch: null,
        },
      }),
    );
    await page.route('**/api/market-activity?*', (r) =>
      r.fulfill({
        json: { countries: [], events: [], counts: {}, eventCounts: {}, total: 0, uniqueApps: 0 },
      }),
    );
    await page.route('**/api/jobs?*', (r) => {
      methods.push(r.request().method());
      if (fail)
        return r.fulfill({ status: 503, json: { error: 'Alex saved-task read interrupted' } });
      const u = new URL(r.request().url()),
        offset = Number(u.searchParams.get('offset') || 0);
      return r.fulfill({
        json: {
          total: 40,
          jobs: Array.from({ length: 20 }, (_, i) => ({
            id: offset + i + 1,
            type: 'enrich',
            status: 'succeeded',
            country: 'ar',
            store: 'google-play',
            appId: 1,
            appTitle: 'Loan Marker 1',
            externalId: 'alex.fixture.1',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2026-09-20T00:00:00Z',
            nextRunAt: '2026-09-20T00:00:00Z',
            finishedAt: '2026-09-20T00:00:02Z',
            progress: {},
            result: { receipt: `receipt-${offset + i + 1}` },
          })),
        },
      });
    });
    await nav(page, '采集运行');
    await page.getByLabel('筛选任务状态').selectOption('succeeded');
    await page.locator('.pagination').first().getByRole('button', { name: '下一页' }).click();
    const row = page.locator('[data-reading-id="job-32"]');
    await row.locator('.job-title').click();
    await row.scrollIntoViewIfNeeded();
    const before = await row.evaluate((e) => e.getBoundingClientRect().top);
    await row.getByRole('button', { name: '查看应用详情', exact: true }).click();
    await page.getByRole('button', { name: '返回采集运行', exact: true }).click();
    await expect(page.locator('.job-expanded')).toContainText('receipt-32');
    await expect(page.getByLabel('筛选任务状态')).toHaveValue('succeeded');
    await expect
      .poll(async () =>
        Math.abs((await row.evaluate((e) => e.getBoundingClientRect().top)) - before),
      )
      .toBeLessThan(4);
    fail = true;
    await page.clock.fastForward(15000);
    await page.getByRole('alert').filter({ hasText: 'Alex saved-task read interrupted' }).waitFor();
    await expect(page.locator('.job-expanded')).toContainText('receipt-32');
    assert.equal(await page.getByText('尚无手动采集任务', { exact: true }).count(), 0);
    assert.ok(methods.every((x) => x === 'GET'));
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

test('Alex OI34: a late previous identity cannot overwrite the new diagnostic query or restore its source page', async () => {
  const { context, page, state } = await harness.fixture(817, { height: 863, clock: true });
  page.setDefaultTimeout(6000);
  let release: (() => void) | undefined;
  try {
    let captured = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/discovery/status', (r) =>
      r.fulfill({
        json: {
          enabled: true,
          intervalHours: 6,
          activeCycle: null,
          lastCycle: null,
          totals: { pending: 0, staged: 0, admitted: 0, failed: 0 },
          limits: { sourceRequests: 60, detailRequests: 60, timeoutMs: 20000, searchResults: 1000 },
        },
      }),
    );
    await page.route('**/api/discovery/candidates?*', (r) =>
      r.fulfill({ json: { candidates: [], total: 0 } }),
    );
    await page.route('**/api/discovery/identity?*', async (r) => {
      const u = new URL(r.request().url()),
        id = u.searchParams.get('externalId');
      if (id === 'alex.slow') {
        captured = true;
        await gate;
      }
      await r
        .fulfill({
          json: {
            country: 'ar',
            store: 'google-play',
            externalId: id,
            status: 'not-seen',
            appId: null,
            sourceTotal: 0,
            sources: [],
            tasks: [],
            analysis: null,
          },
        })
        .catch(() => {});
    });
    await nav(page, '发现诊断');
    await page.getByLabel('诊断应用ID').fill('alex.slow');
    await page.getByRole('button', { name: '查询已保存来源', exact: true }).click();
    await expect.poll(() => captured).toBe(true);
    await page.getByLabel('诊断应用ID').fill('alex.latest');
    await page.getByRole('button', { name: '查询已保存来源', exact: true }).click();
    const result = page.getByRole('region', { name: '身份诊断结果' });
    await expect(result.getByRole('heading', { name: 'alex.latest', exact: true })).toBeVisible();
    release();
    await page.clock.fastForward(100);
    await expect(result.getByRole('heading', { name: 'alex.latest', exact: true })).toBeVisible();
    assert.equal(await result.getByRole('heading', { name: 'alex.slow', exact: true }).count(), 0);
    assert.equal(await page.getByLabel('诊断应用ID').inputValue(), 'alex.latest');
    assert.deepEqual(state.pageErrors, []);
  } finally {
    release?.();
    await context.close();
  }
});

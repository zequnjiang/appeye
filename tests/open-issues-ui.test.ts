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
async function nav(page: Page, name: string) {
  const target = page.getByRole('navigation').getByRole('button', { name, exact: true });
  if (!(await target.isVisible()))
    await page.getByRole('button', { name: '切换导航', exact: true }).click();
  await target.click();
}
const cycle = {
  id: 'cycle-now',
  dueAt: '2026-09-20T01:00:00Z',
  startedAt: '2026-09-20T01:00:05Z',
  finishedAt: null,
  total: 4,
  queued: 0,
  running: 0,
  succeeded: 2,
  failed: 2,
};
const collectionStatus = {
  enabled: true,
  intervalMinutes: 60,
  lastSuccessAt: '2026-09-20T01:00:00Z',
  nextDueAt: '2026-09-20T02:00:00Z',
  activeCycle: cycle,
  lastCycle: null,
  overdue: false,
  overdueApps: 0,
  collector: { lastHeartbeatAt: '2026-09-20T01:00:00Z' },
  failures: [],
  countries: [],
  batch: null,
};
const detail = (extra: any = {}) => ({
  app: alexApp(1),
  snapshots: [],
  changes: [],
  reviews: [],
  enrichments: [],
  rawDetail: {},
  ...extra,
});

test('OI27/28: exact task identity and nonfirst-page expanded state survive detail return; filtered empty, missing association and errors are distinct', async () => {
  const { page, context, state } = await harness.fixture(817, { height: 863 });
  page.setDefaultTimeout(6000);
  await page.route('**/api/market-activity?*', (r) =>
    r.fulfill({
      json: {
        date: '2026-09-20',
        counts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        eventCounts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        countries: [],
        events: [],
        total: 0,
        uniqueApps: 0,
      },
    }),
  );
  try {
    let error = false,
      empty = false;
    const methods: string[] = [];
    await page.route('**/api/collection/status', (r) => r.fulfill({ json: collectionStatus }));
    await page.route('**/api/jobs?*', (r) => {
      methods.push(r.request().method());
      const u = new URL(r.request().url());
      if (error) return r.fulfill({ status: 503, json: { error: 'Task fixture read failed' } });
      const status = u.searchParams.get('status'),
        offset = Number(u.searchParams.get('offset'));
      const jobs = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        type: i === 0 ? 'discover' : 'enrich',
        status: 'succeeded',
        country: 'ar',
        store: 'google-play',
        appId: i === 0 ? null : 1,
        appTitle: i === 1 ? null : 'Loan Marker 1',
        externalId: i === 0 ? null : 'alex.fixture.1',
        attempts: 1,
        maxAttempts: 3,
        progress: {},
        result: { proof: 'saved job result' },
        createdAt: '2026-09-19T01:00:00Z',
        finishedAt: '2026-09-20T01:00:00Z',
        nextRunAt: '2026-09-20T01:00:00Z',
      }));
      return r.fulfill({
        json: {
          jobs:
            empty || status === 'failed' || status === 'queued'
              ? []
              : jobs.slice(offset, offset + 20),
          total: empty || status === 'failed' || status === 'queued' ? 0 : 25,
        },
      });
    });
    await nav(page, '采集运行');
    await page.getByText('按市场发现 · 无关联应用', { exact: true }).waitFor();
    await page.getByLabel('筛选任务状态').selectOption('succeeded');
    await page.locator('.pagination').first().getByRole('button', { name: '下一页' }).click();
    const row = page.locator('[data-reading-id="job-21"]');
    await row.waitFor();
    await row.locator('.job-title').click();
    await page.getByText(/saved job result/).waitFor();
    await row.getByRole('button', { name: '查看应用详情', exact: true }).click();
    await page.getByRole('button', { name: '返回采集运行', exact: true }).click();
    assert.equal(await page.getByLabel('筛选任务状态').inputValue(), 'succeeded');
    await page.locator('[data-reading-id="job-21"]').waitFor();
    assert.equal(await page.locator('.job-expanded').count(), 1);
    await expect(page.locator('.job-expanded')).toContainText('saved job result');
    assert.equal(
      await page.locator('[data-reading-id="job-21"] code').innerText(),
      'alex.fixture.1',
    );
    for (const filter of ['failed', 'queued']) {
      await page.getByLabel('筛选任务状态').selectOption(filter);
      await page.getByRole('button', { name: '查看全部手动任务', exact: true }).waitFor();
      assert.equal(await page.getByText('尚无手动采集任务', { exact: true }).count(), 0);
    }
    await page.getByRole('button', { name: '查看全部手动任务', exact: true }).click();
    await page.locator('[data-reading-id="job-1"]').waitFor();
    error = true;
    await page.getByLabel('筛选任务状态').selectOption('running');
    await page.getByRole('alert').filter({ hasText: 'Task fixture read failed' }).waitFor();
    assert.equal(await page.getByText('尚无手动采集任务', { exact: true }).count(), 0);
    error = false;
    empty = true;
    await page.getByLabel('筛选任务状态').selectOption('');
    await page.getByText('尚无手动采集任务', { exact: true }).waitFor();
    assert.ok(methods.every((m) => m === 'GET'));
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

test('OI34: submitted diagnostic source page and disclosures survive sidebar return while an unsubmitted draft stays separate', async () => {
  const { page, context, state } = await harness.fixture(817, { height: 863 });
  page.setDefaultTimeout(6000);
  await page.route('**/api/market-activity?*', (r) =>
    r.fulfill({
      json: {
        date: '2026-09-20',
        counts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        eventCounts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        countries: [],
        events: [],
        total: 0,
        uniqueApps: 0,
      },
    }),
  );
  try {
    const calls: string[] = [],
      writes: string[] = [];
    await page.route('**/api/discovery/status', (r) =>
      r.fulfill({
        json: {
          enabled: true,
          intervalHours: 6,
          nextDueAt: null,
          heartbeatAt: null,
          activeCycle: null,
          lastCycle: null,
          totals: { pending: 0, staged: 0, admitted: 1, failed: 0 },
          limits: { sourceRequests: 60, detailRequests: 60, timeoutMs: 20000, searchResults: 1000 },
          coverageNote: 'Fixture scope',
        },
      }),
    );
    await page.route('**/api/discovery/candidates?*', (r) =>
      r.fulfill({ json: { candidates: [], total: 0 } }),
    );
    await page.route('**/api/discovery/identity?*', (r) => {
      const u = new URL(r.request().url());
      calls.push(u.search);
      if (r.request().method() !== 'GET') writes.push(r.request().method());
      const offset = Number(u.searchParams.get('offset'));
      return r.fulfill({
        json: {
          country: 'ar',
          store: 'google-play',
          externalId: u.searchParams.get('externalId'),
          status: 'admitted',
          appId: 1,
          classification: 'confirmed',
          lastFetchedAt: '2026-09-20T01:00:00Z',
          error: null,
          sourceTotal: 45,
          tasks: [],
          analysis: {},
          sources: Array.from({ length: Math.min(20, 45 - offset) }, (_, i) => ({
            id: `test:${offset + i}`,
            kind: `source ${offset + i + 1}`,
            source: 'https://example.test/source',
            observedAt: '2026-09-19T01:00:00Z',
            processedAt: '2026-09-20T01:00:00Z',
            data: { identity: 'original submitted' },
            raw: { unaltered: 'source raw' },
          })),
        },
      });
    });
    await nav(page, '发现诊断');
    await page.getByLabel('诊断应用ID').fill('alex.fixture.1');
    await page.getByRole('button', { name: '查询已保存来源', exact: true }).click();
    const identity = page.getByRole('region', { name: '身份诊断结果' });
    await identity.getByRole('button', { name: '诊断下一页', exact: true }).click();
    const source = page.locator('[data-reading-id="diagnostic-source-test:20"]');
    await source.locator('summary').first().click();
    await expect(source).toHaveAttribute('open', '');
    await page.getByLabel('诊断应用ID').fill('unsubmitted.new.package');
    await page.getByRole('button', { name: '查看应用详情', exact: true }).click();
    await page.getByRole('button', { name: '返回发现诊断', exact: true }).waitFor();
    await nav(page, '发现诊断');
    await expect(source).toHaveAttribute('open', '');
    assert.equal(await page.getByLabel('诊断应用ID').inputValue(), 'unsubmitted.new.package');
    await expect(
      identity.getByRole('heading', { name: 'alex.fixture.1', exact: true }),
    ).toBeVisible();
    await expect(identity).toContainText('21–40');
    assert.ok(calls.every((s) => new URLSearchParams(s).get('externalId') === 'alex.fixture.1'));
    await page.getByRole('button', { name: '查询已保存来源', exact: true }).click();
    await expect(
      identity.getByRole('heading', { name: 'unsubmitted.new.package', exact: true }),
    ).toBeVisible();
    await expect(identity).toContainText('1–20');
    assert.equal(await page.locator('.diagnostic-source[open]').count(), 0);
    assert.deepEqual(writes, []);
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

test('OI30/31/33/46: detail preserves original dates/notes and historical privacy provenance while presenting safe readable text and hourly trend', async () => {
  const { page, context, state } = await harness.fixture(390);
  page.setDefaultTimeout(6000);
  await page.route('**/api/market-activity?*', (r) =>
    r.fulfill({
      json: {
        date: '2026-09-20',
        counts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        eventCounts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        countries: [],
        events: [],
        total: 0,
        uniqueApps: 0,
      },
    }),
  );
  try {
    const rawNotes =
      'First &quot;update&quot;<br><br>Second &amp; last < 30\n<script>window.sourceExecuted=1</script><img src=x onerror="window.sourceExecuted=2"><a href="javascript:window.sourceExecuted=3">plain link text</a>';
    let rawDate: any = 'unparsed local release',
      privacy = 'https://example.test/historical';
    await page.route('**/api/apps/1', (r) =>
      r.fulfill({
        json: detail({
          app: {
            ...alexApp(1),
            releaseNotes: rawNotes,
            releasedAtRaw: rawDate,
            privacyPolicy: null,
          },
          snapshots: [
            { id: 1, observedAt: '2026-09-07T17:32:52.667Z', data: { score: 4, minInstalls: 0 } },
            { id: 2, observedAt: '2026-09-07T23:49:24.647Z', data: { score: 4, minInstalls: 100 } },
          ],
          enrichments: [
            {
              appId: 1,
              kind: 'privacy',
              status: 'failed',
              lastSuccessAt: '2026-09-07T03:10:59Z',
              lastAttemptAt: '2026-09-20T01:00:00Z',
              error: 'Source unavailable',
              source: 'https://apps.apple.com/ar/app/id1',
              requestCountry: 'ar',
              data: { privacyPolicyUrl: privacy },
              raw: { privacyPolicyUrl: privacy },
            },
          ],
          rawDetail: { released: rawDate, releaseNotes: rawNotes },
        }),
      }),
    );
    await page.locator('[data-library-row="1"] .app-cell').click();
    await page.getByText('已取得原文，日期待解析', { exact: true }).waitFor();
    await expect(page.locator('dl.facts')).toContainText('unparsed local release');
    const notes = page.getByRole('heading', { name: '本次更新说明', exact: true }).locator('+ p');
    await expect(notes).toHaveText('First "update"\n\nSecond & last < 30\nplain link text');
    const formatted = await page.evaluate(async () => {
      const module = await import('/src/display-evidence.tsx');
      return module.sourceToText(
        'Before<p>段落 &quot;一&quot;</p><div>第二段</div><br class="layout">last < 30',
      );
    });
    assert.equal(formatted, 'Before\n段落 "一"\n\n第二段\n\nlast < 30');
    assert.equal(
      await page.evaluate(async () => {
        const module = await import('/src/display-evidence.tsx');
        return module.sourceToText(
          'Keep a<b and c>d; amount < 30. <strong class="note">Known bold</strong>',
        );
      }),
      'Keep a<b and c>d; amount < 30. Known bold',
    );
    assert.equal(await page.evaluate(() => (window as any).sourceExecuted), undefined);
    assert.equal(await notes.locator('a,img,script').count(), 0);
    await expect(page.locator('.trend')).toContainText('2026/09/08 01:32');
    await expect(page.locator('.trend')).toContainText('2026/09/08 07:49');
    await expect(page.locator('.trend')).toContainText('Asia/Shanghai');
    await page.getByLabel('趋势指标').selectOption('minInstalls');
    await expect(page.locator('.trend')).toContainText('2 次有效观测');
    await expect(page.getByRole('link', { name: '历史隐私协议', exact: true })).toHaveAttribute(
      'href',
      privacy,
    );
    await expect(page.locator('.historical-source-note')).toContainText('2026/09/07 11:10');
    await expect(page.locator('.historical-source-note')).toContainText('未核验其当前有效性');
    await page.getByRole('tab', { name: '公司与商店信息', exact: true }).click();
    await expect(page.getByText(rawNotes, { exact: true })).toBeVisible();
    await page.screenshot({ path: '.artifacts/open-issues-notes-raw-390.png', fullPage: true });
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

const event = {
  id: 'update-1',
  type: 'observedUpdate',
  appId: 1,
  externalId: 'alex.fixture.1',
  title: 'Loan Marker 1',
  country: 'ar',
  store: 'app-store',
  classification: 'confirmed',
  eventAt: '2026-09-20T01:00:00Z',
  observedAt: '2026-09-20T01:00:00Z',
  releasedAt: '2012-05-08T01:38:00Z',
  releasedAtPrecision: 'timestamp',
  snapshotId: 18417,
  sourceUrl: 'https://example.test/source',
  releaseNotes: 'Safe<br>line &quot;two&quot;',
  versionChanged: false,
  changes: [
    { id: 1, field: 'score', oldValue: 4.76448, newValue: 4.79016 },
    { id: 2, field: 'ratings', oldValue: 0, newValue: 305 },
    { id: 3, field: 'unknownField', oldValue: null, newValue: { preserved: 'full value' } },
  ],
};
test('OI29/44: selected event shows historical release year and labelled old/new columns, including zero/null/objects at desktop and narrow widths', async () => {
  for (const width of [1280, 390]) {
    const { page, context, state } = await harness.fixture(width);
    page.setDefaultTimeout(6000);
    await page.route('**/api/market-activity?*', (r) =>
      r.fulfill({
        json: {
          date: '2026-09-20',
          counts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
          eventCounts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
          countries: [],
          events: [],
          total: 0,
          uniqueApps: 0,
        },
      }),
    );
    try {
      await page.route('**/api/market/activity?*', (r) =>
        r.fulfill({
          json: {
            date: '2026-09-20',
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
      await nav(page, '今日市场');
      await expect(page.locator('.research-event-list')).toContainText('2012/05/08');
      await page.getByRole('button', { name: '查看 Loan Marker 1 观测更新', exact: true }).click();
      const card = page.locator('.selected-event');
      await card.waitFor();
      await expect(card).toContainText('2012/05/08 09:38');
      await expect(card).toContainText('18417');
      const score = card.locator('[data-change-field="score"]');
      await expect(score).toContainText('评分');
      assert.deepEqual(await score.locator('pre').allTextContents(), ['4.76448', '4.79016']);
      assert.deepEqual(await card.locator('[data-change-field="ratings"] pre').allTextContents(), [
        '0',
        '305',
      ]);
      assert.deepEqual(
        await card.locator('[data-change-field="unknownField"] pre').allTextContents(),
        ['未提供', '{\n  "preserved": "full value"\n}'],
      );
      const rects = await score
        .locator('pre')
        .evaluateAll((els) =>
          els.map((e) => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })),
        );
      if (width > 620) assert.equal(rects[0].y, rects[1].y);
      else assert.ok(rects[1].y > rects[0].y);
      assert.equal(await card.getByText('变化前', { exact: true }).count(), 3);
      assert.equal(await card.getByText('变化后', { exact: true }).count(), 3);
      await page.screenshot({
        path: `.artifacts/open-issues-comparison-${width}.png`,
        fullPage: true,
      });
      assert.deepEqual(state.pageErrors, []);
    } finally {
      await context.close();
    }
  }
});

test('OI41: failure history labels its own actual cycle/time and retains current versus cross-cycle distinction', async () => {
  const { page, context, state } = await harness.fixture();
  page.setDefaultTimeout(6000);
  await page.route('**/api/market-activity?*', (r) =>
    r.fulfill({
      json: {
        date: '2026-09-20',
        counts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        eventCounts: { firstSeen: 0, storeRelease: 0, observedUpdate: 0 },
        countries: [],
        events: [],
        total: 0,
        uniqueApps: 0,
      },
    }),
  );
  try {
    await page.route('**/api/jobs?*', (r) => r.fulfill({ json: { jobs: [], total: 0 } }));
    await page.route('**/api/collection/status', (r) =>
      r.fulfill({
        json: {
          ...collectionStatus,
          failureScope: 'recent-cross-cycle',
          failureLimit: 20,
          failures: [
            {
              id: 10,
              country: 'ar',
              store: 'google-play',
              kind: 'detail',
              appId: 1,
              attempts: 3,
              error: 'saved network failure',
              cycleId: 'cycle-now',
              cycleDueAt: '2026-09-20T01:00:00Z',
              cycleStartedAt: '2026-09-20T01:00:05Z',
              failedAt: '2026-09-20T01:20:00Z',
            },
            {
              id: 11,
              country: 'ar',
              store: 'google-play',
              kind: 'detail',
              appId: 1,
              attempts: 3,
              error: 'old error',
              cycleId: 'cycle-prior',
              failedAt: null,
            },
          ],
        },
      }),
    );
    await nav(page, '采集运行');
    await page.getByRole('button', { name: /0 待处理 · 2 失败/ }).click();
    const list = page.locator('.activity-schedule-failures');
    await expect(list).toContainText('跨周期最近');
    await expect(list).toContainText('2026/09/20 09:20');
    await expect(list).toContainText('cycle-now · 本周期');
    await expect(list).toContainText('cycle-prior · 其他周期');
    await expect(list).toContainText('失败时间：未提供');
    await list.getByRole('button', { name: '查看关联应用' }).first().click();
    await page.getByRole('button', { name: '返回采集运行', exact: true }).click();
    await expect(list).toBeVisible();
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

test('OI32/45: shared APR range is readable in detail and comparison; savings evidence is explicitly separated and excluded from loan terms', async () => {
  const { classifyLoan } = await import('../server/loan-identification.js');
  const { page, context, state } = await harness.fixture();
  page.setDefaultTimeout(6000);
  try {
    const analysis = classifyLoan({
      store: 'app-store',
      country: 'ph',
      externalId: '991673877',
      title: 'Loan and Savings Fixture',
      description:
        'With Maya, you can start saving money and earn up to 15% interest per year. BORROW: Apply for a personal loan of PHP 1000. Max APR: 32%-40% (customer is not charged more than 32% - 40% in a year for a loan). Repay in 6 months. Loans provided by Sample Lending Company.',
      observedAt: '2026-09-19T00:00:00Z',
    });
    assert.ok(analysis.evidence.some((e) => e.kind === 'non-loan'));
    assert.ok(analysis.evidence.some((e) => e.numericMin === 32 && e.numericMax === 40));
    await page.route(/\/api\/apps\/[12]$/, (r) =>
      r.fulfill({
        json: detail({
          app: {
            ...alexApp(Number(new URL(r.request().url()).pathname.split('/').at(-1))),
            loanAnalysis: analysis,
          },
        }),
      }),
    );
    await page.locator('[data-library-row="1"] .app-cell').click();
    await page.getByRole('tab', { name: '信贷识别', exact: true }).click();
    const savings = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '非借款证据 · 储蓄收益等', exact: true }) });
    await expect(savings).toContainText('saving money');
    await expect(savings).toContainText('非借款成本');
    await expect(page.getByText(/范围 32–40/)).toBeVisible();
    await expect(page.getByText(/声明上限 40/)).toBeVisible();
    await page.getByRole('button', { name: '返回应用库', exact: true }).click();
    for (const id of [1, 2])
      await page.getByRole('checkbox', { name: `对比 Loan Marker ${id}`, exact: true }).check();
    await page.getByRole('button', { name: /开始对比/ }).click();
    const compare = page.locator('.research-compare');
    await expect(compare).toContainText('范围 32–40');
    assert.equal(await compare.getByText(/With Maya, you can start saving/).count(), 0);
    await expect(compare).toContainText('非借款证据未计入');
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

test('OI46: historical privacy helper accepts a failed refresh only with same-identity successful provenance, never a cross-market or unsafe URL', async () => {
  const { historicalPrivacy, releaseRaw } = await import('../src/display-evidence.js');
  const app = alexApp(1) as any;
  const source = {
    appId: 1,
    kind: 'privacy',
    status: 'failed',
    requestCountry: 'ar',
    lastSuccessAt: '2026-09-07T00:00:00Z',
    source: 'https://apps.apple.com/ar/app/id1',
    data: { privacyPolicyUrl: 'https://example.test/privacy' },
  } as any;
  assert.equal(historicalPrivacy(app, [source])?.url, 'https://example.test/privacy');
  for (const override of [
    { appId: 2 },
    { requestCountry: 'mx' },
    { requestCountry: null },
    { lastSuccessAt: null },
    { data: { privacyPolicyUrl: 'javascript:alert(1)' } },
    { data: {} },
    { kind: 'developer' },
  ])
    assert.equal(historicalPrivacy(app, [{ ...source, ...override }]), null);
  const history = {
    appId: 1,
    url: 'https://example.test/older-history',
    source: 'https://apps.apple.com/ar/app/id1',
    fetchedAt: '2026-09-01T00:00:00Z',
    requestCountry: 'ar',
    requestLanguage: null,
    historyId: 42,
  };
  assert.equal(historicalPrivacy(app, [source], history)?.historyId, 42);
  assert.equal(historicalPrivacy(app, [source], null), null);
  for (const invalid of [
    { appId: 2 },
    { requestCountry: 'mx' },
    { requestCountry: null },
    { fetchedAt: '' },
    { url: 'javascript:alert(1)' },
  ])
    assert.equal(historicalPrivacy(app, [source], { ...history, ...invalid }), null);
  assert.equal(releaseRaw({ ...app, releasedAtRaw: 'not parsed' }, {}), 'not parsed');
  assert.equal(releaseRaw(app, {}), null);
});

test('OI46: successful empty current privacy keeps older API history visible with its own time and source, while a current link remains primary', async () => {
  const { page, context, state } = await harness.fixture(390);
  page.setDefaultTimeout(6000);
  let current: string | null = null;
  try {
    await page.route('**/api/apps/1', (r) =>
      r.fulfill({
        json: detail({
          app: { ...alexApp(1), privacyPolicy: current },
          enrichments: [
            {
              appId: 1,
              kind: 'privacy',
              status: 'empty',
              data: {},
              requestCountry: 'ar',
              lastSuccessAt: '2026-09-20T00:00:00Z',
            },
          ],
          historicalPrivacy: {
            appId: 1,
            url: 'https://example.test/older-history',
            source: 'https://apps.apple.com/ar/app/id1',
            fetchedAt: '2026-09-01T00:00:00Z',
            requestCountry: 'ar',
            requestLanguage: null,
            historyId: 42,
          },
        }),
      }),
    );
    await page.locator('[data-library-row="1"] .app-cell').click();
    const note = page.locator('.historical-source-note');
    await expect(note).toContainText('2026/09/01 08:00');
    await expect(note).toContainText('历史记录 #42');
    await expect(note).not.toContainText('2026/09/20');
    await expect(note.getByRole('link', { name: '历史隐私协议', exact: true })).toHaveAttribute(
      'href',
      'https://example.test/older-history',
    );
    await expect(note.getByRole('link', { name: '当时商店来源', exact: true })).toHaveAttribute(
      'href',
      'https://apps.apple.com/ar/app/id1',
    );
    await page.getByRole('button', { name: '返回应用库', exact: true }).click();
    current = 'https://example.test/current-policy';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await nav(page, '应用库');
    await page.locator('[data-library-row="1"] .app-cell').click();
    await expect(
      page.locator('dl.facts a[href="https://example.test/current-policy"]'),
    ).toBeVisible();
    await expect(note).toHaveCount(0);
    assert.deepEqual(state.pageErrors, []);
  } finally {
    await context.close();
  }
});

test('OI29/30: display never guesses a missing year or rolls an invalid calendar date, and an empty release source is genuinely missing', async () => {
  const { time } = await import('../src/ResearchUI.js');
  const { releaseRaw } = await import('../src/display-evidence.js');
  assert.equal(time('2021-08-10', true), '2021-08-10');
  assert.equal(time('2012-05-08T01:38:00Z', true), '2012/05/08 09:38');
  for (const source of ['May 8', '05/08', '2026-02-31', '2012-13-08'])
    assert.equal(time(source, true), `${source}（日期待解析）`);
  assert.equal(releaseRaw({ ...alexApp(1), releasedAtRaw: '' } as any, { released: '' }), null);
});

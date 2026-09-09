import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { alexBrowserHarness } from './alex-browser-fixture.js';

let harness: Awaited<ReturnType<typeof alexBrowserHarness>>;
before(async () => { harness = await alexBrowserHarness(); });
after(async () => { await harness?.close(); });

test('Alex LRR supersedes SR-01: two real 15-second polls stage content without removing table, pagination, or editing focus', { timeout: 55000 }, async () => {
  const { context, page, state } = await harness.fixture();
  try {
    const table = page.locator('[data-library-table]');
    await table.evaluate(node => { (node as HTMLElement & { alexIdentity: string }).alexIdentity = 'stable'; });
    await page.getByLabel('搜索应用', { exact: true }).focus();
    const baseline = state.calls.length;
    const originalRows = await page.locator('[data-library-row]').allTextContents();
    state.rows[0].title = 'Pending first poll';
    await page.getByRole('button', { name: '更新清单', exact: true }).waitFor({ timeout: 18000 });
    assert.equal(await page.getByText('Pending first poll', { exact: true }).count(), 0);
    state.rows[0].title = 'Pending second poll';
    await page.waitForTimeout(15500);
    assert.equal(await page.getByText('Pending second poll', { exact: true }).count(), 0);
    assert.deepEqual(await page.locator('[data-library-row]').allTextContents(), originalRows);
    assert.ok(state.calls.length >= baseline + 2);
    assert.equal(await table.evaluate(node => (node as HTMLElement & { alexIdentity: string }).alexIdentity), 'stable');
    assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).count(), 1);
    assert.equal(await page.getByLabel('搜索应用', { exact: true }).evaluate(node => document.activeElement === node), true);
    await page.getByRole('button', { name: '更新清单', exact: true }).evaluate(button => button.click());
    await page.getByText('Pending second poll', { exact: true }).waitFor();
    state.failed = true;
    await page.getByRole('button', { name: '刷新当前数据', exact: true }).evaluate(button => button.click());
    await page.getByRole('alert').filter({ hasText: 'Alex synthetic refresh failure' }).waitFor();
    assert.equal(await page.locator('[data-library-row]').count(), 20);
    assert.equal(await table.evaluate(node => (node as HTMLElement & { alexIdentity: string }).alexIdentity), 'stable');
    state.failed = false;
    state.rows[0].title = 'Recovered automatically retained rows';
    await page.getByRole('button', { name: '刷新当前数据', exact: true }).evaluate(button => button.click());
    await page.getByText('Recovered automatically retained rows', { exact: true }).waitFor();
    assert.deepEqual(state.pageErrors, []);
  } finally { await context.close(); }
});

test('Alex SR-02/03/04: desktop and 390px detail return restores cached query, page, anchor and focus before a slow response', async () => {
  for (const width of [1280, 390]) {
    const { context, page, state } = await harness.fixture(width);
    let release: (() => void) | undefined;
    try {
      await page.getByLabel('筛选国家', { exact: true }).selectOption('ar');
      await page.getByLabel('应用商店', { exact: true }).selectOption('google-play');
      await page.getByLabel('信贷范围', { exact: true }).selectOption('all');
      await page.getByLabel('搜索应用', { exact: true }).fill('Loan Marker');
      await page.getByRole('button', {name: '搜索', exact:true}).click();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await page.locator('[data-library-row="21"]').waitFor();
      const row = page.locator('[data-library-row="27"]');
      await row.scrollIntoViewIfNeeded();
      const entrance = row.locator('.app-cell'); await entrance.focus();
      const before = await row.boundingBox(); const documents = state.documents;
      await entrance.click();
      await page.getByRole('button', { name: '返回应用库', exact: true }).waitFor();
      state.gate = new Promise<void>(resolve => { release = resolve; });
      await page.getByRole('button', { name: '返回应用库', exact: true }).click();
      await row.waitFor();
      assert.equal(await page.getByLabel('筛选国家', { exact: true }).inputValue(), 'ar');
      assert.equal(await page.getByLabel('应用商店', { exact: true }).inputValue(), 'google-play');
      assert.equal(await page.getByLabel('信贷范围', { exact: true }).inputValue(), 'all');
      assert.equal(await page.getByLabel('搜索应用', { exact: true }).inputValue(), 'Loan Marker');
      assert.equal(await page.locator('[data-library-row]').first().getAttribute('data-library-row'), '21');
      const returned = await row.boundingBox();
      assert.ok(Math.abs(before!.y - returned!.y) < 3, `width ${width}: reading moved ${before!.y} -> ${returned!.y}`);
      assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.focusKey), 'app-27');
      assert.equal(state.documents, documents);
      assert.deepEqual(state.pageErrors, []);
      release(); state.gate = null;
    } finally { release?.(); await context.close(); }
  }
});

test('Alex SR-03/05: a superseded delayed query never populates a different market and filter reset has no old offset request', async () => {
  const { context, page, state } = await harness.fixture();
  let release: (() => void) | undefined;
  try {
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('[data-library-row="21"]').waitFor();
    state.gate = new Promise<void>(resolve => { release = resolve; });
    const start = state.calls.length;
    await page.getByLabel('筛选国家', { exact: true }).selectOption('ar');
    await page.waitForTimeout(50);
    state.gate = null;
    await page.getByLabel('筛选国家', { exact: true }).selectOption('mx');
    await page.locator('[data-library-row="91"]').waitFor();
    release(); await page.waitForTimeout(80);
    assert.equal(await page.locator('[data-library-row]').first().getAttribute('data-library-row'), '91');
    assert.equal(await page.getByLabel('筛选国家', { exact: true }).inputValue(), 'mx');
    const queries = state.calls.slice(start).map(value => new URLSearchParams(value));
    assert.ok(queries.some(query => query.get('country') === 'ar'));
    assert.ok(queries.some(query => query.get('country') === 'mx'));
    for (const query of queries) assert.equal(query.get('offset'), '0');
    assert.deepEqual(state.pageErrors, []);
  } finally { release?.(); await context.close(); }
});

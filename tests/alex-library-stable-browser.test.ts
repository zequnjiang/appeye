import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';
import { alexApp, alexBrowserHarness } from './alex-browser-fixture.js';

let harness: Awaited<ReturnType<typeof alexBrowserHarness>>;
before(async () => { harness = await alexBrowserHarness(); });
after(async () => { await harness?.close(); });

const displayed = (page: Page) => page.evaluate(() => ({
  rows: [...document.querySelectorAll<HTMLElement>('[data-library-row]')].map(row => ({ id: row.dataset.libraryRow, text: row.innerText })),
  count: document.querySelector('.research-pagination > span')?.textContent,
  pagination: document.querySelector('.research-pagination')?.textContent,
}));
async function backgroundTick(page: Page, state: { completed: number }) {
  const previous = state.completed;
  await page.clock.fastForward(15000);
  await expect.poll(() => state.completed).toBeGreaterThan(previous);
  await page.waitForTimeout(50);
}

test('Alex LRR-01/04/05: 817x863 controls stay fixed while member/order/content/total changes remain pending; equivalent polls stay quiet', async () => {
  const { context, page, state } = await harness.fixture(817, { height: 863, clock: true });
  try {
    await page.evaluate(() => scrollTo(0, 0));
    await page.getByLabel('搜索应用', { exact: true }).focus();
    const snapshot = await displayed(page), initialDocuments = state.documents;
    const positions = await page.evaluate(() => ({ y: scrollY, heading: document.querySelector('h1')!.getBoundingClientRect().top, table: document.querySelector('[data-library-table]')!.getBoundingClientRect().top }));
    await backgroundTick(page, state);
    assert.equal(await page.getByRole('button', { name: '更新清单', exact: true }).count(), 0);
    const added = { ...alexApp(5001), country: 'ar' };
    state.rows = [added, ...state.rows.filter(row => row.id !== 2)];
    state.rows[1].title = 'Changed current row';
    await backgroundTick(page, state);
    await page.getByRole('button', { name: '更新清单', exact: true }).waitFor();
    assert.deepEqual(await displayed(page), snapshot);
    state.rows = [added, ...state.rows.filter(row => row.id !== 5001 && row.id !== 3)];
    await backgroundTick(page, state);
    assert.deepEqual(await displayed(page), snapshot);
    const stagedPositions = await page.evaluate(() => ({ y: scrollY, heading: document.querySelector('h1')!.getBoundingClientRect().top, table: document.querySelector('[data-library-table]')!.getBoundingClientRect().top }));
    assert.deepEqual(stagedPositions, positions, 'pending prompt must not move controls or table');
    assert.equal(await page.getByLabel('搜索应用', { exact: true }).evaluate(node => document.activeElement === node), true);
    await page.screenshot({ path: '.artifacts/alex-library-stable-817-pending.png' });
    state.failed = true; await backgroundTick(page, state);
    await page.getByRole('alert').filter({ hasText: 'Alex synthetic refresh failure' }).waitFor();
    assert.deepEqual(await displayed(page), snapshot);
    assert.equal(await page.getByRole('button', { name: '更新清单', exact: true }).count(), 1);
    state.failed = false; await backgroundTick(page, state);
    await page.getByRole('button', { name: '更新清单', exact: true }).evaluate(button => button.click());
    await page.locator('[data-library-row="5001"]').waitFor();
    await expect(page.locator('.research-pagination > span')).toContainText('共 119 项');
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.equal(await page.getByRole('button', { name: '更新清单', exact: true }).count(), 0);
    await page.screenshot({ path: '.artifacts/alex-library-stable-817-applied.png' });
    assert.equal(state.documents, initialDocuments);
    assert.deepEqual(state.pageErrors, []);
  } finally { await context.close(); }
});

test('Alex LRR-02/03/04: detail return retains displayed page and pending; applying preserves surviving reading row; another market has independent state', async () => {
  const { context, page, state } = await harness.fixture(390, { clock: true });
  try {
    await page.getByLabel('筛选国家', { exact: true }).selectOption('ar');
    await expect.poll(() => state.calls.some(value => new URLSearchParams(value).get('country') === 'ar')).toBe(true);
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.locator('[data-library-row="21"]').waitFor();
    const row = page.locator('[data-library-row="27"]');
    await row.scrollIntoViewIfNeeded(); await row.locator('.app-cell').focus();
    const snapshot = await displayed(page), position = await row.boundingBox(), documents = state.documents;
    state.rows = [{ ...alexApp(5001), country: 'ar' }, ...state.rows];
    await backgroundTick(page, state);
    assert.deepEqual(await displayed(page), snapshot);
    await row.locator('.app-cell').click();
    await page.getByRole('button', { name: '返回应用库', exact: true }).click();
    await row.waitFor();
    assert.deepEqual(await displayed(page), snapshot);
    assert.equal(await page.getByLabel('筛选国家', { exact: true }).inputValue(), 'ar');
    assert.equal(await page.getByRole('button', { name: '更新清单', exact: true }).count(), 1);
    assert.ok(Math.abs((await row.boundingBox())!.y - position!.y) < 3);
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.focusKey), 'app-27');
    await page.screenshot({ path: '.artifacts/alex-library-stable-390-return-pending.png' });
    await page.getByRole('button', { name: '更新清单', exact: true }).evaluate(button => button.click());
    await page.locator('[data-library-row="20"]').waitFor();
    assert.ok(Math.abs((await row.boundingBox())!.y - position!.y) < 3);
    await page.getByLabel('筛选国家', { exact: true }).selectOption('mx');
    await page.locator('[data-library-row="91"]').waitFor();
    assert.equal(await page.getByRole('button', { name: '更新清单', exact: true }).count(), 0);
    assert.equal(state.documents, documents);
    assert.deepEqual(state.pageErrors, []);
  } finally { await context.close(); }
});

test('Alex LRR-02/04: shrinking total never moves a displayed last page before consent, then recovers a valid page and explicit empty result', async () => {
  const { context, page, state } = await harness.fixture(817, { height: 863, clock: true });
  let release: (() => void) | undefined;
  try {
    for (let index = 1; index <= 5; index++) {
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await page.locator(`[data-library-row="${index * 20 + 1}"]`).waitFor();
    }
    const snapshot = await displayed(page);
    state.rows = state.rows.slice(0, 20);
    await backgroundTick(page, state);
    assert.deepEqual(await displayed(page), snapshot);
    assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
    const previousCalls = state.calls.length;
    state.gate = new Promise<void>(resolve => { release = resolve; });
    await page.getByRole('button', { name: '更新清单', exact: true }).evaluate(button => button.click());
    await expect.poll(() => state.calls.length).toBeGreaterThan(previousCalls);
    assert.deepEqual(await displayed(page), snapshot, 'hold the accepted old display until the valid replacement page succeeds, not its obsolete cache');
    state.failed = true; state.gate = null; release();
    await page.getByRole('alert').filter({ hasText: 'Alex synthetic refresh failure' }).waitFor();
    assert.deepEqual(await displayed(page), snapshot, 'a failed valid-page fetch must retain the original display and pending update');
    assert.equal(await page.getByRole('button', { name: '更新清单', exact: true }).count(), 1);
    state.failed = false;
    await page.getByRole('button', { name: '更新清单', exact: true }).evaluate(button => button.click());
    await page.locator('[data-library-row="1"]').waitFor();
    await expect(page.locator('.research-pagination > span')).toContainText('共 20 项');
    assert.equal(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
    const settled = state.calls.length;
    await page.waitForTimeout(100); assert.equal(state.calls.length, settled, 'invalid page recovery must not loop');
    state.rows = [];
    await page.getByRole('button', { name: '刷新当前数据', exact: true }).evaluate(button => button.click());
    await expect(page.locator('.research-pagination > span')).toContainText('共 0 项');
    assert.equal(await page.locator('[data-library-row]').count(), 0);
    assert.equal(await page.getByRole('button', { name: '更新清单', exact: true }).count(), 0);
    assert.deepEqual(state.pageErrors, []);
  } finally { release?.(); await context.close(); }
});

test('Alex RWP ordinary expiry retains displayed rows and performs no silent replacement; explicit refresh obtains a fresh token', async () => {
  const { context, page, state } = await harness.fixture(817, { height:863, clock:true });
  try {
    const original = await displayed(page);
    state.expired = true;
    await backgroundTick(page, state);
    await page.getByRole('alert').filter({hasText:'Alex synthetic expired snapshot'}).waitFor();
    assert.deepEqual(await displayed(page), original);
    const boundary = state.calls.length;
    await backgroundTick(page, state);
    assert.deepEqual(await displayed(page), original);
    assert.ok(state.calls.slice(boundary).every(value => new URLSearchParams(value).has('snapshot')));
    const applyAt = state.calls.length;
    state.rows = [{...alexApp(8001),country:'ar'}, ...state.rows];
    await page.getByRole('button', {name:'更新清单',exact:true}).click();
    await page.locator('[data-library-row="8001"]').waitFor();
    assert.ok(state.calls.slice(applyAt).some(value => !new URLSearchParams(value).has('snapshot')));
    assert.deepEqual(state.pageErrors, []);
  } finally { await context.close(); }
});

test('Alex RWP visibility revocation clears displayed and other query caches, comparison selection and silent reloads', async () => {
  const { context, page, state } = await harness.fixture(817, { height:863, clock:true });
  try {
    await page.locator('[data-library-row="1"] input').check();
    await page.locator('[data-library-row="2"] input').check();
    await page.getByLabel('筛选国家', {exact:true}).selectOption('ar');
    await expect.poll(() => state.calls.some(value => new URLSearchParams(value).get('country') === 'ar')).toBe(true);
    await page.waitForTimeout(100);
    state.rows = state.rows.filter(row => row.id !== 1);
    state.revoked = true;
    await backgroundTick(page, state);
    await expect(page.locator('[data-library-row]')).toHaveCount(0);
    assert.equal(await page.getByRole('button', {name:'开始对比',exact:true}).count(), 0);
    const callsAtRevoke = state.calls.length;
    await page.clock.fastForward(30000);
    await page.waitForTimeout(80);
    assert.equal(state.calls.length, callsAtRevoke, 'revoked cache must not auto-reload a fresh query');
    await page.getByLabel('筛选国家', {exact:true}).selectOption('');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-library-row="1"]').count(), 0, 'the formerly cached unfiltered query cannot restore revoked rows');
    const applyAt = state.calls.length;
    state.revoked = false;
    await page.getByRole('button', {name:'更新清单',exact:true}).click();
    await page.locator('[data-library-row="2"]').waitFor();
    assert.equal(await page.locator('[data-library-row="1"]').count(), 0);
    assert.ok(state.calls.slice(applyAt).some(value => !new URLSearchParams(value).has('snapshot')));
    assert.deepEqual(state.pageErrors, []);
  } finally { await context.close(); }
});

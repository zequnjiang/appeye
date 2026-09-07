import assert from 'node:assert/strict';
import { createStore, type Store } from '../server/db.js';
import type { FullScanProviders, ScanProvider } from '../server/full-scan-providers.js';
import type { NormalizedApp } from '../server/types.js';
import { creditApp } from './fixtures.js';
import { facilitatorFixture } from './loan-fixtures.js';

export const hourStart = '2026-09-06T16:00:00.000Z';
export function hourlyData(externalId = 'fixture.hourly.loan'): NormalizedApp {
  return {
    ...creditApp,
    ...facilitatorFixture,
    externalId,
    url: `https://example.invalid/apps/${externalId}`,
    raw: { futureField: { retained: true }, released: '2026-09-07' },
    storeData: { futureField: { retained: true }, released: '2026-09-07' },
  };
}
export function hourlyProvider(overrides: Partial<ScanProvider> = {}): ScanProvider {
  return {
    list: async () => ({
      data: [],
      raw: [],
      source: 'https://example.invalid/finance',
      stopReason: 'chart-interface-no-pagination',
    }),
    search: async () => ({
      data: [],
      raw: [],
      source: 'https://example.invalid/search',
      stopReason: 'search-empty-page',
    }),
    app: async ({ externalId }) => hourlyData(externalId),
    enrich: async () => {
      throw new Error('Hourly work must not request supplements');
    },
    reviewsPage: async () => {
      throw new Error('Hourly work must not request comments');
    },
    ...overrides,
  };
}
export function hourlyProviders(overrides: Partial<FullScanProviders> = {}): FullScanProviders {
  return { 'google-play': hourlyProvider(), 'app-store': hourlyProvider(), ...overrides };
}
export function oneCountry(store: Store) {
  store.run('UPDATE countries SET enabled=0');
  store.upsertCountry({
    ...store.getCountry('th')!,
    enabled: true,
    keywords: ['loan'],
    intervalHours: 1,
  });
  return store;
}
export function hourlyStore() {
  return oneCountry(createStore());
}
export async function drainHourly(runner: { runOnce(): Promise<boolean> }, bound = 300) {
  let count = 0;
  while (await runner.runOnce())
    assert.ok(++count <= bound, 'Synthetic cycle must terminate within its bounded fixture');
  return count;
}

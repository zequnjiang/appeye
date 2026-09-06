import type { NormalizedApp, NormalizedReview, Provider, Providers } from '../server/types.js';

/** Entirely synthetic data. Never submit these IDs or reviews to external stores. */
export const creditApp: NormalizedApp = {
  externalId: 'test.example.credit',
  title: 'Fixture Credit',
  developer: 'Fixture Publisher',
  summary: 'Personal loan application for independent tests',
  description: 'Synthetic app used to verify observations and API boundaries.',
  version: '1.0.0',
  score: 4.1,
  ratings: 123,
  installs: '10,000+',
  minInstalls: 10_000,
  maxInstalls: 50_000,
  releaseNotes: 'Initial release',
  releasedAt: '2025-01-02T00:00:00.000Z',
  storeUpdatedAt: '2025-02-03T00:00:00.000Z',
  genre: 'Finance',
  raw: { fixture: true },
};

export const creditReview: NormalizedReview = {
  externalId: 'fixture-review-001',
  userName: 'Fixture Reviewer',
  title: 'Synthetic review',
  text: 'Useful application; this content is a test fixture.',
  score: 4,
  version: '1.0.0',
  reviewedAt: '2025-02-04T00:00:00.000Z',
  language: 'en',
  raw: { fixture: true },
};

export function fixtureProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    search: async () => [{ ...creditApp }],
    app: async ({ externalId }) => ({ ...creditApp, externalId }),
    reviews: async () => [{ ...creditReview }],
    ...overrides,
  };
}

export function fixtureProviders(overrides: Partial<Providers> = {}): Providers {
  return { 'google-play': fixtureProvider(), 'app-store': fixtureProvider(), ...overrides };
}

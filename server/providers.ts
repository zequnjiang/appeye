import { createHash } from 'node:crypto';
import googlePlay from 'google-play-scraper';
import appStore from 'app-store-scraper';
import type { NormalizedApp, NormalizedReview, Providers, StoreName } from './types.js';
const text = (value: unknown): string | null =>
  value === undefined || value === null || value === '' ? null : String(value);
const number = (value: unknown): number | null =>
  value === undefined || value === null || value === '' || !Number.isFinite(Number(value))
    ? null
    : Number(value);
const date = (value: unknown): string | null => {
  if (!value) return null;
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export function normalizeApp(raw: Record<string, any>, store: StoreName): NormalizedApp {
  const externalId = text(store === 'google-play' ? raw.appId : raw.id);
  if (!externalId || !text(raw.title))
    throw new Error('商店返回的数据缺少应用 ID 或名称，可能是采集接口发生变化');
  return {
    externalId,
    title: String(raw.title),
    developer: text(raw.developer),
    icon: text(raw.icon),
    url: text(raw.url),
    summary: text(raw.summary),
    description: text(raw.description),
    version: text(raw.version),
    score: number(raw.score),
    ratings: number(raw.ratings ?? (store === 'app-store' ? raw.reviews : null)),
    reviewCount: store === 'google-play' ? number(raw.reviews) : null,
    bundleId: store === 'app-store' ? text(raw.appId) : null,
    price: number(raw.price),
    currency: text(raw.currency),
    installs: store === 'google-play' ? text(raw.installs) : null,
    minInstalls: store === 'google-play' ? number(raw.minInstalls) : null,
    maxInstalls: store === 'google-play' ? number(raw.maxInstalls) : null,
    releaseNotes: text(raw.recentChanges ?? raw.releaseNotes),
    releasedAt: date(raw.released),
    storeUpdatedAt: date(raw.updated),
    genre: text(raw.genre),
    developerWebsite: text(raw.developerWebsite),
    privacyPolicy: text(raw.privacyPolicy),
    raw,
  };
}
export function normalizeReview(raw: Record<string, any>, language: string): NormalizedReview {
  const fallback = !text(raw.id);
  const externalId =
    text(raw.id) ??
    `content:${createHash('sha256')
      .update(
        JSON.stringify([
          raw.userName ?? null,
          raw.title ?? null,
          raw.text ?? null,
          raw.score ?? null,
          raw.version ?? null,
          date(raw.date ?? raw.updated),
        ]),
      )
      .digest('hex')}`;
  return {
    externalId,
    userName: text(raw.userName),
    title: text(raw.title),
    text: text(raw.text) ?? '',
    score: number(raw.score),
    version: text(raw.version),
    reviewedAt: date(raw.date ?? raw.updated),
    replyText: text(raw.replyText),
    language,
    raw: fallback ? { ...raw, _appeye: { reviewIdSource: 'content-hash', originalId: null } } : raw,
  };
}
export function createProviders(
  options: { timeoutMs?: number; searchLimit?: number; reviewLimit?: number } = {},
): Providers {
  const timeout = options.timeoutMs ?? 25000;
  const searchLimit = options.searchLimit ?? 20;
  return {
    'google-play': {
      async search({ country, language, keyword, signal }) {
        const rows = await googlePlay.search({
          term: keyword,
          country,
          lang: language,
          num: searchLimit,
          fullDetail: false,
          requestOptions: { timeout: { request: timeout }, retry: { limit: 0 }, signal },
        });
        return rows.map((r: Record<string, any>) => normalizeApp(r, 'google-play'));
      },
      async app({ externalId, country, language, signal }) {
        return normalizeApp(
          await googlePlay.app({
            appId: externalId,
            country,
            lang: language,
            requestOptions: { timeout: { request: timeout }, retry: { limit: 0 }, signal },
          }),
          'google-play',
        );
      },
      async reviews({ externalId, country, language, signal }) {
        const result = await googlePlay.reviews({
          appId: externalId,
          country,
          lang: language,
          num: options.reviewLimit ?? 100,
          sort: googlePlay.sort.NEWEST,
          requestOptions: { timeout: { request: timeout }, retry: { limit: 0 }, signal },
        });
        return (Array.isArray(result) ? result : (result.data ?? [])).map(
          (r: Record<string, any>) => normalizeReview(r, language),
        );
      },
    },
    'app-store': {
      async search({ country, language, keyword }) {
        const rows = await appStore.search({
          term: keyword,
          country,
          lang: language,
          num: searchLimit,
          page: 1,
          requestOptions: { timeout, followRedirect: false, followAllRedirects: false },
        });
        return rows.map((r: Record<string, any>) => normalizeApp(r, 'app-store'));
      },
      async app({ externalId, country, language }) {
        return normalizeApp(
          await appStore.app({
            id: externalId,
            country,
            lang: language,
            requestOptions: { timeout, followRedirect: false, followAllRedirects: false },
          }),
          'app-store',
        );
      },
      // The upstream RSS API scopes reviews by storefront, not an actual language filter.
      async reviews({ externalId, country }) {
        const rows = await appStore.reviews({
          id: externalId,
          country,
          page: 1,
          sort: appStore.sort.RECENT,
          requestOptions: { timeout, followRedirect: false, followAllRedirects: false },
        });
        return rows.map((r: Record<string, any>) => normalizeReview(r, 'und'));
      },
    },
  };
}

import googlePlay from '@mradex77/google-play-scraper';
import * as apple from '@perttu/app-store-scraper';
import { setTimeout as sleep } from 'node:timers/promises';
import { normalizeDeveloperContinuation } from './developer-continuation.js';
import { decodeGoogleDeveloperId, googleDeveloperRequestUrl } from './developer-route.js';
import { describeTransportError } from './transport-error.js';
import {
  ReviewSourceValidationError,
  validateAppleReviewResponse,
  validateGoogleReviewResponse,
} from './review-source-validation.js';
import {
  createProviders,
  normalizeApp,
  normalizeReview,
  enrichmentContext,
  hasEnrichmentData,
  type ScraperClient,
} from './providers.js';
import type {
  NormalizedApp,
  NormalizedReview,
  Provider,
  ProviderContext,
  StoreName,
} from './types.js';

export interface ScanPage<T> {
  data: T[];
  raw: unknown;
  source: string;
  nextCursor?: string | null;
  stopReason?: string;
  warnings?: unknown[];
  requestLanguage?: string | null;
}
export interface ScanProvider {
  list(input: ProviderContext & { collection: string }): Promise<ScanPage<NormalizedApp>>;
  search(
    input: ProviderContext & { keyword: string; page: number },
  ): Promise<ScanPage<NormalizedApp>>;
  app: Provider['app'];
  appWithPeers?(
    input: ProviderContext & { externalId: string; batchId: string; peerExternalIds: string[] },
  ): Promise<ScanDetailResult>;
  enrich(
    input: Parameters<NonNullable<Provider['enrich']>>[0] & {
      developerUrl?: string;
      developerSourceHttpId?: number;
    },
  ): ReturnType<NonNullable<Provider['enrich']>>;
  reviewsPage(
    input: ProviderContext & { externalId: string; page: number; cursor: string | null },
  ): Promise<ScanPage<NormalizedReview>>;
}
export interface ScanDetailResult {
  data: NormalizedApp;
  observedAt: string;
  provenance: {
    method: 'bulk-lookup' | 'individual';
    batchId: string;
    country: string;
    language: string;
    source: string;
    httpId?: number | null;
    fallbackReason?: string;
  };
}
export type FullScanProviders = Record<StoreName, ScanProvider>;
export const financeCollections: Record<StoreName, string[]> = {
  'google-play': ['TOP_FREE', 'TOP_PAID', 'GROSSING'],
  'app-store': [
    'topfreeapplications',
    'toppaidapplications',
    'topgrossingapplications',
    'topfreeipadapplications',
    'toppaidipadapplications',
    'topgrossingipadapplications',
  ],
};
export interface ScanTransportRecord {
  url: string;
  method: string;
  status: number | null;
  body: string | null;
  contentType: string | null;
  error: string | null;
  fetchedAt: string;
}
export interface FullScanProviderOptions {
  timeoutMs?: number;
  requestDelayMs?: number;
  fetchImpl?: typeof fetch;
  onResponse?: (response: ScanTransportRecord) => number | void;
  appleBatchSize?: number;
  googlePlayClient?: ScraperClient & { list(options: any): Promise<any> };
  appStoreClient?: ScraperClient & { list(options: any): Promise<any> };
}

/** All HTTP, including hidden scraper pagination/fallbacks, shares one paced transport. */
export function createFullScanProviders(options: FullScanProviderOptions = {}): FullScanProviders {
  const timeoutMs = options.timeoutMs ?? 30000;
  const transport = options.fetchImpl ?? globalThis.fetch;
  const appleBatchSize = options.appleBatchSize ?? 50;
  if (!Number.isInteger(appleBatchSize) || appleBatchSize < 0 || appleBatchSize > 100)
    throw new Error('appleBatchSize must be an integer in 0..100');
  const transportSources = new WeakMap<
    Response,
    { httpId: number | null; record: ScanTransportRecord }
  >();
  const bulkCache = new Map<string, ScanDetailResult>();
  const bulkAttempted = new Map<string, string>();
  const cacheKey = (batchId: string, country: string, language: string, id: string) =>
    JSON.stringify([batchId, country, language, id]);
  let previousStart = 0;
  let previousITunesStart = 0;
  let cooldownUntil = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const fetcher: typeof fetch = (input, init) => {
    const work = chain.then(async () => {
      const request = input instanceof Request ? input : undefined;
      const signal = init?.signal ?? request?.signal ?? undefined;
      signal?.throwIfAborted();
      const url = new URL(request?.url ?? String(input));
      const iTunesApi =
        url.hostname === 'itunes.apple.com' && /^\/(search|lookup)$/.test(url.pathname);
      const delay = Math.max(
        0,
        (options.requestDelayMs ?? 500) - (Date.now() - previousStart),
        cooldownUntil - Date.now(),
        iTunesApi ? 3100 - (Date.now() - previousITunesStart) : 0,
      );
      if (delay) await sleep(delay, undefined, { signal });
      signal?.throwIfAborted();
      previousStart = Date.now();
      if (iTunesApi) previousITunesStart = previousStart;
      const record: ScanTransportRecord = {
        url: url.href,
        method: init?.method ?? request?.method ?? 'GET',
        status: null,
        body: null,
        contentType: null,
        error: null,
        fetchedAt: new Date().toISOString(),
      };
      try {
        const result = await transport(input, init);
        record.status = result.status;
        record.contentType = result.headers.get('content-type');
        record.body = await result.clone().text();
        if (result.status === 429) {
          const retryAfter = result.headers.get('retry-after');
          const retryAt =
            retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
              ? Date.now() + Number(retryAfter) * 1000
              : Date.parse(retryAfter ?? '');
          cooldownUntil = Math.max(
            cooldownUntil,
            Number.isFinite(retryAt) ? retryAt : Date.now() + 60000,
          );
        }
        const httpId = options.onResponse?.(record);
        transportSources.set(result, {
          httpId: typeof httpId === 'number' ? httpId : null,
          record,
        });
        return result;
      } catch (error) {
        record.error = describeTransportError(error);
        options.onResponse?.(record);
        throw error;
      }
    });
    chain = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  };
  const clients = {
    'google-play': options.googlePlayClient ?? googlePlay,
    'app-store': options.appStoreClient ?? apple,
  };
  const details = createProviders({ ...options, timeoutMs, requestDelayMs: 0, fetchImpl: fetcher });
  const requestOptions = (store: StoreName, signal?: AbortSignal) =>
    store === 'google-play'
      ? { timeoutMs, retries: 0, signal, fetchImpl: fetcher }
      : { timeout: timeoutMs, retries: 0, signal, fetch: fetcher };
  function adapter(store: StoreName): ScanProvider {
    const client = clients[store];
    const context = (input: ProviderContext) => ({
      country: input.country,
      lang: store === 'app-store' ? 'en_us' : input.language,
      requestOptions: requestOptions(store, input.signal),
    });
    const individualApp: Provider['app'] = (input) =>
      details[store].app({ ...input, language: store === 'app-store' ? 'en_us' : input.language });
    const appWithPeers: NonNullable<ScanProvider['appWithPeers']> = async (input) => {
      const key = cacheKey(input.batchId, input.country, input.language, input.externalId);
      if (!bulkCache.has(key) && !bulkAttempted.has(key)) {
        const ids = [...new Set([input.externalId, ...input.peerExternalIds])]
          .filter(
            (id) =>
              /^\d+$/.test(id) &&
              !bulkAttempted.has(cacheKey(input.batchId, input.country, input.language, id)),
          )
          .slice(0, appleBatchSize);
        for (const id of ids)
          bulkAttempted.set(
            cacheKey(input.batchId, input.country, input.language, id),
            'bulk-no-record',
          );
        if (ids.length) {
          const source = `https://itunes.apple.com/lookup?${new URLSearchParams({ id: ids.join(','), country: input.country, entity: 'software', lang: 'en_us', limit: String(ids.length) })}`;
          try {
            const signal = input.signal
              ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
              : AbortSignal.timeout(timeoutMs);
            const response = await fetcher(source, { signal });
            if (!response.ok) throw new Error(`Bulk lookup HTTP ${response.status}`);
            const body = (await response.json()) as { results?: unknown };
            if (!Array.isArray(body.results))
              throw new Error('Bulk lookup response.results is not an array');
            const metadata = transportSources.get(response)!;
            const byId = new Map<string, Record<string, any>>();
            const ambiguousIds = new Set<string>();
            for (const row of body.results) {
              if (!row || typeof row !== 'object' || !ids.includes(String(row.trackId))) continue;
              if (row.kind !== 'software' && row.wrapperType !== 'software') continue;
              const rowId = String(row.trackId);
              if (byId.has(rowId)) ambiguousIds.add(rowId);
              byId.set(rowId, row);
            }
            for (const id of ids) {
              const row = byId.get(id);
              const rowKey = cacheKey(input.batchId, input.country, input.language, id);
              if (!row) continue;
              if (ambiguousIds.has(id)) {
                bulkAttempted.set(rowKey, 'bulk-duplicate-id-use-app-fallback');
                continue;
              }
              if (
                ![row.screenshotUrls, row.ipadScreenshotUrls, row.appletvScreenshotUrls].some(
                  (value) => Array.isArray(value) && value.length > 0,
                )
              ) {
                bulkAttempted.set(rowKey, 'bulk-no-screenshots-use-app-fallback');
                continue;
              }
              try {
                // Reuse the maintained library's public app mapper on this one immutable lookup row.
                // This is an in-memory projection only; it never writes a fictional HTTP observation.
                const projected = await apple.app({
                  id: Number(id),
                  country: input.country,
                  lang: 'en_us',
                  requestOptions: {
                    fetch: async (url) => {
                      const parsed = new URL(url instanceof Request ? url.url : String(url));
                      if (
                        parsed.hostname !== 'itunes.apple.com' ||
                        parsed.pathname !== '/lookup' ||
                        parsed.searchParams.get('id') !== id
                      )
                        throw new Error(
                          'Bulk row requires an additional app request; use normal fallback',
                        );
                      return Response.json({ resultCount: 1, results: [row] });
                    },
                  },
                });
                const provenance: ScanDetailResult['provenance'] = {
                  method: 'bulk-lookup',
                  batchId: input.batchId,
                  country: input.country,
                  language: 'en_us',
                  source,
                  httpId: metadata.httpId,
                };
                const data = normalizeApp(
                  {
                    ...projected,
                    sellerName: row.sellerName ?? null,
                    sellerUrl: row.sellerUrl ?? null,
                    _appeyeLookupRecord: row,
                    _appeyeBulkSource: { ...provenance, fetchedAt: metadata.record.fetchedAt },
                  },
                  'app-store',
                );
                bulkCache.set(rowKey, { data, observedAt: metadata.record.fetchedAt, provenance });
              } catch (error) {
                bulkAttempted.set(
                  rowKey,
                  `bulk-projection-failed: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }
          } catch (error) {
            input.signal?.throwIfAborted();
            for (const id of ids)
              bulkAttempted.set(
                cacheKey(input.batchId, input.country, input.language, id),
                `bulk-lookup-failed: ${error instanceof Error ? error.message : String(error)}`,
              );
          }
        }
      }
      const cached = bulkCache.get(key);
      if (cached) {
        bulkCache.delete(key);
        return cached;
      }
      const data = await individualApp(input);
      return {
        data,
        observedAt: new Date().toISOString(),
        provenance: {
          method: 'individual',
          batchId: input.batchId,
          country: input.country,
          language: 'en_us',
          source: `https://itunes.apple.com/lookup?${new URLSearchParams({ id: input.externalId, country: input.country, entity: 'software', lang: 'en_us' })}`,
          fallbackReason: bulkAttempted.get(key) ?? 'not-eligible-for-bulk',
        },
      };
    };
    return {
      app: individualApp,
      ...(store === 'app-store' &&
      appleBatchSize > 0 &&
      (!options.appStoreClient || options.fetchImpl)
        ? { appWithPeers }
        : {}),
      async enrich(input) {
        if (input.kind !== 'developer' || !client.developer)
          return details[store].enrich!({
            ...input,
            language: store === 'app-store' ? 'en_us' : input.language,
          });
        if (!input.developerId) throw new Error('应用详情缺少开发者 ID，未发起开发者目录请求');
        const warnings: unknown[] = [];
        const compatibility: unknown[] = [];
        const devId =
          store === 'google-play' ? decodeGoogleDeveloperId(input.developerId) : input.developerId;
        const verifiedDeveloperUrl =
          store === 'google-play'
            ? googleDeveloperRequestUrl(input.developerUrl, devId, input.country, input.language)
            : null;
        const developerFetch: typeof fetch = async (url, init) => {
          const originalRequest = url instanceof Request ? url : undefined;
          const expanded = new URL(originalRequest?.url ?? String(url));
          if (
            verifiedDeveloperUrl &&
            expanded.origin === 'https://play.google.com' &&
            !expanded.username &&
            !expanded.password &&
            ['/store/apps/dev', '/store/apps/developer'].includes(expanded.pathname) &&
            expanded.searchParams.getAll('id').length === 1 &&
            expanded.searchParams.get('id') === devId
          ) {
            const verified = new URL(verifiedDeveloperUrl);
            expanded.pathname = verified.pathname;
            expanded.searchParams.set('gl', input.country);
            expanded.searchParams.set('hl', input.language);
          }
          if (
            store === 'app-store' &&
            expanded.hostname === 'itunes.apple.com' &&
            expanded.pathname === '/lookup'
          )
            expanded.searchParams.set('limit', '200');
          const response = await fetcher(
            originalRequest ? new Request(expanded, originalRequest) : expanded.toString(),
            init,
          );
          if (
            store === 'google-play' &&
            response.ok &&
            expanded.hostname === 'play.google.com' &&
            expanded.pathname.endsWith('/batchexecute') &&
            expanded.searchParams.get('rpcids') === 'qnKhOb'
          ) {
            const originalBody = await response.clone().text();
            const normalized = normalizeDeveloperContinuation(originalBody);
            if (normalized.adaptation) {
              const metadata = transportSources.get(response);
              compatibility.push({
                ...normalized.adaptation,
                sourceHttpId: metadata?.httpId ?? null,
                sourceFetchedAt: metadata?.record.fetchedAt ?? null,
                originalHttpPreserved: true,
              });
              // The persisted response remains Google's original bytes; only the SDK input is adapted.
              return new Response(normalized.body, {
                status: response.status,
                statusText: response.statusText,
                headers: { 'content-type': 'application/json; charset=utf-8' },
              });
            }
          }
          return response;
        };
        const raw = await client.developer({
          ...context(input),
          devId,
          num: Number.MAX_SAFE_INTEGER,
          fullDetail: false,
          onDegradation: (event: unknown) => warnings.push(event),
          onIntegrityEvent: (event: unknown) => warnings.push(event),
          requestOptions:
            store === 'google-play'
              ? { timeoutMs, retries: 0, signal: input.signal, fetchImpl: developerFetch }
              : { timeout: timeoutMs, retries: 0, signal: input.signal, fetch: developerFetch },
        });
        const provenance = enrichmentContext(store, input);
        return {
          ...provenance,
          ...(verifiedDeveloperUrl ? { source: verifiedDeveloperUrl } : {}),
          ...(store === 'app-store' ? { source: `${provenance.source}&limit=200&lang=en_us` } : {}),
          status: hasEnrichmentData(raw) ? 'available' : 'empty',
          data: raw,
          raw: {
            data: raw,
            warnings,
            compatibility,
            ...(verifiedDeveloperUrl
              ? {
                  routing: {
                    method: 'verified-listing-link',
                    source: verifiedDeveloperUrl,
                    listingSourceHttpId: input.developerSourceHttpId ?? null,
                    developerId: devId,
                  },
                }
              : {}),
          },
          note: `${provenance.note} ${store === 'google-play' ? `目录沿公开游标尝试续页；无本地20项截断，异常/令牌循环会记录 warnings，存在告警时不视为完整目录。${verifiedDeveloperUrl ? ' 目录路径取自本批次已保存应用详情中的同ID官方链接。' : ' 未取得可靠的同ID listing 目录链接；沿用库默认路径选择，404不能单独证明开发者目录已下架。'}` : '开发者 lookup 明确请求 limit=200；来源不提供外部续页游标，不能证明覆盖开发者全部产品。'}${warnings.length ? ` ${warnings.length} 条采集完整性告警。` : ''}${compatibility.length ? ` ${compatibility.length} 次已校验的续页布局适配；真实原HTTP保留，转换仅作为库的解析输入。` : ''}`,
        };
      },
      async list(input) {
        const raw = await client.list({
          ...context(input),
          collection: input.collection as any,
          category: store === 'google-play' ? 'FINANCE' : 6015,
          num: store === 'google-play' ? 500 : 200,
          fullDetail: false,
        });
        if (!Array.isArray(raw)) throw new Error('Finance chart response is not an array');
        return {
          data: raw.map((row) => normalizeApp(row, store)),
          raw,
          requestLanguage: store === 'google-play' ? input.language : null,
          source:
            store === 'google-play'
              ? `https://play.google.com/store/apps/category/FINANCE?gl=${input.country}&hl=${input.language}&collection=${input.collection}`
              : `https://itunes.apple.com/${input.country}/rss/${input.collection}/genre=6015/limit=200/json`,
          stopReason: 'chart-interface-no-pagination',
        };
      },
      async search(input) {
        const warnings: unknown[] = [];
        const raw = await client.search({
          ...context(input),
          term: input.keyword,
          num: store === 'google-play' ? 250 : 50,
          page: input.page,
          fullDetail: false,
          onDegradation: (e: unknown) => warnings.push(e),
          onIntegrityEvent: (e: unknown) => warnings.push(e),
        });
        if (!Array.isArray(raw)) throw new Error('Search response is not an array');
        return {
          data: raw.map((row) => normalizeApp(row, store)),
          raw,
          warnings,
          requestLanguage: store === 'google-play' ? input.language : 'en_us',
          source:
            store === 'google-play'
              ? `https://play.google.com/store/search?${new URLSearchParams({ q: input.keyword, c: 'apps', gl: input.country, hl: input.language })}`
              : `https://itunes.apple.com/search?${new URLSearchParams({ term: input.keyword, country: input.country, media: 'software', entity: 'software', limit: String(input.page * 50), lang: 'en_us' })}`,
          ...(store === 'google-play'
            ? { stopReason: warnings.length ? 'search-degraded' : 'search-interface-250-limit' }
            : {}),
        };
      },
      async reviewsPage(input) {
        const appleSource = `https://itunes.apple.com/${input.country}/rss/customerreviews/page=${input.page}/id=${input.externalId}/sortby=${apple.sort.RECENT}/xml`;
        let sourceValidationError: ReviewSourceValidationError | undefined;
        const reviewFetch: typeof fetch = async (requestInput, init) => {
          const request = requestInput instanceof Request ? requestInput : undefined;
          const url = new URL(request?.url ?? String(requestInput));
          let googleReviewRequest = false;
          if (
            store === 'google-play' &&
            url.origin === 'https://play.google.com' &&
            url.pathname === '/_/PlayStoreUi/data/batchexecute'
          ) {
            // The SDK's URL names qnKhOb, while its actual review request uses UsvDTd.
            // Inspect a clone so request streams and the original HTTP record stay intact.
            const body = init?.body ?? (request ? await request.clone().text() : undefined);
            if (typeof body === 'string' || body instanceof URLSearchParams) {
              try {
                const batches: unknown = JSON.parse(
                  new URLSearchParams(body).get('f.req') ?? 'null',
                );
                googleReviewRequest =
                  Array.isArray(batches) &&
                  batches.some(
                    (batch) =>
                      Array.isArray(batch) &&
                      batch.some((rpc) => Array.isArray(rpc) && rpc[0] === 'UsvDTd'),
                  );
              } catch {
                // Request validation remains with the SDK; do not attribute unrelated RPCs.
              }
            }
          }
          const response = await fetcher(requestInput, init);
          // fetcher has durably journaled the original body before any source validation.
          // Keep semantic errors outside its transport catch so HTTP200 remains HTTP200.
          if (response.ok) {
            const body =
              transportSources.get(response)?.record.body ?? (await response.clone().text());
            try {
              if (googleReviewRequest) validateGoogleReviewResponse(body);
              if (store === 'app-store' && url.href === appleSource)
                validateAppleReviewResponse(body);
            } catch (error) {
              if (error instanceof ReviewSourceValidationError) sourceValidationError = error;
              throw error;
            }
          }
          return response;
        };
        const raw = await client
          .reviews({
            ...context(input),
            requestOptions:
              store === 'google-play'
                ? { timeoutMs, retries: 0, signal: input.signal, fetchImpl: reviewFetch }
                : { timeout: timeoutMs, retries: 0, signal: input.signal, fetch: reviewFetch },
            ...(store === 'google-play'
              ? {
                  appId: input.externalId,
                  sort: googlePlay.sort.NEWEST,
                  paginate: true,
                  ...(input.cursor ? { nextPaginationToken: input.cursor } : {}),
                }
              : { id: input.externalId, sort: apple.sort.RECENT, page: input.page }),
          })
          .catch((error: unknown) => {
            // Both SDKs can wrap fetch exceptions as generic network failures. Preserve
            // our known semantic failure so the task ledger distinguishes a bad source.
            throw sourceValidationError ?? error;
          });
        const rows = store === 'google-play' ? raw?.data : raw;
        if (!Array.isArray(rows)) throw new Error('Reviews response is not an array');
        return {
          data: rows.map((row) =>
            normalizeReview(row, store === 'google-play' ? input.language : 'und'),
          ),
          raw,
          source:
            store === 'google-play'
              ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(input.externalId)}&gl=${input.country}&hl=${input.language}`
              : appleSource,
          nextCursor: store === 'google-play' ? (raw.nextPaginationToken ?? null) : null,
        };
      },
    };
  }
  return { 'google-play': adapter('google-play'), 'app-store': adapter('app-store') };
}

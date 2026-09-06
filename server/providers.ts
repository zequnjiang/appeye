import googlePlay from '@mradex77/google-play-scraper';
import * as appStore from '@perttu/app-store-scraper';
import { setTimeout as sleep } from 'node:timers/promises';
import { normalizeApp, normalizeReview } from './normalization.js';
import type {
  EnrichmentContext,
  EnrichmentKind,
  ProviderContext,
  Providers,
  StoreName,
} from './types.js';
export { normalizeApp, normalizeReview } from './normalization.js';

// A narrow injection boundary keeps adapter tests independent from the network and upstream typings.
export interface ScraperClient {
  app(options: any): Promise<any>;
  search(options: any): Promise<any>;
  reviews(options: any): Promise<any>;
  permissions?(options: any): Promise<any>;
  dataSafety?(options: any): Promise<any>;
  privacy?(options: any): Promise<any>;
  versionHistory?(options: any): Promise<any>;
  inAppPurchases?(options: any): Promise<any>;
  ratings?(options: any): Promise<any>;
  developer?(options: any): Promise<any>;
}
export interface ProviderOptions {
  timeoutMs?: number;
  searchLimit?: number;
  reviewLimit?: number;
  requestDelayMs?: number;
  fetchImpl?: typeof fetch;
  googlePlayClient?: ScraperClient;
  appStoreClient?: ScraperClient;
}
function googleDeveloperId(value: string): string {
  // App details expose the developer URL query value; URLSearchParams in the new client encodes it again.
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}
export function enrichmentContext(
  store: StoreName,
  input: ProviderContext & {
    externalId: string;
    kind: EnrichmentKind;
    developerId?: string | null;
  },
): EnrichmentContext {
  let source =
    store === 'google-play'
      ? `https://play.google.com/store/apps/${input.kind === 'dataSafety' ? 'datasafety' : 'details'}?id=${encodeURIComponent(input.externalId)}&hl=${encodeURIComponent(input.language)}${input.kind === 'dataSafety' ? '' : `&gl=${input.country}`}`
      : `https://apps.apple.com/${input.country}/app/id${encodeURIComponent(input.externalId)}`;
  if (input.kind === 'developer' && input.developerId) {
    const developerId =
      store === 'google-play' ? googleDeveloperId(input.developerId) : input.developerId;
    source =
      store === 'google-play'
        ? `https://play.google.com/store/apps/${/^\d+$/.test(developerId) ? 'dev' : 'developer'}?${new URLSearchParams({ id: developerId, gl: input.country, hl: input.language })}`
        : `https://itunes.apple.com/lookup?${new URLSearchParams({ id: developerId, entity: 'software', country: input.country })}`;
  } else if (store === 'app-store' && input.kind === 'ratings') {
    source = `https://itunes.apple.com/${input.country}/customer-reviews/id${input.externalId}?displayable-kind=11`;
  }
  return {
    source,
    requestCountry: store === 'google-play' && input.kind === 'dataSafety' ? null : input.country,
    requestLanguage: store === 'app-store' ? null : input.language,
    note:
      input.kind === 'permissions'
        ? '商店声明/返回的权限；不是用户实际授权，也不是 APK Manifest 或运行时权限审计。'
        : store === 'google-play' && input.kind === 'dataSafety'
          ? 'Google Play 商店披露；此接口不发送国家参数，不能视为所选国家独有的数据安全声明。'
          : '商店返回的披露或历史样本；空结果不证明没有相关数据，未进行设备权限或实际行为审计。',
  };
}
export function hasEnrichmentData(value: unknown): boolean {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object')
    return Object.values(value as Record<string, unknown>).some(hasEnrichmentData);
  return true;
}
export function createProviders(options: ProviderOptions = {}): Providers {
  const gp = options.googlePlayClient ?? googlePlay;
  const apple = options.appStoreClient ?? appStore;
  const timeout = Math.min(options.timeoutMs ?? 25000, 120000);
  const searchLimit = options.searchLimit ?? 20;
  const transport = options.fetchImpl ?? globalThis.fetch;
  let lastHttpStart = 0;
  let httpQueue: Promise<unknown> = Promise.resolve();
  const pacedFetch: typeof fetch = (input, init) => {
    const pending = httpQueue.then(async () => {
      init?.signal?.throwIfAborted();
      const wait = Math.max(0, (options.requestDelayMs ?? 1500) - (Date.now() - lastHttpStart));
      if (wait) await sleep(wait, undefined, { signal: init?.signal ?? undefined });
      init?.signal?.throwIfAborted();
      lastHttpStart = Date.now();
      return transport(input, init);
    });
    httpQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  const requestOptions = (
    store: StoreName,
    signal?: AbortSignal,
    fetcher: typeof fetch = pacedFetch,
  ) =>
    store === 'google-play'
      ? { timeoutMs: timeout, retries: 0, signal, fetchImpl: fetcher }
      : { timeout, retries: 0, signal, fetch: fetcher };
  const common = (store: StoreName, input: ProviderContext) => ({
    country: input.country,
    lang: input.language,
    requestOptions: requestOptions(store, input.signal),
  });
  const adapter = (store: StoreName, client: ScraperClient) => ({
    async search(input: ProviderContext & { keyword: string }) {
      const rows = await client.search({
        ...common(store, input),
        term: input.keyword,
        num: searchLimit,
        ...(store === 'google-play' ? { fullDetail: false } : { page: 1 }),
      });
      if (!Array.isArray(rows)) throw new Error('商店搜索返回的结构不是应用列表');
      return rows.map((row) => normalizeApp(row, store));
    },
    async app(input: ProviderContext & { externalId: string }) {
      // Preserve original iTunes JSON fields (including sellerName) that the library's typed projection omits.
      const responses: { url: string; status: number; body: unknown }[] = [];
      const capturingFetch: typeof fetch = async (url, init) => {
        const response = await pacedFetch(url, init);
        if (
          store === 'app-store' &&
          (response.headers.get('content-type')?.includes('json') ||
            /itunes\.apple\.com\/(lookup|search)\?/.test(String(url)))
        ) {
          const body = await response
            .clone()
            .json()
            .catch(() => null);
          if (body !== null) responses.push({ url: String(url), status: response.status, body });
        }
        return response;
      };
      const result = await client.app({
        ...common(store, input),
        ...(store === 'google-play' ? { appId: input.externalId } : { id: input.externalId }),
        requestOptions: requestOptions(store, input.signal, capturingFetch),
      });
      let raw = result;
      if (responses.length) {
        const records = responses.flatMap((response) =>
          Array.isArray((response.body as any)?.results) ? (response.body as any).results : [],
        );
        const original = records.find((record) => String(record.trackId) === input.externalId);
        raw = {
          ...result,
          ...(original?.sellerName ? { sellerName: original.sellerName } : {}),
          ...(original?.sellerUrl ? { sellerUrl: original.sellerUrl } : {}),
          _appeyeTransport: responses,
        };
      }
      return normalizeApp(raw, store);
    },
    async reviews(input: ProviderContext & { externalId: string }) {
      const result = await client.reviews({
        ...common(store, input),
        ...(store === 'google-play'
          ? {
              appId: input.externalId,
              num: options.reviewLimit ?? 100,
              sort: googlePlay.sort.NEWEST,
            }
          : { id: input.externalId, page: 1, sort: appStore.sort.RECENT }),
      });
      const rows = Array.isArray(result) ? result : result?.data;
      if (!Array.isArray(rows)) throw new Error('商店评论返回的结构不是评论列表');
      return rows.map((row) =>
        normalizeReview(row, store === 'google-play' ? input.language : 'und'),
      );
    },
    async enrich(
      input: ProviderContext & {
        externalId: string;
        kind: EnrichmentKind;
        developerId?: string | null;
      },
    ) {
      const context = enrichmentContext(store, input);
      const supported =
        store === 'google-play'
          ? ['permissions', 'dataSafety', 'developer']
          : ['privacy', 'versionHistory', 'inAppPurchases', 'ratings', 'developer'];
      const method = client[input.kind];
      if (!supported.includes(input.kind) || typeof method !== 'function')
        return {
          ...context,
          status: 'unsupported' as const,
          data: null,
          raw: null,
          note: `${context.note} 当前商店适配器不支持 ${input.kind}。`,
        };
      if (input.kind === 'developer' && !input.developerId)
        throw new Error('应用详情缺少开发者 ID，未发起开发者目录请求');
      const result = await method.call(client, {
        ...common(store, input),
        ...(input.kind === 'developer'
          ? {
              devId:
                store === 'google-play' ? googleDeveloperId(input.developerId!) : input.developerId,
              num: 20,
              fullDetail: false,
            }
          : store === 'google-play'
            ? { appId: input.externalId }
            : { id: input.externalId }),
      });
      return {
        ...context,
        status: hasEnrichmentData(result) ? ('available' as const) : ('empty' as const),
        data: result ?? null,
        raw: result ?? null,
      };
    },
  });
  return { 'google-play': adapter('google-play', gp), 'app-store': adapter('app-store', apple) };
}

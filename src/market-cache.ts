import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, ApiError, query } from './api';
import type { LibraryQuery, MarketPage } from './research-types';
export interface MarketState {
  data: MarketPage | null;
  pending: boolean;
  expired: boolean;
  loading: boolean;
  error: string | null;
}
interface Entry {
  state: MarketState;
  listeners: Set<() => void>;
  controller: AbortController | null;
  generation: number;
  query: LibraryQuery;
}
const entries = new Map<string, Entry>();
let scope = '';
const initial = (): MarketState => ({
  data: null,
  pending: false,
  expired: false,
  loading: false,
  error: null,
});
export function setMarketScope(next: string) {
  if (next !== scope) {
    clearMarketCache();
    scope = next;
  }
}
export function clearMarketCache() {
  for (const e of entries.values()) {
    e.generation++;
    e.controller?.abort();
  }
  entries.clear();
}
export function marketKey(q: LibraryQuery) {
  return `${scope}:${JSON.stringify(q)}`;
}
function entry(q: LibraryQuery) {
  const key = marketKey(q);
  let e = entries.get(key);
  if (!e) {
    e = {
      state: initial(),
      listeners: new Set(),
      controller: null,
      generation: 0,
      query: { ...q },
    };
    entries.set(key, e);
  } else {
    entries.delete(key);
    entries.set(key, e);
  }
  while (entries.size > 20) {
    const victim = [...entries].find(([k, v]) => k !== key && !v.listeners.size);
    if (!victim) break;
    victim[1].controller?.abort();
    victim[1].generation++;
    entries.delete(victim[0]);
  }
  return e;
}
function publish(e: Entry, patch: Partial<MarketState>) {
  e.state = { ...e.state, ...patch };
  e.listeners.forEach((fn) => fn());
}
export function revokeMarketScope(message: string) {
  // Notifications can synchronously re-read and touch the LRU Map. Freeze this traversal.
  for (const e of [...entries.values()]) {
    e.generation++;
    e.controller?.abort();
    e.controller = null;
    publish(e, { data: null, pending: true, expired: true, loading: false, error: message });
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('appeye:public-scope-revoked'));
}
export function expireMarketSnapshot(q: LibraryQuery, message: string) {
  publish(entry(q), { expired: true, pending: true, error: message });
}
export async function loadMarket(
  q: LibraryQuery,
  options: { fresh?: boolean; offset?: number; probe?: boolean } = {},
) {
  const e = entry(q);
  if (e.controller) {
    if (options.probe || (!options.fresh && options.offset === undefined)) return;
    e.controller.abort();
  }
  if (options.probe && !e.state.data) return;
  const controller = new AbortController();
  e.controller = controller;
  const generation = ++e.generation;
  const current = e.state.data;
  if (!options.probe) publish(e, { loading: true, error: null });
  const params = {
    ...q,
    limit: 20,
    offset: options.offset ?? current?.offset ?? 0,
    ...(!options.fresh && current ? { snapshot: current.snapshot } : {}),
    ...(options.probe ? { probe: 1 } : {}),
  };
  try {
    const data = await api<MarketPage | { changed: boolean; revision: string }>(
      '/market/apps' + query(params),
      { signal: controller.signal },
    );
    if (controller.signal.aborted || generation !== e.generation) return;
    if ('changed' in data) publish(e, { pending: data.changed, error: null });
    else
      publish(e, {
        data,
        pending: options.fresh ? false : e.state.pending,
        expired: false,
        error: null,
      });
  } catch (error) {
    if (controller.signal.aborted || generation !== e.generation) return;
    if (error instanceof ApiError && error.code === 'SNAPSHOT_SCOPE_REVOKED') {
      revokeMarketScope(error.message);
      return;
    }
    const expired = error instanceof ApiError && error.status === 410;
    publish(e, {
      error: (error as Error).message,
      ...(expired ? { expired: true, pending: true } : {}),
    });
  } finally {
    if (generation === e.generation) {
      e.controller = null;
      if (!options.probe) publish(e, { loading: false });
    }
  }
}
export function useMarket(q: LibraryQuery) {
  const key = marketKey(q);
  const subscribe = useCallback(
    (listener: () => void) => {
      const e = entry(q);
      e.listeners.add(listener);
      return () => {
        e.listeners.delete(listener);
        queueMicrotask(() => {
          if (!e.listeners.size) {
            e.generation++;
            e.controller?.abort();
            e.controller = null;
            if (e.state.loading) publish(e, { loading: false });
          }
        });
      };
    },
    [key],
  );
  const read = useCallback(() => entry(q).state, [key]);
  const state = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    const tick = () => {
      const state = entry(q).state;
      if (!document.hidden && !(state.expired && !state.data))
        void loadMarket(q, state.data ? { probe: true } : {});
    };
    tick();
    const timer = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [key]);
  return {
    ...state,
    refresh: () => loadMarket(q, { fresh: true }),
    page: (offset: number) => loadMarket(q, { offset }),
  };
}

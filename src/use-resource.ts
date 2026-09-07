import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api';
import { createQueryCache } from './query-cache';

export const sessionQueries = createQueryCache({
  fetcher: (key, signal) => api(key, { signal }),
  capacity: 20,
  stageUpdates: (key) => /^\/apps\?/.test(key),
});
export function useResource<T>(path: string, version = 0) {
  const subscribe = useCallback(
    (listener: () => void) => sessionQueries.subscribe(path, listener),
    [path],
  );
  const read = useCallback(() => sessionQueries.read<T>(path), [path]);
  const state = useSyncExternalStore(subscribe, read, read);
  const previous = useRef<{ path: string; version: number } | null>(null);
  useEffect(() => {
    const explicitlyRefreshed =
      previous.current?.path === path && previous.current.version !== version;
    previous.current = { path, version };
    const refresh = () => {
      if (!document.hidden) void sessionQueries.fetch(path);
    };
    if (!document.hidden) void sessionQueries.fetch(path, { apply: explicitlyRefreshed });
    const timer = window.setInterval(refresh, 15000);
    const visibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [path, version]);
  return {
    data: state.data,
    error: state.error,
    loading: state.fetching || (!state.data && !state.error),
    refreshing: state.fetching && state.data !== null,
    updatedAt: state.updatedAt,
    hasPending: state.hasPending,
    displayedAt: state.displayedAt,
  };
}

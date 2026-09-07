import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { createQueryCache } from './query-cache';

export const sessionQueries = createQueryCache({
  fetcher: (key, signal) => api(key, { signal }),
  capacity: 20,
});
export function useResource<T>(path: string, version = 0) {
  const subscribe = useCallback(
    (listener: () => void) => sessionQueries.subscribe(path, listener),
    [path],
  );
  const read = useCallback(() => sessionQueries.read<T>(path), [path]);
  const state = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void sessionQueries.fetch(path);
    };
    refresh();
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
  };
}

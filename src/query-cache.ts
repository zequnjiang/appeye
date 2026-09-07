export interface QuerySnapshot<T = unknown> {
  data: T | null;
  pendingData: T | null;
  hasPending: boolean;
  error: string;
  fetching: boolean;
  updatedAt: number | null;
  displayedAt: number | null;
}
const EMPTY: QuerySnapshot = Object.freeze({
  data: null,
  pendingData: null,
  hasPending: false,
  error: '',
  fetching: false,
  updatedAt: null,
  displayedAt: null,
});
type Entry = {
  state: QuerySnapshot;
  controller?: AbortController;
  promise?: Promise<void>;
  request: number;
  applyNext: boolean;
};
/** JSON payload equality ignores object key order while preserving array order. */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameJsonValue(value, b[index]))
    );
  const left = Object.keys(a),
    right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        sameJsonValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}
/** A bounded, memory-only cache. No data survives a session reset. */
export function createQueryCache(options: {
  fetcher: (key: string, signal: AbortSignal) => Promise<unknown>;
  capacity?: number;
  now?: () => number;
  stageUpdates?: (key: string) => boolean;
}) {
  const capacity = options.capacity ?? 20;
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid cache capacity');
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  let generation = 0;
  const notify = (key: string) => listeners.get(key)?.forEach((fn) => fn());
  const touch = (key: string, entry: Entry) => {
    entries.delete(key);
    entries.set(key, entry);
  };
  function cancel(entry: Entry) {
    entry.request++;
    entry.controller?.abort();
    entry.controller = undefined;
    entry.promise = undefined;
    entry.applyNext = false;
    if (entry.state.fetching) entry.state = { ...entry.state, fetching: false };
  }
  function ensure(key: string) {
    let entry = entries.get(key);
    if (entry) {
      touch(key, entry);
      return entry;
    }
    while (entries.size >= capacity) {
      const oldest =
        [...entries.keys()].find((k) => !listeners.get(k)?.size) ?? entries.keys().next().value!;
      cancel(entries.get(oldest)!);
      entries.delete(oldest);
      notify(oldest);
    }
    entry = { state: EMPTY, request: 0, applyNext: false };
    entries.set(key, entry);
    return entry;
  }
  return {
    read<T>(key: string): QuerySnapshot<T> {
      return (entries.get(key)?.state ?? EMPTY) as QuerySnapshot<T>;
    },
    keys() {
      return [...entries.keys()];
    },
    subscribe(key: string, listener: () => void) {
      let group = listeners.get(key);
      if (!group) listeners.set(key, (group = new Set()));
      group.add(listener);
      return () => {
        group!.delete(listener);
        // React strict-mode immediately resubscribes; defer cancellation until that
        // lifecycle has settled, while still canceling a genuinely abandoned query.
        queueMicrotask(() => {
          if (!listeners.get(key)?.size) {
            const entry = entries.get(key);
            if (entry) cancel(entry);
            listeners.delete(key);
          }
        });
      };
    },
    applyPending(key: string): boolean {
      const entry = entries.get(key);
      if (!entry?.state.hasPending) return false;
      entry.state = {
        ...entry.state,
        data: entry.state.pendingData,
        pendingData: null,
        hasPending: false,
        displayedAt: (options.now ?? Date.now)(),
      };
      notify(key);
      return true;
    },
    fetch(key: string, requestOptions: { apply?: boolean } = {}): Promise<void> {
      const entry = ensure(key);
      if (requestOptions.apply) entry.applyNext = true;
      if (entry.promise) return entry.promise;
      const controller = new AbortController();
      entry.controller = controller;
      const request = ++entry.request,
        session = generation;
      const current = () =>
        generation === session &&
        entries.get(key) === entry &&
        entry.request === request &&
        !controller.signal.aborted;
      entry.state = { ...entry.state, fetching: true, error: '' };
      notify(key);
      const promise = Promise.resolve()
        .then(() => options.fetcher(key, controller.signal))
        .then((data) => {
          if (!current()) return;
          const equal = sameJsonValue(entry.state.data, data);
          const apply =
            !options.stageUpdates?.(key) || entry.state.data === null || entry.applyNext;
          entry.state = {
            data: apply && !equal ? data : entry.state.data,
            pendingData: !apply && !equal ? data : null,
            hasPending: !apply && !equal,
            error: '',
            fetching: true,
            updatedAt: (options.now ?? Date.now)(),
            displayedAt: apply ? (options.now ?? Date.now)() : entry.state.displayedAt,
          };
        })
        .catch((error) => {
          if (current() && error?.name !== 'AbortError')
            entry.state = {
              ...entry.state,
              error: error instanceof Error ? error.message : String(error),
            };
        })
        .finally(() => {
          if (!current()) return;
          entry.controller = undefined;
          entry.promise = undefined;
          entry.applyNext = false;
          entry.state = { ...entry.state, fetching: false };
          notify(key);
        });
      entry.promise = promise;
      return promise;
    },
    clear() {
      generation++;
      for (const entry of entries.values()) cancel(entry);
      entries.clear();
      for (const key of listeners.keys()) notify(key);
    },
  };
}
export type QueryCache = ReturnType<typeof createQueryCache>;

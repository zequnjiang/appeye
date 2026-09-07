export interface LibraryReading {
  queryKey: string;
  region: 'controls' | 'rows';
  scrollY: number;
  rows: Array<{ id: string; top: number }>;
  anchorId: string | null;
  focusKey: string | null;
  restoreFocus: boolean;
}
/** Capture IDs and viewport positions, not just an absolute scroll offset. */
export function captureLibraryReading(queryKey: string, restoreFocus = false): LibraryReading {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-library-row]')];
  const headerBottom = Math.max(
    0,
    document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0,
  );
  const tableTop = document.querySelector('[data-library-table]')?.getBoundingClientRect().top;
  // While controls or the table heading remain below the viewport edge,
  // preserve the page position rather than an application further down it.
  const region = tableTop === undefined || tableTop >= headerBottom ? 'controls' : 'rows';
  const first = rows.find(
    (row) =>
      row.getBoundingClientRect().bottom > headerBottom &&
      row.getBoundingClientRect().top < innerHeight,
  );
  return {
    queryKey,
    region,
    scrollY: window.scrollY,
    rows: rows.map((row) => ({
      id: row.dataset.libraryRow!,
      top: row.getBoundingClientRect().top,
    })),
    anchorId: first?.dataset.libraryRow ?? null,
    focusKey: (document.activeElement as HTMLElement | null)?.dataset.focusKey ?? null,
    restoreFocus,
  };
}
export function restoreLibraryReading(saved: LibraryReading) {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-library-row]')];
  const index = saved.rows.findIndex((row) => row.id === saved.anchorId);
  const choices = saved.rows
    .map((row, i) => ({ ...row, index: i, distance: Math.abs(i - Math.max(0, index)) }))
    .sort((a, b) => a.distance - b.distance || b.index - a.index);
  const candidate = saved.anchorId
    ? choices.find((old) => rows.some((row) => row.dataset.libraryRow === old.id))
    : undefined;
  const target = candidate && rows.find((row) => row.dataset.libraryRow === candidate.id);
  if (saved.region === 'controls') {
    if (Math.abs(window.scrollY - saved.scrollY) > 0.5)
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
  } else if (target && candidate) {
    const delta = target.getBoundingClientRect().top - candidate.top;
    if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
  } else if (saved.anchorId) {
    const table = document.querySelector('[data-library-table]');
    if (table && Math.abs(table.getBoundingClientRect().top) > 0.5)
      table.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  const focused = document.activeElement;
  const mayRestoreFocus = saved.restoreFocus || !focused || focused === document.body;
  if (mayRestoreFocus && saved.focusKey) {
    const exact = [...document.querySelectorAll<HTMLElement>('[data-focus-key]')].find(
      (node) => node.dataset.focusKey === saved.focusKey,
    );
    (exact ?? target?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }
}

export interface LibraryReading {
  queryKey: string;
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
  const first = rows.find(
    (row) =>
      row.getBoundingClientRect().bottom > headerBottom &&
      row.getBoundingClientRect().top < innerHeight,
  );
  return {
    queryKey,
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
  if (target && candidate)
    window.scrollBy({
      top: target.getBoundingClientRect().top - candidate.top,
      behavior: 'instant',
    });
  else if (saved.anchorId)
    document
      .querySelector('[data-library-table]')
      ?.scrollIntoView({ block: 'start', behavior: 'instant' });
  const focused = document.activeElement;
  const mayRestoreFocus = saved.restoreFocus || !focused || focused === document.body;
  if (mayRestoreFocus && saved.focusKey) {
    const exact = [...document.querySelectorAll<HTMLElement>('[data-focus-key]')].find(
      (node) => node.dataset.focusKey === saved.focusKey,
    );
    (exact ?? target?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }
}

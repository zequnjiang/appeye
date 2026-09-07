/** Parse calendar-only Play dates without borrowing the host timezone or inventing a time. */
const months = new Map<string, { month: number; buddhist: boolean }>();
const monthKey = (value: string) => value.toLocaleLowerCase('en-US').replace(/\./g, '');
for (const locale of ['en-US', 'es-MX', 'es-AR', 'id-ID', 'th-TH']) {
  for (const width of ['short', 'long'] as const) {
    const formatter = new Intl.DateTimeFormat(locale, { month: width, timeZone: 'UTC' });
    for (let month = 1; month <= 12; month++) {
      const name = formatter.format(new Date(Date.UTC(2020, month - 1, 15)));
      months.set(monthKey(name), { month, buddhist: locale === 'th-TH' });
    }
  }
}
// Both forms occur in Spanish/English store listings and differ between ICU versions.
months.set('sep', { month: 9, buddhist: false });
months.set('sept', { month: 9, buddhist: false });

function calendarDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return null;
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function parseStoreReleaseDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const tokens = value.replace(/,/g, ' ').split(/\s+/);
  if (tokens.length !== 3 || !/^\d{4}$/.test(tokens[2]!)) return null;
  const dayFirst = /^\d{1,2}$/.test(tokens[0]!);
  const dayToken = tokens[dayFirst ? 0 : 1]!;
  const monthToken = tokens[dayFirst ? 1 : 0]!;
  if (!/^\d{1,2}$/.test(dayToken)) return null;
  const month = months.get(monthKey(monthToken));
  if (!month) return null;
  const year = Number(tokens[2]) - (month.buddhist ? 543 : 0);
  return calendarDate(year, month.month, Number(dayToken));
}

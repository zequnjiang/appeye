/** Only Google Play listing evidence may override the SDK's numeric-ID path heuristic. */
export function decodeGoogleDeveloperId(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function matchingDirectory(value: string, developerId: string): URL | null {
  try {
    const url = new URL(value, 'https://play.google.com');
    if (
      url.origin !== 'https://play.google.com' ||
      url.username ||
      url.password ||
      url.hash ||
      !['/store/apps/dev', '/store/apps/developer'].includes(url.pathname) ||
      url.searchParams.getAll('id').length !== 1 ||
      url.searchParams.get('id') !== developerId
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = {
      '&amp;': '&',
      '&quot;': '"',
      '&apos;': "'",
      '&lt;': '<',
      '&gt;': '>',
    };
    const lower = entity.toLowerCase();
    if (named[lower]) return named[lower];
    const number = lower.startsWith('&#x')
      ? parseInt(lower.slice(3, -1), 16)
      : parseInt(lower.slice(2, -1), 10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

/** developerId is already decoded once, matching the maintained client's query value. */
export function resolveGoogleDeveloperListingLink(
  html: string,
  developerId: string,
): string | null {
  const paths = new Set<string>();
  for (const anchor of html.matchAll(/<a(?=\s|>)([^>]*)>/gi)) {
    const href = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(anchor[1]!);
    if (!href) continue;
    const url = matchingDirectory(decodeHtmlAttribute(href[1] ?? href[2]!), developerId);
    if (url) paths.add(url.pathname);
  }
  // Conflicting name/profile links do not prove which route this listing intended.
  if (paths.size !== 1) return null;
  return `https://play.google.com${[...paths][0]}?${new URLSearchParams({ id: developerId })}`;
}

export function googleDeveloperRequestUrl(
  developerUrl: string | undefined,
  developerId: string,
  country: string,
  language: string,
): string | null {
  const url = developerUrl ? matchingDirectory(developerUrl, developerId) : null;
  if (!url) return null;
  return `https://play.google.com${url.pathname}?${new URLSearchParams({ id: developerId, gl: country, hl: language })}`;
}

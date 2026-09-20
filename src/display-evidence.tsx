import type { Enrichment } from '../server/types';
import type { MarketApp } from './types';

export const changeFieldLabels: Record<string, string> = {
  version: '版本',
  releaseNotes: '更新说明',
  description: '应用描述',
  summary: '简介',
  title: '应用名称',
  developer: '开发者',
  score: '评分',
  ratings: '评分人数',
  reviews: '评论数量',
  installs: '公开累计安装量',
  minInstalls: '累计安装量下限',
  maxInstalls: '累计安装量上限',
  releasedAt: '商店发布日期',
  storeUpdatedAt: '商店更新时间',
  price: '价格',
  currency: '币种',
  icon: '应用图标',
  url: '商店链接',
  privacyPolicy: '隐私政策',
};
export const displayValue = (value: unknown) =>
  value == null
    ? '未提供'
    : typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value);

/** Presentation only: never insert source elements or alter persisted evidence/offsets. */
export function sourceToText(value: unknown): string {
  const source = typeof value === 'string' ? value : displayValue(value);
  const text = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?([a-z][\w:-]*)([^<>]*)>/gi, (tag, name: string, attributes: string) => {
      const key = name.toLowerCase();
      const closing = tag.startsWith('</');
      // Bare words such as `a<b and c>d` are not formatting attributes.
      // Only explicit name=value attributes and known formatting tags are decoded.
      const valid = closing
        ? /^\s*$/.test(attributes)
        : /^(?:\s+[a-z_:][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))*\s*\/?\s*$/i.test(
            attributes,
          );
      if (!valid) return tag;
      if (key === 'br' || /^(p|div|h[1-6]|section|tr|blockquote|pre)$/.test(key)) return '\n';
      if (key === 'li') return closing ? '\n' : '\n• ';
      if (/^(img|input|meta|link|hr)$/.test(key)) return '';
      if (
        /^(b|strong|em|i|u|s|span|a|small|code|ul|ol)$/.test(key) &&
        new RegExp(`<\\/${key}\\s*>`, 'i').test(source)
      )
        return '';
      return tag;
    });
  // Encoding literal '<' prevents source markup, including textarea end tags,
  // from creating elements. The detached textarea only decodes character references.
  if (typeof document !== 'undefined') {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = text.replace(/</g, '&lt;');
    return decoder.value.replace(/\u00a0/g, ' ').trim();
  }
  return text.trim();
}
export function ChangeComparison({
  field,
  oldValue,
  newValue,
}: {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}) {
  const value = (v: unknown) => (field === 'releaseNotes' ? sourceToText(v) : displayValue(v));
  return (
    <div className="change-comparison" data-change-field={field}>
      <div className="change-comparison-field">
        <strong>{changeFieldLabels[field] || field}</strong>
        <code>{field}</code>
      </div>
      <div>
        <span>变化前</span>
        <pre>{value(oldValue)}</pre>
      </div>
      <div>
        <span>变化后</span>
        <pre>{value(newValue)}</pre>
      </div>
    </div>
  );
}
export function releaseRaw(app: MarketApp, rawDetail?: unknown): unknown {
  const raw =
    rawDetail && typeof rawDetail === 'object' ? (rawDetail as Record<string, unknown>) : {};
  const store =
    app.storeData && typeof app.storeData === 'object'
      ? (app.storeData as Record<string, unknown>)
      : {};
  return (
    [app.releasedAtRaw, store.released, store.releaseDate, raw.released, raw.releaseDate].find(
      (value) => value != null && (typeof value !== 'string' || value.trim() !== ''),
    ) ?? null
  );
}
export function historicalPrivacy(app: MarketApp, enrichments: Enrichment[]) {
  const entry = enrichments.find(
    (e) =>
      e.kind === 'privacy' &&
      e.appId === app.id &&
      (!e.requestCountry || e.requestCountry.toLowerCase() === app.country.toLowerCase()) &&
      e.lastSuccessAt &&
      e.data &&
      typeof e.data === 'object',
  );
  if (!entry) return null;
  const value = (entry.data as Record<string, unknown>).privacyPolicyUrl;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? { url: url.href, entry } : null;
  } catch {
    return null;
  }
}

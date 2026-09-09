import React, {
  useEffect,
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight, ImageOff, X, ExternalLink, LoaderCircle } from 'lucide-react';
import type { MarketApp } from './types';
import { scopeLabels, type LoanScope } from './research-types';
export const MutationErrorContext = createContext('');
export const storeLabels: Record<string, string> = {
  'google-play': 'Google Play',
  'app-store': 'App Store',
};
export const eventLabels: Record<string, string> = {
  firstSeen: '首次发现',
  storeRelease: '商店发布',
  observedUpdate: '观测更新',
};
export const count = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('zh-CN').format(n);
export function time(value: unknown, full = false) {
  if (typeof value !== 'string' || !value) return '未提供';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(+d)
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(full ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
      }).format(d);
}
export function businessToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function safeExternal(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function storeSource(app: Pick<MarketApp, 'store' | 'country' | 'externalId'>) {
  return app.store === 'google-play'
    ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(app.externalId)}&gl=${encodeURIComponent(app.country)}`
    : `https://apps.apple.com/${encodeURIComponent(app.country)}/app/id${encodeURIComponent(app.externalId)}`;
}
export function External({ url, children }: { url: unknown; children?: ReactNode }) {
  const href = safeExternal(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children || String(url)} <ExternalLink size={13} />
    </a>
  ) : (
    <span className="muted">{url ? '地址不可用' : '未提供'}</span>
  );
}
export function Flag({ country }: { country: string }) {
  return (
    <span
      className={`fi fi-${/^[a-z]{2}$/.test(country) ? country : 'xx'}`}
      aria-label={country.toUpperCase()}
    />
  );
}
export function Icon({ app }: { app: Pick<MarketApp, 'icon' | 'title'> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [app.icon]);
  return (
    <span
      className="research-app-icon"
      title={failed ? '图标加载失败' : !app.icon ? '暂无图标' : app.title}
    >
      {safeExternal(app.icon) && !failed ? (
        <img
          src={safeExternal(app.icon) || undefined}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageOff size={20} aria-label={failed ? '图标加载失败' : '暂无图标'} />
      )}
    </span>
  );
}
export function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="research-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="button-group">{children}</div>
    </header>
  );
}
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="research-empty">{children}</div>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p className="research-error" role="alert">
      {String(error)}
    </p>
  ) : null;
}
export function Busy() {
  return (
    <div className="research-loading">
      <LoaderCircle className="spin" size={18} />
      加载中…
    </div>
  );
}
export function ScopeSelect({
  value,
  onChange,
}: {
  value: LoanScope;
  onChange: (value: LoanScope) => void;
}) {
  return (
    <select
      aria-label="信贷范围"
      value={value}
      onChange={(e) => onChange(e.target.value as LoanScope)}
    >
      {Object.entries(scopeLabels).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
}
export function Pager({
  offset,
  limit,
  total,
  onChange,
  disabled = false,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  disabled?: boolean;
}) {
  return (
    <footer className="research-pagination">
      <span>
        {total ? `${offset + 1}–${Math.min(total, offset + limit)}` : '0'} / 共 {count(total)} 项
      </span>
      <div className="button-group">
        <button
          className="button secondary"
          disabled={disabled || offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={15} />
          上一页
        </button>
        <span>第 {Math.floor(offset / limit) + 1} 页</span>
        <button
          className="button secondary"
          disabled={disabled || offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          下一页
          <ChevronRight size={15} />
        </button>
      </div>
    </footer>
  );
}
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const mutationError = useContext(MutationErrorContext);
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  if (
    !trigger.current &&
    typeof document !== 'undefined' &&
    document.activeElement instanceof HTMLElement
  )
    trigger.current = document.activeElement;
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      requestAnimationFrame(() => {
        if (!dialog.open && trigger.current?.isConnected && !document.querySelector('dialog[open]'))
          trigger.current.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog className="research-dialog" aria-label={title} ref={ref}>
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="research-dialog-body">
        <ErrorNotice error={mutationError} />
        {children}
      </div>
    </dialog>
  );
}
export function Gallery({ app }: { app: MarketApp }) {
  const urls = Array.isArray(app.screenshots)
    ? app.screenshots.filter((u): u is string => typeof u === 'string' && Boolean(safeExternal(u)))
    : [];
  const [index, setIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (index == null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => (i == null ? i : (i - 1 + urls.length) % urls.length));
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIndex((i) => (i == null ? i : (i + 1) % urls.length));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [index, urls.length]);
  return (
    <section className="panel padded">
      <h2>商店截图</h2>
      {urls.length ? (
        <div className="research-gallery">
          {urls.map((url, i) => (
            <button
              key={`${i}:${url}`}
              aria-label={`${app.title} 商店截图 ${i + 1}`}
              onClick={() => setIndex(i)}
            >
              {failed[url] ? (
                <span>
                  <ImageOff />
                  图片加载失败
                </span>
              ) : (
                <img
                  src={url}
                  alt={`截图 ${i + 1}`}
                  loading="lazy"
                  onError={() => setFailed((v) => ({ ...v, [url]: true }))}
                />
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">商店未提供可用截图。</p>
      )}
      {index != null && (
        <Dialog title={`商店截图 ${index + 1} / ${urls.length}`} onClose={() => setIndex(null)}>
          <div className="research-lightbox">
            {failed[urls[index]] ? (
              <p>
                <ImageOff />
                图片加载失败，可查看其他截图或来源。
              </p>
            ) : (
              <img
                src={urls[index]}
                alt={`商店截图 ${index + 1}`}
                onError={() => setFailed((v) => ({ ...v, [urls[index]]: true }))}
              />
            )}
            <div className="button-group">
              <button
                className="button secondary"
                disabled={urls.length < 2}
                onClick={() => setIndex((index - 1 + urls.length) % urls.length)}
              >
                上一张
              </button>
              <External url={urls[index]}>打开原图</External>
              <button
                className="button secondary"
                disabled={urls.length < 2}
                onClick={() => setIndex((index + 1) % urls.length)}
              >
                下一张
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
export function downloadText(text: string, name: string, mime = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function copyText(value: string) {
  if (!navigator.clipboard?.writeText)
    throw new Error('浏览器暂不可自动复制，请选中文本手动复制。');
  await navigator.clipboard.writeText(value);
}

import { openDialogWithReturn } from './dialog-lifecycle';
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  X,
  Info,
  ImageOff,
  ExternalLink,
} from 'lucide-react';
import { countries, stores, eventLabels } from './data';
import { dateText, formatNumber } from './utils';
export function AppIcon({ app }) {
  const [failedSource, setFailedSource] = useState(null);
  const source = app.iconUrl;
  const failed = Boolean(source && failedSource === source);
  const missing = !source;
  const atlas = Number.isInteger(app.iconIndex) && app.iconIndex >= 0 && app.iconIndex < 24;
  const label = missing ? '暂无图标' : failed ? '图标加载失败' : '示例应用图标';
  return (
    <span
      className={`app-icon${missing ? ' is-missing' : failed ? ' is-error' : atlas ? ' is-atlas' : ''}`}
      role="img"
      aria-label={`${label} · ${app.title}`}
      title={`${label} · ${app.title}${app.iconNote ? ' · ' + app.iconNote : ''}`}
    >
      {missing || failed ? (
        <ImageOff size={18} aria-hidden="true" />
      ) : (
        <img
          className={atlas ? 'app-icon-atlas' : undefined}
          src={source}
          alt=""
          aria-hidden="true"
          loading="lazy"
          style={
            atlas
              ? { left: -(app.iconIndex % 6) * 40, top: -Math.floor(app.iconIndex / 6) * 40 }
              : undefined
          }
          onError={() => setFailedSource(source)}
        />
      )}
    </span>
  );
}
export function Flag({ code }) {
  return (
    <span
      className={`fi fi-${code}`}
      role="img"
      aria-label={countries.find((c) => c.code === code)?.name || code}
    />
  );
}
export function CountryLabel({ code, full = false }) {
  return (
    <span className="country-label">
      <Flag code={code} />
      <strong>{code.toUpperCase()}</strong>
      {full && <b>{countries.find((c) => c.code === code)?.name || code}</b>}
    </span>
  );
}
export function Tag({ kind, children }) {
  return <span className={`tag ${kind || ''}`}>{children}</span>;
}
export function SourceNote() {
  return <span className="source-note">示例数据，仅供产品演示</span>;
}
export function PageHeading({ title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Empty({
  title = '暂无匹配结果',
  description = '试试调整筛选条件，或返回全部应用。',
  children,
}) {
  return (
    <div className="empty-state">
      <Info size={26} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Pager({ page, pages, total, onPage }) {
  return (
    <div className="pager">
      <span>
        共 {formatNumber(total)} 条 · 第 {page} / {pages} 页
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function Dialog({ title, children, onClose, wide = false, onKeyDown }) {
  const ref = useRef(null);
  const returnFocus = useRef(document.activeElement);
  useEffect(() => openDialogWithReturn(ref.current, returnFocus.current), []);
  return (
    <dialog
      ref={ref}
      onKeyDown={onKeyDown}
      className={`dialog ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Lightbox({ images, index, onClose, appTitle = '资金桥 Demo' }) {
  const [current, setCurrent] = useState(index),
    [failed, setFailed] = useState({});
  const next = (delta) => setCurrent((i) => (i + delta + images.length) % images.length);
  return (
    <Dialog
      wide
      title={`截图预览 · ${current + 1} / ${images.length}`}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          next(-1);
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          next(1);
        }
      }}
    >
      <div className="lightbox">
        <button className="icon-button" aria-label="上一张截图" onClick={() => next(-1)}>
          <ChevronLeft />
        </button>
        {failed[current] ? (
          <Empty title="此张示例图加载失败" description="可切换其他图片，或重试当前图片。">
            <button onClick={() => setFailed((f) => ({ ...f, [current]: false }))}>重试图片</button>
          </Empty>
        ) : (
          <img
            src={images[current]}
            onError={() => setFailed((f) => ({ ...f, [current]: true }))}
            alt={`${appTitle} 原型示例截图 ${current + 1}，非真实商店图`}
          />
        )}
        <button className="icon-button" aria-label="下一张截图" onClick={() => next(1)}>
          <ChevronRight />
        </button>
      </div>
      <p className="fine-print">原型示例 · 非真实商店图。使用左右方向键切换，Esc 关闭。</p>
    </Dialog>
  );
}
export function Evidence({ value, label = '完整来源字段' }) {
  return (
    <details className="evidence">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
export function EventTable({ events, apps, onSelect, onRead, reads = [], showRead = false }) {
  return (
    <div className="table-scroll">
      <table className="event-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>市场</th>
            <th>应用名称</th>
            <th>事件类型</th>
            <th>关键变化</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const a = apps.find((x) => x.id === e.appId);
            if (!a) return null;
            return (
              <tr key={e.id}>
                <td className="muted">{e.at.slice(11, 16)}</td>
                <td>
                  <CountryLabel code={e.country} />
                </td>
                <td>
                  <button
                    id={`event-${e.id}`}
                    className="app-title"
                    onClick={() => onSelect(a.id, e.id)}
                  >
                    {a.title}
                  </button>
                  <small>{a.externalId}</small>
                </td>
                <td>
                  <Tag kind={e.type}>{eventLabels[e.type]}</Tag>
                </td>
                <td>
                  <strong>{e.before ? `${e.before} → ${e.after}` : '—'}</strong>
                  <small>{e.summary}</small>
                </td>
                <td className="event-confirm">
                  {showRead ? (
                    <button
                      className={`text-button ${reads.includes(e.id) ? 'muted' : ''}`}
                      onClick={() => onRead(e.id)}
                    >
                      {reads.includes(e.id) ? '已读' : '标记已读'}
                    </button>
                  ) : (
                    <span>
                      {a.classificationSource === 'manual' ? '人工确认' : '自动确认'}{' '}
                      <Info size={13} />
                    </span>
                  )}
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`查看 ${a.title} 事件详情`}
                    onClick={() => onSelect(a.id, e.id)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function Back({ children = '返回', onClick }) {
  return (
    <button className="back-link" onClick={onClick}>
      <ArrowLeft size={15} />
      {children}
    </button>
  );
}
export function Field({ label, children }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function DemoSource({ app }) {
  return (
    <div className="source-box">
      <div>
        <strong>来源与时间</strong>
        <SourceNote />
      </div>
      <p>
        {stores[app.store]} · 请求市场 {app.country.toUpperCase()} · 最近成功观测{' '}
        {app.lastFetchedAt.replace('T', ' ').slice(0, 16)}
      </p>
      <p>
        本系统首次发现：{dateText(app.firstSeenAt)}；商店标注发布：{dateText(app.releasedAt)}
        。首次发现不等于新上架，发布日期不证明该国首次可用。
      </p>
      <details>
        <summary>查看示例来源路径</summary>
        <code>{app.source}</code>
        <p>虚构市场身份，用于展示来源追溯，不打开为真实商店资料。</p>
      </details>
    </div>
  );
}

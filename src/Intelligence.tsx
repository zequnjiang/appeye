import { useEffect, useState } from 'react';
import { patch } from './api';
import { useResource } from './use-resource';
import type { LoanAnalysis } from '../server/loan-identification';
import type { Enrichment } from '../server/types';
import type { MarketApp } from './types';

export const verdictLabels: Record<string, string> = {
  strong: '强信贷证据',
  possible: '可能相关',
  insufficient: '证据不足',
};
const sourceLabels: Record<string, string> = {
  auto: '自动识别',
  manual: '人工分类',
  legacy: '历史分类保留',
};
const statusLabels: Record<string, string> = {
  available: '已获取',
  empty: '返回空数据',
  unsupported: '当前来源不支持',
  failed: '最近采集失败',
  observed: '发现相关披露',
  not_observed: '尚未识别到',
  conditional: '需核对适用条件',
  not_applicable: '不适用本条检查',
};
const kindLabels: Record<string, string> = {
  permissions: '应用权限',
  dataSafety: '数据安全声明',
  privacy: '隐私信息',
  versionHistory: '商店版本历史',
  inAppPurchases: '应用内购买',
  ratings: '评分分布',
  developer: '开发者公开目录',
};
const roleLabels: Record<string, string> = {
  loanProvider: '贷款服务方',
  developerLegalEntity: '开发者法律实体',
  corporateName: '公司名称',
  businessName: '业务名称',
  regulatorClaim: '监管相关声明',
};
const fieldLabels: Record<string, string> = {
  minRepaymentTerm: '最短还款期限',
  maxRepaymentTerm: '最长还款期限',
  maximumApr: '最高 APR',
  maximumInterestRate: '最高普通利率',
  fees: '费用',
  representativeExample: '还款总成本示例',
  privacyPolicy: '隐私政策',
  loanProvider: '贷款服务方',
  developerLegalEntity: '开发者法律实体',
  corporateName: '公司名称',
  businessName: '业务名称',
  secRegistration: 'SEC 注册号',
  certificateOfAuthority: 'CA 编号',
  unregulatedStatement: '非 BoT/FPO 监管声明',
  ojkLicense: 'OJK 相关声明',
  secpApproval: 'SECP 相关声明',
};
const formatTime = (time?: string | null) =>
  time ? new Date(time).toLocaleString('zh-CN') : '尚未获取';
function safeLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) return url.href;
  } catch {
    /* plain text */
  }
}

/** Shows arbitrary provider fields without interpreting markup or dropping unknown keys. */
export function FieldTree({
  value,
  label = '完整返回字段',
  depth = 0,
}: {
  value: unknown;
  label?: string;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  if (value === null || value === undefined)
    return (
      <div className="field-leaf">
        <span>{label}</span>
        <em>未提供</em>
      </div>
    );
  if (typeof value !== 'object')
    return (
      <div className="field-leaf">
        <span>{label}</span>
        <div>
          {safeLink(value) ? (
            <a href={safeLink(value)} target="_blank" rel="noopener noreferrer">
              {String(value)}
            </a>
          ) : (
            String(value)
          )}
        </div>
      </div>
    );
  const entries = Object.entries(value);
  return (
    <details className="field-tree" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {label}{' '}
        <small>{Array.isArray(value) ? `${entries.length} 项` : `${entries.length} 个字段`}</small>
      </summary>
      {open && (
        <div>
          {entries.length ? (
            entries.map(([key, item]) => (
              <FieldTree key={key} value={item} label={key} depth={depth + 1} />
            ))
          ) : (
            <p className="muted">空列表或对象</p>
          )}
        </div>
      )}
    </details>
  );
}

function JsonDownload({ value, name }: { value: unknown; name: string }) {
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button className="button secondary" onClick={download}>
      下载 JSON
    </button>
  );
}

export function ClassificationNote({ app }: { app: MarketApp }) {
  return (
    <small className="classification-note">
      {sourceLabels[app.classificationSource || 'legacy']} ·{' '}
      {app.loanAnalysis ? verdictLabels[app.loanAnalysis.verdict] : '待分析'}
    </small>
  );
}

export function LoanIntelligence({
  app,
  canOperate = false,
  onChanged,
  onNotify,
}: {
  canOperate?: boolean;
  app: MarketApp;
  onChanged: () => void;
  onNotify: (s: string) => void;
}) {
  const analysis: LoanAnalysis | null | undefined = app.loanAnalysis;
  const [busy, setBusy] = useState(false);
  async function automatic() {
    if (!canOperate) return;
    setBusy(true);
    try {
      await patch(`/apps/${app.id}`, { classificationMode: 'auto' });
      onChanged();
      onNotify('已启用自动分类，后续将跟随识别规则更新');
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="intelligence-stack">
      <section className="panel padded">
        <div className="panel-heading inline-heading">
          <div>
            <span className="eyebrow">LOAN INTELLIGENCE</span>
            <h2>{analysis ? verdictLabels[analysis.verdict] : '等待文本分析'}</h2>
          </div>
          {canOperate && app.manualOverride && (
            <button disabled={busy} className="button secondary" onClick={() => void automatic()}>
              启用自动分类
            </button>
          )}
        </div>
        <p>{analysis?.summary || '完成详情采集后，将根据描述生成识别证据。'}</p>
        <p className="mini-note">
          当前分类来源：{sourceLabels[app.classificationSource || 'legacy']}。
          {app.manualOverride
            ? '当前分类已锁定；新分析不会覆盖。点击“启用自动分类”后才会应用自动结果。'
            : '强证据应用自动归为信贷，其余保持待确认。可通过页面上方分类选择框人工覆盖。'}
        </p>
        {analysis && (
          <div className="intelligence-meta">
            <span>证据分 {analysis.confidence}/100 · 非概率</span>
            <span>规则 {analysis.ruleVersion}</span>
            <span>原文观测 {formatTime(analysis.sourceObservedAt)}</span>
            <span>分析 {formatTime(analysis.analyzedAt)}</span>
            <span>产品范围 {analysis.productType}</span>
          </div>
        )}
      </section>
      {analysis && (
        <>
          <section className="panel padded">
            <h2>识别依据</h2>
            <p className="muted">
              原文片段保留来源及位置，费用与利率不代表已完成完整性或合规核验。
            </p>
            <div className="evidence-grid">
              {analysis.evidence.map((e) => (
                <article className="evidence-card" key={e.id}>
                  <header>
                    <strong>{fieldLabels[e.field] || e.field}</strong>
                    <span>
                      {e.id} · {e.source} [{e.start}, {e.end})
                    </span>
                  </header>
                  <blockquote>{e.text}</blockquote>
                  {e.rateType && (
                    <small>
                      {e.rateType} · {e.numericValue} {e.unit}
                    </small>
                  )}
                </article>
              ))}
            </div>
            {!analysis.evidence.length && (
              <p className="muted">当前描述未匹配到规则。可以手动确认分类。</p>
            )}
          </section>
          <section className="panel padded">
            <h2>国别披露检查</h2>
            <p className="muted">
              仅检查描述文本；结构化公司字段、隐私链接请结合“公司与商店信息”核对。“尚未识别到”不是违规结论。Google
              Play 政策不作为 App Store 义务。
            </p>
            <div className="policy-list">
              {analysis.disclosures.map((d) => (
                <details key={d.ruleId}>
                  <summary>
                    <span>{d.title}</span>
                    <span className={`rule-status ${d.status}`}>{statusLabels[d.status]}</span>
                  </summary>
                  <div>
                    <p>{d.note}</p>
                    <p>范围：{d.scope}</p>
                    {d.observedFields.length > 0 && (
                      <p>匹配字段：{d.observedFields.map((f) => fieldLabels[f] || f).join('、')}</p>
                    )}
                    {d.missingFields.length > 0 && (
                      <p>
                        待核对字段：{d.missingFields.map((f) => fieldLabels[f] || f).join('、')}
                      </p>
                    )}
                    <a href={safeLink(d.sourceUrl)} target="_blank" rel="noopener noreferrer">
                      {d.ruleId} · 查看政策原文 ↗
                    </a>
                  </div>
                </details>
              ))}
            </div>
          </section>
          <section className="panel padded">
            <h2>识别边界与来源</h2>
            <p className="mini-note">
              政策核对时间：{formatTime(analysis.policyRetrievedAt)}。{analysis.countryPolicyNote}
            </p>
            {analysis.limitations.map((s) => (
              <p className="muted" key={s}>
                {s}
              </p>
            ))}
            <div className="button-group">
              {analysis.sources.map((s) => (
                <a key={s.url} href={safeLink(s.url)} target="_blank" rel="noopener noreferrer">
                  {s.title} ↗
                </a>
              ))}
            </div>
            <JsonDownload value={analysis} name={`appeye-${app.id}-analysis`} />
          </section>
        </>
      )}
    </div>
  );
}

export function StoreInformation({ app, rawDetail }: { app: MarketApp; rawDetail: unknown }) {
  const keys: [string, string][] = [
    ['developer', '商店开发者显示名'],
    ['developerId', '商店开发者 ID'],
    ['sellerName', 'App Store 销售方'],
    ['developerLegalName', '商店法律实体名称'],
    ['developerEmail', '开发者邮箱'],
    ['developerAddress', '开发者地址'],
    ['developerLegalEmail', '法律实体邮箱'],
    ['developerLegalAddress', '法律实体地址'],
    ['developerLegalPhoneNumber', '法律实体电话'],
    ['developerWebsite', '开发者网站'],
    ['developerUrl', '开发者商店页面'],
    ['sellerUrl', '销售方网站'],
    ['privacyPolicy', '隐私政策'],
    ['bundleId', 'Bundle ID'],
    ['genre', '商店分类'],
    ['price', '价格'],
    ['currency', '币种'],
  ];
  const screenshots = Array.isArray(app.screenshots)
    ? (app.screenshots.filter((s) => typeof s === 'string' && safeLink(s)) as string[])
    : [];
  return (
    <div className="intelligence-stack">
      <section className="panel padded">
        <h2>上架主体与联系信息</h2>
        <p className="muted">
          以下为商店返回字段。商店发布者、技术开发者、贷款服务方可能属于不同实体。
        </p>
        <dl className="facts company-facts">
          {keys.map(([k, title]) => (
            <div key={k}>
              <dt>{title}</dt>
              <dd>
                {safeLink(app[k]) ? (
                  <a href={safeLink(app[k])} target="_blank" rel="noopener noreferrer">
                    {String(app[k])}
                  </a>
                ) : app[k] == null ? (
                  '商店未提供'
                ) : (
                  String(app[k])
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel padded">
        <h2>描述中声明的公司与监管关系</h2>
        <p className="muted">仅提取有明确角色标记的原文，均未独立核验主体或牌照。</p>
        {app.loanAnalysis?.entities.length ? (
          app.loanAnalysis.entities.map((e, i) => (
            <div className="entity-row" key={i}>
              <strong>{roleLabels[e.role]}</strong>
              <span>{e.name}</span>
              <small>描述声明 · {e.evidenceId} · 未核验</small>
            </div>
          ))
        ) : (
          <p>当前描述未提取到明确实体角色。</p>
        )}
      </section>
      <section className="panel padded">
        <div className="panel-heading inline-heading">
          <div>
            <h2>完整商店信息</h2>
            <p>可展开全部字段；包含当前适配器没有专门映射的新字段。</p>
          </div>
          <JsonDownload value={{ app, rawDetail }} name={`appeye-${app.id}-store`} />
        </div>
        <FieldTree value={app.storeData} label="商店详情字段" />
        <FieldTree value={rawDetail} label="原始详情响应" />
      </section>
    </div>
  );
}

function History({ id, kind, version }: { id: number; kind: string; version: number }) {
  return (
    <ObservationHistory
      endpoint={`/apps/${id}/enrichments/${kind}/history`}
      listKey="history"
      title="采集历史"
      version={version}
    />
  );
}

function PermissionSummary({ data }: { data: unknown[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? data : data.slice(0, 6);
  return (
    <>
      <ul className="permission-list">
        {visible.map((entry, i) => {
          const value =
            typeof entry === 'string'
              ? entry
              : entry && typeof entry === 'object'
                ? (entry as Record<string, unknown>).permission ||
                  (entry as Record<string, unknown>).name ||
                  JSON.stringify(entry)
                : String(entry);
          return <li key={i}>{String(value)}</li>;
        })}
      </ul>
      {data.length > 6 && (
        <button
          className="button secondary"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起权限' : `展开全部 ${data.length} 项权限`}
        </button>
      )}
    </>
  );
}
function SupplementalSummary({ kind, data }: { kind: string; data: unknown }) {
  if (!Array.isArray(data) || !data.length) return null;
  if (kind === 'permissions') return <PermissionSummary data={data} />;
  if (kind === 'versionHistory')
    return (
      <div className="version-history">
        {data.map((entry, i) => {
          if (!entry || typeof entry !== 'object') return null;
          return (
            <details key={i}>
              <summary>
                <strong>{String(entry.versionDisplay || entry.version || `版本 ${i + 1}`)}</strong>
                <time>{String(entry.releaseDate || entry.date || '未提供日期')}</time>
              </summary>
              <p className="pre-wrap">
                {String(entry.releaseNotes || entry.notes || '未提供更新说明')}
              </p>
            </details>
          );
        })}
      </div>
    );
  return null;
}
export function ObservationHistory({
  endpoint,
  listKey,
  title,
  version = 0,
}: {
  endpoint: string;
  listKey: string;
  title: string;
  version?: number;
}) {
  const [offset, setOffset] = useState(0);
  const { data, error } = useResource<Record<string, unknown>>(
    `${endpoint}?limit=20&offset=${offset}`,
    version,
  );
  const rows =
    data && Array.isArray(data[listKey]) ? (data[listKey] as Record<string, unknown>[]) : [];
  return (
    <div className="observation-history">
      <h3>
        {title} {data ? `(${data.total})` : ''}
      </h3>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>加载中…</p>}
      {rows.map((r, i) => (
        <FieldTree
          key={`${endpoint}-${String(r.id ?? r.observedAt ?? i)}`}
          value={r}
          label={`${r.observedAt || r.fetchedAt || r.id || i} ${r.status ? statusLabels[String(r.status)] || r.status : r.keyword || ''}`}
          depth={1}
        />
      ))}
      {data && !rows.length && <p className="muted">暂无记录。旧版未保存的额外数据需重新采集。</p>}
      <div className="button-group">
        <button
          className="button secondary"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          上一页
        </button>
        <button
          className="button secondary"
          disabled={offset + rows.length >= Number(data?.total || 0)}
          onClick={() => setOffset(offset + 20)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function EnrichmentPanel({
  app,
  canOperate = false,
  enrichments,
  onCollect,
  version,
}: {
  canOperate?: boolean;
  app: MarketApp;
  enrichments: Enrichment[];
  onCollect: () => void;
  version: number;
}) {
  const [history, setHistory] = useState('');
  return (
    <div className="intelligence-stack">
      <section className="panel padded">
        <div className="panel-heading inline-heading">
          <div>
            <h2>权限、隐私与补充资料</h2>
            <p>每类资料独立采集，保留来源、时间和历史。</p>
          </div>
          {canOperate && (
            <button className="button secondary" onClick={onCollect}>
              采集补充资料
            </button>
          )}
        </div>
        <p className="mini-note">
          权限来自商店公开声明，不代表用户已授予权限，也不是 APK Manifest
          分析。失败或不支持不表示应用没有相关权限。
        </p>
      </section>
      {Object.entries(kindLabels).map(([kind, title]) => {
        const item = enrichments.find((e) => e.kind === kind);
        return (
          <section className="panel padded" key={kind}>
            <div className="panel-heading inline-heading">
              <h2>{title}</h2>
              <span className={`rule-status ${item?.status || ''}`}>
                {item ? statusLabels[item.status] : '等待采集'}
              </span>
            </div>
            {item ? (
              <>
                <div className="intelligence-meta">
                  <span>成功数据来源 {item.lastSuccessAt ? item.source : '尚无成功资料'}</span>
                  <span>数据时间 {formatTime(item.fetchedAt)}</span>
                  <span>最近尝试 {formatTime(item.lastAttemptAt)}</span>
                  <span>
                    成功资料请求市场{' '}
                    {item.lastSuccessAt
                      ? item.requestCountry?.toUpperCase() ||
                        (kind === 'dataSafety' && app.store === 'google-play'
                          ? '此接口不提供国别参数'
                          : '未记录')
                      : '尚无成功资料'}
                  </span>
                  <span>
                    成功资料请求语言{' '}
                    {item.lastSuccessAt ? item.requestLanguage || '未验证或未提供' : '尚无成功资料'}
                  </span>
                  <span>最近尝试来源 {item.attemptSource}</span>
                  <span>
                    最近尝试市场{' '}
                    {item.attemptRequestCountry?.toUpperCase() ||
                      (kind === 'dataSafety' && app.store === 'google-play'
                        ? '此接口不提供国别参数'
                        : '未记录')}
                  </span>
                  <span>最近尝试语言 {item.attemptRequestLanguage || '未验证或未提供'}</span>
                </div>
                {item.note && <p className="mini-note">{item.note}</p>}
                {item.error && (
                  <p className="enrichment-error" role="alert">
                    {item.error}
                    {item.lastSuccessAt
                      ? ` · 以下保留 ${formatTime(item.lastSuccessAt)} 的成功数据`
                      : ' · 尚无成功数据'}
                  </p>
                )}
                {item.status === 'unsupported' && (
                  <p className="muted">该商店或接口不提供此类资料。</p>
                )}
                <SupplementalSummary kind={kind} data={item.data} />
                <FieldTree value={item.data} label="返回信息" />
                <details>
                  <summary>原始响应与采集元数据</summary>
                  <FieldTree value={item} />
                </details>
                <div className="button-group">
                  <button
                    className="button secondary"
                    onClick={() => setHistory(history === kind ? '' : kind)}
                  >
                    {history === kind ? '收起历史' : '查看采集历史'}
                  </button>
                  <JsonDownload value={item} name={`appeye-${app.id}-${kind}`} />
                </div>
                {history === kind && <History id={app.id} kind={kind} version={version} />}
              </>
            ) : (
              <p className="muted">
                {app.store === 'app-store' && kind === 'permissions'
                  ? 'App Store 不公开 Android 权限；可查看隐私信息。'
                  : '刷新详情后会自动排队，也可手动采集。'}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

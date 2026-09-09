export const sortFields = [
  ['title', '应用名称'],
  ['developer', '开发者'],
  ['firstSeenAt', '系统首次发现'],
  ['releasedAt', '商店发布日期'],
  ['storeUpdatedAt', '商店更新时间'],
  ['lastFetchedAt', '最近采集'],
  ['score', '评分'],
  ['ratings', '评分人数'],
  ['minInstalls', '累计安装量'],
];
export const canEditResearch = (role) => role === 'admin' || role === 'researcher';
export const canManageMembers = (role) => role === 'admin';
export const canOperate = (role) => role === 'platform';
export function visibleApps(apps, filters = {}, sort = 'firstSeenAt', direction = 'desc') {
  const q = (filters.q || '').trim().toLowerCase();
  return apps
    .filter(
      (a) =>
        (!q || `${a.title} ${a.developer} ${a.externalId}`.toLowerCase().includes(q)) &&
        (!filters.country || a.country === filters.country) &&
        (!filters.store || a.store === filters.store) &&
        (!filters.loanType || a.loanType === filters.loanType) &&
        (!filters.classification || a.classification === filters.classification) &&
        (!filters.from || (a.releasedAt && a.releasedAt.slice(0, 10) >= filters.from)) &&
        (!filters.to || (a.releasedAt && a.releasedAt.slice(0, 10) <= filters.to)) &&
        (filters.score === '' ||
          filters.score === undefined ||
          (a.score !== null && a.score >= Number(filters.score))) &&
        (filters.installs === '' ||
          filters.installs === undefined ||
          (a.minInstalls !== null && a.minInstalls >= Number(filters.installs))),
    )
    .sort((a, b) => {
      const x = a[sort],
        y = b[sort];
      if (x == null && y == null) return a.id.localeCompare(b.id);
      if (x == null) return 1;
      if (y == null) return -1;
      const compare = ['firstSeenAt', 'releasedAt', 'storeUpdatedAt', 'lastFetchedAt'].includes(
        sort,
      )
        ? Date.parse(x) - Date.parse(y)
        : typeof x === 'number'
          ? x - y
          : String(x).localeCompare(String(y), 'zh-CN', { numeric: true });
      return compare ? (direction === 'asc' ? compare : -compare) : a.id.localeCompare(b.id);
    });
}
export function paginate(rows, page = 1, size = 12) {
  const pages = Math.max(1, Math.ceil(rows.length / size)),
    current = Math.max(1, Math.min(page, pages));
  return {
    rows: rows.slice((current - 1) * size, current * size),
    page: current,
    pages,
    total: rows.length,
  };
}
export function marketCounts(apps, events, { day = '2026-09-08', cashOnly = true } = {}) {
  const allowed = new Set(
    apps
      .filter((a) => a.classification === 'confirmed' && (!cashOnly || a.loanType === 'personal'))
      .map((a) => a.id),
  );
  const result = {};
  for (const e of events) {
    if (e.date !== day || !allowed.has(e.appId)) continue;
    result[e.country] ??= { firstSeen: new Set(), storeRelease: new Set(), updated: new Set() };
    result[e.country][e.type]?.add(e.appId);
  }
  return Object.fromEntries(
    Object.entries(result).map(([code, row]) => [
      code,
      Object.fromEntries(Object.entries(row).map(([k, s]) => [k, s.size])),
    ]),
  );
}
export function exportResearch(workspace, apps) {
  return (
    `# ${workspace.name} · 示例研究摘录\n\n示例数据，仅供产品演示。\n\n` +
    workspace.collections
      .map(
        (c) =>
          `## ${c.name}\n` +
          c.appIds
            .map((id) => {
              const app = apps.find((a) => a.id === id);
              return app
                ? `- ${app.title} · ${app.country.toUpperCase()} / ${app.store} / ${app.externalId}\n  来源：${app.source}`
                : `- ${id}`;
            })
            .join('\n'),
      )
      .join('\n\n') +
    '\n\n## 研究备注\n' +
    workspace.notes
      .map(
        (n) =>
          `### ${apps.find((a) => a.id === n.appId)?.title || n.appId}\n${n.text}\n${n.author} · ${n.date}\n来源：${n.source || '未提供'}${n.eventId ? ' · 事件 ' + n.eventId : ''}`,
      )
      .join('\n\n')
  );
}
export function formatNumber(v) {
  return v === null || v === undefined ? '未提供' : new Intl.NumberFormat('zh-CN').format(v);
}
export function dateText(v) {
  return v ? String(v).slice(0, 10) : '未提供';
}
export function statusText(s) {
  return (
    {
      pending: '待审核',
      queued: '等待执行',
      running: '执行中',
      succeeded: '已完成',
      failed: '失败',
      approved: '已收录',
      excluded: '已排除',
      confirmed: '已确认',
      candidate: '待确认',
    }[s] || s
  );
}

export const isCustomerRole = (role) => ['admin', 'researcher', 'viewer'].includes(role);

export function latestMarketObservation(apps, events, { country, day, cashOnly = true }) {
  const eligible = new Map(
    apps
      .filter(
        (app) =>
          app.country === country &&
          app.classification === 'confirmed' &&
          (!cashOnly || app.loanType === 'personal'),
      )
      .map((app) => [app.id, app]),
  );
  const observations = events
    .filter((event) => event.country === country && event.date === day && eligible.has(event.appId))
    .map((event) => ({
      ...event,
      title: eligible.get(event.appId).title,
      observedTime: event.observedAt || event.at,
    }))
    .filter((event) => Number.isFinite(Date.parse(event.observedTime)));
  observations.sort(
    (a, b) => Date.parse(b.observedTime) - Date.parse(a.observedTime) || a.id.localeCompare(b.id),
  );
  return observations[0] || null;
}

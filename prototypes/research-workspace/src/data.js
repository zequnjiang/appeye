export const DEMO_DAY = '2026-09-08';
export const DEMO_NOW = '2026-09-08T12:00:00+08:00';
export const countries = [
  {
    code: 'th',
    name: '泰国',
    short: 'TH',
    counts: [8, 5, 18],
    recent: '2 小时前 · 观察到 资金桥 Demo 更新',
  },
  {
    code: 'mx',
    name: '墨西哥',
    short: 'MX',
    counts: [6, 4, 12],
    recent: '3 小时前 · 新发现 Préstamo Demo',
  },
  {
    code: 'ph',
    name: '菲律宾',
    short: 'PH',
    counts: [5, 3, 10],
    recent: '4 小时前 · Cash Demo 发布新版本',
  },
  {
    code: 'pk',
    name: '巴基斯坦',
    short: 'PK',
    counts: [4, 2, 7],
    recent: '6 小时前 · 观察到 EasyLoan 更新',
  },
  {
    code: 'id',
    name: '印尼',
    short: 'ID',
    counts: [3, 6, 9],
    recent: '8 小时前 · 新发现 DanaCepat Demo',
  },
  {
    code: 'ar',
    name: '阿根廷',
    short: 'AR',
    counts: [4, 3, 8],
    recent: '9 小时前 · 观察到 Préstamo Demo 更新',
  },
];
export const eventLabels = {
  firstSeen: '系统新发现',
  storeRelease: '商店当日发布',
  updated: '应用更新',
};
export const roles = {
  platform: '平台运营',
  admin: '客户管理员',
  researcher: '研究员',
  viewer: '只读成员',
};
export const stores = { 'google-play': 'Google Play', 'app-store': 'App Store' };
const firstNames = {
  th: '资金桥 Demo',
  mx: 'Préstamo Demo',
  ph: 'Cash Demo',
  pk: 'EasyLoan Demo',
  id: 'DanaCepat Demo',
  ar: 'Préstamo Demo AR',
};
const prefixes = {
  th: 'Siam Credit',
  mx: 'Crédito Claro',
  ph: 'Cash Horizon',
  pk: 'Asaan Credit',
  id: 'Dana Aman',
  ar: 'Crédito Sur',
};
const permissions = [
  ['相机', '拍摄照片和视频', '身份验证资料拍摄'],
  ['位置信息', '获取大致位置', '商店权限声明'],
  ['网络连接', '查看网络连接', '连接状态检查'],
  ['存储空间', '读取选定的照片', '上传申请材料'],
  ['通知', '发送通知', '还款与申请通知'],
  ['设备状态', '读取设备状态', '设备兼容性'],
  ['生物识别', '使用生物识别硬件', '快捷身份验证'],
  ['网络访问', '拥有完全的网络访问权限', '连接服务'],
  ['前台服务', '运行前台服务', '持续服务状态'],
  ['振动', '控制振动', '通知反馈'],
];
const pad = (n) => String(n).padStart(2, '0');
export function createFixtures() {
  const apps = countries.flatMap((country, ci) =>
    Array.from({ length: 22 }, (_, index) => {
      const id = `${country.code}-${index + 1}`,
        store = index % 2 ? 'app-store' : 'google-play';
      const title =
        index === 0
          ? firstNames[country.code]
          : `${prefixes[country.code]} ${String(index + 1).padStart(2, '0')} Demo`;
      return {
        id,
        country: country.code,
        store,
        externalId:
          store === 'google-play'
            ? `com.${country.code}.creditdemo${index + 1}`
            : `${1100000000 + ci * 100 + index}`,
        title,
        iconUrl:
          id === 'th-19'
            ? null
            : id === 'ar-20'
              ? '/assets/intentional-missing-icon-demo.png'
              : '/assets/app-icons-demo.png',
        iconIndex: ['th-19', 'ar-20'].includes(id) ? null : (ci * 22 + index) % 24,
        iconNote:
          id === 'th-19'
            ? '演示图标缺失'
            : id === 'ar-20'
              ? '故意使用本地不存在的示例图标路径，演示加载失败；非真实商店错误'
              : '本地生成的演示图标，稳定复用素材，不代表真实商店图标',
        developer: `${prefixes[country.code]} Technologies Ltd.`,
        seller: `${prefixes[country.code]} Finance Company`,
        loanType: index < 20 ? 'personal' : index === 20 ? 'business' : 'mortgage',
        classification: 'confirmed',
        classificationSource:
          (country.code === 'mx' && index === 0) || index % 4 === 1 ? 'manual' : 'auto',
        firstSeenAt:
          index < country.counts[0]
            ? `${DEMO_DAY}T${pad(8 + (index % 3))}:${pad((index * 7) % 60)}:00+08:00`
            : `2026-08-${pad(1 + index)}T08:00:00+08:00`,
        releasedAt:
          index < country.counts[1]
            ? DEMO_DAY
            : index === 21
              ? null
              : `2025-${pad(1 + (index % 12))}-${pad(1 + (index % 25))}`,
        storeUpdatedAt:
          index < country.counts[2]
            ? `${DEMO_DAY}T${pad(7 + (index % 4))}:${pad((index * 3) % 60)}:00+08:00`
            : index === 21
              ? null
              : '2026-08-21T12:00:00+08:00',
        lastFetchedAt: `${DEMO_DAY}T${pad(9 + (index % 3))}:${pad((index * 2) % 60)}:00+08:00`,
        score:
          index === 19
            ? 0
            : index === 21
              ? null
              : Number((3.6 + ((index + ci) % 13) / 10).toFixed(1)),
        ratings: index === 19 ? 0 : 1200 + index * 873 + ci * 102,
        minInstalls:
          store === 'app-store'
            ? null
            : index === 18
              ? 0
              : [10000, 50000, 100000, 500000, 1000000][index % 5],
        version: country.code === 'ph' && index === 0 ? '3.1.0' : '1.3.0',
        oldVersion: country.code === 'ph' && index === 0 ? '3.0.1' : '1.2.3',
        description: `${title} 是用于产品原型演示的${index < 20 ? '个人现金贷款' : index === 20 ? '经营贷款' : '住房抵押贷款'}服务。示例申请金额 5,000–50,000，当地货币；还款期限 90–180 天。展示身份验证、申请进度和还款计划。此处为虚构内容，不代表真实产品、贷款条件或牌照。`,
        releaseNotes: '优化申请流程与页面加载体验，改善还款计划展示，修复已知问题。',
        permissions:
          store === 'app-store'
            ? null
            : [2, 6].includes(index)
              ? []
              : permissions.map(([group, title, description], pi) =>
                  pi === 6
                    ? 'android.permission.USE_BIOMETRIC'
                    : pi === 7
                      ? {
                          permission:
                            '具有完整网络访问权限，连接申请资料和还款计划等服务的长名称演示',
                          type: 0,
                          unknownField: '来源未知字段保留',
                        }
                      : pi === 8
                        ? { name: '运行前台服务', type: 1 }
                        : { group, title, description },
                ),
        screenshots:
          id === 'th-1'
            ? ['/assets/store-demo-1.png', '/assets/store-demo-2.png']
            : id === 'th-9'
              ? ['/assets/intentional-missing-demo.png']
              : [],
        screenshotStatus:
          id === 'th-9' ? 'demo-load-failure' : id === 'th-1' ? 'available' : 'uncollected',
        screenshotNote:
          id === 'th-9'
            ? '故意使用本地不存在路径，演示图片获取失败；不是实际商店图片或采集错误。'
            : null,
        permissionStatus:
          store === 'app-store'
            ? 'unsupported'
            : index === 2
              ? 'empty'
              : index === 4
                ? 'failed'
                : index === 6
                  ? 'uncollected'
                  : 'available',
        permissionFetchedAt:
          store === 'app-store' || index === 6
            ? null
            : index === 4
              ? '2026-09-07T08:00:00+08:00'
              : `${DEMO_DAY}T12:00:00+08:00`,
        permissionError: index === 4 ? '示例来源请求超时，保留前次成功声明' : null,
        source:
          store === 'google-play'
            ? `https://play.google.com/store/apps/details?id=com.${country.code}.creditdemo${index + 1}`
            : `https://apps.apple.com/${country.code}/app/id${1100000000 + ci * 100 + index}`,
        ruleVersion: 'demo-personal-loan-v1',
        confidence: 86 + (index % 10),
        privacyUrl: 'https://example.com/demo-privacy',
        reviews: [
          {
            id: `${id}-r1`,
            score: 4,
            text: '示例评价：申请页面清晰，希望还款提示更及时。',
            date: DEMO_DAY,
          },
          {
            id: `${id}-r2`,
            score: 5,
            text: '示例评价：容易找到我的申请进度。',
            date: '2026-09-07',
          },
        ],
      };
    }),
  );
  apps.find((a) => a.id === 'th-9').description +=
    ' 此应用另带故意的本地图片获取失败示例，不代表真实商店资料。';
  const events = countries.flatMap((country) => {
    const local = apps.filter((a) => a.country === country.code && a.loanType === 'personal');
    return ['firstSeen', 'storeRelease', 'updated'].flatMap((type, i) =>
      local.slice(0, country.counts[i]).map((app, j) => ({
        id: `${app.id}-${type}`,
        appId: app.id,
        country: app.country,
        store: app.store,
        type,
        date: DEMO_DAY,
        at:
          type === 'firstSeen'
            ? app.firstSeenAt
            : `${DEMO_DAY}T${pad(type === 'updated' ? 10 : 9)}:${pad((j * 3) % 60)}:00+08:00`,
        before: type === 'updated' ? app.oldVersion : null,
        after: type === 'updated' ? app.version : null,
        summary:
          type === 'updated'
            ? '版本更新 · 功能优化'
            : type === 'firstSeen'
              ? '首次收录 · 确认为信贷应用'
              : `在 ${stores[app.store]} 上架`,
        observedAt: app.lastFetchedAt,
        source: app.source,
      })),
    );
  });
  const featuredIds = ['th-1-updated', 'mx-1-firstSeen', 'id-1-storeRelease', 'ph-1-updated'];
  ['10:24', '09:41', '08:12', '07:36'].forEach((time, i) => {
    const e = events.find((x) => x.id === featuredIds[i]);
    e.at = `${DEMO_DAY}T${time}:00+08:00`;
  });
  const phFirst = events.find((e) => e.id === 'ph-1-firstSeen');
  phFirst.at = `${DEMO_DAY}T07:30:00+08:00`;
  for (const event of events) {
    const first = events.find((e) => e.appId === event.appId && e.type === 'firstSeen');
    if (event.type !== 'firstSeen' && first && Date.parse(event.at) < Date.parse(first.at))
      event.at = first.at;
  }
  // Event time is observation time; store releases retain date-only source precision.
  for (const event of events) {
    const app = apps.find((a) => a.id === event.appId);
    if (event.type === 'firstSeen') app.firstSeenAt = event.at;
    event.observedAt = event.at;
    event.field = event.type === 'updated' ? 'version' : null;
    if (event.type === 'storeRelease') {
      event.releasedAt = app.releasedAt;
      event.releasePrecision = 'date';
    }
    if (event.type === 'updated') app.storeUpdatedAt = event.at;
    const times = [app.lastFetchedAt, app.firstSeenAt, app.storeUpdatedAt, event.observedAt].filter(
      Boolean,
    );
    app.lastFetchedAt = times.reduce((latest, time) =>
      Date.parse(time) > Date.parse(latest) ? time : latest,
    );
  }
  for (const app of apps) {
    if (app.storeUpdatedAt && Date.parse(app.storeUpdatedAt) > Date.parse(app.lastFetchedAt))
      app.lastFetchedAt = app.storeUpdatedAt;
    if (Date.parse(app.firstSeenAt) > Date.parse(app.lastFetchedAt))
      app.lastFetchedAt = app.firstSeenAt;
  }
  const companyEvent = events.find((e) => e.id === 'th-15-updated');
  companyEvent.field = 'seller';
  companyEvent.before = 'Siam Credit Finance Demo Ltd.';
  companyEvent.after = apps.find((a) => a.id === 'th-15').seller;
  companyEvent.summary = '发布公司资料更新 · 非版本事件';
  const termEvent = events.find((e) => e.id === 'th-17-updated');
  termEvent.field = 'loanTerm';
  termEvent.before = '60–90 天';
  termEvent.after = '90–180 天';
  termEvent.summary = '贷款期限声明更新 · 非版本事件';
  const historic = apps.find((a) => a.id === 'th-19');
  events.push({
    id: 'th-19-historical-update',
    appId: historic.id,
    country: 'th',
    store: historic.store,
    type: 'updated',
    date: '2026-09-07',
    at: '2026-09-07T09:20:00+08:00',
    observedAt: '2026-09-07T09:20:00+08:00',
    before: '1.1.0',
    after: '1.2.3',
    summary: '历史版本示例观测',
    field: 'version',
    source: historic.source,
  });
  return {
    apps,
    events,
    featuredIds,
    candidates: countries.flatMap((c, ci) =>
      [0, 1].map((i) => ({
        id: `candidate-${c.code}-${i}`,
        country: c.code,
        store: i ? 'app-store' : 'google-play',
        externalId: `demo.candidate.${c.code}.${i}`,
        title: `${prefixes[c.code]} 待核对 ${i + 1}`,
        status: 'pending',
        verdict: i ? 'possible' : 'strong',
        reason: i ? '缺少清晰还款条款' : '贷款申请与还款条款同时出现',
      })),
    ),
    rules: [
      {
        id: 'rule-1',
        name: '个人现金贷申请与还款证据',
        version: 'v1.4',
        enabled: true,
        description: '申请贷款 + 期限 / 金额 / 还款说明',
      },
      {
        id: 'rule-2',
        name: '仅计算器、理财与无贷款服务排除',
        version: 'v1.2',
        enabled: true,
        description: '识别否定语境，避免仅凭关键词确认',
      },
    ],
    tasks: [
      {
        id: 'task-101',
        name: '泰国 · 双商店资料更新',
        status: 'succeeded',
        at: '10:42',
        error: null,
      },
      {
        id: 'task-102',
        name: '墨西哥 · 搜索来源补充',
        status: 'failed',
        at: '10:38',
        error: '示例来源超时；保留上次成功数据',
      },
      { id: 'task-103', name: '菲律宾 · 评论增量', status: 'queued', at: '10:35', error: null },
    ],
    markets: countries.map((c) => ({
      ...c,
      enabled: true,
      keywords:
        c.code === 'mx' || c.code === 'ar' ? 'préstamo, crédito, dinero' : 'loan, credit, cash',
      interval: 1,
    })),
    workspaces: {
      north: {
        name: '北辰研究',
        following: ['th-1', 'mx-1', 'ph-1'],
        groups: [
          { id: 'ng1', name: '东南亚重点', appIds: ['th-1', 'ph-1'] },
          { id: 'ng2', name: '拉美观察', appIds: ['mx-1'] },
        ],
        notes: [
          {
            id: 'n1',
            appId: 'th-1',
            text: '重点观察新版申请流程，后续对比同市场产品。',
            author: '林研究员',
            date: DEMO_DAY,
            source: apps[0].source,
            eventId: 'th-1-updated',
          },
        ],
        collections: [
          { id: 'c1', name: '东南亚重点样本', appIds: ['th-1', 'ph-1', 'id-1'], noteIds: ['n1'] },
          { id: 'c2', name: '拉美研究', appIds: ['mx-1', 'ar-1'], noteIds: [] },
        ],
        requests: [],
        members: [
          { id: 'm1', name: '林研究员', email: 'lin@example.test', role: 'researcher' },
          { id: 'm2', name: '陈同学', email: 'chen@example.test', role: 'viewer' },
        ],
      },
      south: {
        name: '远山研究',
        following: ['ar-1', 'th-1'],
        groups: [
          { id: 'sg1', name: '拉美借贷', appIds: ['ar-1'] },
          { id: 'sg2', name: '泰国对照', appIds: ['th-1'] },
        ],
        notes: [
          {
            id: 's1',
            appId: 'th-1',
            text: '远山空间的资金桥独立研究笔记，请与拉美样本对照。',
            author: '周研究员',
            date: DEMO_DAY,
            source: apps[0].source,
            eventId: 'th-1-updated',
          },
        ],
        collections: [
          { id: 's-c1', name: '拉美观察', appIds: ['ar-1', 'mx-1'], noteIds: [] },
          { id: 's-c2', name: '亚洲对照', appIds: ['th-1'], noteIds: ['s1'] },
        ],
        requests: [],
        members: [{ id: 'sm1', name: '周研究员', email: 'zhou@example.test', role: 'researcher' }],
      },
    },
  };
}
export function storeSource(app) {
  return app.store === 'google-play'
    ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(app.externalId)}&gl=${app.country}`
    : `https://apps.apple.com/${app.country}/app/id${encodeURIComponent(app.externalId)}`;
}
export function createPendingDemo(apps, events) {
  if (apps.some((a) => a.id === 'th-new-demo')) return { apps: [...apps], events: [...events] };
  const original = apps.find((a) => a.id === 'th-1');
  const added = {
    ...original,
    id: 'th-new-demo',
    title: 'Siam Bridge 新发现 Demo',
    externalId: 'com.th.newcreditdemo',
    firstSeenAt: DEMO_NOW,
    releasedAt: '2026-08-20',
    lastFetchedAt: DEMO_NOW,
    version: '1.0.0',
    oldVersion: null,
    screenshots: [],
    iconUrl: null,
    iconIndex: null,
    iconNote: '新模拟身份尚未取得图标',
    reviews: [],
  };
  added.source = storeSource(added);
  added.description = '新发现的个人现金贷款演示，金额和期限待核对，不代表真实商店应用。';
  return {
    apps: [added, ...apps],
    events: [
      {
        id: 'th-new-demo-firstSeen',
        appId: added.id,
        country: 'th',
        store: added.store,
        type: 'firstSeen',
        date: DEMO_DAY,
        at: DEMO_NOW,
        before: null,
        after: null,
        summary: '演示检测新发现 · 点击更新后应用',
        observedAt: DEMO_NOW,
        source: added.source,
      },
      ...events,
    ],
  };
}
export function admitCandidate(model, id) {
  const candidate = model.candidates.find((c) => c.id === id);
  if (!candidate || candidate.status !== 'pending') return model;
  const old = model.apps.find(
    (a) =>
      a.country === candidate.country &&
      a.store === candidate.store &&
      a.externalId === candidate.externalId,
  );
  const candidates = model.candidates.map((c) =>
    c.id === id ? { ...c, status: 'approved', appId: old?.id || `admitted-${id}` } : c,
  );
  if (old) return { ...model, candidates };
  const base =
    model.apps.find((a) => a.country === candidate.country && a.store === candidate.store) ||
    model.apps.find((a) => a.store === candidate.store);
  const app = {
    ...base,
    id: `admitted-${id}`,
    country: candidate.country,
    store: candidate.store,
    title: candidate.title,
    externalId: candidate.externalId,
    firstSeenAt: DEMO_NOW,
    lastFetchedAt: DEMO_NOW,
    releasedAt: null,
    storeUpdatedAt: null,
    classification: 'confirmed',
    loanType: 'personal',
    classificationSource: 'manual',
    description: `${candidate.title} 是模拟核对的个人现金贷款应用。来源和条件均为原型示例，不代表真实采集。`,
    screenshots: [],
    iconUrl: null,
    iconIndex: null,
    iconNote: '新模拟身份尚未取得图标',
    reviews: [],
    version: '1.0.0',
    oldVersion: null,
  };
  app.source = storeSource(app);
  return {
    ...model,
    candidates,
    apps: [...model.apps, app],
    events: [
      ...model.events,
      {
        id: `${app.id}-firstSeen`,
        appId: app.id,
        country: app.country,
        store: app.store,
        type: 'firstSeen',
        date: DEMO_DAY,
        at: DEMO_NOW,
        observedAt: DEMO_NOW,
        source: app.source,
        before: null,
        after: null,
        summary: '运营确认后首次收录 · 示例',
      },
    ],
  };
}

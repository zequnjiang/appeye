import express, { type ErrorRequestHandler, type Request } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Store } from './db.js';
import { enrichmentKinds, type Providers, type StoreName } from './types.js';
import type { Worker } from './worker.js';
import { activityWindow, getMarketActivity, type CollectionStatus } from './market-activity.js';
import { getCollectionStatus } from './hourly-monitor.js';
import {
  discoveryIdentity,
  getDiscoveryStatus,
  listDiscoveryCandidates,
  recordKnownIdentity,
} from './extended-discovery.js';
import { earliestKnownDiscovery } from './manual-collection.js';
import { createWorkspaceAuth, HttpError, type Actor, audit } from './workspace-auth.js';
import { researchRouter, publicApp } from './workspace-research.js';
import { workspaceRouter, platformRouter } from './workspace-admin.js';
import {
  queryMarket,
  workspaceActivity,
  category,
  displayReleaseEvidence,
  exportMarketCsv,
} from './workspace-market.js';

export const limitations = [
  '首次发现是本系统第一次观察到该应用的时间，不代表实际新上架；商店提供的发布日期单独保存。',
  'Google Play 安装量为商店公开累计区间，不是国家下载量、日下载量或精确销量；App Store 不公开下载量，统一显示未知。',
  '关键词搜索形成有限样本，覆盖受搜索排序、语言、地区及结果上限影响，不能代表全市场。新应用有强信贷证据时自动确认，其余保留候选；人工及历史分类优先，自动识别不代表持牌或合规认定。',
  '变化和更新频率仅基于本系统采集以来的快照，不补造历史；版本观测不足时频率为未知。',
  '评论是有限的近期样本。Google Play 请求指定语言与国家；App Store 按店面采集，实际评论语言未验证。',
  '采集失败只记录错误，不自动推断应用下架。',
];
const storeName = z.enum(['google-play', 'app-store']);
const classification = z.enum(['candidate', 'confirmed', 'excluded']);
const countrySchema = z
  .object({
    code: z.string().regex(/^[a-z]{2}$/),
    name: z.string().trim().min(1).max(80),
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/),
    keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    enabled: z.boolean().default(true),
    intervalHours: z.literal(1).default(1),
  })
  .strict();
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const filterSchema = pageSchema.extend({
  country: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  store: storeName.optional(),
  classification: classification.optional(),
  loanVerdict: z.enum(['strong', 'possible', 'insufficient']).optional(),
  q: z.string().max(200).optional(),
});
export interface AppOptions {
  store: Store;
  password?: string;
  sessionSecret?: string;
  providers?: Providers;
  worker?: Worker;
  collection?: {
    status(): CollectionStatus;
    discovery?: { status(): ReturnType<typeof getDiscoveryStatus> };
  };
  demoMode?: boolean;
  allowedOrigins?: string[];
  clientPath?: string;
  secureCookies?: boolean;
}
export function createApp(options: AppOptions) {
  const { store } = options;
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'https:'],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'connect-src': ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  app.use(express.json({ limit: '128kb' }));
  const password = options.password ?? '';
  const dataset = options.demoMode ? 'demo' : 'live';
  const auth = createWorkspaceAuth(
    store,
    password,
    dataset,
    options.secureCookies,
    options.sessionSecret,
  );
  const allowedOrigins =
    options.allowedOrigins ??
    (process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5173']);
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    const sameOrigin = `${req.protocol}://${req.get('host')}`;
    if (
      (origin && origin !== sameOrigin && !allowedOrigins.includes(origin)) ||
      req.get('sec-fetch-site') === 'cross-site'
    )
      return next(new HttpError(403, '请求来源不被允许'));
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, dataset }));
  app.get('/api/auth/session', (req, res) => res.json(auth.session(auth.current(req))));
  const authLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '登录尝试过多，请稍后再试' },
  });
  app.post('/api/auth/login', authLimiter, auth.login);
  app.get('/api/auth/invitations/:token', (req, res) => {
    const invitation = auth.invitation(String(req.params.token));
    res.json({
      invitation: {
        email: invitation.email,
        role: invitation.role,
        workspaceName: invitation.workspace_name,
        expiresAt: invitation.expires_at,
      },
    });
  });
  app.post('/api/auth/accept', authLimiter, auth.accept);
  app.use('/api', (req, res, next) => {
    const actor = auth.current(req);
    if (!actor) return next(new HttpError(401, '请先登录'));
    res.locals.actor = actor;
    next();
  });
  app.post('/api/auth/logout', (req, res) => {
    auth.logout(req);
    res.clearCookie('appeye_session', { ...auth.cookieOptions, maxAge: undefined });
    res.json({ authenticated: false });
  });
  app.post('/api/auth/workspace', (req, res) => {
    const actor = res.locals.actor as Actor,
      input = z.object({ workspaceId: z.number().int().positive() }).strict().parse(req.body);
    if (
      actor.role === 'platform' ||
      !auth.workspaces(actor.id).some((w) => w.id === input.workspaceId)
    )
      throw new HttpError(403, '不是该客户空间的有效成员');
    auth.logout(req);
    res.json(auth.issue(res, actor.id, input.workspaceId));
  });
  app.get('/api/market/apps', (req, res) =>
    res.json(queryMarket(store, res.locals.actor as Actor, req.query)),
  );
  app.get('/api/market/apps.csv', (req, res) => {
    const csv = exportMarketCsv(store, res.locals.actor as Actor, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="appeye-market-apps.csv"');
    res.send(csv);
  });
  app.get('/api/market/activity', (req, res) => {
    try {
      res.json({ ...workspaceActivity(store, req.query), dataset });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : '无效查询');
    }
  });
  app.use('/api/research', researchRouter(store));
  app.use('/api/workspaces', workspaceRouter(store));
  app.use('/api/platform', platformRouter(store, options.demoMode));
  // Legacy administrative endpoints also enforce the current principal. The only
  // customer-readable legacy branches are countries and confirmed app evidence.
  app.use('/api', (req, res, next) => {
    const actor = res.locals.actor as Actor;
    if (actor.role === 'platform') return next();
    if (req.method === 'GET' && req.path === '/countries') return next();
    const detail =
      /^\/apps\/(\d+)(?:\/(?:discoveries|enrichments(?:\/[^/]+\/history)?|snapshots|changes|reviews))?$/.exec(
        req.path,
      );
    if (req.method === 'GET' && detail) {
      publicApp(store, Number(detail[1]));
      return next();
    }
    return next(new HttpError(403, '此接口仅限平台运营'));
  });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      res.on('finish', () => {
        if (res.statusCode < 400)
          audit(store, res.locals.actor as Actor, `legacy.${req.method.toLowerCase()}`, req.path);
      });
    next();
  });
  app.get('/api/overview', (_req, res) => res.json({ ...store.overview(), dataset, limitations }));
  app.get('/api/market-activity', (req, res) => {
    const query = z
      .object({
        date: z.string().optional(),
        timeZone: z.literal('Asia/Shanghai').optional(),
        country: z
          .string()
          .regex(/^[a-z]{2}$/)
          .optional(),
        store: storeName.optional(),
        classification: classification.optional(),
        type: z.enum(['all', 'firstSeen', 'storeRelease', 'observedUpdate']).default('all'),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .strict()
      .parse(req.query);
    if (query.country && !store.getCountry(query.country)) throw new HttpError(400, '国家不存在');
    try {
      activityWindow(query.date, query.timeZone);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    res.json({ ...getMarketActivity(store, query), dataset });
  });
  app.get('/api/collection/status', (_req, res) =>
    res.json(
      options.collection?.status() ??
        getCollectionStatus(store, {
          enabled: false,
          mode: options.demoMode ? 'demo' : 'external',
        }),
    ),
  );
  app.get('/api/collection/tasks', (req, res) => {
    const page = pageSchema.parse(req.query);
    res.json({
      tasks: store
        .all(
          'SELECT id,cycle_id cycleId,kind,country,store,external_id externalId,app_id appId,payload,status,attempts,next_run_at nextRunAt,created_at createdAt,started_at startedAt,finished_at finishedAt,error,result,response_id responseId FROM monitor_tasks ORDER BY id DESC LIMIT ? OFFSET ?',
          page.limit,
          page.offset,
        )
        .map((row) => ({
          ...row,
          payload: JSON.parse(row.payload),
          result: row.result ? JSON.parse(row.result) : null,
        })),
      total: store.one('SELECT COUNT(*) n FROM monitor_tasks')!.n,
      ...page,
    });
  });
  app.get('/api/collection/tasks/:id', (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id),
      task = store.one('SELECT * FROM monitor_tasks WHERE id=?', id);
    if (!task) throw new HttpError(404, '小时采集任务不存在');
    res.json({
      task,
      attempts: store.all('SELECT * FROM monitor_attempts WHERE task_id=? ORDER BY id', id),
      responses: store
        .all('SELECT * FROM monitor_responses WHERE task_id=? ORDER BY id', id)
        .map((row) => ({ ...row, data: JSON.parse(row.data) })),
      http: store.all(
        'SELECT id,fetched_at,url,method,status,content_type,error FROM monitor_http WHERE task_id=? ORDER BY id',
        id,
      ),
    });
  });
  app.get('/api/countries', (_req, res) => res.json({ countries: store.listCountries() }));
  app.post('/api/countries', (req, res) => {
    const data = countrySchema.parse(req.body);
    if (store.getCountry(data.code)) throw new HttpError(409, '国家已存在，请编辑现有配置');
    res
      .status(201)
      .json({ country: store.upsertCountry({ ...data, keywords: [...new Set(data.keywords)] }) });
  });
  app.patch('/api/countries/:code', (req, res) => {
    const code = z
      .string()
      .regex(/^[a-z]{2}$/)
      .parse(req.params.code);
    const current = store.getCountry(code);
    if (!current) throw new HttpError(404, '国家不存在');
    const data = countrySchema.omit({ code: true }).partial().strict().parse(req.body);
    const merged = { ...current, ...data };
    res.json({
      country: store.upsertCountry({ ...merged, keywords: [...new Set(merged.keywords)] }),
    });
  });
  app.get('/api/apps', (req, res) => res.json(store.listApps(filterSchema.parse(req.query))));
  app.get('/api/discovery/status', (_req, res) =>
    res.json(options.collection?.discovery?.status() ?? getDiscoveryStatus(store)),
  );
  app.get('/api/discovery/candidates', (req, res) => {
    const filters = pageSchema
      .extend({
        country: z
          .string()
          .regex(/^[a-z]{2}$/)
          .optional(),
        store: storeName.optional(),
        status: z.enum(['pending', 'staged', 'admitted', 'failed']).optional(),
      })
      .parse(req.query);
    res.json(listDiscoveryCandidates(store, filters));
  });
  app.get('/api/discovery/identity', (req, res) => {
    const identity = pageSchema
      .extend({
        country: z.string().regex(/^[a-z]{2}$/),
        store: storeName,
        externalId: z.string().trim().min(1).max(200),
      })
      .parse(req.query);
    res.json(discoveryIdentity(store, identity));
  });
  app.get('/api/discovery/tasks/:id', (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const task = store.one('SELECT * FROM discovery_tasks WHERE id=?', id);
    if (!task) throw new HttpError(404, '发现任务不存在');
    const { limit, offset } = pageSchema.parse(req.query);
    res.json({
      task,
      responses: store
        .all(
          'SELECT * FROM discovery_responses WHERE task_id=? ORDER BY id DESC LIMIT ? OFFSET ?',
          id,
          limit,
          offset,
        )
        .map((r) => ({ ...r, data: JSON.parse(r.data) })),
      responsesTotal: store.one('SELECT COUNT(*) n FROM discovery_responses WHERE task_id=?', id)!
        .n,
      http: store.all(
        'SELECT * FROM discovery_http WHERE task_id=? ORDER BY id DESC LIMIT ? OFFSET ?',
        id,
        limit,
        offset,
      ),
      httpTotal: store.one('SELECT COUNT(*) n FROM discovery_http WHERE task_id=?', id)!.n,
    });
  });
  const liveOnly = () => {
    if (options.demoMode)
      throw new HttpError(409, '演示模式使用隔离样例数据，不能启动真实采集；请切换正式数据库');
  };
  const requireCountry = (code: string) => {
    const country = store.getCountry(code);
    if (!country) throw new HttpError(404, '国家不存在');
    return country;
  };
  app.post('/api/apps', (req, res) => {
    liveOnly();
    const data = z
      .object({
        store: storeName,
        externalId: z.string().trim().min(1).max(200),
        country: z.string().regex(/^[a-z]{2}$/),
      })
      .strict()
      .parse(req.body);
    requireCountry(data.country);
    if (data.store === 'app-store' && !/^\d+$/.test(data.externalId))
      throw new HttpError(400, 'App Store 请填写数字应用 ID');
    if (
      data.store === 'google-play' &&
      !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(data.externalId)
    )
      throw new HttpError(400, 'Google Play 请填写合法包名，如 com.example.loan');
    const existing = store.one(
      'SELECT id FROM apps WHERE country=? AND store=? AND external_id=?',
      data.country,
      data.store,
      data.externalId,
    );
    const record = store.createApp({
      ...data,
      observedAt: existing
        ? new Date().toISOString()
        : earliestKnownDiscovery(store, data, new Date().toISOString()),
    });
    const job = store.enqueueJob({
      type: 'refresh',
      country: record.country,
      store: record.store,
      appId: record.id,
    });
    recordKnownIdentity(store, record, job.id, new Date().toISOString());
    res.status(201).json({ app: record, job });
  });
  const appId = (req: Request) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    if (!store.getApp(id)) throw new HttpError(404, '应用不存在');
    return id;
  };
  app.get('/api/apps/:id', (req, res) => {
    const id = appId(req),
      record = store.getApp(id)!,
      release = displayReleaseEvidence(record);
    res.json({
      app: {
        ...record,
        ...category(store, id),
        releasedAt: release.releasedAt,
        releasedAtPrecision: release.releasedAtPrecision,
        releasedAtRaw: release.releasedAtRaw,
      },
      rawDetail: store.getRawDetail(id),
      enrichments: store.listEnrichments(id),
      discoveries: store.listDiscoveries(id, 20).discoveries,
      snapshots: store.listSnapshots(id, 50).snapshots,
      changes: store.listChanges({ appId: id, limit: 100 }).changes,
      reviews: store.listReviews(id, { limit: 50 }).reviews,
      limitations,
    });
  });
  app.patch('/api/apps/:id', (req, res) => {
    const id = appId(req);
    const input = z
      .union([
        z.object({ classification }).strict(),
        z.object({ classificationMode: z.literal('auto') }).strict(),
        z.object({ mode: z.literal('auto') }).strict(),
      ])
      .parse(req.body);
    res.json({
      app:
        'classification' in input
          ? store.updateClassification(id, input.classification)
          : store.setClassificationMode(id, 'auto'),
    });
  });
  app.get('/api/apps/:id/discoveries', (req, res) => {
    const id = appId(req);
    const page = pageSchema.parse(req.query);
    res.json(store.listDiscoveries(id, page.limit, page.offset));
  });
  app.get('/api/apps/:id/enrichments', (req, res) =>
    res.json({ enrichments: store.listEnrichments(appId(req)) }),
  );
  app.get('/api/apps/:id/enrichments/:kind/history', (req, res) => {
    const id = appId(req);
    const kind = z.enum(enrichmentKinds).parse(req.params.kind);
    const page = pageSchema.parse(req.query);
    res.json(store.listEnrichmentHistory(id, kind, page.limit, page.offset));
  });
  app.get('/api/apps/:id/snapshots', (req, res) => {
    const id = appId(req),
      page = pageSchema.parse(req.query);
    res.json(store.listSnapshots(id, page.limit, page.offset));
  });
  app.get('/api/apps/:id/changes', (req, res) =>
    res.json(store.listChanges({ ...pageSchema.parse(req.query), appId: appId(req) })),
  );
  app.get('/api/apps/:id/reviews', (req, res) =>
    res.json(
      store.listReviews(
        appId(req),
        pageSchema
          .extend({
            score: z.coerce.number().int().min(1).max(5).optional(),
            language: z.string().max(20).optional(),
            since: z.iso.datetime().optional(),
          })
          .parse(req.query),
      ),
    ),
  );
  app.get('/api/changes', (req, res) =>
    res.json(
      store.listChanges(
        filterSchema
          .extend({ field: z.string().max(50).optional(), since: z.iso.datetime().optional() })
          .parse(req.query),
      ),
    ),
  );
  app.get('/api/jobs', (req, res) =>
    res.json(
      store.listJobs(
        pageSchema
          .extend({
            status: z.enum(['queued', 'running', 'succeeded', 'failed']).optional(),
            type: z.enum(['discover', 'refresh', 'reviews', 'enrich']).optional(),
            country: z
              .string()
              .regex(/^[a-z]{2}$/)
              .optional(),
          })
          .parse(req.query),
      ),
    ),
  );
  app.post('/api/jobs', (req, res) => {
    liveOnly();
    const input = z
      .object({
        type: z.enum(['discover', 'refresh', 'reviews', 'enrich']),
        country: z
          .string()
          .regex(/^[a-z]{2}$/)
          .optional(),
        store: storeName.optional(),
        appId: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    if (input.type !== 'discover') {
      if (!input.appId) throw new HttpError(400, '应用采集任务需要 appId');
      const record = store.getApp(input.appId);
      if (!record) throw new HttpError(404, '应用不存在');
      if (
        (input.country && input.country !== record.country) ||
        (input.store && input.store !== record.store)
      )
        throw new HttpError(400, '任务国家或商店与应用不匹配');
      const job = store.enqueueJob({
        type: input.type,
        country: record.country,
        store: record.store,
        appId: record.id,
      });
      return res.status(202).json({ job, jobs: [job] });
    }
    if (input.appId) throw new HttpError(400, '发现任务不接受 appId');
    const countries = input.country
      ? [requireCountry(input.country)]
      : store.listCountries().filter((c) => c.enabled);
    const stores: StoreName[] = input.store ? [input.store] : ['google-play', 'app-store'];
    const jobs = countries.flatMap((c) =>
      stores.map((s) => store.enqueueJob({ type: 'discover', country: c.code, store: s })),
    );
    res.status(202).json({ jobs, job: jobs[0] ?? null });
  });
  app.post('/api/jobs/:id/retry', (req, res) => {
    liveOnly();
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const job = store.getJob(id);
    if (!job) throw new HttpError(404, '任务不存在');
    if (job.status !== 'failed') throw new HttpError(409, '只有失败任务可以重试');
    try {
      res.json({ job: store.retryJob(id) });
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '已有相同任务正在排队或执行');
      throw error;
    }
  });
  app.get('/api/export/apps.csv', (req, res) => {
    const filter = filterSchema.parse(req.query);
    const columns = [
      'id',
      'store',
      'externalId',
      'country',
      'classification',
      'title',
      'developer',
      'version',
      'score',
      'ratings',
      'installs',
      'minInstalls',
      'maxInstalls',
      'releasedAt',
      'storeUpdatedAt',
      'firstSeenAt',
      'lastFetchedAt',
      'updateCount',
      'observedUpdateIntervalDays',
    ] as const;
    const cell = (value: unknown) => {
      let s = value == null ? '' : String(value);
      if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="appeye-${dataset}-apps.csv"`);
    res.write('\uFEFF' + columns.join(',') + ',dataset,installsScope\r\n');
    let offset = 0;
    while (true) {
      const batch = store.listApps({ ...filter, limit: 1000, offset }).apps;
      if (!batch.length) break;
      for (const row of batch)
        res.write(
          columns
            .map((k) => cell(row[k]))
            .concat(
              cell(dataset),
              cell(
                row.store === 'google-play'
                  ? 'store-public-cumulative-not-country-downloads'
                  : 'unavailable',
              ),
            )
            .join(',') + '\r\n',
        );
      offset += batch.length;
    }
    res.end();
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API 不存在')));
  const clientPath = options.clientPath ?? resolve('dist/client');
  if (existsSync(resolve(clientPath, 'index.html'))) {
    app.use(express.static(clientPath));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(clientPath, 'index.html')));
  }
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return void res.status(400).json({ error: '输入参数不合法', details: error.issues });
    if (error instanceof HttpError)
      return void res
        .status(error.status)
        .json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    if (error instanceof SyntaxError && 'body' in error)
      return void res.status(400).json({ error: 'JSON 格式不正确' });
    console.error(error);
    res.status(500).json({ error: '服务器内部错误，请查看服务日志' });
  };
  app.use(errorHandler);
  return app;
}

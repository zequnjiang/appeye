import express, { type ErrorRequestHandler, type Request } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Store } from './db.js';
import type { Providers, StoreName } from './types.js';
import type { Worker } from './worker.js';

export const limitations = [
  '首次发现是本系统第一次观察到该应用的时间，不代表实际新上架；商店提供的发布日期单独保存。',
  'Google Play 安装量为商店公开累计区间，不是国家下载量、日下载量或精确销量；App Store 不公开下载量，统一显示未知。',
  '关键词搜索只形成候选样本，覆盖受搜索排序、语言、地区及结果上限影响；候选需人工确认，不能代表全市场。',
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
    intervalHours: z.number().min(1).max(720).default(24),
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
  q: z.string().max(200).optional(),
});
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface AppOptions {
  store: Store;
  password?: string;
  sessionSecret?: string;
  providers?: Providers;
  worker?: Worker;
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
  const secret = options.sessionSecret ?? randomBytes(32).toString('hex');
  const sessions = new Map<string, number>();
  const dataset = options.demoMode ? 'demo' : 'live';
  const sign = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
  const authenticated = (req: Request) => {
    const value = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('appeye_session='))
      ?.slice(15);
    if (!value) return false;
    const [id, signature] = value.split('.');
    if (!id || !signature || signature.length !== 64) return false;
    const expected = sign(id);
    if (
      !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      return false;
    const expires = sessions.get(id);
    if (!expires || expires <= Date.now()) {
      sessions.delete(id);
      return false;
    }
    return true;
  };
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: options.secureCookies ?? false,
    path: '/',
    maxAge: 12 * 3600000,
  };
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
  app.get('/api/auth/session', (req, res) =>
    res.json({ authenticated: authenticated(req), configured: !!password, dataset }),
  );
  app.post(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60000,
      limit: 15,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: '登录尝试过多，请稍后再试' },
    }),
    (req, res) => {
      if (!password)
        throw new HttpError(503, '尚未设置 ADMIN_PASSWORD，请在 .env 中配置后重启服务');
      const input = z.object({ password: z.string().max(1024) }).parse(req.body);
      const digest = (value: string) => createHash('sha256').update(value).digest();
      if (!timingSafeEqual(digest(input.password), digest(password)))
        throw new HttpError(401, '密码不正确');
      for (const [id, expires] of sessions) if (expires < Date.now()) sessions.delete(id);
      const id = randomBytes(32).toString('hex');
      sessions.set(id, Date.now() + cookieOptions.maxAge);
      res.cookie('appeye_session', `${id}.${sign(id)}`, cookieOptions);
      res.json({ authenticated: true, dataset });
    },
  );
  app.use('/api', (req, _res, next) => {
    if (!authenticated(req)) return next(new HttpError(401, '请先登录'));
    next();
  });
  app.post('/api/auth/logout', (req, res) => {
    const value = req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('appeye_session='))
      ?.slice(15);
    if (value) sessions.delete(value.split('.')[0]!);
    res.clearCookie('appeye_session', { ...cookieOptions, maxAge: undefined });
    res.json({ authenticated: false });
  });
  app.get('/api/overview', (_req, res) => res.json({ ...store.overview(), dataset, limitations }));
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
    const record = store.createApp(data);
    const job = store.enqueueJob({
      type: 'refresh',
      country: record.country,
      store: record.store,
      appId: record.id,
    });
    res.status(201).json({ app: record, job });
  });
  const appId = (req: Request) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    if (!store.getApp(id)) throw new HttpError(404, '应用不存在');
    return id;
  };
  app.get('/api/apps/:id', (req, res) => {
    const id = appId(req);
    res.json({
      app: store.getApp(id),
      snapshots: store.listSnapshots(id, 50).snapshots,
      changes: store.listChanges({ appId: id, limit: 100 }).changes,
      reviews: store.listReviews(id, { limit: 50 }).reviews,
      limitations,
    });
  });
  app.patch('/api/apps/:id', (req, res) => {
    const id = appId(req);
    const input = z.object({ classification }).strict().parse(req.body);
    res.json({ app: store.updateClassification(id, input.classification) });
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
            type: z.enum(['discover', 'refresh', 'reviews']).optional(),
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
        type: z.enum(['discover', 'refresh', 'reviews']),
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
      return void res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError && 'body' in error)
      return void res.status(400).json({ error: 'JSON 格式不正确' });
    console.error(error);
    res.status(500).json({ error: '服务器内部错误，请查看服务日志' });
  };
  app.use(errorHandler);
  return app;
}

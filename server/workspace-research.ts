import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Store } from './db.js';
import { HttpError, audit, timestamp, type Actor } from './workspace-auth.js';
import { releaseEvidence } from './market-activity.js';
import { libraryRows } from './workspace-market.js';

export const positiveId = z.coerce.number().int().positive();
const name = z.string().trim().min(1).max(100);
export const identityInput = z.object({
  country: z.string().regex(/^[a-z]{2}$/),
  store: z.enum(['google-play', 'app-store']),
  externalId: z.string().trim().min(1).max(200),
});
export function checkIdentity(store: Store, value: z.infer<typeof identityInput>) {
  if (!store.getCountry(value.country)) throw new HttpError(400, '国家不存在');
  if (
    value.store === 'app-store'
      ? !/^\d+$/.test(value.externalId)
      : !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(value.externalId)
  )
    throw new HttpError(400, '商店应用 ID 格式不正确');
}
export function publicApp(store: Store, id: number) {
  const app = store.getApp(id);
  if (!app || app.classification !== 'confirmed')
    throw new HttpError(404, '应用不存在或当前不在客户应用库');
  return app;
}
function actorOf(res: Response): Actor {
  return res.locals.actor as Actor;
}
export function requireCustomer(res: Response, write = false) {
  const actor = actorOf(res);
  if (actor.workspaceId == null || actor.role === 'platform')
    throw new HttpError(403, '平台身份没有客户研究权限，请使用受邀请的客户账号');
  if (write && actor.role === 'viewer') throw new HttpError(403, '只读成员不能修改研究数据');
  return actor;
}
function own(
  store: Store,
  table: 'research_groups' | 'research_collections' | 'research_entries',
  id: number,
  actor: Actor,
) {
  const row = store.one(
    `SELECT * FROM ${table} WHERE id=? AND workspace_id=?`,
    id,
    actor.workspaceId,
  );
  if (!row) throw new HttpError(404, '对象不存在或不属于当前空间');
  return row;
}
function appIdentity(app: Record<string, any>) {
  return {
    id: app.id,
    title: app.title,
    externalId: app.externalId,
    country: app.country,
    store: app.store,
  };
}
function safeUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function citationFor(store: Store, appId: number, input: unknown) {
  const selected = z
    .object({
      kind: z.enum(['app', 'snapshot', 'change', 'review', 'enrichment']),
      recordId: positiveId.optional(),
      field: z.string().max(100).optional(),
      quote: z.string().min(1).max(30000).optional(),
    })
    .strict()
    .parse(input);
  const app = publicApp(store, appId);
  let source: unknown,
    sourceObservedAt: string | null = null,
    sourceUrl = safeUrl(app.url),
    recordId = selected.recordId ?? null,
    field = selected.field;
  if (selected.kind === 'app') {
    if (selected.recordId) throw new HttpError(400, '当前资料引用不能自指定历史记录 ID');
    field ??= 'description';
    if (
      ![
        'title',
        'developer',
        'description',
        'summary',
        'releaseNotes',
        'developerWebsite',
        'privacyPolicy',
      ].includes(field)
    )
      throw new HttpError(400, '不能引用该当前资料字段');
    source = (app as unknown as Record<string, unknown>)[field];
    sourceObservedAt = app.lastFetchedAt ?? app.lastSeenAt;
    const latest = store.one(
      'SELECT id FROM snapshots WHERE app_id=? ORDER BY observed_at DESC,id DESC LIMIT 1',
      appId,
    );
    recordId = latest?.id ?? null;
  } else {
    if (!recordId) throw new HttpError(400, '引用必须包含来源记录 ID');
    const table = {
      snapshot: 'snapshots',
      change: 'changes',
      review: 'reviews',
      enrichment: 'enrichment_history',
    }[selected.kind];
    const row = store.one(`SELECT * FROM ${table} WHERE id=? AND app_id=?`, recordId, appId);
    if (!row) throw new HttpError(404, '来源记录不属于该应用');
    if (selected.kind === 'snapshot') {
      field ??= 'description';
      const data = JSON.parse(row.data);
      if (!Object.hasOwn(data, field)) throw new HttpError(400, '该快照没有指定字段');
      source = data[field];
      sourceObservedAt = row.observed_at;
      sourceUrl = safeUrl(data.url);
    } else if (selected.kind === 'change') {
      if (field && field !== row.field) throw new HttpError(400, '变更字段与来源不匹配');
      field = row.field;
      source = { oldValue: JSON.parse(row.old_value), newValue: JSON.parse(row.new_value) };
      sourceObservedAt = row.observed_at;
      const snap = row.snapshot_id
        ? store.one('SELECT data FROM snapshots WHERE id=? AND app_id=?', row.snapshot_id, appId)
        : null;
      sourceUrl = snap ? safeUrl(JSON.parse(snap.data).url) : null;
    } else if (selected.kind === 'review') {
      if (field && field !== 'text') throw new HttpError(400, '评价仅可引用正文');
      field = 'text';
      source = row.text;
      sourceObservedAt = row.fetched_at;
    } else {
      if (!['available', 'empty'].includes(row.status))
        throw new HttpError(400, '补充来源尚未成功，无法作为已采集原文引用');
      field = row.kind;
      source = row.data ? JSON.parse(row.data) : null;
      sourceObservedAt = row.fetched_at;
      sourceUrl = safeUrl(row.source);
    }
  }
  if (source == null || source === '') throw new HttpError(400, '来源字段未提供原文');
  const fullText = typeof source === 'string' ? source : JSON.stringify(source, null, 2);
  const quote = selected.quote ?? fullText;
  if (quote.length > 30000) throw new HttpError(400, '来源较长，请选择不超过30000字的原文片段');
  if (!fullText.includes(quote)) throw new HttpError(400, '摘录与来源原文不匹配');
  return {
    kind: selected.kind,
    recordId,
    field,
    quote,
    sourceUrl,
    sourceObservedAt,
    app: appIdentity(app),
  };
}
export function requestRows(store: Store, workspaceId?: number) {
  // Derive status only from the linked real job/detail; creating a placeholder never admits it.
  for (const row of store.all(
    `SELECT r.*,j.status job_status,j.error job_error,j.created_at job_created_at FROM research_requests r LEFT JOIN jobs j ON j.id=r.job_id WHERE r.status IN ('processing','review','admitted') ${workspaceId ? 'AND r.workspace_id=?' : ''}`,
    ...(workspaceId ? [workspaceId] : []),
  )) {
    const app = row.app_id ? store.getApp(row.app_id) : null;
    let status = row.status,
      error = row.error,
      observed = row.result_observed_at;
    if (
      row.job_status === 'succeeded' &&
      app?.lastFetchedAt &&
      app.lastFetchedAt >= row.job_created_at
    ) {
      status = app.classification === 'confirmed' ? 'admitted' : 'review';
      error = null;
      observed = app.lastFetchedAt;
    } else if (row.job_status === 'succeeded') {
      status = 'failed';
      error = '任务结束但未取得本次成功详情，请核对来源后重试';
    } else if (row.job_status === 'failed') {
      status = 'failed';
      error = row.job_error ?? '资料采集失败';
    } else if (row.status === 'admitted' && app?.classification !== 'confirmed') status = 'review';
    if (status !== row.status || error !== row.error || observed !== row.result_observed_at)
      store.run(
        'UPDATE research_requests SET status=?,error=?,result_observed_at=?,updated_at=? WHERE id=?',
        status,
        error,
        observed,
        timestamp(),
        row.id,
      );
  }
  return store
    .all(
      `SELECT r.*,w.name workspace_name FROM research_requests r JOIN research_workspaces w ON w.id=r.workspace_id ${workspaceId ? 'WHERE r.workspace_id=?' : ''} ORDER BY r.id DESC`,
      ...(workspaceId ? [workspaceId] : []),
    )
    .map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      country: r.country,
      store: r.store,
      externalId: r.external_id,
      status: r.status,
      appId: r.app_id,
      jobId: r.job_id,
      error: r.error,
      note: r.note,
      resultObservedAt: r.result_observed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}
function entryRow(store: Store, row: Record<string, any>) {
  return {
    id: row.id,
    appId: row.app_id,
    appIdentity: JSON.parse(row.app_identity),
    appVisible:
      store.one('SELECT classification FROM apps WHERE id=?', row.app_id)?.classification ===
      'confirmed',
    collectionId: row.collection_id,
    kind: row.kind,
    text: row.text,
    revision: row.revision,
    citation: row.citation ? JSON.parse(row.citation) : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function researchState(store: Store, actor: Actor) {
  const workspace = store.one(
    'SELECT id,name FROM research_workspaces WHERE id=?',
    actor.workspaceId,
  )!;
  const groups = store.all(
    'SELECT id,name,created_at createdAt,updated_at updatedAt FROM research_groups WHERE workspace_id=? ORDER BY id',
    actor.workspaceId,
  );
  const favorites = store.all(
    'SELECT app_id appId,group_id groupId,created_at createdAt FROM research_favorites WHERE workspace_id=? ORDER BY created_at DESC',
    actor.workspaceId,
  );
  const collections = store
    .all(
      'SELECT id,name,created_at createdAt,updated_at updatedAt FROM research_collections WHERE workspace_id=? ORDER BY id',
      actor.workspaceId,
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      appIds: store
        .all(
          'SELECT app_id FROM research_collection_apps WHERE collection_id=? ORDER BY app_id',
          c.id,
        )
        .map((r) => r.app_id),
    }));
  const entries = store
    .all('SELECT * FROM research_entries WHERE workspace_id=? ORDER BY id DESC', actor.workspaceId)
    .map((r) => entryRow(store, r));
  const appIds = new Set([
    ...favorites.map((r) => r.appId),
    ...collections.flatMap((c) => c.appIds),
    ...entries.map((e) => e.appId),
  ]);
  return {
    workspace,
    groups,
    favorites,
    collections,
    entries,
    apps: libraryRows(store, { loanScope: 'all' }).filter((app) => appIds.has(app.id)),
    readStates: store.all(
      'SELECT event_id eventId,read_at readAt FROM research_reads WHERE workspace_id=? AND user_id=? ORDER BY read_at DESC',
      actor.workspaceId,
      actor.id,
    ),
    requests: requestRows(store, actor.workspaceId!),
  };
}
function emptyBody(req: Request) {
  z.object({})
    .strict()
    .parse(req.body ?? {});
}
export function researchRouter(store: Store) {
  const router = Router();
  router.use((_req, res, next) => {
    requireCustomer(res);
    next();
  });
  router.get('/state', (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json(researchState(store, requireCustomer(res)));
  });
  for (const [path, table] of [
    ['groups', 'research_groups'],
    ['collections', 'research_collections'],
  ] as const) {
    router.post(`/${path}`, (req, res) => {
      const actor = requireCustomer(res, true),
        input = z.object({ name }).strict().parse(req.body),
        time = timestamp();
      const id = Number(
        store.run(
          `INSERT INTO ${table}(workspace_id,name,created_at,updated_at) VALUES (?,?,?,?)`,
          actor.workspaceId,
          input.name,
          time,
          time,
        ).lastInsertRowid,
      );
      audit(store, actor, `${path}.create`, id);
      res.status(201).json({ id, name: input.name, createdAt: time, updatedAt: time });
    });
    router.patch(`/${path}/:id`, (req, res) => {
      const actor = requireCustomer(res, true),
        id = positiveId.parse(req.params.id),
        input = z.object({ name }).strict().parse(req.body);
      own(store, table, id, actor);
      store.run(`UPDATE ${table} SET name=?,updated_at=? WHERE id=?`, input.name, timestamp(), id);
      audit(store, actor, `${path}.rename`, id);
      res.json({ ok: true });
    });
    router.delete(`/${path}/:id`, (req, res) => {
      const actor = requireCustomer(res, true),
        id = positiveId.parse(req.params.id);
      emptyBody(req);
      own(store, table, id, actor);
      store.run(`DELETE FROM ${table} WHERE id=?`, id);
      audit(store, actor, `${path}.delete`, id);
      res.json({ ok: true });
    });
  }
  router.put('/favorites/:appId', (req, res) => {
    const actor = requireCustomer(res, true),
      appId = positiveId.parse(req.params.appId),
      input = z.object({ groupId: positiveId.nullable().optional() }).strict().parse(req.body);
    publicApp(store, appId);
    if (input.groupId) own(store, 'research_groups', input.groupId, actor);
    store.run(
      'INSERT INTO research_favorites VALUES (?,?,?,?) ON CONFLICT(workspace_id,app_id) DO UPDATE SET group_id=excluded.group_id',
      actor.workspaceId,
      appId,
      input.groupId ?? null,
      timestamp(),
    );
    audit(store, actor, 'favorite.save', appId);
    res.json({ ok: true });
  });
  router.delete('/favorites/:appId', (req, res) => {
    const actor = requireCustomer(res, true);
    emptyBody(req);
    store.run(
      'DELETE FROM research_favorites WHERE workspace_id=? AND app_id=?',
      actor.workspaceId,
      positiveId.parse(req.params.appId),
    );
    res.json({ ok: true });
  });
  router.put('/collections/:id/apps/:appId', (req, res) => {
    const actor = requireCustomer(res, true),
      id = positiveId.parse(req.params.id),
      appId = positiveId.parse(req.params.appId);
    emptyBody(req);
    own(store, 'research_collections', id, actor);
    publicApp(store, appId);
    store.run('INSERT OR IGNORE INTO research_collection_apps VALUES (?,?)', id, appId);
    res.json({ ok: true });
  });
  router.delete('/collections/:id/apps/:appId', (req, res) => {
    const actor = requireCustomer(res, true),
      id = positiveId.parse(req.params.id);
    emptyBody(req);
    own(store, 'research_collections', id, actor);
    store.run(
      'DELETE FROM research_collection_apps WHERE collection_id=? AND app_id=?',
      id,
      positiveId.parse(req.params.appId),
    );
    res.json({ ok: true });
  });
  router.post('/entries', (req, res) => {
    const actor = requireCustomer(res, true),
      input = z
        .object({
          appId: positiveId,
          collectionId: positiveId.nullable().optional(),
          kind: z.enum(['note', 'excerpt']),
          text: z.string().trim().min(1).max(20000),
          citation: z.unknown().optional(),
        })
        .strict()
        .parse(req.body);
    const app = publicApp(store, input.appId);
    if (input.collectionId) own(store, 'research_collections', input.collectionId, actor);
    if (input.kind === 'excerpt' && !input.citation)
      throw new HttpError(400, '原文摘录必须指定来源');
    const citation = input.citation ? citationFor(store, input.appId, input.citation) : null,
      time = timestamp();
    const id = Number(
      store.run(
        'INSERT INTO research_entries(workspace_id,app_id,collection_id,kind,text,app_identity,citation,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        actor.workspaceId,
        input.appId,
        input.collectionId ?? null,
        input.kind,
        input.text,
        JSON.stringify(appIdentity(app)),
        citation ? JSON.stringify(citation) : null,
        actor.id,
        time,
        time,
      ).lastInsertRowid,
    );
    audit(store, actor, 'entry.create', id);
    res.status(201).json({ entry: entryRow(store, own(store, 'research_entries', id, actor)) });
  });
  router.patch('/entries/:id', (req, res) => {
    const actor = requireCustomer(res, true),
      id = positiveId.parse(req.params.id),
      input = z
        .object({
          text: z.string().trim().min(1).max(20000).optional(),
          collectionId: positiveId.nullable().optional(),
          revision: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
    const row = own(store, 'research_entries', id, actor);
    if (input.collectionId) own(store, 'research_collections', input.collectionId, actor);
    const result = store.run(
      'UPDATE research_entries SET text=?,collection_id=?,revision=revision+1,updated_at=? WHERE id=? AND workspace_id=? AND revision=?',
      input.text ?? row.text,
      input.collectionId === undefined ? row.collection_id : input.collectionId,
      timestamp(),
      id,
      actor.workspaceId,
      input.revision,
    );
    if (!result.changes) throw new HttpError(409, '这条研究已被其他成员修改，请重新读取后再编辑');
    audit(store, actor, 'entry.update', id, { previousRevision: input.revision });
    res.json({ entry: entryRow(store, own(store, 'research_entries', id, actor)) });
  });
  router.delete('/entries/:id', (req, res) => {
    const actor = requireCustomer(res, true),
      id = positiveId.parse(req.params.id);
    const input = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
    own(store, 'research_entries', id, actor);
    const result = store.run(
      'DELETE FROM research_entries WHERE id=? AND workspace_id=? AND revision=?',
      id,
      actor.workspaceId,
      input.revision,
    );
    if (!result.changes) throw new HttpError(409, '这条研究已被其他成员修改，请重新读取后再删除');
    audit(store, actor, 'entry.delete', id, { previousRevision: input.revision });
    res.json({ ok: true });
  });
  function checkEvent(eventId: string) {
    const match = /^(firstSeen|storeRelease|observedUpdate):(\d+)(?::(.+))?$/.exec(eventId);
    if (!match) throw new HttpError(400, '事件标识格式不正确');
    const app = publicApp(store, Number(match[2]));
    if (match[1] === 'observedUpdate') {
      const key = match[3];
      if (
        !key ||
        !store.one(
          'SELECT id FROM changes WHERE app_id=? AND (CAST(snapshot_id AS TEXT)=? OR observed_at=?)',
          app.id,
          key,
          key,
        )
      )
        throw new HttpError(404, '事件不存在');
    } else if (match[3] || (match[1] === 'storeRelease' && !releaseEvidence(app).releasedAt))
      throw new HttpError(404, '事件不存在');
  }
  router.put('/read/:eventId', (req, res) => {
    const actor = requireCustomer(res, true),
      eventId = z.string().max(150).parse(req.params.eventId);
    emptyBody(req);
    checkEvent(eventId);
    store.run(
      'INSERT INTO research_reads VALUES (?,?,?,?) ON CONFLICT(workspace_id,user_id,event_id) DO UPDATE SET read_at=excluded.read_at',
      actor.workspaceId,
      actor.id,
      eventId,
      timestamp(),
    );
    res.json({ ok: true });
  });
  router.delete('/read/:eventId', (req, res) => {
    const actor = requireCustomer(res, true);
    emptyBody(req);
    store.run(
      'DELETE FROM research_reads WHERE workspace_id=? AND user_id=? AND event_id=?',
      actor.workspaceId,
      actor.id,
      z.string().max(150).parse(req.params.eventId),
    );
    res.json({ ok: true });
  });
  router.post('/requests', (req, res) => {
    const actor = requireCustomer(res, true),
      input = identityInput
        .extend({ note: z.string().trim().max(2000).optional() })
        .strict()
        .parse(req.body);
    checkIdentity(store, input);
    const time = timestamp();
    store.run(
      'INSERT OR IGNORE INTO research_requests(workspace_id,requested_by,country,store,external_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      actor.workspaceId,
      actor.id,
      input.country,
      input.store,
      input.externalId,
      input.note ?? null,
      time,
      time,
    );
    const request = requestRows(store, actor.workspaceId!).find(
      (r) =>
        r.country === input.country && r.store === input.store && r.externalId === input.externalId,
    )!;
    audit(store, actor, 'request.submit', request.id);
    res.status(201).json({ request });
  });
  router.get('/export', (req, res) => {
    const actor = requireCustomer(res),
      input = z.object({ collectionId: positiveId.optional() }).strict().parse(req.query);
    const collection = input.collectionId
      ? own(store, 'research_collections', input.collectionId, actor)
      : null;
    const state = researchState(store, actor),
      entries = state.entries.filter((e) => !collection || e.collectionId === collection.id);
    const escape = (v: unknown) => String(v ?? '未提供').replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
    const lines = [
      `# ${escape(state.workspace.name)} · ${collection ? escape(collection.name) : '全部研究'}`,
      `导出时间：${timestamp()}`,
      `导出人：${escape(actor.name)} / ${escape(actor.email)}`,
      `范围：空间 ${actor.workspaceId}${collection ? ` / 集合 ${collection.id}` : ''}`,
      '市场资料与成员研究观点分开；公开累计安装不是国别下载。',
      '',
    ];
    const collections = state.collections.filter((c) => !collection || c.id === collection.id);
    for (const c of collections) {
      lines.push(`## 集合：${escape(c.name)}`);
      for (const id of c.appIds) {
        const app = state.apps.find((a) => a.id === id);
        lines.push(
          `- ${app ? `${escape(app.title)} · ${escape(app.country)}/${escape(app.store)}/${escape(app.externalId)}` : `应用 ${id}（当前已不在公共应用库）`}`,
        );
      }
    }
    for (const e of entries) {
      lines.push(
        `## ${e.kind === 'excerpt' ? '来源摘录' : '研究备注'} #${e.id}`,
        `应用：${escape(e.appIdentity.title)} · ${escape(e.appIdentity.country)}/${escape(e.appIdentity.store)}/${escape(e.appIdentity.externalId)}`,
        `创建者：${e.createdBy}；创建：${e.createdAt}；更新：${e.updatedAt}；版本：${e.revision}`,
        e.appVisible ? '' : '当前应用已不在公共应用库，以下为本空间保存的研究。',
        '',
        escape(e.text),
        '',
      );
      if (e.citation)
        lines.push(
          `来源：${escape(e.citation.kind)} / 记录 ${e.citation.recordId ?? '未提供'} / 字段 ${escape(e.citation.field)}`,
          `原观测：${e.citation.sourceObservedAt ?? '未提供'}`,
          `来源地址：${escape(e.citation.sourceUrl)}`,
          '',
          ...String(e.citation.quote)
            .split('\n')
            .map((line) => `> ${escape(line)}`),
          '',
        );
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="appeye-research-${actor.workspaceId}${collection ? `-${collection.id}` : ''}.md"`,
    );
    res.type('text/markdown; charset=utf-8').send(lines.join('\n'));
  });
  return router;
}

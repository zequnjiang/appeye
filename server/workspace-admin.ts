import { Router, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './db.js';
import {
  HttpError,
  audit,
  timestamp,
  tokenHash,
  emailSchema,
  memberRole,
  type Actor,
} from './workspace-auth.js';
import { positiveId, requestRows } from './workspace-research.js';
import { earliestKnownDiscovery } from './manual-collection.js';
import { recordKnownIdentity } from './extended-discovery.js';
import catalog from './policy-catalog.json' with { type: 'json' };

export function requirePlatform(res: Response) {
  const actor = res.locals.actor as Actor;
  if (actor.role !== 'platform') throw new HttpError(403, '此操作仅限平台运营');
  return actor;
}
function manageWorkspace(store: Store, res: Response, id: number) {
  const actor = res.locals.actor as Actor,
    workspace = store.one('SELECT * FROM research_workspaces WHERE id=?', id);
  if (!workspace) throw new HttpError(404, '客户空间不存在');
  if (actor.role !== 'platform' && (actor.role !== 'admin' || actor.workspaceId !== id))
    throw new HttpError(403, '没有该客户空间的成员管理权限');
  return { actor, workspace };
}
export function workspaceRouter(store: Store) {
  const router = Router();
  router.get('/', (req, res) => {
    z.object({}).strict().parse(req.query);
    const actor = res.locals.actor as Actor;
    const rows =
      actor.role === 'platform'
        ? store.all(
            'SELECT id,name,enabled,created_at createdAt,updated_at updatedAt FROM research_workspaces ORDER BY id',
          )
        : store.all(
            'SELECT w.id,w.name,w.enabled,m.role FROM research_workspaces w JOIN research_memberships m ON m.workspace_id=w.id WHERE m.user_id=? AND m.enabled=1 AND w.enabled=1 ORDER BY w.id',
            actor.id,
          );
    res.json({ workspaces: rows.map((r) => ({ ...r, enabled: !!r.enabled })) });
  });
  router.post('/', (req, res) => {
    const actor = requirePlatform(res),
      input = z
        .object({ name: z.string().trim().min(1).max(100) })
        .strict()
        .parse(req.body),
      time = timestamp();
    const id = Number(
      store.run(
        'INSERT INTO research_workspaces(name,created_at,updated_at) VALUES (?,?,?)',
        input.name,
        time,
        time,
      ).lastInsertRowid,
    );
    audit(store, actor, 'workspace.create', id);
    res
      .status(201)
      .json({
        workspace: { id, name: input.name, enabled: true, createdAt: time, updatedAt: time },
      });
  });
  router.patch('/:id', (req, res) => {
    const actor = requirePlatform(res),
      id = positiveId.parse(req.params.id),
      input = z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          enabled: z.boolean().optional(),
        })
        .strict()
        .parse(req.body),
      { workspace } = manageWorkspace(store, res, id);
    store.transaction(() => {
      store.run(
        'UPDATE research_workspaces SET name=?,enabled=?,updated_at=? WHERE id=?',
        input.name ?? workspace.name,
        input.enabled === undefined ? workspace.enabled : Number(input.enabled),
        timestamp(),
        id,
      );
      if (input.enabled === false)
        store.run('DELETE FROM research_sessions WHERE workspace_id=?', id);
      audit(store, actor, 'workspace.update', id, input);
    });
    res.json({ ok: true });
  });
  router.get('/:id/members', (req, res) => {
    const id = positiveId.parse(req.params.id);
    manageWorkspace(store, res, id);
    z.object({}).strict().parse(req.query);
    res.json({
      members: store
        .all(
          'SELECT u.id,u.name,u.email,m.role,m.enabled FROM research_memberships m JOIN research_users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.id',
          id,
        )
        .map((r) => ({ ...r, enabled: !!r.enabled })),
      invitations: store.all(
        "SELECT id,email,role,CASE WHEN status='pending' AND expires_at<=? THEN 'expired' ELSE status END status,expires_at expiresAt,created_at createdAt FROM research_invitations WHERE workspace_id=? ORDER BY id DESC",
        timestamp(),
        id,
      ),
    });
  });
  router.post('/:id/invitations', (req, res) => {
    const id = positiveId.parse(req.params.id),
      { actor, workspace } = manageWorkspace(store, res, id),
      input = z.object({ email: emailSchema, role: memberRole }).strict().parse(req.body);
    if (!workspace.enabled) throw new HttpError(409, '已停用的空间不能生成邀请');
    if (
      store.one(
        'SELECT m.user_id FROM research_memberships m JOIN research_users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?',
        id,
        input.email,
      )
    )
      throw new HttpError(409, '该邮箱已是成员，请通过成员管理修改角色或启用');
    const token = randomBytes(32).toString('hex'),
      time = timestamp(),
      expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const invitation = store.transaction(() => {
      store.run(
        "UPDATE research_invitations SET status='revoked' WHERE workspace_id=? AND email=? AND status='pending'",
        id,
        input.email,
      );
      const inviteId = Number(
        store.run(
          'INSERT INTO research_invitations(workspace_id,email,role,token_hash,expires_at,created_at,created_by) VALUES (?,?,?,?,?,?,?)',
          id,
          input.email,
          input.role,
          tokenHash(token),
          expiresAt,
          time,
          actor.id,
        ).lastInsertRowid,
      );
      audit(store, actor, 'invitation.create', inviteId, {
        workspaceId: id,
        email: input.email,
        role: input.role,
      });
      return {
        id: inviteId,
        email: input.email,
        role: input.role,
        status: 'pending',
        expiresAt,
        createdAt: time,
      };
    });
    res.status(201).json({ invitation, token, acceptPath: `/?invite=${token}` });
  });
  router.delete('/:id/invitations/:invitationId', (req, res) => {
    const id = positiveId.parse(req.params.id),
      { actor } = manageWorkspace(store, res, id),
      inviteId = positiveId.parse(req.params.invitationId);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const invite = store.one(
      'SELECT status FROM research_invitations WHERE id=? AND workspace_id=?',
      inviteId,
      id,
    );
    if (!invite) throw new HttpError(404, '邀请不存在');
    if (invite.status === 'accepted') throw new HttpError(409, '邀请已被接受，请使用成员管理撤权');
    store.run(
      "UPDATE research_invitations SET status='revoked' WHERE id=? AND workspace_id=?",
      inviteId,
      id,
    );
    audit(store, actor, 'invitation.revoke', inviteId);
    res.json({ ok: true });
  });
  function mutateMember(
    res: Response,
    workspaceId: number,
    userId: number,
    input: { role?: z.infer<typeof memberRole>; enabled?: boolean },
    remove = false,
  ) {
    const { actor } = manageWorkspace(store, res, workspaceId);
    store.transaction(() => {
      const current = store.one(
        'SELECT * FROM research_memberships WHERE workspace_id=? AND user_id=?',
        workspaceId,
        userId,
      );
      if (!current) throw new HttpError(404, '成员不存在');
      if (
        current.role === 'admin' &&
        current.enabled &&
        (remove || input.enabled === false || (input.role && input.role !== 'admin')) &&
        store.one(
          "SELECT COUNT(*) n FROM research_memberships m JOIN research_users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.role='admin' AND m.enabled=1 AND u.enabled=1",
          workspaceId,
        )!.n <= 1
      )
        throw new HttpError(409, '不能移除或降级最后一位有效管理员');
      if (remove)
        store.run(
          'DELETE FROM research_memberships WHERE workspace_id=? AND user_id=?',
          workspaceId,
          userId,
        );
      else
        store.run(
          'UPDATE research_memberships SET role=?,enabled=?,updated_at=? WHERE workspace_id=? AND user_id=?',
          input.role ?? current.role,
          input.enabled === undefined ? current.enabled : Number(input.enabled),
          timestamp(),
          workspaceId,
          userId,
        );
      store.run(
        'DELETE FROM research_sessions WHERE workspace_id=? AND user_id=?',
        workspaceId,
        userId,
      );
      audit(store, actor, remove ? 'member.remove' : 'member.update', userId, {
        workspaceId,
        ...input,
      });
    });
    res.json({ ok: true });
  }
  router.patch('/:id/members/:userId', (req, res) =>
    mutateMember(
      res,
      positiveId.parse(req.params.id),
      positiveId.parse(req.params.userId),
      z
        .object({ role: memberRole.optional(), enabled: z.boolean().optional() })
        .strict()
        .parse(req.body),
    ),
  );
  router.delete('/:id/members/:userId', (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    mutateMember(
      res,
      positiveId.parse(req.params.id),
      positiveId.parse(req.params.userId),
      {},
      true,
    );
  });
  return router;
}
export function platformRouter(store: Store, demoMode = false) {
  const router = Router();
  router.use((_req, res, next) => {
    requirePlatform(res);
    next();
  });
  router.get('/requests', (_req, res) => res.json({ requests: requestRows(store) }));
  router.post('/requests/:id/process', (req, res) => {
    const actor = requirePlatform(res),
      id = positiveId.parse(req.params.id),
      input = z
        .object({
          action: z.enum(['collect', 'reject']),
          reason: z.string().trim().max(2000).optional(),
        })
        .strict()
        .parse(req.body);
    requestRows(store);
    const request = store.one('SELECT * FROM research_requests WHERE id=?', id);
    if (!request) throw new HttpError(404, '收录申请不存在');
    if (input.action === 'reject') {
      if (!input.reason) throw new HttpError(400, '请填写拒绝原因');
      store.run(
        "UPDATE research_requests SET status='rejected',error=?,updated_at=? WHERE id=?",
        input.reason,
        timestamp(),
        id,
      );
      audit(store, actor, 'request.reject', id, { reason: input.reason });
    } else {
      if (demoMode) throw new HttpError(409, '演示模式不能发起真实采集');
      if (request.status === 'processing')
        return res.json({ request: requestRows(store).find((r) => r.id === id) });
      if (request.status === 'admitted')
        return res.json({ request: requestRows(store).find((r) => r.id === id) });
      const country = store.getCountry(request.country);
      if (!country?.enabled) throw new HttpError(409, '请先启用该国家');
      const identity = {
          country: request.country,
          store: request.store,
          externalId: request.external_id,
        },
        time = timestamp();
      let app = store.getApp(
        store.one(
          'SELECT id FROM apps WHERE country=? AND store=? AND external_id=?',
          identity.country,
          identity.store,
          identity.externalId,
        )?.id ?? 0,
      );
      if (!app)
        app = store.createApp({
          ...identity,
          observedAt: earliestKnownDiscovery(store, identity, time),
        });
      const job = store.enqueueJob({
        type: 'refresh',
        country: app.country,
        store: app.store,
        appId: app.id,
      });
      recordKnownIdentity(store, app, job.id, time);
      store.run(
        "UPDATE research_requests SET status='processing',app_id=?,job_id=?,error=NULL,updated_at=? WHERE id=?",
        app.id,
        job.id,
        time,
        id,
      );
      audit(store, actor, 'request.collect', id, { appId: app.id, jobId: job.id });
    }
    res.json({ request: requestRows(store).find((r) => r.id === id) });
  });
  router.patch('/apps/:id/category', (req, res) => {
    const actor = requirePlatform(res),
      id = positiveId.parse(req.params.id),
      input = z
        .object({
          category: z.enum(['personal', 'other', 'unknown']),
          reason: z.string().trim().min(1).max(2000),
        })
        .strict()
        .parse(req.body);
    if (!store.getApp(id)) throw new HttpError(404, '应用不存在');
    const previous =
      store.one('SELECT category FROM research_app_categories WHERE app_id=?', id)?.category ??
      'unknown';
    store.transaction(() => {
      store.run(
        'INSERT INTO research_app_categories VALUES (?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET category=excluded.category,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
        id,
        input.category,
        input.reason,
        actor.id,
        timestamp(),
      );
      audit(store, actor, 'category.update', id, { previous, ...input });
    });
    res.json({ category: input.category, categorySource: 'manual' });
  });
  router.get('/rules', (_req, res) => {
    const row = store.one('SELECT * FROM research_rule_config WHERE id=1')!;
    res.json({
      autoConfirmStrong: !!row.auto_confirm_strong,
      version: row.version,
      updatedAt: row.updated_at,
      catalog,
    });
  });
  router.patch('/rules', (req, res) => {
    const actor = requirePlatform(res),
      input = z.object({ autoConfirmStrong: z.boolean() }).strict().parse(req.body);
    store.transaction(() => {
      const old = store.one('SELECT * FROM research_rule_config WHERE id=1')!;
      store.run(
        'UPDATE research_rule_config SET auto_confirm_strong=?,version=version+1,updated_at=? WHERE id=1',
        Number(input.autoConfirmStrong),
        timestamp(),
      );
      audit(store, actor, 'rules.update', 1, {
        previous: !!old.auto_confirm_strong,
        ...input,
        version: old.version + 1,
      });
    });
    const row = store.one('SELECT * FROM research_rule_config WHERE id=1')!;
    res.json({
      autoConfirmStrong: !!row.auto_confirm_strong,
      version: row.version,
      updatedAt: row.updated_at,
    });
  });
  router.post('/rules/reanalyze', (req, res) => {
    const actor = requirePlatform(res);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const ids = store.all('SELECT id FROM apps');
    for (const row of ids) store.analyzeApp(row.id);
    audit(store, actor, 'rules.reanalyze', 1, { count: ids.length });
    res.json({ count: ids.length });
  });
  return router;
}

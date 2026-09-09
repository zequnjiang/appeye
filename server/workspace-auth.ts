import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Store } from './db.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export type Role = 'platform' | 'admin' | 'researcher' | 'viewer';
export interface Actor {
  id: number;
  name: string;
  email: string | null;
  role: Role;
  workspaceId: number | null;
  sessionId: string;
}
export const timestamp = () => new Date().toISOString();
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const passwordSchema = z.string().min(12).max(128);
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase());
export const memberRole = z.enum(['admin', 'researcher', 'viewer']);
export function passwordHash(value: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}
function passwordMatches(value: string, hash: string) {
  const [salt, key] = hash.split(':');
  if (!salt || !key || !/^[a-f0-9]{128}$/.test(key)) return false;
  return timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(key, 'hex'));
}
export function audit(
  store: Store,
  actor: Actor,
  action: string,
  targetId: string | number | null,
  detail: unknown = {},
) {
  store.run(
    'INSERT INTO research_audit(actor_id,workspace_id,action,target_id,detail,created_at) VALUES (?,?,?,?,?,?)',
    actor.id,
    actor.workspaceId,
    action,
    targetId == null ? null : String(targetId),
    JSON.stringify(detail),
    timestamp(),
  );
}
export function createWorkspaceAuth(
  store: Store,
  password: string,
  dataset: string,
  secure = false,
  sessionSecret?: string,
) {
  const sessionHash = (raw: string) =>
    sessionSecret ? createHmac('sha256', sessionSecret).update(raw).digest('hex') : tokenHash(raw);
  const platformMatches = new Map<string, boolean>();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path: '/',
    maxAge: 12 * 3600000,
  };
  const cookie = (req: Request) =>
    req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('appeye_session='))
      ?.slice(15) ?? '';
  function current(req: Request): Actor | null {
    const value = cookie(req);
    if (!/^[a-f0-9]{64}$/.test(value)) return null;
    const hash = sessionHash(value);
    const row = store.one('SELECT * FROM research_sessions WHERE token_hash=?', hash);
    if (!row) return null;
    if (row.expires_at <= timestamp()) {
      store.run('DELETE FROM research_sessions WHERE token_hash=?', hash);
      return null;
    }
    if (row.platform_auth) {
      if (!password) return null;
      if (!platformMatches.has(row.platform_auth)) {
        if (platformMatches.size > 1000) platformMatches.clear();
        platformMatches.set(row.platform_auth, passwordMatches(password, row.platform_auth));
      }
      if (!platformMatches.get(row.platform_auth)) return null;
      return {
        id: 0,
        name: '平台运营',
        email: null,
        role: 'platform',
        workspaceId: null,
        sessionId: hash,
      };
    }
    const user = store.one(
      'SELECT u.id,u.name,u.email,m.role,m.workspace_id FROM research_users u JOIN research_memberships m ON m.user_id=u.id JOIN research_workspaces w ON w.id=m.workspace_id WHERE u.id=? AND m.workspace_id=? AND u.enabled=1 AND m.enabled=1 AND w.enabled=1',
      row.user_id,
      row.workspace_id,
    );
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      workspaceId: user.workspace_id,
      sessionId: hash,
    };
  }
  function workspaces(userId: number) {
    return store.all(
      'SELECT w.id,w.name,m.role FROM research_workspaces w JOIN research_memberships m ON m.workspace_id=w.id WHERE m.user_id=? AND m.enabled=1 AND w.enabled=1 ORDER BY w.id',
      userId,
    );
  }
  function session(actor: Actor | null) {
    return {
      authenticated: !!actor,
      configured: !!password || !!store.one('SELECT id FROM research_users LIMIT 1'),
      dataset,
      user: actor
        ? {
            id: actor.id,
            name: actor.name,
            email: actor.email,
            role: actor.role,
            workspaceId: actor.workspaceId,
          }
        : null,
      workspaces: actor && actor.role !== 'platform' ? workspaces(actor.id) : [],
      authorizationVersion: actor
        ? `${actor.id}:${actor.workspaceId ?? 'platform'}:${actor.role}:${actor.sessionId.slice(0, 16)}`
        : null,
    };
  }
  function issue(res: Response, userId: number | null, workspaceId: number | null) {
    const raw = randomBytes(32).toString('hex');
    const time = timestamp();
    store.run('DELETE FROM research_sessions WHERE expires_at<=?', time);
    store.run(
      'INSERT INTO research_sessions VALUES (?,?,?,?,?,?)',
      sessionHash(raw),
      userId,
      workspaceId,
      userId == null ? passwordHash(password) : null,
      time,
      new Date(Date.now() + cookieOptions.maxAge).toISOString(),
    );
    res.cookie('appeye_session', raw, cookieOptions);
    const fake = { headers: { cookie: `appeye_session=${raw}` } } as Request;
    return session(current(fake));
  }
  function login(req: Request, res: Response) {
    const input = z
      .object({
        email: emailSchema.optional(),
        password: z.string().max(1024),
        workspaceId: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    if (!input.email) {
      if (!password)
        throw new HttpError(503, '尚未设置 ADMIN_PASSWORD，请在 .env 中配置后重启服务');
      if (
        !timingSafeEqual(Buffer.from(tokenHash(input.password)), Buffer.from(tokenHash(password)))
      )
        throw new HttpError(401, '密码不正确');
      if (input.workspaceId) throw new HttpError(403, '平台账号不能作为客户成员登录');
      logout(req);
      return res.json(issue(res, null, null));
    }
    const user = store.one('SELECT * FROM research_users WHERE email=? AND enabled=1', input.email);
    if (!user || !passwordMatches(input.password, user.password_hash))
      throw new HttpError(401, '邮箱或密码不正确');
    const memberships = workspaces(user.id);
    const chosen = input.workspaceId
      ? memberships.find((w) => w.id === input.workspaceId)
      : memberships[0];
    if (!chosen) throw new HttpError(403, '没有可用的客户空间');
    logout(req);
    return res.json(issue(res, user.id, chosen.id));
  }
  function logout(req: Request) {
    if (cookie(req))
      store.run('DELETE FROM research_sessions WHERE token_hash=?', sessionHash(cookie(req)));
  }
  function invitation(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(410, '邀请链接无效或已失效');
    const row = store.one(
      'SELECT i.*,w.name workspace_name,w.enabled workspace_enabled FROM research_invitations i JOIN research_workspaces w ON w.id=i.workspace_id WHERE i.token_hash=?',
      tokenHash(token),
    );
    if (!row || row.status !== 'pending' || row.expires_at <= timestamp() || !row.workspace_enabled)
      throw new HttpError(410, '邀请链接无效、已使用、已撤销或已过期');
    return row;
  }
  function accept(req: Request, res: Response) {
    const input = z
      .object({
        token: z.string(),
        name: z.string().trim().min(1).max(80),
        password: passwordSchema,
      })
      .strict()
      .parse(req.body);
    const accepted = store.transaction(() => {
      const invite = invitation(input.token);
      let user = store.one('SELECT * FROM research_users WHERE email=?', invite.email);
      if (user && (!user.enabled || !passwordMatches(input.password, user.password_hash)))
        throw new HttpError(401, '已有账号请使用原密码接受邀请');
      if (!user) {
        const id = store.run(
          'INSERT INTO research_users(email,name,password_hash,created_at) VALUES (?,?,?,?)',
          invite.email,
          input.name,
          passwordHash(input.password),
          timestamp(),
        ).lastInsertRowid;
        user = store.one('SELECT * FROM research_users WHERE id=?', id)!;
      }
      if (
        store.one(
          'SELECT user_id FROM research_memberships WHERE workspace_id=? AND user_id=?',
          invite.workspace_id,
          user.id,
        )
      )
        throw new HttpError(409, '该账号已经是空间成员，请由管理员管理角色');
      store.run(
        'INSERT INTO research_memberships VALUES (?,?,?,1,?)',
        invite.workspace_id,
        user.id,
        invite.role,
        timestamp(),
      );
      store.run(
        "UPDATE research_invitations SET status='accepted',accepted_at=? WHERE id=? AND status='pending'",
        timestamp(),
        invite.id,
      );
      audit(
        store,
        {
          id: user.id,
          name: user.name,
          email: user.email,
          role: invite.role,
          workspaceId: invite.workspace_id,
          sessionId: '',
        },
        'invitation.accept',
        invite.id,
        { workspaceId: invite.workspace_id, role: invite.role },
      );
      return { id: user.id, workspaceId: invite.workspace_id };
    });
    logout(req);
    return res.status(201).json(issue(res, accepted.id, accepted.workspaceId));
  }
  return { current, session, login, logout, issue, invitation, accept, cookieOptions, workspaces };
}

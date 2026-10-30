import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Role } from '../shared/types';
import { today } from '../shared/dates';
import type { AppBindings } from './env';
import { readCookie, resolveSession, SESSION_COOKIE } from './auth';

/** Resolves the gym-local day once so every handler agrees on "today". */
export const withToday: MiddlewareHandler<AppBindings> = async (c, next) => {
  c.set('today', today(c.env.APP_TIMEZONE || 'Asia/Hebron'));
  await next();
};

/** Requires a valid session; 401 otherwise. */
export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE);
  if (!token) throw new HTTPException(401, { message: 'not_authenticated' });

  const user = await resolveSession(c.env, token);
  if (!user) throw new HTTPException(401, { message: 'session_expired' });

  // A forced PIN change must be completed before anything else is reachable.
  if (user.mustChangePin && !c.req.path.startsWith('/api/auth/')) {
    throw new HTTPException(403, { message: 'pin_change_required' });
  }

  c.set('user', user);
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      throw new HTTPException(403, { message: 'forbidden' });
    }
    await next();
  };
}

/** Admins and coaches run the mat; only admins touch money and accounts. */
export const requireStaff = requireRole('admin', 'coach');
export const requireAdmin = requireRole('admin');

/**
 * Opening a class and marking who attended. Staff have it by role; a player
 * can hold it temporarily through a dated grant. Deliberately narrower than
 * `requireStaff`, which also opens the member list and the money owed.
 */
export const requireAttendanceAccess: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = c.get('user');
  if (!user?.canTakeAttendance) {
    throw new HTTPException(403, { message: 'forbidden' });
  }
  await next();
};

/**
 * Players may only ever read their own record. Staff may read anyone's.
 * Call with the member id a route is about.
 */
export function assertCanReadMember(
  user: { role: Role; memberId: number | null },
  memberId: number,
): void {
  if (user.role === 'admin' || user.role === 'coach') return;
  if (user.memberId === memberId) return;
  throw new HTTPException(403, { message: 'forbidden' });
}

export async function audit(
  c: { env: { DB: D1Database }; get: (k: 'user') => { userId: number; login: string } | undefined },
  action: string,
  entity: string,
  entityId: number | null,
  detail?: unknown,
): Promise<void> {
  const user = c.get('user');
  await c.env.DB.prepare(
    `INSERT INTO audit_log (actor_user_id, actor_login, action, entity, entity_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      user?.userId ?? null,
      user?.login ?? null,
      action,
      entity,
      entityId,
      detail === undefined ? null : JSON.stringify(detail),
    )
    .run();
}

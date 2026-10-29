import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Role } from '@shared/types';
import type { AppBindings } from '../env';
import {
  SESSION_COOKIE,
  clearCookie,
  createSession,
  destroyAllSessions,
  destroySession,
  hashPin,
  iterationsFor,
  lockoutUntil,
  newCredential,
  normalisePhone,
  pinProblem,
  readCookie,
  resolveSession,
  sessionCookie,
  verifyPin,
} from '../auth';
import { audit } from '../middleware';
import { readJson } from '../http';

const auth = new Hono<AppBindings>();

interface UserAuthRow {
  id: number;
  member_id: number | null;
  login: string;
  role: Role;
  pin_hash: string;
  pin_salt: string;
  pin_iterations: number;
  must_change_pin: number;
  disabled: number;
  failed_attempts: number;
  locked_until: string | null;
  name_ar: string | null;
}

const isSecure = (url: string) => new URL(url).protocol === 'https:';

auth.post('/login', async (c) => {
  const body = await readJson<{ login?: string; pin?: string }>(c.req);
  const rawLogin = (body.login ?? '').trim();
  const pin = body.pin ?? '';

  if (!rawLogin || !pin) {
    throw new HTTPException(400, { message: 'login_and_pin_required' });
  }

  // Accept the phone number in any of the forms people actually type it.
  const login = normalisePhone(rawLogin) ?? rawLogin;

  const user = await c.env.DB.prepare(
    `SELECT u.*, m.name_ar
       FROM users u
       LEFT JOIN members m ON m.id = u.member_id
      WHERE u.login = ?`,
  )
    .bind(login)
    .first<UserAuthRow>();

  // Same error and roughly the same work either way, so a wrong number cannot
  // be told apart from a wrong PIN.
  if (!user) {
    await hashPin(pin, 'decoy-salt-not-a-real-user', iterationsFor(c.env));
    throw new HTTPException(401, { message: 'invalid_credentials' });
  }

  if (user.disabled) throw new HTTPException(403, { message: 'account_disabled' });

  const now = new Date().toISOString();
  if (user.locked_until && user.locked_until > now) {
    throw new HTTPException(429, { message: `locked_until:${user.locked_until}` });
  }

  const ok = await verifyPin(pin, user);

  if (!ok) {
    const attempts = user.failed_attempts + 1;
    await c.env.DB.prepare(
      `UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?`,
    )
      .bind(attempts, lockoutUntil(attempts), user.id)
      .run();
    throw new HTTPException(401, { message: 'invalid_credentials' });
  }

  // Successful login clears the lockout counters and, if PIN_ITERATIONS was
  // raised since this hash was made, quietly upgrades it.
  const target = iterationsFor(c.env);
  if (user.pin_iterations < target) {
    const upgraded = await newCredential(pin, c.env);
    await c.env.DB.prepare(
      `UPDATE users
          SET pin_hash = ?, pin_salt = ?, pin_iterations = ?,
              failed_attempts = 0, locked_until = NULL, last_login_at = ?
        WHERE id = ?`,
    )
      .bind(upgraded.hash, upgraded.salt, upgraded.iterations, now, user.id)
      .run();
  } else {
    await c.env.DB.prepare(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`,
    )
      .bind(now, user.id)
      .run();
  }

  const { token } = await createSession(c.env, user.id, c.req.header('user-agent') ?? null);
  c.header('Set-Cookie', sessionCookie(token, isSecure(c.req.url)));

  return c.json({
    user: {
      userId: user.id,
      memberId: user.member_id,
      login: user.login,
      role: user.role,
      mustChangePin: !!user.must_change_pin,
      nameAr: user.name_ar,
    },
  });
});

auth.post('/logout', async (c) => {
  const token = readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE);
  if (token) await destroySession(c.env, token);
  c.header('Set-Cookie', clearCookie(isSecure(c.req.url)));
  return c.json({ ok: true });
});

auth.get('/me', async (c) => {
  const token = readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE);
  if (!token) return c.json({ user: null });
  const user = await resolveSession(c.env, token);
  return c.json({ user });
});

/**
 * Changing a PIN logs out every other session, so an admin resetting a PIN
 * reliably kicks out whoever was using the old one.
 */
auth.post('/change-pin', async (c) => {
  const token = readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE);
  if (!token) throw new HTTPException(401, { message: 'not_authenticated' });

  const session = await resolveSession(c.env, token);
  if (!session) throw new HTTPException(401, { message: 'session_expired' });

  const body = await readJson<{ currentPin?: string; newPin?: string }>(c.req);

  const current = body.currentPin ?? '';
  const next = body.newPin ?? '';

  const row = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(session.userId)
    .first<UserAuthRow>();
  if (!row) throw new HTTPException(401, { message: 'not_authenticated' });

  if (!(await verifyPin(current, row))) {
    throw new HTTPException(401, { message: 'current_pin_wrong' });
  }

  const problem = pinProblem(next, row.role);
  if (problem) throw new HTTPException(400, { message: problem });
  if (next === current) throw new HTTPException(400, { message: 'pin_unchanged' });

  const cred = await newCredential(next, c.env);
  await c.env.DB.prepare(
    `UPDATE users
        SET pin_hash = ?, pin_salt = ?, pin_iterations = ?, must_change_pin = 0
      WHERE id = ?`,
  )
    .bind(cred.hash, cred.salt, cred.iterations, row.id)
    .run();

  await destroyAllSessions(c.env, row.id);
  const fresh = await createSession(c.env, row.id, c.req.header('user-agent') ?? null);
  c.header('Set-Cookie', sessionCookie(fresh.token, isSecure(c.req.url)));

  c.set('user', session);
  await audit(c, 'auth.change_pin', 'user', row.id);

  return c.json({ ok: true });
});

export default auth;

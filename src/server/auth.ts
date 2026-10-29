import type { Role, SessionUser } from '@shared/types';
import type { Env } from './env';

/**
 * PIN / password hashing and session handling.
 *
 * On the Workers free plan each request gets ~10ms of CPU, which is not enough
 * for a 100k-iteration PBKDF2 (that alone is 50ms+ and the request would be
 * killed). So the iteration count is deliberately modest and the real defence
 * against guessing a 4-6 digit PIN is server-side lockout, not KDF cost — a
 * 6-digit PIN is only 10^6 possibilities, so no sane iteration count would
 * save it from an attacker who already has the hash.
 *
 * The count is stored per user (`users.pin_iterations`), so raising
 * PIN_ITERATIONS later upgrades hashes on next login without locking anyone out.
 */

const DEFAULT_ITERATIONS = 12_000;
const HASH_BITS = 256;
const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'jj_session';

/** Lockout schedule: index by failed-attempt count, in minutes. */
const LOCKOUT_MINUTES = [0, 0, 0, 0, 0, 15, 15, 30, 60, 60, 240];

export function iterationsFor(env: Env): number {
  const parsed = Number(env.PIN_ITERATIONS);
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.floor(parsed) : DEFAULT_ITERATIONS;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(
  pin: string,
  salt: string,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    key,
    HASH_BITS,
  );
  return toHex(bits);
}

/** Length-independent constant-time compare over hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function newCredential(
  pin: string,
  env: Env,
): Promise<{ salt: string; hash: string; iterations: number }> {
  const salt = randomHex(16);
  const iterations = iterationsFor(env);
  return { salt, hash: await hashPin(pin, salt, iterations), iterations };
}

export async function verifyPin(
  pin: string,
  stored: { pin_hash: string; pin_salt: string; pin_iterations: number },
): Promise<boolean> {
  const candidate = await hashPin(pin, stored.pin_salt, stored.pin_iterations);
  return timingSafeEqual(candidate, stored.pin_hash);
}

export function lockoutUntil(failedAttempts: number): string | null {
  const minutes = LOCKOUT_MINUTES[Math.min(failedAttempts, LOCKOUT_MINUTES.length - 1)] ?? 240;
  if (minutes === 0) return null;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------- sessions ---

/**
 * The cookie carries a random token; the database stores only its SHA-256.
 * A database dump therefore does not hand over live sessions.
 */
async function tokenId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(digest);
}

export async function createSession(
  env: Env,
  userId: number,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomHex(32);
  const id = await tokenId(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();

  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, userId, expiresAt, userAgent?.slice(0, 256) ?? null)
    .run();

  return { token, expiresAt };
}

export async function resolveSession(env: Env, token: string): Promise<SessionUser | null> {
  const id = await tokenId(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.login, u.role, u.must_change_pin, u.disabled,
            u.member_id, m.name_ar
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN members m ON m.id = u.member_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<{
      user_id: number;
      expires_at: string;
      login: string;
      role: Role;
      must_change_pin: number;
      disabled: number;
      member_id: number | null;
      name_ar: string | null;
    }>();

  if (!row) return null;
  if (row.disabled) return null;
  if (row.expires_at < new Date().toISOString()) {
    await destroySessionById(env, id);
    return null;
  }

  return {
    userId: row.user_id,
    memberId: row.member_id,
    login: row.login,
    role: row.role,
    mustChangePin: !!row.must_change_pin,
    nameAr: row.name_ar,
  };
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await destroySessionById(env, await tokenId(token));
}

async function destroySessionById(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM auth_sessions WHERE id = ?`).bind(id).run();
}

/** Invalidates every session for a user — used on PIN change and on disable. */
export async function destroyAllSessions(env: Env, userId: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).bind(userId).run();
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86_400}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=') || null;
  }
  return null;
}

// -------------------------------------------------------------- validation ---

/** Phone numbers are the login id, so they must normalise to one form. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '');
  // Accept 05xxxxxxxx, +9725xxxxxxxx, 009725xxxxxxxx and store as 05xxxxxxxx.
  const m =
    /^(?:\+972|00972)(5\d{8})$/.exec(digits) ??
    /^0(5\d{8})$/.exec(digits) ??
    /^(5\d{8})$/.exec(digits);
  if (m?.[1]) return `0${m[1]}`;
  // Fall back to any 9-15 digit international number so the app is not
  // unusable for a member with a non-Palestinian SIM.
  if (/^\+?\d{9,15}$/.test(digits)) return digits.replace(/^\+/, '');
  return null;
}

export const MIN_PIN_LENGTH = 4;
export const MIN_ADMIN_PIN_LENGTH = 6;

export function pinProblem(pin: string, role: Role): string | null {
  const min = role === 'player' ? MIN_PIN_LENGTH : MIN_ADMIN_PIN_LENGTH;
  if (pin.length < min) return `pin_too_short:${min}`;
  if (pin.length > 128) return 'pin_too_long';
  if (/^(\d)\1+$/.test(pin)) return 'pin_all_same_digit';
  if (/^(0123456789|123456789|12345678|1234567|123456|12345|1234)$/.test(pin)) {
    return 'pin_sequential';
  }
  return null;
}

/** Cryptographically random numeric PIN, for admin-provisioned accounts. */
export function generatePin(digits = 6): string {
  const buf = new Uint32Array(digits);
  crypto.getRandomValues(buf);
  return [...buf].map((v) => (v % 10).toString()).join('');
}

import { today } from '@shared/dates';
import type { Env } from './env';

/**
 * Nightly housekeeping (wrangler.toml `[triggers]`).
 *
 * Purchase status is also recomputed whenever attendance or billing moves, so
 * this exists to catch the one thing no request triggers: a subscription that
 * simply ran out of time while nobody was looking.
 */
export async function runNightlyMaintenance(env: Env): Promise<void> {
  const asOf = today(env.APP_TIMEZONE || 'Asia/Hebron');
  const nowIso = new Date().toISOString();

  const results = await env.DB.batch([
    // Time-expired entitlements.
    env.DB.prepare(
      `UPDATE purchases
          SET status = 'expired'
        WHERE status = 'active'
          AND valid_until IS NOT NULL
          AND valid_until < ?`,
    ).bind(asOf),

    // Fully used packages, in case a release left one at its limit.
    env.DB.prepare(
      `UPDATE purchases
          SET status = 'exhausted'
        WHERE status = 'active'
          AND sessions_total IS NOT NULL
          AND sessions_used >= sessions_total`,
    ),

    // Expired login sessions.
    env.DB.prepare(`DELETE FROM auth_sessions WHERE expires_at < ?`).bind(nowIso),

    // Keep the audit log bounded; D1's free tier is generous but not infinite.
    env.DB.prepare(
      `DELETE FROM audit_log
        WHERE id NOT IN (SELECT id FROM audit_log ORDER BY at DESC, id DESC LIMIT 20000)`,
    ),
  ]);

  const [expired, exhausted, sessionsPurged] = results;
  console.log(
    JSON.stringify({
      task: 'nightly',
      asOf,
      expiredPurchases: expired?.meta.changes ?? 0,
      exhaustedPurchases: exhausted?.meta.changes ?? 0,
      authSessionsPurged: sessionsPurged?.meta.changes ?? 0,
    }),
  );
}

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isIsoDate } from '../../shared/dates';
import { pickCoverage, settleStatus, type Entitlement } from '../../shared/billing';
import type { AttendanceStatus, ClassType, Coverage } from '../../shared/types';
import type { AppBindings } from '../env';
import { audit, requireStaff } from '../middleware';
import { balancesFor, entitlementsForMany, listMembers, loadSettings } from '../queries';
import { readJson } from '../http';

const sessions = new Hono<AppBindings>();

const CLASS_TYPES: ClassType[] = ['gi', 'nogi', 'open_mat', 'kids', 'seminar'];
const ATT_STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];

/** Only these count toward promotion progress and consume paid sessions. */
const COUNTS_AS_TRAINED = (s: AttendanceStatus) => s === 'present' || s === 'late';

sessions.use('*', requireStaff);

sessions.get('/', async (c) => {
  const to = c.req.query('to') ?? c.get('today');
  const from = c.req.query('from') ?? `${to.slice(0, 4)}-01-01`;
  const limit = Math.min(Number(c.req.query('limit') ?? 60), 200);

  const { results } = await c.env.DB.prepare(
    `SELECT cs.*,
            COALESCE(SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END), 0) AS present_count,
            COUNT(a.id) AS attendee_count,
            COALESCE(SUM(CASE WHEN a.coverage = 'uncovered' THEN 1 ELSE 0 END), 0) AS uncovered_count
       FROM class_sessions cs
       LEFT JOIN attendance a ON a.session_id = cs.id
      WHERE cs.date BETWEEN ? AND ?
      GROUP BY cs.id
      ORDER BY cs.date DESC, cs.start_time DESC
      LIMIT ?`,
  )
    .bind(from, to, limit)
    .all();

  return c.json({ sessions: results ?? [] });
});

sessions.post('/', async (c) => {
  const body = await readJson<{
    date?: string;
    startTime?: string | null;
    classType?: ClassType;
    coachMemberId?: number | null;
    techniqueTitle?: string | null;
    techniqueNotes?: string | null;
  }>(c.req);

  const settings = await loadSettings(c.env);
  const date = body.date && isIsoDate(body.date) ? body.date : c.get('today');
  const classType =
    body.classType && CLASS_TYPES.includes(body.classType)
      ? body.classType
      : ((settings.default_class_type as ClassType) ?? 'gi');

  const startTime = body.startTime?.trim() || null;
  if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
    throw new HTTPException(400, { message: 'bad_start_time' });
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM class_sessions
      WHERE date = ? AND class_type = ? AND COALESCE(start_time,'') = COALESCE(?,'')`,
  )
    .bind(date, classType, startTime)
    .first<{ id: number }>();
  if (existing) {
    // Opening the same class twice is a tap mistake, not an error worth a wall.
    return c.json({ session: await loadSession(c, existing.id), existed: true });
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO class_sessions (date, start_time, class_type, coach_member_id,
                                 technique_title, technique_notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      date,
      startTime,
      classType,
      body.coachMemberId ?? null,
      body.techniqueTitle?.trim() || null,
      body.techniqueNotes?.trim() || null,
      c.get('user').userId,
    )
    .first<{ id: number }>();

  await audit(c, 'session.create', 'class_session', row!.id, { date, classType });
  return c.json({ session: await loadSession(c, row!.id) }, 201);
});

async function loadSession(c: { env: AppBindings['Bindings'] }, id: number) {
  return c.env.DB.prepare(`SELECT * FROM class_sessions WHERE id = ?`).bind(id).first();
}

/**
 * Session detail including the check-in roster: every active member, whatever
 * is already recorded, and a preview of which entitlement would pay for them.
 * The preview is read-only — nothing is consumed until attendance is saved.
 */
sessions.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const session = await c.env.DB.prepare(`SELECT * FROM class_sessions WHERE id = ?`)
    .bind(id)
    .first<{ id: number; date: string }>();
  if (!session) throw new HTTPException(404, { message: 'session_not_found' });

  const roster = await listMembers(c.env, { status: 'active' });

  // Anyone already marked stays on the roster even if since made inactive, so
  // a historical session never silently loses attendees.
  const { results: recorded } = await c.env.DB.prepare(
    `SELECT a.member_id, a.status, a.coverage, a.purchase_id, m.name_ar, m.belt, m.stripes, m.status AS member_status
       FROM attendance a JOIN members m ON m.id = a.member_id
      WHERE a.session_id = ?`,
  )
    .bind(id)
    .all<{
      member_id: number;
      status: AttendanceStatus;
      coverage: Coverage | null;
      purchase_id: number | null;
      name_ar: string;
      belt: string;
      stripes: number;
      member_status: string;
    }>();

  const recordedMap = new Map((recorded ?? []).map((r) => [r.member_id, r]));
  const rosterIds = new Set(roster.map((m) => m.id));
  const extra = (recorded ?? []).filter((r) => !rosterIds.has(r.member_id));

  const memberIds = [...roster.map((m) => m.id), ...extra.map((r) => r.member_id)];
  const [entitlements, balances] = await Promise.all([
    entitlementsForMany(c.env, memberIds),
    balancesFor(c.env, memberIds),
  ]);

  const build = (
    memberId: number,
    nameAr: string,
    belt: string,
    stripes: number,
    memberStatus: string,
  ) => {
    const rec = recordedMap.get(memberId);
    const ents = entitlements.get(memberId) ?? [];
    const preview = pickCoverage(ents, session.date);
    return {
      memberId,
      nameAr,
      belt,
      stripes,
      memberStatus,
      status: rec?.status ?? null,
      coverage: rec?.coverage ?? null,
      purchaseId: rec?.purchase_id ?? null,
      // What *would* pay for this class if checked in right now.
      preview: {
        coverage: preview.coverage,
        purchaseId: preview.purchaseId,
        remainingAfter: preview.remainingAfter,
      },
      outstandingMinor: balances.get(memberId)?.outstandingMinor ?? 0,
    };
  };

  return c.json({
    session,
    roster: [
      ...roster.map((m) => build(m.id, m.nameAr, m.belt, m.stripes, m.status)),
      ...extra.map((r) => build(r.member_id, r.name_ar, r.belt, r.stripes, r.member_status)),
    ],
  });
});

sessions.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await readJson<{
    techniqueTitle?: string | null;
    techniqueNotes?: string | null;
    coachMemberId?: number | null;
    startTime?: string | null;
    status?: 'open' | 'closed';
  }>(c.req);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(v);
  };

  if (body.techniqueTitle !== undefined) put('technique_title', body.techniqueTitle?.trim() || null);
  if (body.techniqueNotes !== undefined) put('technique_notes', body.techniqueNotes?.trim() || null);
  if (body.coachMemberId !== undefined) put('coach_member_id', body.coachMemberId);
  if (body.startTime !== undefined) put('start_time', body.startTime?.trim() || null);
  if (body.status !== undefined) {
    if (body.status !== 'open' && body.status !== 'closed') {
      throw new HTTPException(400, { message: 'bad_status' });
    }
    put('status', body.status);
  }
  if (!sets.length) throw new HTTPException(400, { message: 'nothing_to_update' });

  binds.push(id);
  const res = await c.env.DB.prepare(`UPDATE class_sessions SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'session_not_found' });

  await audit(c, 'session.update', 'class_session', id, body);
  return c.json({ session: await loadSession(c, id) });
});

/**
 * Bulk attendance save — the one write the coach makes every class.
 *
 * Idempotent and reversible. Marking someone present resolves and consumes
 * their coverage; changing them back to absent releases the session that was
 * burned. Re-sending the same roster twice does not double-charge, because an
 * unchanged present→present transition keeps the coverage already recorded.
 */
sessions.post('/:id/attendance', async (c) => {
  const id = Number(c.req.param('id'));
  const session = await c.env.DB.prepare(`SELECT id, date, status FROM class_sessions WHERE id = ?`)
    .bind(id)
    .first<{ id: number; date: string; status: string }>();
  if (!session) throw new HTTPException(404, { message: 'session_not_found' });

  const body = await readJson<{
    entries?: { memberId: number; status: AttendanceStatus; coverage?: 'free' }[];
  }>(c.req);

  const entries = (body.entries ?? []).filter(
    (e) => Number.isInteger(e.memberId) && ATT_STATUSES.includes(e.status),
  );
  if (!entries.length) throw new HTTPException(400, { message: 'no_entries' });

  const memberIds = [...new Set(entries.map((e) => e.memberId))];

  const { results: existingRows } = await c.env.DB.prepare(
    `SELECT member_id, status, coverage, purchase_id FROM attendance
      WHERE session_id = ? AND member_id IN (${memberIds.map(() => '?').join(',')})`,
  )
    .bind(id, ...memberIds)
    .all<{
      member_id: number;
      status: AttendanceStatus;
      coverage: Coverage | null;
      purchase_id: number | null;
    }>();

  const existing = new Map((existingRows ?? []).map((r) => [r.member_id, r]));
  const entitlements = await entitlementsForMany(c.env, memberIds);

  const statements: D1PreparedStatement[] = [];
  /** purchase id → net change in sessions_used across this save. */
  const consumption = new Map<number, number>();
  const outcome: {
    memberId: number;
    status: AttendanceStatus;
    coverage: Coverage | null;
    remaining: number | null;
  }[] = [];

  const userId = c.get('user').userId;
  const now = new Date().toISOString();

  for (const entry of entries) {
    const prev = existing.get(entry.memberId);
    const wasTrained = prev ? COUNTS_AS_TRAINED(prev.status) : false;
    const nowTrained = COUNTS_AS_TRAINED(entry.status);

    let coverage: Coverage | null = prev?.coverage ?? null;
    let purchaseId: number | null = prev?.purchase_id ?? null;
    let remaining: number | null = null;

    if (!nowTrained) {
      // Releasing a consumed session: hand the credit back.
      if (wasTrained && purchaseId && (coverage === 'package' || coverage === 'single')) {
        consumption.set(purchaseId, (consumption.get(purchaseId) ?? 0) - 1);
      }
      coverage = null;
      purchaseId = null;
    } else if (!wasTrained) {
      if (entry.coverage === 'free') {
        coverage = 'free';
        purchaseId = null;
      } else {
        const ents = entitlements.get(entry.memberId) ?? [];
        // Account for anything already consumed earlier in this same batch.
        const adjusted: Entitlement[] = ents.map((e) => ({
          ...e,
          sessionsUsed: e.sessionsUsed + Math.max(0, consumption.get(e.id) ?? 0),
        }));
        const decision = pickCoverage(adjusted, session.date);
        coverage = decision.coverage;
        purchaseId = decision.purchaseId;
        remaining = decision.remainingAfter;
        if (decision.consumes && decision.purchaseId) {
          consumption.set(decision.purchaseId, (consumption.get(decision.purchaseId) ?? 0) + 1);
        }
      }
    }

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO attendance (session_id, member_id, status, coverage, purchase_id, recorded_by, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, member_id) DO UPDATE SET
           status = excluded.status,
           coverage = excluded.coverage,
           purchase_id = excluded.purchase_id,
           recorded_by = excluded.recorded_by,
           recorded_at = excluded.recorded_at`,
      ).bind(id, entry.memberId, entry.status, coverage, purchaseId, userId, now),
    );

    outcome.push({ memberId: entry.memberId, status: entry.status, coverage, remaining });
  }

  for (const [purchaseId, delta] of consumption) {
    if (delta === 0) continue;
    statements.push(
      c.env.DB.prepare(
        `UPDATE purchases
            SET sessions_used = MAX(0, sessions_used + ?)
          WHERE id = ?`,
      ).bind(delta, purchaseId),
    );
  }

  await c.env.DB.batch(statements);

  // Flip exhausted/expired/active now that usage has moved.
  await resettleMemberPurchases(c.env, memberIds, c.get('today'));

  await audit(c, 'attendance.save', 'class_session', id, {
    count: entries.length,
    uncovered: outcome.filter((o) => o.coverage === 'uncovered').length,
  });

  return c.json({ saved: outcome.length, entries: outcome });
});

/** Recomputes purchase status after usage or time has moved it. */
export async function resettleMemberPurchases(
  env: AppBindings['Bindings'],
  memberIds: number[],
  asOf: string,
): Promise<void> {
  if (!memberIds.length) return;
  const { results } = await env.DB.prepare(
    `SELECT id, plan_type, sessions_total, sessions_used, valid_from, valid_until, status
       FROM purchases
      WHERE member_id IN (${memberIds.map(() => '?').join(',')}) AND status != 'cancelled'`,
  )
    .bind(...memberIds)
    .all<{
      id: number;
      plan_type: Entitlement['planType'];
      sessions_total: number | null;
      sessions_used: number;
      valid_from: string;
      valid_until: string | null;
      status: Entitlement['status'];
    }>();

  const updates: D1PreparedStatement[] = [];
  for (const r of results ?? []) {
    const next = settleStatus(
      {
        id: r.id,
        planType: r.plan_type,
        sessionsTotal: r.sessions_total,
        sessionsUsed: r.sessions_used,
        validFrom: r.valid_from,
        validUntil: r.valid_until,
        status: r.status,
      },
      asOf,
    );
    if (next !== r.status) {
      updates.push(env.DB.prepare(`UPDATE purchases SET status = ? WHERE id = ?`).bind(next, r.id));
    }
  }
  if (updates.length) await env.DB.batch(updates);
}

export default sessions;

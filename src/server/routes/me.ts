import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { coverageOutlook, pickCoverage } from '../../shared/billing';
import { evaluateEligibility } from '../../shared/promotion';
import { isIsoDate } from '../../shared/dates';
import type { AppBindings } from '../env';
import { audit } from '../middleware';
import { readJson } from '../http';
import { normalisePhone } from '../auth';
import { balancesFor, entitlementsFor, getMember, loadRules, loadSettings } from '../queries';

const me = new Hono<AppBindings>();

function requireOwnMember(c: { get: (k: 'user') => { memberId: number | null } }): number {
  const memberId = c.get('user').memberId;
  if (memberId == null) throw new HTTPException(404, { message: 'no_member_record' });
  return memberId;
}

/**
 * Everything a player sees about themselves on one screen: belt and how close
 * the next promotion is (and why not, if it is blocked), what they owe and when
 * the next payment falls due, their weekly schedule, and what the team trained.
 */
me.get('/overview', async (c) => {
  const user = c.get('user');
  if (user.memberId == null) {
    // Staff accounts need not be attached to a member record.
    return c.json({ member: null, role: user.role });
  }

  const member = await getMember(c.env, user.memberId);
  if (!member) throw new HTTPException(404, { message: 'member_not_found' });

  const rules = await loadRules(c.env);
  const settings = await loadSettings(c.env);
  const asOf = c.get('today');
  const rule = rules[member.belt];

  const eligibility = rule
    ? evaluateEligibility(
        {
          belt: member.belt,
          stripes: member.stripes,
          lastPromotionDate: member.lastPromotionDate,
          joinDate: member.joinDate,
          totalClasses: member.totalClasses,
          classesAtLastPromotion: member.classesAtLastPromotion,
          birthDate: member.birthDate,
          status: member.status,
        },
        rule,
        asOf,
        Number(settings.promotion_lookahead_days ?? 60),
      )
    : null;

  const [
    balances,
    entitlements,
    attendance,
    monthly,
    beltHistory,
    recentClasses,
    lastPayment,
    schedule,
  ] = await Promise.all([
    balancesFor(c.env, [member.id]),
    entitlementsFor(c.env, member.id),
    c.env.DB.prepare(
      `SELECT a.status, a.coverage, cs.date, cs.class_type, cs.start_time, cs.technique_title
         FROM attendance a
         JOIN class_sessions cs ON cs.id = a.session_id
        WHERE a.member_id = ?
        ORDER BY cs.date DESC
        LIMIT 30`,
    )
      .bind(member.id)
      .all(),
    // Monthly counts: imported history plus everything recorded in the app.
    c.env.DB.prepare(
      `SELECT period, SUM(classes) AS classes FROM (
         SELECT CASE WHEN year = 0 THEN 'earlier'
                     ELSE printf('%04d-%02d', year, month) END AS period,
                classes
           FROM legacy_monthly_attendance WHERE member_id = ?
         UNION ALL
         SELECT substr(cs.date, 1, 7) AS period, 1 AS classes
           FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id
          WHERE a.member_id = ? AND a.status IN ('present','late')
       )
       GROUP BY period ORDER BY period`,
    )
      .bind(member.id, member.id)
      .all(),
    c.env.DB.prepare(
      `SELECT from_belt, from_stripes, to_belt, to_stripes, kind, promoted_on, note
         FROM promotions WHERE member_id = ? ORDER BY promoted_on DESC, id DESC`,
    )
      .bind(member.id)
      .all(),
    c.env.DB.prepare(
      `SELECT cs.date, cs.class_type, cs.technique_title, cs.technique_notes,
              CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS attended
         FROM class_sessions cs
         LEFT JOIN attendance a
                ON a.session_id = cs.id AND a.member_id = ? AND a.status IN ('present','late')
        WHERE cs.technique_title IS NOT NULL
        ORDER BY cs.date DESC LIMIT 10`,
    )
      .bind(member.id)
      .all(),
    c.env.DB.prepare(
      `SELECT amount_minor, currency, paid_on, method
         FROM payments WHERE member_id = ? ORDER BY paid_on DESC, id DESC LIMIT 1`,
    )
      .bind(member.id)
      .first(),
    // The weekly schedule of the groups this member belongs to.
    c.env.DB.prepare(
      `SELECT g.id AS group_id, g.name_ar, g.name_en, g.class_type, g.location,
              s.weekday, s.start_time, s.duration_minutes
         FROM group_members gm
         JOIN training_groups g ON g.id = gm.group_id AND g.active = 1
         LEFT JOIN group_slots s ON s.group_id = g.id
        WHERE gm.member_id = ?
        ORDER BY s.weekday, s.start_time`,
    )
      .bind(member.id)
      .all(),
  ]);

  return c.json({
    member,
    role: user.role,
    eligibility,
    rule: rule ?? null,
    balance: balances.get(member.id) ?? { chargedMinor: 0, paidMinor: 0, outstandingMinor: 0 },
    currentCoverage: pickCoverage(entitlements, asOf),
    outlook: coverageOutlook(entitlements, asOf),
    activeEntitlements: entitlements,
    lastPayment: lastPayment ?? null,
    attendance: attendance.results ?? [],
    monthly: monthly.results ?? [],
    beltHistory: beltHistory.results ?? [],
    recentClasses: recentClasses.results ?? [],
    schedule: schedule.results ?? [],
  });
});

/**
 * A player maintaining their own contact details.
 *
 * Phone is also the login identifier, so changing it changes how they sign in.
 * The response says so explicitly and the client confirms before sending, which
 * is better than silently moving someone's login out from under them. An admin
 * can always reset it.
 */
me.patch('/profile', async (c) => {
  const memberId = requireOwnMember(c);
  const user = c.get('user');

  const b = await readJson<{
    nameAr: string;
    nameEn: string | null;
    phone: string;
    birthDate: string | null;
  }>(c.req);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(v);
  };

  let loginChangedTo: string | null = null;

  if (b.nameAr !== undefined) {
    const v = b.nameAr.trim();
    if (!v) throw new HTTPException(400, { message: 'name_required' });
    if (v.length > 80) throw new HTTPException(400, { message: 'name_too_long' });
    put('name_ar', v);
  }
  if (b.nameEn !== undefined) put('name_en', b.nameEn?.trim() || null);

  if (b.birthDate !== undefined) {
    if (b.birthDate && !isIsoDate(b.birthDate)) {
      throw new HTTPException(400, { message: 'bad_birth_date' });
    }
    if (b.birthDate && b.birthDate > c.get('today')) {
      throw new HTTPException(400, { message: 'bad_birth_date' });
    }
    put('birth_date', b.birthDate || null);
  }

  if (b.phone !== undefined) {
    const phone = normalisePhone(b.phone);
    if (!phone) throw new HTTPException(400, { message: 'bad_phone' });

    const clash = await c.env.DB.prepare(
      `SELECT id FROM users WHERE login = ? AND id != ?`,
    )
      .bind(phone, user.userId)
      .first();
    if (clash) throw new HTTPException(409, { message: 'login_taken' });

    put('phone', phone);
    loginChangedTo = phone;
  }

  if (!sets.length) throw new HTTPException(400, { message: 'nothing_to_update' });

  put('updated_at', new Date().toISOString());
  binds.push(memberId);

  const statements = [
    c.env.DB.prepare(`UPDATE members SET ${sets.join(', ')} WHERE id = ?`).bind(...binds),
  ];
  if (loginChangedTo) {
    statements.push(
      c.env.DB.prepare(`UPDATE users SET login = ? WHERE id = ?`).bind(loginChangedTo, user.userId),
    );
  }
  await c.env.DB.batch(statements);

  await audit(c, 'me.profile_update', 'member', memberId, {
    fields: Object.keys(b),
    loginChanged: !!loginChangedTo,
  });

  return c.json({
    member: await getMember(c.env, memberId),
    loginChangedTo,
  });
});

export default me;

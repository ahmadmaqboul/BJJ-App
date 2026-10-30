import type { Belt, Member, MemberStatus, PromotionRule, Role } from '../shared/types';
import type { MemberType, StatusReason } from '../shared/membership';
import type { Entitlement } from '../shared/billing';
import type { Env } from './env';

/**
 * A member's class count is their imported spreadsheet total plus every
 * present/late attendance recorded since. Absences and excused days never
 * count toward a promotion.
 */
const MEMBER_SELECT = `
  SELECT m.id, m.name_ar, m.name_en, m.phone, m.birth_date, m.join_date, m.status,
         m.status_reason, m.status_note, m.status_changed_on, m.member_type,
         m.belt, m.stripes, m.last_promotion_date, m.legacy_attendance,
         m.classes_at_last_promotion, m.notes,
         m.legacy_attendance + COALESCE(att.cnt, 0) AS total_classes,
         u.role AS role,
         CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS has_login
    FROM members m
    LEFT JOIN (
      SELECT member_id, COUNT(*) AS cnt
        FROM attendance
       WHERE status IN ('present', 'late')
       GROUP BY member_id
    ) att ON att.member_id = m.id
    LEFT JOIN users u ON u.member_id = m.id
`;

export interface MemberRow {
  id: number;
  name_ar: string;
  name_en: string | null;
  phone: string | null;
  birth_date: string | null;
  join_date: string;
  status: MemberStatus;
  member_type: MemberType;
  status_reason: StatusReason | null;
  status_note: string | null;
  status_changed_on: string | null;
  belt: Belt;
  stripes: number;
  last_promotion_date: string | null;
  legacy_attendance: number;
  classes_at_last_promotion: number;
  notes: string | null;
  total_classes: number;
  role: Role | null;
  has_login: number;
}

export function toMember(r: MemberRow): Member {
  return {
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    phone: r.phone,
    birthDate: r.birth_date,
    joinDate: r.join_date,
    status: r.status,
    memberType: r.member_type,
    statusReason: r.status_reason,
    statusNote: r.status_note,
    statusChangedOn: r.status_changed_on,
    belt: r.belt,
    stripes: r.stripes,
    lastPromotionDate: r.last_promotion_date,
    legacyAttendance: r.legacy_attendance,
    classesAtLastPromotion: r.classes_at_last_promotion,
    notes: r.notes,
    totalClasses: r.total_classes,
    hasLogin: !!r.has_login,
    role: r.role,
  };
}

export async function listMembers(
  env: Env,
  opts: { status?: MemberStatus | 'all'; search?: string } = {},
): Promise<Member[]> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (opts.status && opts.status !== 'all') {
    where.push('m.status = ?');
    binds.push(opts.status);
  }
  if (opts.search) {
    where.push('(m.name_ar LIKE ? OR m.name_en LIKE ? OR m.phone LIKE ?)');
    const like = `%${opts.search}%`;
    binds.push(like, like, like);
  }

  const sql =
    MEMBER_SELECT +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY m.status = 'active' DESC, m.name_ar COLLATE NOCASE`;

  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<MemberRow>();
  return (results ?? []).map(toMember);
}

export async function getMember(env: Env, id: number): Promise<Member | null> {
  const row = await env.DB.prepare(`${MEMBER_SELECT} WHERE m.id = ?`).bind(id).first<MemberRow>();
  return row ? toMember(row) : null;
}

// --------------------------------------------------------- promotion rules ---

export interface RuleRow {
  belt: Belt;
  months_per_stripe: number;
  classes_per_stripe: number;
  max_stripes: number;
  months_to_next_belt: number;
  classes_to_next_belt: number;
  min_age: number | null;
  next_belt: Belt | null;
}

export function toRule(r: RuleRow): PromotionRule {
  return {
    belt: r.belt,
    monthsPerStripe: r.months_per_stripe,
    classesPerStripe: r.classes_per_stripe,
    maxStripes: r.max_stripes,
    monthsToNextBelt: r.months_to_next_belt,
    classesToNextBelt: r.classes_to_next_belt,
    minAge: r.min_age,
    nextBelt: r.next_belt,
  };
}

export async function loadRules(env: Env): Promise<Record<Belt, PromotionRule>> {
  const { results } = await env.DB.prepare(`SELECT * FROM promotion_rules`).all<RuleRow>();
  const map = {} as Record<Belt, PromotionRule>;
  for (const row of results ?? []) map[row.belt] = toRule(row);
  return map;
}

// ------------------------------------------------------------- entitlements ---

interface EntitlementRow {
  id: number;
  plan_type: Entitlement['planType'];
  sessions_total: number | null;
  sessions_used: number;
  valid_from: string;
  valid_until: string | null;
  status: Entitlement['status'];
}

function toEntitlement(r: EntitlementRow): Entitlement {
  return {
    id: r.id,
    planType: r.plan_type,
    sessionsTotal: r.sessions_total,
    sessionsUsed: r.sessions_used,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    status: r.status,
  };
}

export async function entitlementsFor(env: Env, memberId: number): Promise<Entitlement[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, plan_type, sessions_total, sessions_used, valid_from, valid_until, status
       FROM purchases
      WHERE member_id = ? AND status = 'active'
      ORDER BY id`,
  )
    .bind(memberId)
    .all<EntitlementRow>();
  return (results ?? []).map(toEntitlement);
}

/** Entitlements for many members at once, for the check-in roster. */
export async function entitlementsForMany(
  env: Env,
  memberIds: number[],
): Promise<Map<number, Entitlement[]>> {
  const map = new Map<number, Entitlement[]>();
  if (!memberIds.length) return map;

  const placeholders = memberIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT member_id, id, plan_type, sessions_total, sessions_used, valid_from, valid_until, status
       FROM purchases
      WHERE status = 'active' AND member_id IN (${placeholders})
      ORDER BY member_id, id`,
  )
    .bind(...memberIds)
    .all<EntitlementRow & { member_id: number }>();

  for (const row of results ?? []) {
    const list = map.get(row.member_id) ?? [];
    list.push(toEntitlement(row));
    map.set(row.member_id, list);
  }
  return map;
}

// ---------------------------------------------------------------- balances ---

export interface BalanceRow {
  member_id: number;
  charged_minor: number;
  paid_minor: number;
}

/**
 * Outstanding money per member: everything charged (excluding cancelled
 * purchases) minus everything paid. Positive means the member owes the club.
 */
export async function balancesFor(
  env: Env,
  memberIds?: number[],
): Promise<Map<number, { chargedMinor: number; paidMinor: number; outstandingMinor: number }>> {
  const scoped = memberIds?.length ? memberIds : null;
  const where = scoped ? `WHERE member_id IN (${scoped.map(() => '?').join(',')})` : '';

  const { results } = await env.DB.prepare(
    `SELECT member_id,
            SUM(charged) AS charged_minor,
            SUM(paid)    AS paid_minor
       FROM (
         SELECT member_id, amount_minor AS charged, 0 AS paid
           FROM purchases WHERE status != 'cancelled'
         UNION ALL
         SELECT member_id, 0 AS charged, amount_minor AS paid
           FROM payments
       )
       ${where}
       GROUP BY member_id`,
  )
    .bind(...(scoped ?? []))
    .all<BalanceRow>();

  const map = new Map<number, { chargedMinor: number; paidMinor: number; outstandingMinor: number }>();
  for (const r of results ?? []) {
    map.set(r.member_id, {
      chargedMinor: r.charged_minor ?? 0,
      paidMinor: r.paid_minor ?? 0,
      outstandingMinor: (r.charged_minor ?? 0) - (r.paid_minor ?? 0),
    });
  }
  return map;
}

// ------------------------------------------------------ subscription status ---

/**
 * Everything the subscription half of a member's status needs, for many
 * members at once: whether they have ever bought anything, and when they were
 * last on the mat.
 *
 * "Last seen" merges the imported monthly totals with recorded attendance, so
 * it is a month ('2026-01') for history carried over from the spreadsheet and
 * a full date for anything the app recorded itself. Members whose entire
 * history is in the sheet's undated pre-2026 bucket get the sentinel
 * '0000-00', which sorts below every real month so MAX() never prefers it —
 * without it they would read as having never trained at all.
 */
export interface MemberActivity {
  everPurchased: boolean;
  lastSeen: string | null;
}

export async function activityFor(
  env: Env,
  memberIds?: number[],
): Promise<Map<number, MemberActivity>> {
  const scoped = memberIds?.length ? memberIds : null;
  const inList = scoped ? `WHERE member_id IN (${scoped.map(() => '?').join(',')})` : '';

  const [purchased, seen] = await Promise.all([
    env.DB.prepare(
      `SELECT member_id, COUNT(*) AS n FROM purchases ${inList} GROUP BY member_id`,
    )
      .bind(...(scoped ?? []))
      .all<{ member_id: number; n: number }>(),
    env.DB.prepare(
      `SELECT member_id, MAX(period) AS last_seen FROM (
         SELECT member_id, printf('%04d-%02d', year, month) AS period
           FROM legacy_monthly_attendance
          WHERE year > 0 AND classes > 0
         UNION ALL
         SELECT member_id, '0000-00' AS period
           FROM legacy_monthly_attendance
          WHERE year = 0 AND classes > 0
         UNION ALL
         SELECT a.member_id, cs.date AS period
           FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id
          WHERE a.status IN ('present','late')
       ) ${inList} GROUP BY member_id`,
    )
      .bind(...(scoped ?? []))
      .all<{ member_id: number; last_seen: string | null }>(),
  ]);

  const map = new Map<number, MemberActivity>();
  for (const r of purchased.results ?? []) {
    map.set(r.member_id, { everPurchased: r.n > 0, lastSeen: null });
  }
  for (const r of seen.results ?? []) {
    const existing = map.get(r.member_id) ?? { everPurchased: false, lastSeen: null };
    existing.lastSeen = r.last_seen;
    map.set(r.member_id, existing);
  }
  return map;
}

// ---------------------------------------------------------------- settings ---

export async function loadSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings`).all<{
    key: string;
    value: string;
  }>();
  return Object.fromEntries((results ?? []).map((r) => [r.key, r.value]));
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(key, value)
    .run();
}

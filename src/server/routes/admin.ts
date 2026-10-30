import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { monthBounds } from '../../shared/dates';
import { evaluateEligibility } from '../../shared/promotion';
import type { AppBindings } from '../env';
import { audit, requireAdmin, requireStaff } from '../middleware';
import { balancesFor, listMembers, loadRules, loadSettings, setSetting } from '../queries';
import { readJson } from '../http';

const admin = new Hono<AppBindings>();

/** Keys the admin UI is allowed to change. */
const EDITABLE_SETTINGS = new Set([
  'team_name',
  'team_name_ar',
  'default_currency',
  'timezone',
  'class_week_days',
  'default_class_type',
  'promotion_lookahead_days',
]);

admin.get('/settings', requireStaff, async (c) => {
  return c.json({ settings: await loadSettings(c.env) });
});

admin.put('/settings', requireAdmin, async (c) => {
  const body = await readJson<Record<string, string>>(c.req);
  const applied: Record<string, string> = {};

  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE_SETTINGS.has(key)) continue;
    if (typeof value !== 'string' || value.length > 200) {
      throw new HTTPException(400, { message: `bad_value:${key}` });
    }
    await setSetting(c.env, key, value);
    applied[key] = value;
  }

  if (!Object.keys(applied).length) throw new HTTPException(400, { message: 'nothing_to_update' });

  await audit(c, 'settings.update', 'settings', null, applied);
  return c.json({ settings: await loadSettings(c.env) });
});

/** The numbers the admin home screen opens on. */
admin.get('/dashboard', requireStaff, async (c) => {
  const asOf = c.get('today');
  const { start, end } = monthBounds(asOf);

  const [members, rules, settings, balances] = await Promise.all([
    listMembers(c.env, { status: 'all' }),
    loadRules(c.env),
    loadSettings(c.env),
    balancesFor(c.env),
  ]);

  const lookahead = Number(settings.promotion_lookahead_days ?? 60);
  let due = 0;
  let blockedByAttendance = 0;

  for (const m of members) {
    const rule = rules[m.belt];
    if (!rule) continue;
    const e = evaluateEligibility(
      {
        belt: m.belt,
        stripes: m.stripes,
        lastPromotionDate: m.lastPromotionDate,
        joinDate: m.joinDate,
        totalClasses: m.totalClasses,
        classesAtLastPromotion: m.classesAtLastPromotion,
        birthDate: m.birthDate,
        status: m.status,
      },
      rule,
      asOf,
      lookahead,
    );
    if (e.status === 'due' || e.status === 'overdue') due += 1;
    if (e.status === 'blocked_attendance') blockedByAttendance += 1;
  }

  const monthStats = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM class_sessions WHERE date BETWEEN ? AND ?) AS classes_this_month,
       (SELECT COUNT(*) FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id
         WHERE cs.date BETWEEN ? AND ? AND a.status IN ('present','late')) AS checkins_this_month,
       (SELECT COUNT(*) FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id
         WHERE cs.date BETWEEN ? AND ? AND a.coverage = 'uncovered'
           AND a.status IN ('present','late')) AS uncovered_this_month,
       (SELECT COALESCE(SUM(amount_minor),0) FROM payments WHERE paid_on BETWEEN ? AND ?) AS collected_this_month`,
  )
    .bind(start, end, start, end, start, end, start, end)
    .first<{
      classes_this_month: number;
      checkins_this_month: number;
      uncovered_this_month: number;
      collected_this_month: number;
    }>();

  const outstandingMinor = [...balances.values()].reduce(
    (sum, b) => sum + Math.max(0, b.outstandingMinor),
    0,
  );

  const lastSession = await c.env.DB.prepare(
    `SELECT cs.id, cs.date, cs.class_type, cs.technique_title,
            COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) AS present_count
       FROM class_sessions cs LEFT JOIN attendance a ON a.session_id = cs.id
      GROUP BY cs.id ORDER BY cs.date DESC, cs.id DESC LIMIT 1`,
  ).first();

  return c.json({
    asOf,
    members: {
      total: members.length,
      active: members.filter((m) => m.status === 'active').length,
      inactive: members.filter((m) => m.status === 'inactive').length,
      paused: members.filter((m) => m.status === 'paused').length,
      withoutLogin: members.filter((m) => !m.hasLogin).length,
    },
    promotions: { due, blockedByAttendance },
    month: {
      key: asOf.slice(0, 7),
      classes: monthStats?.classes_this_month ?? 0,
      checkins: monthStats?.checkins_this_month ?? 0,
      uncovered: monthStats?.uncovered_this_month ?? 0,
      collectedMinor: monthStats?.collected_this_month ?? 0,
    },
    outstandingMinor,
    membersOwing: [...balances.values()].filter((b) => b.outstandingMinor > 0).length,
    lastSession,
  });
});

admin.get('/audit', requireAdmin, async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({ entries: results ?? [] });
});

/**
 * CSV export of the whole roster: one row per member, a column per recent
 * month of attendance, plus the three things the old spreadsheet was really
 * being kept for — when they last paid, when their subscription runs out, and
 * what they owe.
 *
 * Excel on Windows reads a UTF-8 CSV as the system codepage unless it starts
 * with a byte-order mark, which turns every Arabic name into mojibake. The BOM
 * below is what keeps the file readable after download.
 */
admin.get('/export/members.csv', requireStaff, async (c) => {
  const asOf = c.get('today');
  const months = Number(c.req.query('months') ?? 12);

  // The month columns, oldest first, ending with the current one.
  const periods: string[] = [];
  {
    const [y, m] = asOf.split('-').map(Number);
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(y!, m! - 1 - i, 1));
      periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
  }

  const [members, monthly, payments, subs, balances] = await Promise.all([
    listMembers(c.env, { status: 'all' }),
    c.env.DB.prepare(
      `SELECT member_id, period, SUM(classes) AS classes FROM (
         SELECT member_id, printf('%04d-%02d', year, month) AS period, classes
           FROM legacy_monthly_attendance WHERE year > 0
         UNION ALL
         SELECT a.member_id, substr(cs.date, 1, 7) AS period, 1 AS classes
           FROM attendance a JOIN class_sessions cs ON cs.id = a.session_id
          WHERE a.status IN ('present','late')
       ) GROUP BY member_id, period`,
    ).all<{ member_id: number; period: string; classes: number }>(),
    c.env.DB.prepare(
      `SELECT member_id, MAX(paid_on) AS last_paid, SUM(amount_minor) AS paid
         FROM payments GROUP BY member_id`,
    ).all<{ member_id: number; last_paid: string; paid: number }>(),
    c.env.DB.prepare(
      `SELECT member_id, MAX(valid_until) AS until
         FROM purchases
        WHERE status = 'active' AND plan_type = 'monthly'
        GROUP BY member_id`,
    ).all<{ member_id: number; until: string | null }>(),
    balancesFor(c.env),
  ]);

  const byMember = new Map<number, Map<string, number>>();
  for (const r of monthly.results ?? []) {
    const m = byMember.get(r.member_id) ?? new Map();
    m.set(r.period, r.classes);
    byMember.set(r.member_id, m);
  }
  const lastPaid = new Map((payments.results ?? []).map((r) => [r.member_id, r.last_paid]));
  const subUntil = new Map((subs.results ?? []).map((r) => [r.member_id, r.until]));

  const BELT_AR: Record<string, string> = {
    white: 'أبيض', blue: 'أزرق', purple: 'بنفسجي', brown: 'بني', black: 'أسود',
  };
  const STATUS_AR: Record<string, string> = {
    active: 'نشط', inactive: 'غير نشط', paused: 'موقوف مؤقتًا',
  };

  const header = [
    'اسم اللاعب',
    'رقم الجوال',
    'النوع',
    'الحالة',
    'الحزام',
    'عدد الخطوط',
    'تاريخ اخر ترقية',
    ...periods.map((p) => `شهر ${p}`),
    'اجمالي الحضور',
    'تاريخ اخر دفعة',
    'الاشتراك ساري لغاية',
    'المتبقي عليه',
    'رصيد له',
  ];

  const rows = members.map((m) => {
    const perMonth = byMember.get(m.id) ?? new Map();
    const bal = balances.get(m.id)?.outstandingMinor ?? 0;
    const until = subUntil.get(m.id) ?? null;

    return [
      m.nameAr,
      m.phone ?? '',
      m.memberType === 'coach' ? 'مدرب' : 'لاعب',
      STATUS_AR[m.status] ?? m.status,
      BELT_AR[m.belt] ?? m.belt,
      m.stripes,
      m.lastPromotionDate ?? '',
      ...periods.map((p) => perMonth.get(p) ?? 0),
      m.totalClasses,
      lastPaid.get(m.id) ?? '',
      // A coach is never billed, so an end date would be misleading.
      m.memberType === 'coach' ? 'معفى' : (until ?? ''),
      bal > 0 ? (bal / 100).toFixed(2) : '',
      bal < 0 ? (-bal / 100).toFixed(2) : '',
    ];
  });

  const escape = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');

  await audit(c, 'export.members', 'members', null, { rows: rows.length, months });

  return new Response('\uFEFF' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="jui-jitsu-${asOf}.csv"`,
      'cache-control': 'no-store',
    },
  });
});

export default admin;

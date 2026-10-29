import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { evaluateEligibility } from '@shared/promotion';
import { isIsoDate } from '@shared/dates';
import type { Belt, MemberStatus } from '@shared/types';
import type { AppBindings } from '../env';
import { assertCanReadMember, audit, requireAdmin, requireStaff } from '../middleware';
import {
  balancesFor,
  getMember,
  listMembers,
  loadRules,
  loadSettings,
} from '../queries';
import { generatePin, newCredential, normalisePhone, pinProblem } from '../auth';
import { readJson } from '../http';

const members = new Hono<AppBindings>();

const STATUSES: MemberStatus[] = ['active', 'inactive', 'paused'];

members.get('/', requireStaff, async (c) => {
  const status = (c.req.query('status') ?? 'all') as MemberStatus | 'all';
  const search = c.req.query('q') ?? undefined;

  const list = await listMembers(c.env, {
    status: status === 'all' ? 'all' : status,
    search,
  });

  const balances = await balancesFor(c.env);
  const rules = await loadRules(c.env);
  const asOf = c.get('today');

  return c.json({
    members: list.map((m) => ({
      ...m,
      balance: balances.get(m.id) ?? { chargedMinor: 0, paidMinor: 0, outstandingMinor: 0 },
      eligibility: rules[m.belt]
        ? evaluateEligibility(
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
            rules[m.belt]!,
            asOf,
          )
        : null,
    })),
  });
});

members.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'bad_id' });
  assertCanReadMember(c.get('user'), id);

  const member = await getMember(c.env, id);
  if (!member) throw new HTTPException(404, { message: 'member_not_found' });

  const rules = await loadRules(c.env);
  const settings = await loadSettings(c.env);
  const asOf = c.get('today');
  const lookahead = Number(settings.promotion_lookahead_days ?? 60);

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
        lookahead,
      )
    : null;

  const [balanceMap, promotions, recentAttendance, monthly, purchases, payments] = await Promise.all([
    balancesFor(c.env, [id]),
    c.env.DB.prepare(
      `SELECT id, from_belt, from_stripes, to_belt, to_stripes, kind, promoted_on,
              classes_at_promotion, awarded_by, note
         FROM promotions WHERE member_id = ? ORDER BY promoted_on DESC, id DESC`,
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      `SELECT a.id, a.status, a.coverage, cs.date, cs.class_type, cs.start_time,
              cs.technique_title
         FROM attendance a
         JOIN class_sessions cs ON cs.id = a.session_id
        WHERE a.member_id = ?
        ORDER BY cs.date DESC, cs.start_time DESC
        LIMIT 40`,
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      `SELECT year, month, classes FROM legacy_monthly_attendance
        WHERE member_id = ? ORDER BY year, month`,
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      `SELECT p.*, COALESCE(pay.paid, 0) AS paid_minor
         FROM purchases p
         LEFT JOIN (SELECT purchase_id, SUM(amount_minor) paid FROM payments GROUP BY purchase_id) pay
                ON pay.purchase_id = p.id
        WHERE p.member_id = ?
        ORDER BY p.valid_from DESC, p.id DESC`,
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      `SELECT id, purchase_id, amount_minor, currency, paid_on, method, note
         FROM payments WHERE member_id = ? ORDER BY paid_on DESC, id DESC LIMIT 50`,
    )
      .bind(id)
      .all(),
  ]);

  return c.json({
    member,
    eligibility,
    rule: rule ?? null,
    balance: balanceMap.get(id) ?? { chargedMinor: 0, paidMinor: 0, outstandingMinor: 0 },
    promotions: promotions.results ?? [],
    attendance: recentAttendance.results ?? [],
    legacyMonthly: monthly.results ?? [],
    purchases: purchases.results ?? [],
    payments: payments.results ?? [],
  });
});

interface MemberBody {
  nameAr?: string;
  nameEn?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  joinDate?: string;
  status?: MemberStatus;
  belt?: Belt;
  stripes?: number;
  lastPromotionDate?: string | null;
  notes?: string | null;
}

members.post('/', requireAdmin, async (c) => {
  const body = await readJson<MemberBody>(c.req);
  const nameAr = (body.nameAr ?? '').trim();
  if (!nameAr) throw new HTTPException(400, { message: 'name_required' });

  const joinDate = body.joinDate && isIsoDate(body.joinDate) ? body.joinDate : c.get('today');
  const phone = body.phone ? normalisePhone(body.phone) : null;
  if (body.phone && !phone) throw new HTTPException(400, { message: 'bad_phone' });

  const belt = body.belt ?? 'white';
  const stripes = Math.max(0, Math.min(4, body.stripes ?? 0));

  const result = await c.env.DB.prepare(
    `INSERT INTO members (name_ar, name_en, phone, birth_date, join_date, status, belt,
                          stripes, last_promotion_date, legacy_attendance,
                          classes_at_last_promotion, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
     RETURNING id`,
  )
    .bind(
      nameAr,
      body.nameEn?.trim() || null,
      phone,
      body.birthDate && isIsoDate(body.birthDate) ? body.birthDate : null,
      joinDate,
      body.status && STATUSES.includes(body.status) ? body.status : 'active',
      belt,
      stripes,
      body.lastPromotionDate && isIsoDate(body.lastPromotionDate) ? body.lastPromotionDate : joinDate,
      body.notes?.trim() || null,
    )
    .first<{ id: number }>();

  const id = result!.id;

  // A new member starts their grade clock now, recorded as history.
  await c.env.DB.prepare(
    `INSERT INTO promotions (member_id, to_belt, to_stripes, kind, promoted_on, classes_at_promotion, created_by)
     VALUES (?, ?, ?, 'initial', ?, 0, ?)`,
  )
    .bind(id, belt, stripes, joinDate, c.get('user').userId)
    .run();

  await audit(c, 'member.create', 'member', id, { nameAr });
  return c.json({ member: await getMember(c.env, id) }, 201);
});

members.patch('/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await getMember(c.env, id);
  if (!existing) throw new HTTPException(404, { message: 'member_not_found' });

  const body = await readJson<MemberBody>(c.req);
  const sets: string[] = [];
  const binds: unknown[] = [];

  const put = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(value);
  };

  if (body.nameAr !== undefined) {
    const v = body.nameAr.trim();
    if (!v) throw new HTTPException(400, { message: 'name_required' });
    put('name_ar', v);
  }
  if (body.nameEn !== undefined) put('name_en', body.nameEn?.trim() || null);
  if (body.phone !== undefined) {
    const phone = body.phone ? normalisePhone(body.phone) : null;
    if (body.phone && !phone) throw new HTTPException(400, { message: 'bad_phone' });
    put('phone', phone);
  }
  if (body.birthDate !== undefined) {
    if (body.birthDate && !isIsoDate(body.birthDate)) {
      throw new HTTPException(400, { message: 'bad_birth_date' });
    }
    put('birth_date', body.birthDate || null);
  }
  if (body.joinDate !== undefined) {
    if (!isIsoDate(body.joinDate)) throw new HTTPException(400, { message: 'bad_join_date' });
    put('join_date', body.joinDate);
  }
  if (body.notes !== undefined) put('notes', body.notes?.trim() || null);

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new HTTPException(400, { message: 'bad_status' });
    put('status', body.status);
    put('status_changed_on', c.get('today'));
  }

  // Belt and stripes are normally moved by recording a promotion, which keeps
  // history intact. Editing them here is a correction, and is logged as one.
  if (body.belt !== undefined || body.stripes !== undefined) {
    const belt = body.belt ?? existing.belt;
    const stripes = Math.max(0, Math.min(4, body.stripes ?? existing.stripes));
    put('belt', belt);
    put('stripes', stripes);
    if (body.lastPromotionDate && isIsoDate(body.lastPromotionDate)) {
      put('last_promotion_date', body.lastPromotionDate);
    }
    await c.env.DB.prepare(
      `INSERT INTO promotions (member_id, from_belt, from_stripes, to_belt, to_stripes,
                               kind, promoted_on, classes_at_promotion, note, created_by)
       VALUES (?, ?, ?, ?, ?, 'correction', ?, ?, 'تعديل يدوي من ملف اللاعب', ?)`,
    )
      .bind(
        id,
        existing.belt,
        existing.stripes,
        belt,
        stripes,
        body.lastPromotionDate && isIsoDate(body.lastPromotionDate)
          ? body.lastPromotionDate
          : (existing.lastPromotionDate ?? c.get('today')),
        existing.totalClasses,
        c.get('user').userId,
      )
      .run();
  }

  if (!sets.length) return c.json({ member: existing });

  put('updated_at', new Date().toISOString());
  binds.push(id);

  await c.env.DB.prepare(`UPDATE members SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  await audit(c, 'member.update', 'member', id, body);
  return c.json({ member: await getMember(c.env, id) });
});

/**
 * Status is the active/inactive switch, kept as its own endpoint because it is
 * the one member field the coach touches constantly.
 */
members.post('/:id/status', requireStaff, async (c) => {
  const id = Number(c.req.param('id'));
  const body = await readJson<{ status?: MemberStatus }>(c.req);
  if (!body.status || !STATUSES.includes(body.status)) {
    throw new HTTPException(400, { message: 'bad_status' });
  }

  const res = await c.env.DB.prepare(
    `UPDATE members SET status = ?, status_changed_on = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(body.status, c.get('today'), new Date().toISOString(), id)
    .run();

  if (!res.meta.changes) throw new HTTPException(404, { message: 'member_not_found' });

  await audit(c, 'member.status', 'member', id, { status: body.status });
  return c.json({ member: await getMember(c.env, id) });
});

// ----------------------------------------------------------- login accounts ---

/**
 * Creates or resets a member's login. The PIN is generated server-side and
 * returned exactly once, in this response — it is never stored in plain text
 * and cannot be read back later. If it is lost, reset it again.
 */
members.post('/:id/login', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const member = await getMember(c.env, id);
  if (!member) throw new HTTPException(404, { message: 'member_not_found' });

  const body = await readJson<{ login?: string; role?: 'admin' | 'coach' | 'player'; pin?: string }>(c.req);

  const role = body.role ?? 'player';
  const rawLogin = body.login ?? member.phone ?? '';
  const login = normalisePhone(rawLogin);
  if (!login) throw new HTTPException(400, { message: 'phone_required_for_login' });

  const pin = body.pin ?? generatePin(role === 'player' ? 6 : 8);
  const problem = pinProblem(pin, role);
  if (problem) throw new HTTPException(400, { message: problem });

  const clash = await c.env.DB.prepare(
    `SELECT id FROM users WHERE login = ? AND (member_id IS NULL OR member_id != ?)`,
  )
    .bind(login, id)
    .first<{ id: number }>();
  if (clash) throw new HTTPException(409, { message: 'login_taken' });

  const cred = await newCredential(pin, c.env);

  await c.env.DB.prepare(
    `INSERT INTO users (member_id, login, role, pin_hash, pin_salt, pin_iterations, must_change_pin)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(login) DO UPDATE SET
       member_id = excluded.member_id,
       role = excluded.role,
       pin_hash = excluded.pin_hash,
       pin_salt = excluded.pin_salt,
       pin_iterations = excluded.pin_iterations,
       must_change_pin = 1,
       disabled = 0,
       failed_attempts = 0,
       locked_until = NULL`,
  )
    .bind(login, login, role, cred.hash, cred.salt, cred.iterations)
    .run();

  // Keep the member's phone in step with the login they actually use.
  if (member.phone !== login) {
    await c.env.DB.prepare(`UPDATE members SET phone = ? WHERE id = ?`).bind(login, id).run();
  }

  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE login = ?`)
    .bind(login)
    .first<{ id: number }>();
  if (user) {
    // Any existing session on this account is no longer valid.
    await c.env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).bind(user.id).run();
  }

  await audit(c, 'member.login_reset', 'member', id, { login, role });

  return c.json({
    login,
    role,
    // Shown once. Give it to the member; they are forced to change it on first use.
    pin,
    mustChangePin: true,
  });
});

members.delete('/:id/login', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const res = await c.env.DB.prepare(`DELETE FROM users WHERE member_id = ?`).bind(id).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'no_login' });
  await audit(c, 'member.login_delete', 'member', id);
  return c.json({ ok: true });
});

export default members;

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { addDays, isIsoDate } from '../../shared/dates';
import { pickCoverage, type Entitlement } from '../../shared/billing';
import type { Coverage, PaymentMethod, PlanType } from '../../shared/types';
import type { AppBindings, Env } from '../env';
import { assertCanReadMember, audit, requireAdmin, requireStaff } from '../middleware';
import { balancesFor, entitlementsFor, getMember, loadSettings } from '../queries';
import { readJson } from '../http';
import { resettleMemberPurchases } from './sessions';

const billing = new Hono<AppBindings>();

const PLAN_TYPES: PlanType[] = ['monthly', 'package', 'single'];
const METHODS: PaymentMethod[] = ['cash', 'bank', 'wallet', 'other'];

// ------------------------------------------------------------------- plans ---

billing.get('/plans', requireStaff, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM plans WHERE active = 1 OR ? = 1 ORDER BY sort_order, id`,
  )
    .bind(c.req.query('includeInactive') === '1' ? 1 : 0)
    .all();
  return c.json({ plans: results ?? [] });
});

billing.post('/plans', requireAdmin, async (c) => {
  const b = await readJson<{
    nameAr?: string;
    nameEn?: string;
    type?: PlanType;
    priceMinor?: number;
    sessionsIncluded?: number | null;
    validityDays?: number | null;
    sortOrder?: number;
  }>(c.req);

  if (!b.nameAr?.trim()) throw new HTTPException(400, { message: 'name_required' });
  if (!b.type || !PLAN_TYPES.includes(b.type)) throw new HTTPException(400, { message: 'bad_type' });
  if (!Number.isInteger(b.priceMinor) || b.priceMinor! < 0) {
    throw new HTTPException(400, { message: 'bad_price' });
  }

  // A monthly plan is unlimited by definition; a package or single must say
  // how many sessions it buys, or coverage could never be consumed.
  const sessions = b.type === 'monthly' ? null : (b.sessionsIncluded ?? (b.type === 'single' ? 1 : null));
  if (b.type !== 'monthly' && (!Number.isInteger(sessions) || sessions! < 1)) {
    throw new HTTPException(400, { message: 'sessions_required_for_this_type' });
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO plans (name_ar, name_en, type, price_minor, currency, sessions_included,
                        validity_days, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING *`,
  )
    .bind(
      b.nameAr.trim(),
      b.nameEn?.trim() || b.nameAr.trim(),
      b.type,
      b.priceMinor,
      (await loadSettings(c.env)).default_currency ?? c.env.DEFAULT_CURRENCY ?? 'ILS',
      sessions,
      b.validityDays ?? null,
      b.sortOrder ?? 100,
    )
    .first();

  await audit(c, 'plan.create', 'plan', (row as { id: number }).id, b);
  return c.json({ plan: row }, 201);
});

billing.patch('/plans/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const b = await readJson<Record<string, unknown>>(c.req);

  const map: Record<string, string> = {
    nameAr: 'name_ar',
    nameEn: 'name_en',
    priceMinor: 'price_minor',
    sessionsIncluded: 'sessions_included',
    validityDays: 'validity_days',
    active: 'active',
    sortOrder: 'sort_order',
  };

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [key, col] of Object.entries(map)) {
    if (b[key] === undefined) continue;
    sets.push(`${col} = ?`);
    binds.push(key === 'active' ? (b[key] ? 1 : 0) : b[key]);
  }
  if (!sets.length) throw new HTTPException(400, { message: 'nothing_to_update' });

  binds.push(id);
  const res = await c.env.DB.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'plan_not_found' });

  // Existing purchases keep their snapshotted price, so changing a plan here
  // never rewrites what anyone was already charged.
  await audit(c, 'plan.update', 'plan', id, b);
  return c.json({ plan: await c.env.DB.prepare(`SELECT * FROM plans WHERE id = ?`).bind(id).first() });
});

// --------------------------------------------------------------- purchases ---

interface PurchaseBody {
  memberId?: number;
  planId?: number | null;
  /** For an off-menu charge: name it and price it directly. */
  customNameAr?: string;
  customType?: PlanType;
  customSessions?: number | null;
  customValidityDays?: number | null;
  amountMinor?: number;
  validFrom?: string;
  note?: string;
  /** Settle it immediately (the common case: cash on the mat). */
  payNow?: boolean;
  method?: PaymentMethod;
  /** Retroactively cover already-recorded uncovered classes in this window. */
  backfill?: boolean;
}

/**
 * Records a purchase, optionally takes the money for it, and optionally
 * applies it backwards over classes the member already trained uncovered.
 *
 * The backfill is what makes the walk-in case work: a member whose monthly
 * lapsed trains on Sunday, is flagged uncovered, and pays on Tuesday — the
 * Sunday class gets attached to the new purchase instead of staying a debt.
 */
billing.post('/purchases', requireStaff, async (c) => {
  const b = await readJson<PurchaseBody>(c.req);
  const memberId = Number(b.memberId);
  if (!Number.isInteger(memberId)) throw new HTTPException(400, { message: 'member_required' });

  const member = await getMember(c.env, memberId);
  if (!member) throw new HTTPException(404, { message: 'member_not_found' });

  const settings = await loadSettings(c.env);
  const currency = settings.default_currency ?? c.env.DEFAULT_CURRENCY ?? 'ILS';
  const validFrom = b.validFrom && isIsoDate(b.validFrom) ? b.validFrom : c.get('today');

  let planId: number | null = null;
  let nameAr: string;
  let type: PlanType;
  let sessionsTotal: number | null;
  let validityDays: number | null;
  let amountMinor: number;

  if (b.planId) {
    const plan = await c.env.DB.prepare(`SELECT * FROM plans WHERE id = ?`)
      .bind(b.planId)
      .first<{
        id: number;
        name_ar: string;
        type: PlanType;
        price_minor: number;
        sessions_included: number | null;
        validity_days: number | null;
      }>();
    if (!plan) throw new HTTPException(404, { message: 'plan_not_found' });

    planId = plan.id;
    nameAr = plan.name_ar;
    type = plan.type;
    sessionsTotal = plan.sessions_included;
    validityDays = plan.validity_days;
    // An explicit amount wins, so a discount can be given without a new plan.
    amountMinor = Number.isInteger(b.amountMinor) ? b.amountMinor! : plan.price_minor;
  } else {
    if (!b.customNameAr?.trim()) throw new HTTPException(400, { message: 'plan_or_custom_required' });
    if (!b.customType || !PLAN_TYPES.includes(b.customType)) {
      throw new HTTPException(400, { message: 'bad_type' });
    }
    if (!Number.isInteger(b.amountMinor) || b.amountMinor! < 0) {
      throw new HTTPException(400, { message: 'bad_amount' });
    }
    nameAr = b.customNameAr.trim();
    type = b.customType;
    sessionsTotal = type === 'monthly' ? null : (b.customSessions ?? (type === 'single' ? 1 : 1));
    validityDays = b.customValidityDays ?? null;
    amountMinor = b.amountMinor!;
  }

  const validUntil = validityDays ? addDays(validFrom, validityDays - 1) : null;

  const purchase = await c.env.DB.prepare(
    `INSERT INTO purchases (member_id, plan_id, plan_name_ar, plan_type, amount_minor, currency,
                            sessions_total, sessions_used, valid_from, valid_until, status, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'active', ?, ?)
     RETURNING *`,
  )
    .bind(
      memberId,
      planId,
      nameAr,
      type,
      amountMinor,
      currency,
      sessionsTotal,
      validFrom,
      validUntil,
      b.note?.trim() || null,
      c.get('user').userId,
    )
    .first<{ id: number }>();

  const purchaseId = purchase!.id;
  let paymentId: number | null = null;

  if (b.payNow && amountMinor > 0) {
    const method = b.method && METHODS.includes(b.method) ? b.method : 'cash';
    const pay = await c.env.DB.prepare(
      `INSERT INTO payments (member_id, purchase_id, amount_minor, currency, paid_on, method, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(memberId, purchaseId, amountMinor, currency, c.get('today'), method, c.get('user').userId)
      .first<{ id: number }>();
    paymentId = pay!.id;
  }

  let backfilled = 0;
  if (b.backfill) backfilled = await backfillUncovered(c.env, memberId, purchaseId);

  await resettleMemberPurchases(c.env, [memberId], c.get('today'));
  await audit(c, 'purchase.create', 'purchase', purchaseId, {
    memberId,
    type,
    amountMinor,
    paid: !!paymentId,
    backfilled,
  });

  return c.json(
    {
      purchase: await c.env.DB.prepare(`SELECT * FROM purchases WHERE id = ?`).bind(purchaseId).first(),
      paymentId,
      backfilled,
      balance: (await balancesFor(c.env, [memberId])).get(memberId) ?? null,
    },
    201,
  );
});

/**
 * Attaches a new entitlement to classes the member already trained without
 * coverage, oldest first, within the entitlement's validity window.
 */
async function backfillUncovered(env: Env, memberId: number, purchaseId: number): Promise<number> {
  const purchase = await env.DB.prepare(
    `SELECT id, plan_type, sessions_total, sessions_used, valid_from, valid_until, status
       FROM purchases WHERE id = ?`,
  )
    .bind(purchaseId)
    .first<{
      id: number;
      plan_type: Entitlement['planType'];
      sessions_total: number | null;
      sessions_used: number;
      valid_from: string;
      valid_until: string | null;
      status: Entitlement['status'];
    }>();
  if (!purchase) return 0;

  const { results: uncovered } = await env.DB.prepare(
    `SELECT a.id, cs.date
       FROM attendance a
       JOIN class_sessions cs ON cs.id = a.session_id
      WHERE a.member_id = ?
        AND a.coverage = 'uncovered'
        AND a.status IN ('present','late')
        AND cs.date >= ?
        AND (? IS NULL OR cs.date <= ?)
      ORDER BY cs.date`,
  )
    .bind(memberId, purchase.valid_from, purchase.valid_until, purchase.valid_until)
    .all<{ id: number; date: string }>();

  const rows = uncovered ?? [];
  if (!rows.length) return 0;

  const capacity =
    purchase.sessions_total == null
      ? rows.length // unlimited monthly covers everything in its window
      : Math.max(0, purchase.sessions_total - purchase.sessions_used);

  const take = rows.slice(0, capacity);
  if (!take.length) return 0;

  const coverage: Coverage =
    purchase.sessions_total == null ? 'monthly' : purchase.plan_type === 'single' ? 'single' : 'package';

  const statements = take.map((r) =>
    env.DB.prepare(`UPDATE attendance SET coverage = ?, purchase_id = ? WHERE id = ?`).bind(
      coverage,
      purchaseId,
      r.id,
    ),
  );

  if (purchase.sessions_total != null) {
    statements.push(
      env.DB.prepare(`UPDATE purchases SET sessions_used = sessions_used + ? WHERE id = ?`).bind(
        take.length,
        purchaseId,
      ),
    );
  }

  await env.DB.batch(statements);
  return take.length;
}

billing.post('/purchases/:id/cancel', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const purchase = await c.env.DB.prepare(`SELECT member_id FROM purchases WHERE id = ?`)
    .bind(id)
    .first<{ member_id: number }>();
  if (!purchase) throw new HTTPException(404, { message: 'purchase_not_found' });

  // Release any attendance this was paying for so those classes read as
  // uncovered again rather than silently pointing at a cancelled charge.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE attendance SET coverage = 'uncovered', purchase_id = NULL WHERE purchase_id = ?`,
    ).bind(id),
    c.env.DB.prepare(`UPDATE purchases SET status = 'cancelled' WHERE id = ?`).bind(id),
  ]);

  await audit(c, 'purchase.cancel', 'purchase', id, { memberId: purchase.member_id });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- payments ---

billing.post('/payments', requireStaff, async (c) => {
  const b = await readJson<{
    memberId?: number;
    purchaseId?: number | null;
    amountMinor?: number;
    paidOn?: string;
    method?: PaymentMethod;
    note?: string;
  }>(c.req);

  const memberId = Number(b.memberId);
  if (!Number.isInteger(memberId)) throw new HTTPException(400, { message: 'member_required' });
  if (!Number.isInteger(b.amountMinor) || b.amountMinor! <= 0) {
    throw new HTTPException(400, { message: 'bad_amount' });
  }

  const member = await getMember(c.env, memberId);
  if (!member) throw new HTTPException(404, { message: 'member_not_found' });

  if (b.purchaseId) {
    const owns = await c.env.DB.prepare(`SELECT id FROM purchases WHERE id = ? AND member_id = ?`)
      .bind(b.purchaseId, memberId)
      .first();
    if (!owns) throw new HTTPException(400, { message: 'purchase_not_for_member' });
  }

  const settings = await loadSettings(c.env);
  const row = await c.env.DB.prepare(
    `INSERT INTO payments (member_id, purchase_id, amount_minor, currency, paid_on, method, note, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      memberId,
      b.purchaseId ?? null,
      b.amountMinor,
      settings.default_currency ?? c.env.DEFAULT_CURRENCY ?? 'ILS',
      b.paidOn && isIsoDate(b.paidOn) ? b.paidOn : c.get('today'),
      b.method && METHODS.includes(b.method) ? b.method : 'cash',
      b.note?.trim() || null,
      c.get('user').userId,
    )
    .first<{ id: number }>();

  await audit(c, 'payment.create', 'payment', row!.id, { memberId, amountMinor: b.amountMinor });

  return c.json(
    {
      payment: await c.env.DB.prepare(`SELECT * FROM payments WHERE id = ?`).bind(row!.id).first(),
      balance: (await balancesFor(c.env, [memberId])).get(memberId) ?? null,
    },
    201,
  );
});

billing.delete('/payments/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(`SELECT member_id, amount_minor FROM payments WHERE id = ?`)
    .bind(id)
    .first<{ member_id: number; amount_minor: number }>();
  if (!row) throw new HTTPException(404, { message: 'payment_not_found' });

  await c.env.DB.prepare(`DELETE FROM payments WHERE id = ?`).bind(id).run();
  await audit(c, 'payment.delete', 'payment', id, row);
  return c.json({ ok: true });
});

// ------------------------------------------------------------- who owes what ---

billing.get('/outstanding', requireStaff, async (c) => {
  const balances = await balancesFor(c.env);

  const { results: memberRows } = await c.env.DB.prepare(
    `SELECT id, name_ar, phone, status, belt, stripes FROM members ORDER BY name_ar COLLATE NOCASE`,
  ).all<{
    id: number;
    name_ar: string;
    phone: string | null;
    status: string;
    belt: string;
    stripes: number;
  }>();

  const { results: lastPayments } = await c.env.DB.prepare(
    `SELECT member_id, MAX(paid_on) AS last_paid_on FROM payments GROUP BY member_id`,
  ).all<{ member_id: number; last_paid_on: string }>();
  const lastPaid = new Map((lastPayments ?? []).map((r) => [r.member_id, r.last_paid_on]));

  const { results: uncoveredCounts } = await c.env.DB.prepare(
    `SELECT member_id, COUNT(*) AS n FROM attendance
      WHERE coverage = 'uncovered' AND status IN ('present','late')
      GROUP BY member_id`,
  ).all<{ member_id: number; n: number }>();
  const uncovered = new Map((uncoveredCounts ?? []).map((r) => [r.member_id, r.n]));

  const rows = (memberRows ?? []).map((m) => {
    const bal = balances.get(m.id) ?? { chargedMinor: 0, paidMinor: 0, outstandingMinor: 0 };
    return {
      memberId: m.id,
      nameAr: m.name_ar,
      phone: m.phone,
      status: m.status,
      belt: m.belt,
      stripes: m.stripes,
      ...bal,
      lastPaidOn: lastPaid.get(m.id) ?? null,
      uncoveredClasses: uncovered.get(m.id) ?? 0,
    };
  });

  return c.json({
    rows: rows.sort((a, b) => b.outstandingMinor - a.outstandingMinor),
    totalOutstandingMinor: rows.reduce((sum, r) => sum + Math.max(0, r.outstandingMinor), 0),
  });
});

/** A member's own billing view; players may read only their own. */
billing.get('/members/:id', async (c) => {
  const id = Number(c.req.param('id'));
  assertCanReadMember(c.get('user'), id);

  const [purchases, payments, balances, entitlements] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.*, COALESCE(pay.paid, 0) AS paid_minor
         FROM purchases p
         LEFT JOIN (SELECT purchase_id, SUM(amount_minor) paid FROM payments GROUP BY purchase_id) pay
                ON pay.purchase_id = p.id
        WHERE p.member_id = ? ORDER BY p.valid_from DESC, p.id DESC`,
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      `SELECT * FROM payments WHERE member_id = ? ORDER BY paid_on DESC, id DESC`,
    )
      .bind(id)
      .all(),
    balancesFor(c.env, [id]),
    entitlementsFor(c.env, id),
  ]);

  const coverage = pickCoverage(entitlements, c.get('today'));

  return c.json({
    purchases: purchases.results ?? [],
    payments: payments.results ?? [],
    balance: balances.get(id) ?? { chargedMinor: 0, paidMinor: 0, outstandingMinor: 0 },
    currentCoverage: coverage,
  });
});

export default billing;

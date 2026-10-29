import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isIsoDate } from '@shared/dates';
import {
  compareByUrgency,
  evaluateEligibility,
  nextAward,
  type PromotionStatus,
} from '@shared/promotion';
import { BELTS, type Belt } from '@shared/types';
import type { AppBindings } from '../env';
import { assertCanReadMember, audit, requireAdmin, requireStaff } from '../middleware';
import { getMember, listMembers, loadRules, loadSettings } from '../queries';
import { readJson } from '../http';

const promotions = new Hono<AppBindings>();

/**
 * The promotion board.
 *
 * Grouped by what the coach should do about each member, not alphabetically.
 * `blocked_attendance` is the group the spreadsheet could never produce: time
 * served but not enough classes to justify the grade.
 */
promotions.get('/board', requireStaff, async (c) => {
  const members = await listMembers(c.env, { status: 'all' });
  const rules = await loadRules(c.env);
  const settings = await loadSettings(c.env);
  const asOf = c.get('today');
  const lookahead = Number(settings.promotion_lookahead_days ?? 60);

  const rows = members
    .map((m) => {
      const rule = rules[m.belt];
      if (!rule) return null;
      const eligibility = evaluateEligibility(
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
      return {
        memberId: m.id,
        nameAr: m.nameAr,
        phone: m.phone,
        // `status` below is the eligibility verdict, which is what the board
        // groups by; the member's own active/inactive state keeps its own key.
        memberStatus: m.status,
        belt: m.belt,
        stripes: m.stripes,
        lastPromotionDate: m.lastPromotionDate,
        totalClasses: m.totalClasses,
        ...eligibility,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort(compareByUrgency);

  const groups: Record<PromotionStatus, typeof rows> = {
    overdue: [],
    due: [],
    upcoming: [],
    blocked_attendance: [],
    blocked_age: [],
    not_due: [],
    inactive: [],
    capped: [],
  };
  for (const row of rows) groups[row.status].push(row);

  return c.json({
    asOf,
    rows,
    groups,
    counts: Object.fromEntries(
      Object.entries(groups).map(([k, v]) => [k, v.length]),
    ) as Record<PromotionStatus, number>,
  });
});

promotions.get('/rules', requireStaff, async (c) => {
  const rules = await loadRules(c.env);
  return c.json({ rules: BELTS.map((b) => rules[b]).filter(Boolean) });
});

promotions.put('/rules/:belt', requireAdmin, async (c) => {
  const belt = c.req.param('belt') as Belt;
  if (!BELTS.includes(belt)) throw new HTTPException(400, { message: 'bad_belt' });

  const b = await readJson<{
    monthsPerStripe?: number;
    classesPerStripe?: number;
    maxStripes?: number;
    monthsToNextBelt?: number;
    classesToNextBelt?: number;
    minAge?: number | null;
  }>(c.req);

  const nonNegInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  const fields: [string, unknown][] = [
    ['months_per_stripe', b.monthsPerStripe],
    ['classes_per_stripe', b.classesPerStripe],
    ['max_stripes', b.maxStripes],
    ['months_to_next_belt', b.monthsToNextBelt],
    ['classes_to_next_belt', b.classesToNextBelt],
  ];

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [col, value] of fields) {
    if (value === undefined) continue;
    if (!nonNegInt(value)) throw new HTTPException(400, { message: `bad_${col}` });
    sets.push(`${col} = ?`);
    binds.push(value);
  }
  if (b.minAge !== undefined) {
    if (b.minAge !== null && !nonNegInt(b.minAge)) throw new HTTPException(400, { message: 'bad_min_age' });
    sets.push('min_age = ?');
    binds.push(b.minAge);
  }
  if (!sets.length) throw new HTTPException(400, { message: 'nothing_to_update' });

  binds.push(belt);
  await c.env.DB.prepare(`UPDATE promotion_rules SET ${sets.join(', ')} WHERE belt = ?`)
    .bind(...binds)
    .run();

  await audit(c, 'promotion_rule.update', 'promotion_rule', null, { belt, ...b });
  const rules = await loadRules(c.env);
  return c.json({ rule: rules[belt] });
});

promotions.get('/member/:id', async (c) => {
  const id = Number(c.req.param('id'));
  assertCanReadMember(c.get('user'), id);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM promotions WHERE member_id = ? ORDER BY promoted_on DESC, id DESC`,
  )
    .bind(id)
    .all();
  return c.json({ promotions: results ?? [] });
});

/**
 * Awards a promotion.
 *
 * Writing history is the point: the row is appended, the member's cached belt
 * and stripes are updated to match, and `classes_at_last_promotion` is reset to
 * their current class total so the next cycle's attendance gate starts from
 * zero rather than counting classes they already got credit for.
 *
 * Defaults to whatever the rules say comes next, so the usual case is a single
 * tap with no body at all.
 */
promotions.post('/member/:id', requireStaff, async (c) => {
  const id = Number(c.req.param('id'));
  const member = await getMember(c.env, id);
  if (!member) throw new HTTPException(404, { message: 'member_not_found' });

  const b = await readJson<{
    toBelt?: Belt;
    toStripes?: number;
    promotedOn?: string;
    awardedBy?: string;
    note?: string;
    /** Award even when the attendance or time gate is not met. */
    override?: boolean;
  }>(c.req);

  const rules = await loadRules(c.env);
  const rule = rules[member.belt];
  if (!rule) throw new HTTPException(500, { message: 'no_rule_for_belt' });

  const suggested = nextAward(member.belt, member.stripes, rule);
  const toBelt = b.toBelt ?? suggested.belt;
  const toStripes = b.toStripes ?? suggested.stripes;

  if (!BELTS.includes(toBelt)) throw new HTTPException(400, { message: 'bad_belt' });
  if (!Number.isInteger(toStripes) || toStripes < 0 || toStripes > 4) {
    throw new HTTPException(400, { message: 'bad_stripes' });
  }
  if (toBelt === member.belt && toStripes === member.stripes) {
    throw new HTTPException(400, { message: 'no_change' });
  }

  const promotedOn = b.promotedOn && isIsoDate(b.promotedOn) ? b.promotedOn : c.get('today');

  // Only guard the suggested next step; an explicit different grade is taken as
  // a deliberate decision by the coach.
  const isSuggested = toBelt === suggested.belt && toStripes === suggested.stripes;
  if (isSuggested && !b.override) {
    const eligibility = evaluateEligibility(
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
      promotedOn,
    );
    if (eligibility.status === 'blocked_attendance' || eligibility.status === 'not_due' || eligibility.status === 'upcoming') {
      throw new HTTPException(409, {
        message: `not_eligible:${eligibility.status}`,
        // The UI turns this into "short 12 classes — award anyway?".
        cause: eligibility,
      });
    }
  }

  const kind = toBelt !== member.belt ? 'belt' : 'stripe';

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO promotions (member_id, from_belt, from_stripes, to_belt, to_stripes, kind,
                               promoted_on, classes_at_promotion, awarded_by, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      member.belt,
      member.stripes,
      toBelt,
      toStripes,
      kind,
      promotedOn,
      member.totalClasses,
      b.awardedBy?.trim() || null,
      b.note?.trim() || null,
      c.get('user').userId,
    ),
    c.env.DB.prepare(
      `UPDATE members
          SET belt = ?, stripes = ?, last_promotion_date = ?,
              classes_at_last_promotion = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(toBelt, toStripes, promotedOn, member.totalClasses, new Date().toISOString(), id),
  ]);

  await audit(c, 'promotion.award', 'member', id, {
    from: `${member.belt}/${member.stripes}`,
    to: `${toBelt}/${toStripes}`,
    promotedOn,
    override: !!b.override,
  });

  return c.json({ member: await getMember(c.env, id) }, 201);
});

/** Undo: removes the latest promotion and restores the grade it replaced. */
promotions.delete('/member/:id/latest', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));

  const latest = await c.env.DB.prepare(
    `SELECT * FROM promotions
      WHERE member_id = ? AND kind IN ('stripe','belt','correction')
      ORDER BY promoted_on DESC, id DESC LIMIT 1`,
  )
    .bind(id)
    .first<{
      id: number;
      from_belt: Belt | null;
      from_stripes: number | null;
      classes_at_promotion: number | null;
    }>();

  if (!latest) throw new HTTPException(404, { message: 'no_promotion_to_undo' });
  if (!latest.from_belt) throw new HTTPException(400, { message: 'cannot_undo_initial' });

  // Restore the grade and the class baseline from the step before this one.
  const previous = await c.env.DB.prepare(
    `SELECT promoted_on, classes_at_promotion FROM promotions
      WHERE member_id = ? AND id < ? ORDER BY id DESC LIMIT 1`,
  )
    .bind(id, latest.id)
    .first<{ promoted_on: string; classes_at_promotion: number | null }>();

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM promotions WHERE id = ?`).bind(latest.id),
    c.env.DB.prepare(
      `UPDATE members SET belt = ?, stripes = ?, last_promotion_date = ?,
                          classes_at_last_promotion = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      latest.from_belt,
      latest.from_stripes ?? 0,
      previous?.promoted_on ?? null,
      previous?.classes_at_promotion ?? 0,
      new Date().toISOString(),
      id,
    ),
  ]);

  await audit(c, 'promotion.undo', 'member', id, { promotionId: latest.id });
  return c.json({ member: await getMember(c.env, id) });
});

export default promotions;

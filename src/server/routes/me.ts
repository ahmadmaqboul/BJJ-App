import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { pickCoverage } from '@shared/billing';
import { evaluateEligibility } from '@shared/promotion';
import type { AppBindings } from '../env';
import { balancesFor, entitlementsFor, getMember, loadRules, loadSettings } from '../queries';

const me = new Hono<AppBindings>();

/**
 * Everything a player sees about themselves on one screen: how close they are
 * to the next stripe and why, whether they owe anything, and what the team
 * worked on recently.
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

  const [balances, entitlements, attendance, monthly, beltHistory, recentClasses] =
    await Promise.all([
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
      // "What we worked on" — visible to players, which is the phase-5 feature
      // the schema already carries.
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
    ]);

  const coverage = pickCoverage(entitlements, asOf);

  return c.json({
    member,
    role: user.role,
    eligibility,
    rule: rule ?? null,
    balance: balances.get(member.id) ?? { chargedMinor: 0, paidMinor: 0, outstandingMinor: 0 },
    currentCoverage: coverage,
    activeEntitlements: entitlements,
    attendance: attendance.results ?? [],
    monthly: monthly.results ?? [],
    beltHistory: beltHistory.results ?? [],
    recentClasses: recentClasses.results ?? [],
  });
});

export default me;

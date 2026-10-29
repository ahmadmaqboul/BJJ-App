import { addMonths, ageOn, daysBetween, monthsBetween, type IsoDate } from './dates';
import type { Belt, MemberStatus, PromotionRule } from './types';

/**
 * Promotion eligibility.
 *
 * The spreadsheet this replaces checked elapsed time only, which let someone
 * sit at "eligible" for 18 months on 2 total classes. Eligibility here needs
 * BOTH gates: enough time in grade AND enough classes attended since the last
 * promotion. When only one gate passes the result says which, and by how much,
 * so the coach sees "short 31 classes" rather than a bare yes/no.
 */

export type PromotionStatus =
  /** Both gates passed — award it. */
  | 'due'
  /** Both gates passed well past the eligible date; it has been missed. */
  | 'overdue'
  /** Time gate not met yet, but the date is within the look-ahead window. */
  | 'upcoming'
  /** Time served, attendance short. The gate the old sheet never checked. */
  | 'blocked_attendance'
  /** Too young for this belt under the rules. */
  | 'blocked_age'
  /** Not active on the mat, so not a promotion candidate. */
  | 'inactive'
  /** Nothing further to award under the configured rules. */
  | 'capped'
  /** Neither gate met, and not close enough to flag. */
  | 'not_due';

export interface EligibilityInput {
  belt: Belt;
  stripes: number;
  lastPromotionDate: IsoDate | null;
  joinDate: IsoDate;
  /** legacyAttendance + sessions recorded in the app. */
  totalClasses: number;
  classesAtLastPromotion: number;
  birthDate?: IsoDate | null;
  status: MemberStatus;
}

export interface Eligibility {
  /** What the next award would be. */
  target: 'stripe' | 'belt' | 'none';
  targetBelt: Belt;
  targetStripes: number;

  monthsRequired: number;
  monthsElapsed: number;
  /** Date the time gate opens (or opened). */
  eligibleOn: IsoDate | null;
  /** Negative once the date has passed. */
  daysUntilEligible: number | null;

  classesRequired: number;
  classesSince: number;
  /** 0 when the attendance gate is satisfied. */
  classesShort: number;

  timeGateMet: boolean;
  classGateMet: boolean;
  status: PromotionStatus;
  /** 0–1, the lower of the two gates: what the progress bar shows. */
  progress: number;
}

export const DEFAULT_LOOKAHEAD_DAYS = 60;
/** Days past the eligible date before a due promotion is called overdue. */
const OVERDUE_AFTER_DAYS = 60;

export function nextAward(
  belt: Belt,
  stripes: number,
  rule: PromotionRule,
): { target: 'stripe' | 'belt' | 'none'; belt: Belt; stripes: number } {
  if (stripes < rule.maxStripes) {
    return { target: 'stripe', belt, stripes: stripes + 1 };
  }
  if (rule.nextBelt) {
    return { target: 'belt', belt: rule.nextBelt, stripes: 0 };
  }
  return { target: 'none', belt, stripes };
}

export function evaluateEligibility(
  input: EligibilityInput,
  rule: PromotionRule,
  asOf: IsoDate,
  lookaheadDays: number = DEFAULT_LOOKAHEAD_DAYS,
): Eligibility {
  const award = nextAward(input.belt, input.stripes, rule);
  const isStripe = award.target === 'stripe';

  const monthsRequired = isStripe ? rule.monthsPerStripe : rule.monthsToNextBelt;
  const classesRequired = isStripe ? rule.classesPerStripe : rule.classesToNextBelt;

  // Members imported without a promotion date fall back to their join date, so
  // the clock still runs rather than reading as "never eligible".
  const since = input.lastPromotionDate ?? input.joinDate;

  const monthsElapsed = monthsBetween(since, asOf);
  const eligibleOn = addMonths(since, monthsRequired);
  const daysUntilEligible = daysBetween(asOf, eligibleOn);

  const classesSince = Math.max(0, input.totalClasses - input.classesAtLastPromotion);
  const classesShort = Math.max(0, classesRequired - classesSince);

  const timeGateMet = daysUntilEligible <= 0;
  const classGateMet = classesShort === 0;

  const timeProgress = monthsRequired > 0 ? Math.min(1, monthsElapsed / monthsRequired) : 1;
  const classProgress = classesRequired > 0 ? Math.min(1, classesSince / classesRequired) : 1;
  const progress = Math.min(timeProgress, classProgress);

  const base = {
    target: award.target,
    targetBelt: award.belt,
    targetStripes: award.stripes,
    monthsRequired,
    monthsElapsed,
    eligibleOn,
    daysUntilEligible,
    classesRequired,
    classesSince,
    classesShort,
    timeGateMet,
    classGateMet,
    progress,
  };

  const tooYoung =
    rule.minAge != null && input.birthDate != null && ageOn(input.birthDate, asOf) < rule.minAge;

  let status: PromotionStatus;
  if (award.target === 'none') {
    status = 'capped';
  } else if (input.status !== 'active') {
    status = 'inactive';
  } else if (tooYoung) {
    status = 'blocked_age';
  } else if (timeGateMet && classGateMet) {
    status = -daysUntilEligible > OVERDUE_AFTER_DAYS ? 'overdue' : 'due';
  } else if (timeGateMet && !classGateMet) {
    status = 'blocked_attendance';
  } else if (daysUntilEligible <= lookaheadDays) {
    status = 'upcoming';
  } else {
    status = 'not_due';
  }

  return { ...base, status };
}

/** Board ordering: what the coach needs to act on first. */
const STATUS_RANK: Record<PromotionStatus, number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  blocked_attendance: 3,
  blocked_age: 4,
  not_due: 5,
  inactive: 6,
  capped: 7,
};

export function compareByUrgency(
  a: { status: PromotionStatus; daysUntilEligible: number | null },
  b: { status: PromotionStatus; daysUntilEligible: number | null },
): number {
  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus !== 0) return byStatus;
  return (a.daysUntilEligible ?? 0) - (b.daysUntilEligible ?? 0);
}

export const ACTIONABLE_STATUSES: PromotionStatus[] = ['overdue', 'due'];

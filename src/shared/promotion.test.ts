import { describe, expect, it } from 'vitest';
import { evaluateEligibility, nextAward, type PromotionStatus } from './promotion';
import type { PromotionRule } from './types';

const whiteRule: PromotionRule = {
  belt: 'white',
  monthsPerStripe: 6,
  classesPerStripe: 40,
  maxStripes: 4,
  monthsToNextBelt: 6,
  classesToNextBelt: 40,
  minAge: null,
  nextBelt: 'blue',
};

const blackRule: PromotionRule = {
  belt: 'black',
  monthsPerStripe: 12,
  classesPerStripe: 60,
  maxStripes: 4,
  monthsToNextBelt: 0,
  classesToNextBelt: 0,
  minAge: 19,
  nextBelt: null,
};

function member(over: Partial<Parameters<typeof evaluateEligibility>[0]> = {}) {
  return {
    belt: 'white' as const,
    stripes: 0,
    lastPromotionDate: '2026-01-01',
    joinDate: '2026-01-01',
    totalClasses: 0,
    classesAtLastPromotion: 0,
    status: 'active' as const,
    ...over,
  };
}

describe('nextAward', () => {
  it('awards the next stripe below the cap', () => {
    expect(nextAward('white', 2, whiteRule)).toEqual({ target: 'stripe', belt: 'white', stripes: 3 });
  });

  it('moves to the next belt at the stripe cap and resets stripes', () => {
    expect(nextAward('white', 4, whiteRule)).toEqual({ target: 'belt', belt: 'blue', stripes: 0 });
  });

  it('has nothing to award when there is no next belt', () => {
    expect(nextAward('black', 4, blackRule)).toEqual({ target: 'none', belt: 'black', stripes: 4 });
  });
});

describe('evaluateEligibility — the two gates', () => {
  it('is due only when time AND classes are both satisfied', () => {
    const e = evaluateEligibility(
      member({ totalClasses: 45, classesAtLastPromotion: 0 }),
      whiteRule,
      '2026-07-01',
    );
    expect(e.timeGateMet).toBe(true);
    expect(e.classGateMet).toBe(true);
    expect(e.status).toBe<PromotionStatus>('due');
    expect(e.targetStripes).toBe(1);
  });

  /**
   * This is the case the old spreadsheet got wrong: a purple belt promoted in
   * September 2024 with 2 total classes showed as eligible from March 2025
   * onward, purely because the date had passed.
   */
  it('blocks on attendance when time has passed but classes have not been done', () => {
    const e = evaluateEligibility(
      member({ belt: 'purple', lastPromotionDate: '2024-09-01', totalClasses: 2 }),
      { ...whiteRule, belt: 'purple', classesPerStripe: 50, nextBelt: 'brown' },
      '2026-10-29',
    );
    expect(e.timeGateMet).toBe(true);
    expect(e.classGateMet).toBe(false);
    expect(e.classesShort).toBe(48);
    expect(e.status).toBe<PromotionStatus>('blocked_attendance');
  });

  it('counts only classes done since the last promotion', () => {
    // 126 total but 118 of them earned the stripe they already have.
    const e = evaluateEligibility(
      member({ totalClasses: 126, classesAtLastPromotion: 118, lastPromotionDate: '2026-10-04' }),
      whiteRule,
      '2026-10-29',
    );
    expect(e.classesSince).toBe(8);
    expect(e.classesShort).toBe(32);
  });

  it('reports the exact date the time gate opens', () => {
    const e = evaluateEligibility(member({ lastPromotionDate: '2026-04-07' }), whiteRule, '2026-10-29');
    expect(e.eligibleOn).toBe('2026-10-07');
    expect(e.daysUntilEligible).toBe(-22);
  });

  it('flags upcoming inside the look-ahead window and not_due outside it', () => {
    const promoted = { lastPromotionDate: '2026-06-01', totalClasses: 50 };
    // Six months from 2026-06-01 is 2026-12-01.

    // 16 days short of the date, inside the 60-day window.
    const upcoming = evaluateEligibility(member(promoted), whiteRule, '2026-11-15', 60);
    expect(upcoming.daysUntilEligible).toBe(16);
    expect(upcoming.status).toBe<PromotionStatus>('upcoming');

    // Five months out, well beyond the window.
    const far = evaluateEligibility(member(promoted), whiteRule, '2026-07-01', 60);
    expect(far.status).toBe<PromotionStatus>('not_due');

    // Nine days past the date: due, not yet overdue.
    const due = evaluateEligibility(member(promoted), whiteRule, '2026-12-10', 60);
    expect(due.status).toBe<PromotionStatus>('due');
  });

  it('calls a long-passed eligible date overdue rather than merely due', () => {
    const e = evaluateEligibility(
      member({ lastPromotionDate: '2025-01-01', totalClasses: 100 }),
      whiteRule,
      '2026-10-29',
    );
    expect(e.status).toBe<PromotionStatus>('overdue');
  });

  it('never proposes a promotion for an inactive member', () => {
    const e = evaluateEligibility(
      member({ totalClasses: 500, lastPromotionDate: '2024-01-01', status: 'inactive' }),
      whiteRule,
      '2026-10-29',
    );
    expect(e.status).toBe<PromotionStatus>('inactive');
  });

  it('respects a minimum age for the belt', () => {
    const e = evaluateEligibility(
      member({
        belt: 'blue',
        stripes: 4,
        birthDate: '2014-05-01',
        totalClasses: 100,
        lastPromotionDate: '2025-01-01',
      }),
      { ...whiteRule, belt: 'blue', minAge: 16, nextBelt: 'purple' },
      '2026-10-29',
    );
    expect(e.status).toBe<PromotionStatus>('blocked_age');
  });

  it('is capped at the top of the configured ladder', () => {
    const e = evaluateEligibility(
      member({ belt: 'black', stripes: 4, totalClasses: 9999, lastPromotionDate: '2000-01-01' }),
      blackRule,
      '2026-10-29',
    );
    expect(e.status).toBe<PromotionStatus>('capped');
    expect(e.target).toBe('none');
  });

  it('falls back to the join date when no promotion was ever recorded', () => {
    const noPromotion = { lastPromotionDate: null, joinDate: '2026-01-15', totalClasses: 60 };

    const due = evaluateEligibility(member(noPromotion), whiteRule, '2026-08-01');
    expect(due.eligibleOn).toBe('2026-07-15');
    expect(due.status).toBe<PromotionStatus>('due');

    // Still measured from the join date months later, so it ages into overdue.
    const stale = evaluateEligibility(member(noPromotion), whiteRule, '2026-10-29');
    expect(stale.eligibleOn).toBe('2026-07-15');
    expect(stale.status).toBe<PromotionStatus>('overdue');
  });

  it('reports progress as the weaker of the two gates', () => {
    // Time fully served, attendance only a quarter done.
    const e = evaluateEligibility(
      member({ lastPromotionDate: '2026-01-01', totalClasses: 10 }),
      whiteRule,
      '2026-07-01',
    );
    expect(e.progress).toBeCloseTo(10 / 40);
  });
});

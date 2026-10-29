import { describe, expect, it } from 'vitest';
import { formatMinor, parseMoney, pickCoverage, settleStatus, type Entitlement } from './billing';

function ent(over: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 1,
    planType: 'package',
    sessionsTotal: 8,
    sessionsUsed: 0,
    validFrom: '2026-10-01',
    validUntil: '2026-12-31',
    status: 'active',
    ...over,
  };
}

describe('pickCoverage', () => {
  it('returns uncovered when the member has nothing', () => {
    expect(pickCoverage([], '2026-10-29').coverage).toBe('uncovered');
  });

  it('prefers an unlimited monthly and consumes nothing', () => {
    const decision = pickCoverage(
      [ent({ id: 2 }), ent({ id: 1, planType: 'monthly', sessionsTotal: null })],
      '2026-10-29',
    );
    expect(decision.coverage).toBe('monthly');
    expect(decision.purchaseId).toBe(1);
    expect(decision.consumes).toBe(false);
  });

  it('burns the entitlement that expires soonest', () => {
    const decision = pickCoverage(
      [
        ent({ id: 1, validUntil: '2026-12-31' }),
        ent({ id: 2, validUntil: '2026-11-05' }),
        ent({ id: 3, validUntil: null }),
      ],
      '2026-10-29',
    );
    expect(decision.purchaseId).toBe(2);
    expect(decision.consumes).toBe(true);
  });

  it('reports the sessions left after the check-in', () => {
    const decision = pickCoverage([ent({ sessionsTotal: 8, sessionsUsed: 5 })], '2026-10-29');
    expect(decision.remainingAfter).toBe(2);
  });

  it('skips an exhausted package', () => {
    expect(pickCoverage([ent({ sessionsTotal: 4, sessionsUsed: 4 })], '2026-10-29').coverage).toBe(
      'uncovered',
    );
  });

  it('skips entitlements outside their validity window', () => {
    const expired = ent({ validFrom: '2026-01-01', validUntil: '2026-01-31' });
    const future = ent({ id: 2, validFrom: '2027-01-01', validUntil: '2027-02-01' });
    expect(pickCoverage([expired, future], '2026-10-29').coverage).toBe('uncovered');
  });

  it('labels a single-session purchase as single, not package', () => {
    const decision = pickCoverage(
      [ent({ planType: 'single', sessionsTotal: 1, validUntil: '2026-10-30' })],
      '2026-10-29',
    );
    expect(decision.coverage).toBe('single');
  });

  /**
   * An opening balance carried over from the spreadsheet is money owed, not
   * mat time, so it must never pay for a class.
   */
  it('never lets an opening balance cover a class', () => {
    const decision = pickCoverage(
      [ent({ planType: 'opening_balance', sessionsTotal: 0, sessionsUsed: 0 })],
      '2026-10-29',
    );
    expect(decision.coverage).toBe('uncovered');
  });

  it('ignores cancelled entitlements', () => {
    expect(pickCoverage([ent({ status: 'cancelled' })], '2026-10-29').coverage).toBe('uncovered');
  });

  /**
   * The walk-in case: a monthly that lapsed yesterday plus one session bought
   * today should resolve to the single session, not to the dead monthly.
   */
  it('covers the lapsed-monthly walk-in from a freshly bought single', () => {
    const lapsedMonthly = ent({
      id: 1,
      planType: 'monthly',
      sessionsTotal: null,
      validFrom: '2026-09-28',
      validUntil: '2026-10-28',
    });
    const walkIn = ent({
      id: 2,
      planType: 'single',
      sessionsTotal: 1,
      validFrom: '2026-10-29',
      validUntil: '2026-11-04',
    });
    const decision = pickCoverage([lapsedMonthly, walkIn], '2026-10-29');
    expect(decision.coverage).toBe('single');
    expect(decision.purchaseId).toBe(2);
    expect(decision.remainingAfter).toBe(0);
  });
});

describe('settleStatus', () => {
  it('exhausts a fully used package', () => {
    expect(settleStatus(ent({ sessionsTotal: 8, sessionsUsed: 8 }), '2026-10-29')).toBe('exhausted');
  });

  it('expires a subscription past its window', () => {
    expect(settleStatus(ent({ validUntil: '2026-10-01' }), '2026-10-29')).toBe('expired');
  });

  it('leaves a live entitlement active', () => {
    expect(settleStatus(ent({ sessionsUsed: 3 }), '2026-10-29')).toBe('active');
  });

  it('keeps a cancelled entitlement cancelled', () => {
    expect(settleStatus(ent({ status: 'cancelled' }), '2026-10-29')).toBe('cancelled');
  });
});

describe('money formatting', () => {
  it('drops decimals on whole amounts', () => {
    expect(formatMinor(15000)).toBe('150');
    expect(formatMinor(6000)).toBe('60');
  });

  it('keeps two decimals on part amounts', () => {
    expect(formatMinor(15050)).toBe('150.50');
    expect(formatMinor(5)).toBe('0.05');
  });

  it('handles negatives, which is what credit looks like', () => {
    expect(formatMinor(-2500)).toBe('-25');
  });

  it('round-trips through parseMoney', () => {
    expect(parseMoney('150')).toBe(15000);
    expect(parseMoney('150.50')).toBe(15050);
    expect(parseMoney(' 60 ₪ ')).toBe(6000);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
  });
});

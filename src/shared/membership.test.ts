import { describe, expect, it } from 'vitest';
import type { Entitlement } from './billing';
import { subscriptionStatusOf } from './membership';

function ent(over: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 1,
    planType: 'monthly',
    sessionsTotal: null,
    sessionsUsed: 0,
    validFrom: '2026-10-01',
    validUntil: '2026-11-27',
    status: 'active',
    ...over,
  };
}

const clear = { everPurchased: true, outstandingMinor: 0 };

describe('subscriptionStatusOf', () => {
  it('is "never" for a member who has bought nothing', () => {
    const s = subscriptionStatusOf([], { everPurchased: false, outstandingMinor: 0 }, '2026-10-29');
    expect(s.state).toBe('never');
  });

  it('is "expired" once a member who used to pay has nothing live', () => {
    const s = subscriptionStatusOf([], clear, '2026-10-29');
    expect(s.state).toBe('expired');
  });

  it('is "subscribed" with comfortable time left', () => {
    const s = subscriptionStatusOf([ent({ validUntil: '2026-11-27' })], clear, '2026-10-29');
    expect(s.state).toBe('subscribed');
  });

  it('is "ending_soon" in the last week of a subscription', () => {
    const s = subscriptionStatusOf([ent({ validUntil: '2026-11-03' })], clear, '2026-10-29');
    expect(s.state).toBe('ending_soon');
  });

  it('is "ending_soon" when a session card is nearly used up', () => {
    const s = subscriptionStatusOf(
      [ent({ planType: 'package', sessionsTotal: 8, sessionsUsed: 6, validUntil: '2026-12-31' })],
      clear,
      '2026-10-29',
    );
    expect(s.state).toBe('ending_soon');
    expect(s.outlook).toEqual({ kind: 'sessions_left', left: 2 });
  });

  it('is "subscribed" when a session card still has room', () => {
    const s = subscriptionStatusOf(
      [ent({ planType: 'package', sessionsTotal: 8, sessionsUsed: 1, validUntil: '2026-12-31' })],
      clear,
      '2026-10-29',
    );
    expect(s.state).toBe('subscribed');
  });

  /**
   * A coach trains and is promoted like anyone else but is never billed, so
   * "expired" or "never subscribed" would be noise on their row.
   */
  it('is "exempt" for a coach, whatever their ledger says', () => {
    const noPlan = subscriptionStatusOf(
      [],
      { everPurchased: false, outstandingMinor: 0, feeExempt: true },
      '2026-10-29',
    );
    expect(noPlan.state).toBe('exempt');

    const lapsed = subscriptionStatusOf(
      [ent({ validUntil: '2026-01-31' })],
      { everPurchased: true, outstandingMinor: 0, feeExempt: true },
      '2026-10-29',
    );
    expect(lapsed.state).toBe('exempt');
  });

  it('still reports a real balance a coach happens to carry', () => {
    const owing = subscriptionStatusOf(
      [],
      { everPurchased: true, outstandingMinor: 4000, feeExempt: true },
      '2026-10-29',
    );
    expect(owing.state).toBe('exempt');
    expect(owing.owesMinor).toBe(4000);
  });

  /**
   * The two statuses are independent on purpose: these are the cases that a
   * single combined field would hide.
   */
  it('reports money owed independently of coverage', () => {
    const owing = subscriptionStatusOf(
      [ent()],
      { everPurchased: true, outstandingMinor: 6000 },
      '2026-10-29',
    );
    expect(owing.state).toBe('subscribed');
    expect(owing.owesMinor).toBe(6000);
  });

  it('can be fully covered while owing nothing, and lapsed while owing money', () => {
    const lapsedAndOwing = subscriptionStatusOf(
      [],
      { everPurchased: true, outstandingMinor: 6000 },
      '2026-10-29',
    );
    expect(lapsedAndOwing.state).toBe('expired');
    expect(lapsedAndOwing.owesMinor).toBe(6000);
  });
});

import { type IsoDate } from './dates';
import type { Coverage, PurchaseStatus, PurchaseType } from './types';

/**
 * Billing works as an entitlement ledger rather than a monthly bill, because
 * the team runs all three payment models at once and members mix them: a
 * monthly subscription can lapse mid-trip and the member pays for one or two
 * single sessions to cover the gap.
 *
 * Every purchase is an entitlement. Checking a member in resolves which
 * entitlement pays for that class, and a package or single session is consumed
 * at that moment. Nothing matching means the check-in is recorded as
 * `uncovered` — the attendance is never blocked, it just shows up as owed.
 */

export interface Entitlement {
  id: number;
  planType: PurchaseType;
  /** null = unlimited (a monthly subscription). */
  sessionsTotal: number | null;
  sessionsUsed: number;
  validFrom: IsoDate;
  /** null = never expires. */
  validUntil: IsoDate | null;
  status: PurchaseStatus;
}

export interface CoverageDecision {
  coverage: Coverage;
  purchaseId: number | null;
  /** True when awarding this coverage burns a session off a finite entitlement. */
  consumes: boolean;
  /** Sessions left after this check-in; null for unlimited or uncovered. */
  remainingAfter: number | null;
}

export const UNCOVERED: CoverageDecision = {
  coverage: 'uncovered',
  purchaseId: null,
  consumes: false,
  remainingAfter: null,
};

function isLive(e: Entitlement, on: IsoDate): boolean {
  if (e.status !== 'active') return false;
  if (e.planType === 'opening_balance') return false; // money owed, not mat time
  if (e.validFrom > on) return false;
  if (e.validUntil != null && e.validUntil < on) return false;
  return true;
}

function hasSessionsLeft(e: Entitlement): boolean {
  return e.sessionsTotal == null || e.sessionsUsed < e.sessionsTotal;
}

/**
 * Picks which entitlement pays for a class on `on`.
 *
 * Preference order:
 *   1. An unlimited (monthly) subscription — it costs nothing extra to use and
 *      would otherwise go to waste.
 *   2. The finite entitlement expiring soonest, so use-it-or-lose-it sessions
 *      are burned before ones with time left. Ties break toward the older
 *      purchase.
 */
export function pickCoverage(entitlements: Entitlement[], on: IsoDate): CoverageDecision {
  const live = entitlements.filter((e) => isLive(e, on) && hasSessionsLeft(e));

  const unlimited = live.find((e) => e.sessionsTotal == null);
  if (unlimited) {
    return {
      coverage: 'monthly',
      purchaseId: unlimited.id,
      consumes: false,
      remainingAfter: null,
    };
  }

  const finite = live
    .filter((e) => e.sessionsTotal != null)
    .sort((a, b) => {
      // Never-expiring entitlements sort last so dated ones get used first.
      const aEnd = a.validUntil ?? '9999-12-31';
      const bEnd = b.validUntil ?? '9999-12-31';
      if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;
      return a.id - b.id;
    });

  const pick = finite[0];
  if (!pick) return UNCOVERED;

  return {
    coverage: pick.planType === 'single' ? 'single' : 'package',
    purchaseId: pick.id,
    consumes: true,
    remainingAfter: Math.max(0, (pick.sessionsTotal ?? 0) - pick.sessionsUsed - 1),
  };
}

/** Status a purchase should hold after `sessionsUsed` changes. */
export function settleStatus(e: Entitlement, on: IsoDate): PurchaseStatus {
  if (e.status === 'cancelled') return 'cancelled';
  if (e.sessionsTotal != null && e.sessionsUsed >= e.sessionsTotal) return 'exhausted';
  if (e.validUntil != null && e.validUntil < on) return 'expired';
  return 'active';
}

export interface MemberBalance {
  /** Everything ever charged. */
  chargedMinor: number;
  /** Everything ever paid. */
  paidMinor: number;
  /** Positive = the member owes the club. */
  outstandingMinor: number;
}

export function balanceOf(chargedMinor: number, paidMinor: number): MemberBalance {
  return {
    chargedMinor,
    paidMinor,
    outstandingMinor: chargedMinor - paidMinor,
  };
}

// ----------------------------------------------------------------- display ---

/** Minor units (agorot) → '150.00'. Whole amounts drop the decimals. */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return cents === 0
    ? `${sign}${whole}`
    : `${sign}${whole}.${String(cents).padStart(2, '0')}`;
}

export const CURRENCY_SYMBOL: Record<string, string> = { ILS: '₪', JOD: 'د.أ', USD: '$' };

export function formatMoney(minor: number, currency = 'ILS'): string {
  return `${formatMinor(minor)} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

/** Parses '150' or '150.50' into minor units. Returns null if unparseable. */
export function parseMoney(input: string): number | null {
  const trimmed = input.trim().replace(/[₪,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

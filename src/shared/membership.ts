import { coverageOutlook, type CoverageOutlook, type Entitlement } from './billing';
import type { IsoDate } from './dates';

/**
 * A member carries two independent statuses, because they answer two different
 * questions and routinely disagree:
 *
 *   - **Membership** — are they on the mat at all? Stored on the member.
 *   - **Subscription** — is anything paying for their training right now?
 *     Derived from the purchases ledger at read time.
 *
 * Someone can be active with a lapsed subscription (trains, owes money), or
 * inactive with one still running (paid for the month, then travelled). Folding
 * the two into one field would lose exactly the cases worth seeing.
 */

export type MembershipStatus = 'active' | 'inactive' | 'paused';

/** Why a member is not currently active. */
export type StatusReason = 'travel' | 'injury' | 'stopped' | 'study' | 'cost' | 'other';

export const STATUS_REASONS: StatusReason[] = [
  'travel',
  'injury',
  'stopped',
  'study',
  'cost',
  'other',
];

export type SubscriptionState =
  /** Covered, with comfortable room left. */
  | 'subscribed'
  /** Covered, but about to run out — the nudge-them-now group. */
  | 'ending_soon'
  /** Had something once; nothing is live now. */
  | 'expired'
  /** Never bought anything. */
  | 'never';

export interface SubscriptionStatus {
  state: SubscriptionState;
  outlook: CoverageOutlook;
  /** Positive when the member owes the club. */
  owesMinor: number;
}

/** A subscription inside this many days of expiry counts as ending soon. */
export const ENDING_SOON_DAYS = 7;
/** A session card with this many classes left or fewer counts as ending soon. */
export const ENDING_SOON_SESSIONS = 2;

export function subscriptionStatusOf(
  entitlements: Entitlement[],
  opts: { everPurchased: boolean; outstandingMinor: number },
  asOf: IsoDate,
): SubscriptionStatus {
  const outlook = coverageOutlook(entitlements, asOf);
  const owesMinor = opts.outstandingMinor;

  let state: SubscriptionState;
  if (outlook.kind === 'covered_until') {
    state = outlook.daysLeft <= ENDING_SOON_DAYS ? 'ending_soon' : 'subscribed';
  } else if (outlook.kind === 'sessions_left') {
    state = outlook.left <= ENDING_SOON_SESSIONS ? 'ending_soon' : 'subscribed';
  } else {
    state = opts.everPurchased ? 'expired' : 'never';
  }

  return { state, outlook, owesMinor };
}

/** Members needing attention first when the admin opens the money screen. */
const SUBSCRIPTION_RANK: Record<SubscriptionState, number> = {
  expired: 0,
  ending_soon: 1,
  never: 2,
  subscribed: 3,
};

export function compareBySubscription(a: SubscriptionState, b: SubscriptionState): number {
  return SUBSCRIPTION_RANK[a] - SUBSCRIPTION_RANK[b];
}

/**
 * Whether this member should appear on the check-in roster and be considered
 * for promotion. Paused members are off the mat too — the difference from
 * inactive is intent, not effect.
 */
export function isOnTheMat(status: MembershipStatus): boolean {
  return status === 'active';
}

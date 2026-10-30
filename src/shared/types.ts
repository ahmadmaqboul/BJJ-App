import type { IsoDate } from './dates';
import type { MemberType, StatusReason } from './membership';

export type Belt = 'white' | 'blue' | 'purple' | 'brown' | 'black';
export const BELTS: Belt[] = ['white', 'blue', 'purple', 'brown', 'black'];

export type MemberStatus = 'active' | 'inactive' | 'paused';
export type Role = 'admin' | 'coach' | 'player';
export type ClassType = 'gi' | 'nogi' | 'open_mat' | 'kids' | 'seminar';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

/** Which entitlement paid for a check-in. */
export type Coverage = 'monthly' | 'package' | 'single' | 'free' | 'uncovered';

export type PlanType = 'monthly' | 'package' | 'single';
export type PurchaseType = PlanType | 'opening_balance';
export type PurchaseStatus = 'active' | 'expired' | 'exhausted' | 'cancelled';
export type PaymentMethod = 'cash' | 'bank' | 'wallet' | 'other';

export interface Member {
  id: number;
  nameAr: string;
  nameEn: string | null;
  phone: string | null;
  birthDate: IsoDate | null;
  joinDate: IsoDate;
  status: MemberStatus;
  /** Player or coach. A coach trains but is never billed. */
  memberType: MemberType;
  /** Why they are not active. Null while active. */
  statusReason: StatusReason | null;
  statusNote: string | null;
  statusChangedOn: IsoDate | null;
  belt: Belt;
  stripes: number;
  lastPromotionDate: IsoDate | null;
  /** Attendance carried over from the spreadsheet (no per-session detail). */
  legacyAttendance: number;
  classesAtLastPromotion: number;
  notes: string | null;
  /** legacyAttendance + sessions recorded in the app. */
  totalClasses: number;
  hasLogin: boolean;
  role: Role | null;
}

export interface Plan {
  id: number;
  nameAr: string;
  nameEn: string;
  type: PlanType;
  priceMinor: number;
  currency: string;
  sessionsIncluded: number | null;
  validityDays: number | null;
  active: boolean;
  sortOrder: number;
}

export interface Purchase {
  id: number;
  memberId: number;
  planId: number | null;
  planNameAr: string;
  planType: PurchaseType;
  amountMinor: number;
  currency: string;
  sessionsTotal: number | null;
  sessionsUsed: number;
  validFrom: IsoDate;
  validUntil: IsoDate | null;
  status: PurchaseStatus;
  note: string | null;
  createdAt: string;
  /** Sum of payments attached to this purchase. */
  paidMinor: number;
}

export interface Payment {
  id: number;
  memberId: number;
  purchaseId: number | null;
  amountMinor: number;
  currency: string;
  paidOn: IsoDate;
  method: PaymentMethod;
  note: string | null;
  createdAt: string;
}

export interface ClassSession {
  id: number;
  date: IsoDate;
  startTime: string | null;
  classType: ClassType;
  coachMemberId: number | null;
  techniqueTitle: string | null;
  techniqueNotes: string | null;
  status: 'open' | 'closed';
  presentCount: number;
  attendeeCount: number;
}

export interface AttendanceRecord {
  id: number;
  sessionId: number;
  memberId: number;
  status: AttendanceStatus;
  coverage: Coverage | null;
  purchaseId: number | null;
  recordedAt: string;
}

export interface Promotion {
  id: number;
  memberId: number;
  fromBelt: Belt | null;
  fromStripes: number | null;
  toBelt: Belt;
  toStripes: number;
  kind: 'stripe' | 'belt' | 'initial' | 'correction';
  promotedOn: IsoDate;
  classesAtPromotion: number | null;
  awardedBy: string | null;
  note: string | null;
}

export interface PromotionRule {
  belt: Belt;
  monthsPerStripe: number;
  classesPerStripe: number;
  maxStripes: number;
  monthsToNextBelt: number;
  classesToNextBelt: number;
  minAge: number | null;
  nextBelt: Belt | null;
}

export interface SessionUser {
  userId: number;
  memberId: number | null;
  login: string;
  role: Role;
  mustChangePin: boolean;
  nameAr: string | null;
}

export type ApiError = { error: string; code?: string; details?: unknown };

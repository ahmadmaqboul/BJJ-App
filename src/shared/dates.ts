// Date-only helpers. Every date in this app is a calendar day ('YYYY-MM-DD'),
// never an instant, so all arithmetic is done in UTC to keep it free of
// timezone drift. Gym-local "today" is resolved once, in today(), using the
// configured timezone.

export type IsoDate = string; // 'YYYY-MM-DD'

const DAY_MS = 86_400_000;

export function isIsoDate(v: unknown): v is IsoDate {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

/** Today as a calendar day in the gym's timezone (not the server's). */
export function today(timeZone = 'Asia/Hebron'): IsoDate {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function toUtc(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtc(new Date(toUtc(d).getTime() + n * DAY_MS));
}

/**
 * Adds calendar months, clamping to the end of the target month so that
 * 2026-01-31 + 1 month is 2026-02-28 rather than spilling into March.
 */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const base = toUtc(d);
  const targetMonth = base.getUTCMonth() + n;
  const result = new Date(Date.UTC(base.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return fromUtc(result);
}

/** Whole months elapsed; a partial month does not count. */
export function monthsBetween(from: IsoDate, to: IsoDate): number {
  const a = toUtc(from);
  const b = toUtc(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

export function ageOn(birthDate: IsoDate, on: IsoDate): number {
  return Math.floor(monthsBetween(birthDate, on) / 12);
}

/** First and last day of the month containing `d`. */
export function monthBounds(d: IsoDate): { start: IsoDate; end: IsoDate } {
  const base = toUtc(d);
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
  return { start: fromUtc(start), end: fromUtc(end) };
}

export function monthKey(d: IsoDate): string {
  return d.slice(0, 7); // 'YYYY-MM'
}

import { formatMoney } from '../../shared/billing';
import type { Lang } from '../i18n';

/**
 * Dates are rendered with Intl in the active language but always from the
 * stored 'YYYY-MM-DD' string parsed as UTC, so a day never shifts by one in a
 * timezone west of the gym.
 */
function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

const LOCALE: Record<Lang, string> = { ar: 'ar', en: 'en-GB' };

export function formatDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    // Western digits read more clearly beside Latin-script times and amounts.
    numberingSystem: 'latn',
  }).format(parse(iso));
}

export function formatDateShort(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    numberingSystem: 'latn',
  }).format(parse(iso));
}

export function weekdayOf(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(parse(iso));
}

/** 'HH:MM' → a locale-formatted time, without inventing a timezone. */
export function formatTime(hhmm: string | null | undefined, lang: Lang): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h ?? 0, m ?? 0));
  return new Intl.DateTimeFormat(LOCALE[lang], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    numberingSystem: 'latn',
  }).format(d);
}

export const money = (minor: number, currency = 'ILS') => formatMoney(minor, currency);

/** '2026-10' → 'Oct 2026'. */
export function formatMonth(period: string, lang: Lang): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat(LOCALE[lang], {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    numberingSystem: 'latn',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

import { describe, expect, it } from 'vitest';
import { addDays, addMonths, ageOn, daysBetween, monthBounds, monthsBetween } from './dates';

describe('addMonths', () => {
  it('adds whole months', () => {
    expect(addMonths('2026-10-04', 6)).toBe('2027-04-04');
    expect(addMonths('2025-11-01', 6)).toBe('2026-05-01');
  });

  it('clamps to the end of a shorter month instead of spilling over', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('crosses year boundaries', () => {
    expect(addMonths('2026-10-18', 6)).toBe('2027-04-18');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('monthsBetween', () => {
  it('counts only whole months', () => {
    expect(monthsBetween('2026-01-15', '2026-07-14')).toBe(5);
    expect(monthsBetween('2026-01-15', '2026-07-15')).toBe(6);
  });

  it('is zero for the same day', () => {
    expect(monthsBetween('2026-10-29', '2026-10-29')).toBe(0);
  });

  it('spans years', () => {
    expect(monthsBetween('2024-09-01', '2026-10-29')).toBe(25);
  });
});

describe('daysBetween and addDays', () => {
  it('counts days forwards and backwards', () => {
    expect(daysBetween('2026-10-01', '2026-10-29')).toBe(28);
    expect(daysBetween('2026-10-29', '2026-10-01')).toBe(-28);
  });

  it('is unaffected by daylight-saving shifts', () => {
    // Palestine shifts clocks in late October; date arithmetic must not drift.
    expect(daysBetween('2026-10-20', '2026-11-05')).toBe(16);
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31');
  });

  it('derives a validity window end from a day count', () => {
    // A 30-day monthly starting the 29th runs through the 27th of next month.
    expect(addDays('2026-10-29', 29)).toBe('2026-11-27');
  });
});

describe('monthBounds', () => {
  it('finds the first and last day of the month', () => {
    expect(monthBounds('2026-10-29')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(monthBounds('2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});

describe('ageOn', () => {
  it('counts completed years only', () => {
    expect(ageOn('2010-10-30', '2026-10-29')).toBe(15);
    expect(ageOn('2010-10-29', '2026-10-29')).toBe(16);
  });
});

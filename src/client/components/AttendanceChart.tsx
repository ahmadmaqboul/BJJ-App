import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { Button, Card, cx } from './ui';

export interface MonthlyPoint {
  /** 'YYYY-MM', or 'earlier' for the sheet's pre-2026 catch-all bucket. */
  period: string;
  classes: number;
}

/**
 * Monthly attendance, as columns.
 *
 * One series, so there is no legend — the heading says what is plotted. Only
 * the busiest month is labelled directly; the rest are carried by the y-axis
 * ticks, the hover tooltip and the table view, because a number on every
 * column just becomes noise.
 *
 * The imported pre-2026 total is deliberately NOT a column: it aggregates
 * years, and putting ~48 beside months of ~8 would flatten every real month
 * against a bucket that is not comparable. It is shown as a figure instead.
 */
export function AttendanceChart({
  data,
  className,
}: {
  data: MonthlyPoint[];
  /** Extra classes for the wrapper. */
  className?: string;
}) {
  const t = useT();
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const earlier = useMemo(
    () => data.find((d) => d.period === 'earlier')?.classes ?? 0,
    [data],
  );

  const months = useMemo(
    () =>
      data
        .filter((d) => d.period !== 'earlier')
        .sort((a, b) => a.period.localeCompare(b.period))
        .slice(-12),
    [data],
  );

  const max = useMemo(() => Math.max(1, ...months.map((m) => m.classes)), [months]);
  const peakIndex = useMemo(
    () => months.reduce((best, m, i) => (m.classes > (months[best]?.classes ?? 0) ? i : best), 0),
    [months],
  );

  if (!months.length && !earlier) {
    return <p className="px-1 py-6 text-center text-sm text-ink-muted">{t('chart.noData')}</p>;
  }

  // Geometry in viewBox units; the SVG scales to its container.
  const W = 320;
  const H = 128;
  const padTop = 16;
  const padBottom = 20;
  const padX = 4;
  const plotH = H - padTop - padBottom;
  const band = months.length ? (W - padX * 2) / months.length : W;
  // Capped so a wide container never produces slab-like bars, and the 2px
  // surface gap between neighbours is preserved by the band leftover.
  const barW = Math.min(24, Math.max(6, band - 6));

  const yOf = (v: number) => padTop + plotH * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);

  const monthLabel = (period: string) => period.slice(5).replace(/^0/, '');

  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-soft">{t('chart.monthlyAttendance')}</h3>
        {earlier > 0 && (
          <p className="text-xs text-ink-muted">
            {t('chart.earlier')}:{' '}
            <span className="tnum font-medium text-ink-soft">{earlier}</span>
          </p>
        )}
      </div>

      {/* The time axis runs left-to-right in both languages, as it does in
          every spreadsheet the team already uses. */}
      <div className="relative" style={{ direction: 'ltr' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 'auto' }}
          role="img"
          aria-label={t('chart.monthlyAttendance')}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={padX}
                x2={W - padX}
                y1={yOf(v)}
                y2={yOf(v)}
                stroke={v === 0 ? 'var(--axis)' : 'var(--grid)'}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={padX}
                y={yOf(v) - 3}
                className="tnum"
                fontSize="8"
                fill="var(--ink-muted)"
              >
                {v}
              </text>
            </g>
          ))}

          {months.map((m, i) => {
            const x = padX + band * i + (band - barW) / 2;
            const y = yOf(m.classes);
            const h = Math.max(m.classes > 0 ? 2 : 0, padTop + plotH - y);
            const active = hover === i;
            return (
              <g key={m.period}>
                {/* Hit target spans the whole band so a thin column is still
                    easy to hover or tap. */}
                <rect
                  x={padX + band * i}
                  y={padTop}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${monthLabel(m.period)}: ${m.classes}`}
                />
                {h > 0 && (
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    rx="2"
                    fill="var(--series-1)"
                    opacity={hover === null || active ? 1 : 0.55}
                    pointerEvents="none"
                  />
                )}
                <text
                  x={padX + band * i + band / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="tnum"
                  fontSize="8"
                  fill={active ? 'var(--ink-1)' : 'var(--ink-muted)'}
                  pointerEvents="none"
                >
                  {monthLabel(m.period)}
                </text>
                {/* One direct label: the busiest month. */}
                {i === peakIndex && m.classes > 0 && hover === null && (
                  <text
                    x={padX + band * i + band / 2}
                    y={y - 4}
                    textAnchor="middle"
                    className="tnum"
                    fontSize="9"
                    fontWeight="600"
                    fill="var(--ink-1)"
                    pointerEvents="none"
                  >
                    {m.classes}
                  </text>
                )}
                {active && (
                  <text
                    x={padX + band * i + band / 2}
                    y={y - 4}
                    textAnchor="middle"
                    className="tnum"
                    fontSize="9"
                    fontWeight="600"
                    fill="var(--ink-1)"
                    pointerEvents="none"
                  >
                    {m.classes}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-1 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)}>
          {showTable ? t('chart.hideTable') : t('chart.showTable')}
        </Button>
      </div>

      {showTable && (
        <Card className="mt-1 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-ink-muted">
                <th className="px-3 py-2 text-start font-medium">{t('chart.month')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('chart.classes')}</th>
              </tr>
            </thead>
            <tbody>
              {earlier > 0 && (
                <tr className="border-b border-hairline">
                  <td className="px-3 py-1.5 text-ink-soft">{t('chart.earlier')}</td>
                  <td className="tnum px-3 py-1.5 text-end text-ink">{earlier}</td>
                </tr>
              )}
              {[...months].reverse().map((m) => (
                <tr key={m.period} className="border-b border-hairline last:border-0">
                  <td className="tnum px-3 py-1.5 text-ink-soft" style={{ direction: 'ltr' }}>
                    {m.period}
                  </td>
                  <td className={cx('tnum px-3 py-1.5 text-end', m.classes ? 'text-ink' : 'text-ink-muted')}>
                    {m.classes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

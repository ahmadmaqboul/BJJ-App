import type { Belt } from '../../shared/types';
import { beltKey, useT } from '../i18n';
import { cx } from './ui';

/**
 * A belt drawn as a belt: the strap in the belt's colour with the black bar at
 * one end and the stripes taped across it, the way a rank actually looks.
 *
 * The grade is also written out underneath, so the belt colour and the stripe
 * marks are reinforcement rather than the only way to read it.
 */
export function BeltVisual({
  belt,
  stripes,
  size = 'md',
  className,
}: {
  belt: Belt;
  stripes: number;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const t = useT();
  const h = size === 'lg' ? 'h-14' : 'h-10';
  // A black belt's bar is red; every other belt takes the black bar.
  const barColor = belt === 'black' ? '#b02020' : '#111827';

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <div
        data-belt={belt}
        className={cx(
          'relative w-full overflow-hidden rounded-md ring-1 ring-[color:var(--belt-ring)]',
          h,
        )}
        style={{ background: 'var(--belt-bg)' }}
        role="img"
        aria-label={`${t(beltKey(belt))} — ${stripes}`}
      >
        {/* Stitch lines along the strap. */}
        <span
          className="pointer-events-none absolute inset-x-0 top-[22%] h-px"
          style={{ background: 'rgb(0 0 0 / 0.12)' }}
        />
        <span
          className="pointer-events-none absolute inset-x-0 bottom-[22%] h-px"
          style={{ background: 'rgb(0 0 0 / 0.12)' }}
        />

        {/* The rank bar, at the end of the strap. */}
        <span
          className="absolute inset-y-0 end-0 w-[38%]"
          style={{ background: barColor }}
        />

        {/* Stripes taped across the bar, from the outer end inward. */}
        <span className="absolute inset-y-[14%] end-[3%] flex flex-row-reverse items-stretch gap-[6px]">
          {Array.from({ length: Math.max(0, Math.min(4, stripes)) }, (_, i) => (
            <span key={i} className="block w-[6px] rounded-[1px] bg-white/95" />
          ))}
        </span>
      </div>

      <p className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold text-ink">{t(beltKey(belt))}</span>
        <span className="text-ink-soft">
          {stripes > 0 ? t('me.stripesCount', { n: stripes }) : t('me.noStripes')}
        </span>
      </p>
    </div>
  );
}

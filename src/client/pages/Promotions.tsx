import { useNavigate } from 'react-router-dom';
import type { Belt } from '../../shared/types';
import type { PromotionStatus } from '../../shared/promotion';
import { beltKey, promoStatusKey, useLang, useT } from '../i18n';
import { useApi } from '../lib/hooks';
import { formatDate } from '../lib/format';
import {
  Badge,
  BeltBadge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Meter,
  SectionTitle,
  cx,
  type Tone,
} from '../components/ui';
import { Icon } from '../components/Icon';

interface BoardRow {
  memberId: number;
  nameAr: string;
  memberStatus: string;
  belt: Belt;
  stripes: number;
  totalClasses: number;
  status: PromotionStatus;
  target: 'stripe' | 'belt' | 'none';
  targetBelt: Belt;
  targetStripes: number;
  monthsElapsed: number;
  monthsRequired: number;
  classesSince: number;
  classesRequired: number;
  classesShort: number;
  eligibleOn: string | null;
  daysUntilEligible: number | null;
  timeGateMet: boolean;
  classGateMet: boolean;
  progress: number;
}

const TONE: Record<PromotionStatus, Tone> = {
  overdue: 'critical',
  due: 'good',
  upcoming: 'info',
  blocked_attendance: 'warning',
  blocked_age: 'warning',
  not_due: 'neutral',
  inactive: 'neutral',
  capped: 'neutral',
};

/** Only the groups worth showing by default; the rest stay collapsed. */
const PRIMARY: PromotionStatus[] = ['overdue', 'due', 'upcoming', 'blocked_attendance'];
const SECONDARY: PromotionStatus[] = ['blocked_age', 'not_due', 'capped', 'inactive'];

export function Promotions() {
  const t = useT();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi<{
    asOf: string;
    groups: Record<PromotionStatus, BoardRow[]>;
    counts: Record<PromotionStatus, number>;
  }>('/api/promotions/board');

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (!data) return null;

  const actionable = (data.counts.due ?? 0) + (data.counts.overdue ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">{t('promo.board')}</h1>
          <p className="mt-0.5 text-xs text-ink-muted">{t('promo.rulesHint')}</p>
        </div>
        <Button size="sm" icon="settings" onClick={() => nav('/settings')}>
          {t('promo.rules')}
        </Button>
      </div>

      {actionable === 0 && (
        <Card className="bg-good-tint p-3">
          <p className="flex items-center gap-2 text-sm text-ink">
            <Icon name="check" className="size-4 shrink-0" />
            {t('promo.noneDue')}
          </p>
        </Card>
      )}

      {PRIMARY.map((status) => {
        const rows = data.groups[status] ?? [];
        if (!rows.length) return null;
        return (
          <section key={status}>
            <SectionTitle>
              <span className="flex items-center gap-2">
                <Badge tone={TONE[status]} icon={status === 'blocked_attendance' ? 'alert' : 'award'}>
                  {t(promoStatusKey(status))}
                </Badge>
                <span className="tnum text-ink-muted">{rows.length}</span>
              </span>
            </SectionTitle>
            <ul className="space-y-1.5">
              {rows.map((r) => (
                <BoardCard key={r.memberId} row={r} onOpen={() => nav(`/members/${r.memberId}`)} />
              ))}
            </ul>
          </section>
        );
      })}

      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2 py-2 text-sm text-ink-soft">
          <Icon name="chevron" className="size-4 flip-rtl transition-transform group-open:rotate-90" />
          {t('common.more')}
        </summary>
        <div className="space-y-4 pt-2">
          {SECONDARY.map((status) => {
            const rows = data.groups[status] ?? [];
            if (!rows.length) return null;
            return (
              <section key={status}>
                <SectionTitle>
                  <span className="flex items-center gap-2">
                    <Badge tone={TONE[status]}>{t(promoStatusKey(status))}</Badge>
                    <span className="tnum text-ink-muted">{rows.length}</span>
                  </span>
                </SectionTitle>
                <ul className="space-y-1.5">
                  {rows.map((r) => (
                    <BoardCard
                      key={r.memberId}
                      row={r}
                      onOpen={() => nav(`/members/${r.memberId}`)}
                      compact
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </details>

      {Object.values(data.groups).every((g) => g.length === 0) && (
        <EmptyState icon="award">{t('promo.noneDue')}</EmptyState>
      )}
    </div>
  );
}

function BoardCard({
  row,
  onOpen,
  compact,
}: {
  row: BoardRow;
  onOpen: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();

  const targetLabel =
    row.target === 'belt'
      ? t('promo.nextBelt', { belt: t(beltKey(row.targetBelt)) })
      : row.target === 'stripe'
        ? t('promo.nextStripe', { n: row.targetStripes })
        : t('promoStatus.capped');

  return (
    <Card as="li" className="p-3">
      <button className="w-full text-start" onClick={onOpen}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{row.nameAr}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <BeltBadge belt={row.belt} stripes={row.stripes} />
              <Icon name="chevron" className="size-3 flip-rtl text-ink-muted" />
              <span className="text-xs font-medium text-ink-soft">{targetLabel}</span>
            </p>
          </div>
          <Icon name="chevron" className="size-4 shrink-0 flip-rtl text-ink-muted" />
        </div>

        {!compact && (
          <div className="mt-3 space-y-2">
            <Meter value={row.progress} tone={TONE[row.status]} label={t('promo.progress')} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span
                className={cx(
                  'flex items-center gap-1',
                  row.timeGateMet ? 'text-ink-soft' : 'text-ink-muted',
                )}
              >
                <Icon
                  name={row.timeGateMet ? 'check' : 'clock'}
                  className={cx('size-3.5', row.timeGateMet && 'text-good')}
                />
                {t('promo.monthsServed', { done: row.monthsElapsed, need: row.monthsRequired })}
              </span>
              <span
                className={cx(
                  'flex items-center gap-1',
                  row.classGateMet ? 'text-ink-soft' : 'text-ink-muted',
                )}
              >
                <Icon
                  name={row.classGateMet ? 'check' : 'alert'}
                  className={cx('size-3.5', row.classGateMet && 'text-good')}
                />
                {t('promo.classesDone', { done: row.classesSince, need: row.classesRequired })}
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              {row.classesShort > 0
                ? t('promo.shortBy', { n: row.classesShort })
                : row.eligibleOn
                  ? row.timeGateMet
                    ? t('promo.eligibleSince', { date: formatDate(row.eligibleOn, lang) })
                    : t('promo.eligibleOn', { date: formatDate(row.eligibleOn, lang) })
                  : null}
            </p>
          </div>
        )}
      </button>
    </Card>
  );
}

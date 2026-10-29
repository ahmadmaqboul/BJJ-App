import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Belt } from '../../shared/types';
import { useLang, useT } from '../i18n';
import { useApi } from '../lib/hooks';
import { formatDate, money } from '../lib/format';
import {
  Badge,
  BeltBadge,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  SectionTitle,
  Segmented,
  StatTile,
  cx,
} from '../components/ui';
import { Icon } from '../components/Icon';

interface OutstandingRow {
  memberId: number;
  nameAr: string;
  phone: string | null;
  status: string;
  belt: Belt;
  stripes: number;
  chargedMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  lastPaidOn: string | null;
  uncoveredClasses: number;
}

type Filter = 'owing' | 'all';

export function Payments() {
  const t = useT();
  const { lang } = useLang();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('owing');

  const { data, error, loading, reload } = useApi<{
    rows: OutstandingRow[];
    totalOutstandingMinor: number;
  }>('/api/billing/outstanding');

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return filter === 'owing' ? all.filter((r) => r.outstandingMinor > 0) : all;
  }, [data, filter]);

  const owingCount = (data?.rows ?? []).filter((r) => r.outstandingMinor > 0).length;
  const uncoveredTotal = (data?.rows ?? []).reduce((s, r) => s + r.uncoveredClasses, 0);

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">{t('pay.title')}</h1>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label={t('pay.totalOutstanding')}
          value={money(data?.totalOutstandingMinor ?? 0)}
          sub={t('dash.membersOwing', { n: owingCount })}
          tone={(data?.totalOutstandingMinor ?? 0) > 0 ? 'warning' : 'good'}
          icon="coins"
        />
        <StatTile
          label={t('dash.uncovered')}
          value={uncoveredTotal}
          tone={uncoveredTotal > 0 ? 'warning' : 'good'}
          icon="alert"
        />
      </div>

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'owing', label: t('pay.outstanding'), count: owingCount },
          { value: 'all', label: t('members.all'), count: data?.rows.length },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState icon="check">{t('pay.noOutstanding')}</EmptyState>
      ) : (
        <>
          <SectionTitle>{t('members.title')}</SectionTitle>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <Card as="li" key={r.memberId} className="p-3">
                <button
                  className="flex w-full items-center gap-3 text-start"
                  onClick={() => nav(`/members/${r.memberId}`)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{r.nameAr}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      <BeltBadge belt={r.belt} stripes={r.stripes} />
                      <span className="text-xs text-ink-muted">
                        {r.lastPaidOn
                          ? `${t('pay.lastPaid')}: ${formatDate(r.lastPaidOn, lang)}`
                          : t('pay.never')}
                      </span>
                      {r.uncoveredClasses > 0 && (
                        <Badge tone="warning" icon="alert">
                          {t('pay.uncoveredClasses', { n: r.uncoveredClasses })}
                        </Badge>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p
                      className={cx(
                        'tnum text-sm font-semibold',
                        r.outstandingMinor > 0 ? 'text-ink' : 'text-ink-muted',
                      )}
                    >
                      {money(r.outstandingMinor)}
                    </p>
                  </div>
                  <Icon name="chevron" className="size-4 shrink-0 flip-rtl text-ink-muted" />
                </button>
              </Card>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

import { useNavigate } from 'react-router-dom';
import { useT, useLang } from '../i18n';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { formatDate, money } from '../lib/format';
import { Badge, Button, Card, ErrorBlock, LoadingBlock, SectionTitle, StatTile } from '../components/ui';
import { Icon } from '../components/Icon';
import { useState } from 'react';

interface DashboardData {
  asOf: string;
  members: { total: number; active: number; inactive: number; paused: number; withoutLogin: number };
  promotions: { due: number; blockedByAttendance: number };
  month: { key: string; classes: number; checkins: number; uncovered: number; collectedMinor: number };
  outstandingMinor: number;
  membersOwing: number;
  lastSession: {
    id: number;
    date: string;
    class_type: string;
    technique_title: string | null;
    present_count: number;
  } | null;
}

export function Dashboard() {
  const t = useT();
  const { lang } = useLang();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi<DashboardData>('/api/admin/dashboard');
  const [starting, setStarting] = useState(false);

  async function startTodayClass() {
    if (starting) return;
    setStarting(true);
    try {
      const res = await api.post<{ session: { id: number } }>('/api/sessions', {});
      nav(`/classes/${res.session.id}`);
    } finally {
      setStarting(false);
    }
  }

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (!data) return null;

  const owes = data.outstandingMinor > 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink">{t('dash.title')}</h1>
        <p className="text-xs text-ink-muted">{formatDate(data.asOf, lang)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label={t('dash.activeMembers')}
          value={data.members.active}
          sub={`${data.members.inactive} ${t('status.inactive')}`}
          icon="users"
          onClick={() => nav('/members')}
        />
        <StatTile
          label={t('dash.classesThisMonth')}
          value={data.month.classes}
          sub={`${data.month.checkins} ${t('dash.checkinsThisMonth')}`}
          icon="calendar"
          onClick={() => nav('/classes')}
        />
        <StatTile
          label={t('dash.outstanding')}
          value={money(data.outstandingMinor)}
          sub={owes ? t('dash.membersOwing', { n: data.membersOwing }) : t('pay.settled')}
          tone={owes ? 'warning' : 'good'}
          icon="coins"
          onClick={() => nav('/payments')}
        />
        <StatTile
          label={t('dash.promotionsDue')}
          value={data.promotions.due}
          sub={
            data.promotions.blockedByAttendance > 0
              ? t('dash.blockedByAttendance', { n: data.promotions.blockedByAttendance })
              : undefined
          }
          tone={data.promotions.due > 0 ? 'good' : 'neutral'}
          icon="award"
          onClick={() => nav('/promotions')}
        />
      </div>

      <div>
        <SectionTitle>{t('dash.quickActions')}</SectionTitle>
        <div className="space-y-2">
          <Button variant="primary" size="lg" icon="plus" onClick={startTodayClass} disabled={starting}>
            {starting ? t('common.saving') : t('dash.startClass')}
          </Button>
        </div>
      </div>

      <div>
        <SectionTitle>{t('dash.lastClass')}</SectionTitle>
        {data.lastSession ? (
          <Card className="p-3">
            <button
              className="flex w-full items-center justify-between gap-3 text-start"
              onClick={() => nav(`/classes/${data.lastSession!.id}`)}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {formatDate(data.lastSession.date, lang)}
                </p>
                <p className="truncate text-xs text-ink-soft">
                  {data.lastSession.technique_title || t('classType.gi')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone="info">
                  {data.lastSession.present_count} {t('classes.present')}
                </Badge>
                <Icon name="chevron" className="size-4 flip-rtl text-ink-muted" />
              </div>
            </button>
          </Card>
        ) : (
          <Card className="p-4">
            <p className="text-sm text-ink-muted">{t('dash.noClasses')}</p>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label={t('dash.collected')}
          value={money(data.month.collectedMinor)}
          icon="coins"
        />
        <StatTile
          label={t('dash.uncovered')}
          value={data.month.uncovered}
          tone={data.month.uncovered > 0 ? 'warning' : 'good'}
          icon="alert"
          onClick={() => nav('/payments')}
        />
      </div>
    </div>
  );
}

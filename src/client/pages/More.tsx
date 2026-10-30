import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import { useApi } from '../lib/hooks';
import { isAdmin, useAuth } from '../auth';
import { Badge, Button, Card, SectionTitle, cx } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';

interface DashboardCounts {
  promotions: { due: number; blockedByAttendance: number };
}

/**
 * Everything that does not earn a permanent slot in the bottom bar.
 *
 * This replaces the admin/player mode switch that used to sit in the header.
 * Swapping the whole app between two modes was a heavier idea than the problem
 * needed: an admin who also trains does not want a different app, they want
 * their own player page — which is just another destination, listed here.
 */
export function More() {
  const t = useT();
  const nav = useNavigate();
  const { user, signOut } = useAuth();
  const admin = isAdmin(user);

  // Only to badge the promotions row; the board itself does the real work.
  const { data } = useApi<DashboardCounts>('/api/admin/dashboard');
  const due = data?.promotions.due ?? 0;

  const manage: { to: string; label: string; icon: IconName; badge?: number }[] = [
    { to: '/promotions', label: t('nav.promotions'), icon: 'award', badge: due },
    { to: '/groups', label: t('groups.title'), icon: 'list' },
  ];

  // A plain link, so the browser handles the download itself rather than the
  // app buffering a file it has no other use for.
  const exportHref = '/api/admin/export/members.csv';

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold text-ink">{t('more.title')}</h1>

      <section>
        <SectionTitle>{t('more.manage')}</SectionTitle>
        <Card className="divide-y divide-hairline overflow-hidden p-0">
          {manage.map((row) => (
            <Row
              key={row.to}
              icon={row.icon}
              label={row.label}
              badge={row.badge}
              onClick={() => nav(row.to)}
            />
          ))}
          <a
            href={exportHref}
            download
            className="flex w-full items-center gap-3 px-3 py-3.5 text-start transition-colors hover:bg-plane"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-plane text-ink-soft">
              <Icon name="list" className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                {t('more.export')}
              </span>
              <span className="block truncate text-xs text-ink-muted">
                {t('more.exportHint')}
              </span>
            </span>
            <Icon name="chevron" className="size-4 shrink-0 flip-rtl text-ink-muted" />
          </a>
        </Card>
      </section>

      <section>
        <SectionTitle>{t('more.account')}</SectionTitle>
        <Card className="divide-y divide-hairline overflow-hidden p-0">
          {user?.memberId != null && (
            <Row
              icon="users"
              label={t('more.myPage')}
              hint={t('more.myPageHint')}
              onClick={() => nav('/me')}
            />
          )}
          <Row icon="settings" label={t('nav.settings')} onClick={() => nav('/settings')} />
        </Card>
      </section>

      {admin && (
        <p className="px-1 text-xs text-ink-muted">
          {t('role.admin')} · <span dir="ltr">{user?.login}</span>
        </p>
      )}

      <section className="border-t border-hairline pt-4">
        <Button variant="ghost" icon="logout" onClick={() => void signOut()}>
          {t('settings.logout')}
        </Button>
      </section>
    </div>
  );
}

function Row({
  icon,
  label,
  hint,
  badge,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 px-3 py-3.5 text-start transition-colors hover:bg-plane"
      onClick={onClick}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-plane text-ink-soft">
        <Icon name={icon} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block truncate text-xs text-ink-muted">{hint}</span>}
      </span>
      {badge !== undefined && badge > 0 && (
        <Badge tone="good" icon="award">
          {badge}
        </Badge>
      )}
      <Icon name="chevron" className={cx('size-4 shrink-0 flip-rtl text-ink-muted')} />
    </button>
  );
}

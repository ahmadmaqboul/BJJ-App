import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { isStaff, useAuth } from './auth';
import { useT } from './i18n';
import { Icon, type IconName } from './components/Icon';
import { LoadingBlock, cx } from './components/ui';
import { Login } from './pages/Login';
import { ChangePin } from './pages/ChangePin';
import { Dashboard } from './pages/Dashboard';
import { Classes } from './pages/Classes';
import { CheckIn } from './pages/CheckIn';
import { Members } from './pages/Members';
import { MemberProfile } from './pages/MemberProfile';
import { Payments } from './pages/Payments';
import { Promotions } from './pages/Promotions';
import { Groups } from './pages/Groups';
import { Settings } from './pages/Settings';
import { MyProfile } from './pages/MyProfile';
import { More } from './pages/More';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] transition-colors',
                  isActive ? 'text-series font-semibold' : 'text-ink-muted',
                )
              }
            >
              <Icon name={item.icon} className="size-5" />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Shell({ items, children }: { items: NavItem[]; children: React.ReactNode }) {
  const t = useT();

  return (
    <div className="min-h-[100dvh] bg-plane">
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-series text-white">
              <Icon name="award" className="size-4" />
            </span>
            <span className="text-sm font-semibold text-ink">{t('app.name')}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">{children}</main>

      <BottomNav items={items} />
    </div>
  );
}

export function App() {
  const t = useT();
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-plane">
        <LoadingBlock />
      </div>
    );
  }

  if (!user) return <Login />;

  // Nothing else is reachable until the temporary PIN is replaced; the server
  // enforces this too, so a deep link cannot slip past it.
  if (user.mustChangePin) return <ChangePin forced />;

  const staffMode = isStaff(user);

  // Four destinations used constantly, plus one drawer for the rest. The
  // promotions board, groups and settings live behind "More" because they are
  // opened occasionally, and the dashboard already links to whichever of them
  // needs attention today.
  const staffItems: NavItem[] = [
    { to: '/', label: t('nav.home'), icon: 'home' },
    { to: '/classes', label: t('nav.classes'), icon: 'calendar' },
    { to: '/members', label: t('nav.members'), icon: 'users' },
    { to: '/payments', label: t('nav.payments'), icon: 'coins' },
    { to: '/more', label: t('nav.more'), icon: 'list' },
  ];

  // A player who runs the register gets the classes tab, and nothing else
  // the staff navigation carries.
  const playerItems: NavItem[] = [
    { to: '/me', label: t('nav.me'), icon: 'users' },
    ...(user.canTakeAttendance
      ? [{ to: '/classes', label: t('nav.classes'), icon: 'calendar' as const }]
      : []),
    { to: '/me/settings', label: t('nav.settings'), icon: 'settings' },
  ];

  if (!staffMode) {
    return (
      <Shell items={playerItems}>
        <Routes>
          <Route path="/me" element={<MyProfile />} />
          <Route path="/me/settings" element={<Settings />} />
          {user.canTakeAttendance && (
            <>
              <Route path="/classes" element={<Classes />} />
              <Route path="/classes/:id" element={<CheckIn />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/me" replace state={{ from: location }} />} />
        </Routes>
      </Shell>
    );
  }

  return (
    <Shell items={staffItems}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/classes" element={<Classes />} />
        <Route path="/classes/:id" element={<CheckIn />} />
        <Route path="/members" element={<Members />} />
        <Route path="/members/:id" element={<MemberProfile />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/promotions" element={<Promotions />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/more" element={<More />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/me" element={<MyProfile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

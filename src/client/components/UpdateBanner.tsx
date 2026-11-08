import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { watchForUpdates } from '../lib/updates';
import { Button } from './ui';
import { Icon } from './Icon';

/**
 * Tells the user a new version is ready and lets them apply it.
 *
 * Sits above the bottom navigation rather than over the content, so it never
 * covers what someone is working on, and it can be dismissed — the update is
 * still applied on the next natural reload.
 */
export function UpdateBanner() {
  const t = useT();
  const [apply, setApply] = useState<(() => void) | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Stored as a thunk: a bare function would be treated as a state updater.
    watchForUpdates((fn) => setApply(() => fn));
  }, []);

  if (!apply || dismissed) return null;

  return (
    <div
      className="fixed inset-x-0 z-40 px-4"
      style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
      role="status"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl2 bg-series-tint px-3 py-2.5 shadow-card ring-1 ring-hairline">
        <Icon name="refresh" className="size-4 shrink-0 text-ink" />
        <p className="min-w-0 flex-1 truncate text-sm text-ink">{t('update.ready')}</p>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          {t('update.later')}
        </Button>
        <Button size="sm" variant="primary" onClick={apply}>
          {t('update.apply')}
        </Button>
      </div>
    </div>
  );
}

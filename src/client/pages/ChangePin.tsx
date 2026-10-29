import { useState } from 'react';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { api, errorKey } from '../lib/api';
import { Button, Card, Field, Input } from '../components/ui';
import { Icon } from '../components/Icon';

/**
 * Forced on first sign-in, and reachable afterwards from the profile. The
 * server rejects a weak or sequential PIN, so the message comes from there
 * rather than being re-implemented here.
 */
export function ChangePin({ forced, onDone }: { forced: boolean; onDone?: () => void }) {
  const t = useT();
  const { refresh, signOut } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setError(t('pin.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/change-pin', { currentPin: current, newPin: next });
      await refresh();
      onDone?.();
    } catch (err) {
      const { key, vars } = errorKey(err);
      setError(t(key as 'err.generic', vars));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-plane px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-series text-white">
            <Icon name="key" className="size-6" />
          </div>
          <h1 className="text-xl font-semibold text-ink">{t('pin.title')}</h1>
          {forced && <p className="mt-1 text-sm text-ink-soft">{t('pin.why')}</p>}
        </div>

        <Card className="p-4">
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('pin.current')}>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                dir="ltr"
                className="text-start tracking-[0.3em]"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </Field>
            <Field label={t('pin.new')}>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                dir="ltr"
                className="text-start tracking-[0.3em]"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </Field>
            <Field label={t('pin.confirm')}>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                dir="ltr"
                className="text-start tracking-[0.3em]"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </Field>

            {error && (
              <p className="rounded-xl2 bg-critical-tint px-3 py-2 text-sm text-ink" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {busy ? t('common.saving') : t('pin.submit')}
            </Button>
          </form>
        </Card>

        {forced && (
          <div className="mt-4 text-center">
            <Button variant="ghost" size="sm" icon="logout" onClick={() => void signOut()}>
              {t('settings.logout')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

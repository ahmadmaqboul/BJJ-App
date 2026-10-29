import { useState } from 'react';
import { useAuth, rememberedLogin } from '../auth';
import { useT, useLang } from '../i18n';
import { errorKey } from '../lib/api';
import { Button, Card, Field, Input, Switch } from '../components/ui';
import { Icon } from '../components/Icon';

export function Login() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { signIn } = useAuth();

  const remembered = rememberedLogin();
  const [login, setLogin] = useState(remembered);
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(login.trim(), pin, remember);
    } catch (err) {
      const { key, vars } = errorKey(err);
      setError(t(key as 'err.generic', vars));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-plane px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-series text-white">
            <Icon name="award" className="size-6" />
          </div>
          <h1 className="text-xl font-semibold text-ink">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-ink-soft">{t('app.tagline')}</p>
        </div>

        <Card className="p-4">
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('login.phone')} htmlFor="login">
              <Input
                id="login"
                name="username"
                type="tel"
                inputMode="tel"
                autoComplete="username"
                dir="ltr"
                className="text-start"
                placeholder="05xxxxxxxx"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
              />
            </Field>

            <Field label={t('login.pin')} htmlFor="pin" hint={t('login.hint')}>
              <Input
                id="pin"
                name="password"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                dir="ltr"
                className="text-start tracking-[0.3em]"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
              />
            </Field>

            <Switch checked={remember} onChange={setRemember} label={t('login.remember')} />

            {error && (
              <p className="rounded-xl2 bg-critical-tint px-3 py-2 text-sm text-ink" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {busy ? t('login.working') : t('login.submit')}
            </Button>
          </form>
        </Card>

        <div className="mt-4 text-center">
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
            {lang === 'ar' ? 'English' : 'العربية'}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { Belt, PlanType } from '../../shared/types';
import { parseMoney } from '../../shared/billing';
import { beltKey, planTypeKey, useLang, useT, type Lang } from '../i18n';
import { api, errorKey } from '../lib/api';
import { useApi } from '../lib/hooks';
import type { Theme } from '../lib/hooks';
import { useTheme } from '../theme';
import { money } from '../lib/format';
import { isAdmin, isStaff, useAuth } from '../auth';
import {
  Badge,
  Button,
  Card,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  SectionTitle,
  Segmented,
  Sheet,
  Switch,
  useToast,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { ChangePin } from './ChangePin';

interface Plan {
  id: number;
  name_ar: string;
  name_en: string;
  type: PlanType;
  price_minor: number;
  sessions_included: number | null;
  validity_days: number | null;
  active: number;
}

interface Rule {
  belt: Belt;
  monthsPerStripe: number;
  classesPerStripe: number;
  maxStripes: number;
  monthsToNextBelt: number;
  classesToNextBelt: number;
  minAge: number | null;
  nextBelt: Belt | null;
}

export function Settings() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { theme, setTheme } = useTheme();
  const { user, signOut } = useAuth();
  const staff = isStaff(user);
  const admin = isAdmin(user);

  const [pinOpen, setPinOpen] = useState(false);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold text-ink">{t('settings.title')}</h1>

      <section>
        <SectionTitle>{t('settings.language')}</SectionTitle>
        <Segmented<Lang>
          value={lang}
          onChange={setLang}
          options={[
            { value: 'ar', label: 'العربية' },
            { value: 'en', label: 'English' },
          ]}
        />
      </section>

      <section>
        <SectionTitle>{t('settings.theme')}</SectionTitle>
        <Segmented<Theme>
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: t('settings.theme.system') },
            { value: 'light', label: t('settings.theme.light') },
            { value: 'dark', label: t('settings.theme.dark') },
          ]}
        />
      </section>

      <section>
        <SectionTitle>{t('login.pin')}</SectionTitle>
        <Card className="p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="tnum text-sm text-ink-soft" dir="ltr">
              {user?.login}
            </p>
            <Button size="sm" icon="key" onClick={() => setPinOpen(true)}>
              {t('me.changePin')}
            </Button>
          </div>
        </Card>
      </section>

      {staff && <TeamSettings />}
      {staff && <PlansSection editable={admin} />}
      {staff && <RulesSection editable={admin} />}

      <section className="border-t border-hairline pt-4">
        <Button variant="ghost" icon="logout" onClick={() => void signOut()}>
          {t('settings.logout')}
        </Button>
      </section>

      {pinOpen && (
        <Sheet open onClose={() => setPinOpen(false)} title={t('me.changePin')}>
          <div className="-mx-4 -my-4">
            <ChangePin forced={false} onDone={() => setPinOpen(false)} />
          </div>
        </Sheet>
      )}
    </div>
  );
}

function TeamSettings() {
  const t = useT();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ settings: Record<string, string> }>(
    '/api/admin/settings',
  );
  const { user } = useAuth();
  const admin = isAdmin(user);

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const value = (key: string) => edits[key] ?? data?.settings[key] ?? '';
  const set = (key: string, v: string) => setEdits((e) => ({ ...e, [key]: v }));

  async function save() {
    if (busy || !Object.keys(edits).length) return;
    setBusy(true);
    try {
      await api.put('/api/admin/settings', edits);
      setEdits({});
      toast.show(t('common.save'), 'good');
      reload();
    } catch (err) {
      const { key, vars } = errorKey(err);
      toast.show(t(key as 'err.generic', vars), 'warning');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;

  return (
    <section>
      <SectionTitle>{t('settings.team')}</SectionTitle>
      <Card className="space-y-3 p-4">
        <Field label={t('settings.teamName')}>
          <Input
            value={value('team_name_ar')}
            onChange={(e) => set('team_name_ar', e.target.value)}
            disabled={!admin}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.currency')}>
            <Input
              value={value('default_currency')}
              onChange={(e) => set('default_currency', e.target.value)}
              disabled={!admin}
              dir="ltr"
            />
          </Field>
          <Field label={t('settings.lookahead')}>
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              value={value('promotion_lookahead_days')}
              onChange={(e) => set('promotion_lookahead_days', e.target.value)}
              disabled={!admin}
            />
          </Field>
        </div>
        <Field label={t('settings.timezone')}>
          <Input value={value('timezone')} onChange={(e) => set('timezone', e.target.value)} disabled={!admin} dir="ltr" />
        </Field>

        {admin && Object.keys(edits).length > 0 && (
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        )}
      </Card>
    </section>
  );
}

function PlansSection({ editable }: { editable: boolean }) {
  const t = useT();
  const { data, loading, reload } = useApi<{ plans: Plan[] }>('/api/billing/plans?includeInactive=1');
  const [editing, setEditing] = useState<Plan | null>(null);

  if (loading && !data) return <LoadingBlock />;

  return (
    <section>
      <SectionTitle hint={t('settings.placeholderPrices')}>{t('settings.plans')}</SectionTitle>
      <ul className="space-y-1.5">
        {(data?.plans ?? []).map((p) => (
          <Card as="li" key={p.id} className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{p.name_ar}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  <Badge tone="info">{t(planTypeKey(p.type))}</Badge>
                  {p.sessions_included != null && (
                    <span className="tnum">
                      {p.sessions_included} {t('chart.classes')}
                    </span>
                  )}
                  {p.validity_days != null && <span className="tnum">{p.validity_days}d</span>}
                  {!p.active && <Badge tone="neutral">{t('groups.inactive')}</Badge>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tnum text-sm font-semibold text-ink">{money(p.price_minor)}</span>
                {editable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="edit"
                    aria-label={t('common.save')}
                    onClick={() => setEditing(p)}
                  />
                )}
              </div>
            </div>
          </Card>
        ))}
      </ul>

      {editing && (
        <EditPlanSheet
          plan={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

function EditPlanSheet({
  plan,
  onClose,
  onDone,
}: {
  plan: Plan;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [nameAr, setNameAr] = useState(plan.name_ar);
  const [price, setPrice] = useState(String(plan.price_minor / 100));
  const [sessions, setSessions] = useState(
    plan.sessions_included == null ? '' : String(plan.sessions_included),
  );
  const [validity, setValidity] = useState(
    plan.validity_days == null ? '' : String(plan.validity_days),
  );
  const [active, setActive] = useState(!!plan.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const minor = parseMoney(price);
    if (minor === null || minor < 0) {
      setError(t('err.bad_amount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/billing/plans/${plan.id}`, {
        nameAr,
        priceMinor: minor,
        sessionsIncluded: sessions === '' ? null : Number(sessions),
        validityDays: validity === '' ? null : Number(validity),
        active,
      });
      toast.show(t('common.save'), 'good');
      onDone();
    } catch (err) {
      const { key, vars } = errorKey(err);
      setError(t(key as 'err.generic', vars));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={plan.name_ar}
      footer={
        <Button variant="primary" size="lg" onClick={save} disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('settings.planName')}>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('settings.planPrice')} error={error ?? undefined}>
          <Input
            inputMode="decimal"
            dir="ltr"
            className="text-start"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.planSessions')} hint={t('pay.unlimited')}>
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
              disabled={plan.type === 'monthly'}
            />
          </Field>
          <Field label={t('settings.planValidity')} hint={t('pay.noExpiry')}>
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              value={validity}
              onChange={(e) => setValidity(e.target.value)}
            />
          </Field>
        </div>
        <Switch checked={active} onChange={setActive} label={t('settings.planActive')} />
      </div>
    </Sheet>
  );
}

function RulesSection({ editable }: { editable: boolean }) {
  const t = useT();
  const { data, loading, reload } = useApi<{ rules: Rule[] }>('/api/promotions/rules');
  const [editing, setEditing] = useState<Rule | null>(null);

  if (loading && !data) return <LoadingBlock />;

  return (
    <section>
      <SectionTitle hint={t('promo.rulesHint')}>{t('promo.rules')}</SectionTitle>
      <ul className="space-y-1.5">
        {(data?.rules ?? []).map((r) => (
          <Card as="li" key={r.belt} className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{t(beltKey(r.belt))}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  <span className="tnum">{r.monthsPerStripe}</span> {t('promo.monthsPerStripe')} ·{' '}
                  <span className="tnum">{r.classesPerStripe}</span> {t('promo.classesPerStripe')}
                </p>
              </div>
              {editable && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="edit"
                  aria-label={t('common.save')}
                  onClick={() => setEditing(r)}
                />
              )}
            </div>
          </Card>
        ))}
      </ul>

      {editing && (
        <EditRuleSheet
          rule={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

function EditRuleSheet({
  rule,
  onClose,
  onDone,
}: {
  rule: Rule;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [form, setForm] = useState({
    monthsPerStripe: String(rule.monthsPerStripe),
    classesPerStripe: String(rule.classesPerStripe),
    monthsToNextBelt: String(rule.monthsToNextBelt),
    classesToNextBelt: String(rule.classesToNextBelt),
    maxStripes: String(rule.maxStripes),
    minAge: rule.minAge == null ? '' : String(rule.minAge),
  });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await api.put(`/api/promotions/rules/${rule.belt}`, {
        monthsPerStripe: Number(form.monthsPerStripe),
        classesPerStripe: Number(form.classesPerStripe),
        monthsToNextBelt: Number(form.monthsToNextBelt),
        classesToNextBelt: Number(form.classesToNextBelt),
        maxStripes: Number(form.maxStripes),
        minAge: form.minAge === '' ? null : Number(form.minAge),
      });
      toast.show(t('common.save'), 'good');
      onDone();
    } catch (err) {
      const { key, vars } = errorKey(err);
      toast.show(t(key as 'err.generic', vars), 'warning');
    } finally {
      setBusy(false);
    }
  }

  const num = (label: string, k: keyof typeof form) => (
    <Field label={label}>
      <Input
        type="number"
        inputMode="numeric"
        dir="ltr"
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${t('promo.rules')} — ${t(beltKey(rule.belt))}`}
      footer={
        <Button variant="primary" size="lg" onClick={save} disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {num(t('promo.monthsPerStripe'), 'monthsPerStripe')}
          {num(t('promo.classesPerStripe'), 'classesPerStripe')}
          {num(t('promo.monthsToBelt'), 'monthsToNextBelt')}
          {num(t('promo.classesToBelt'), 'classesToNextBelt')}
          {num(t('promo.maxStripes'), 'maxStripes')}
          {num(t('promo.minAge'), 'minAge')}
        </div>
        {rule.nextBelt && (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Icon name="chevron" className="size-3.5 flip-rtl" />
            {t('promo.nextBelt', { belt: t(beltKey(rule.nextBelt)) })}
          </p>
        )}
      </div>
    </Sheet>
  );
}

import { useMemo, useState } from 'react';
import type { Belt, Coverage, Member, PaymentMethod } from '../../shared/types';
import type { Eligibility } from '../../shared/promotion';
import type { CoverageOutlook } from '../../shared/billing';
import { beltKey, coverageKey, methodKey, promoStatusKey, useLang, useT } from '../i18n';
import { api, errorKey } from '../lib/api';
import { useApi } from '../lib/hooks';
import { formatDate, formatTime, money } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Meter,
  SectionTitle,
  Sheet,
  StatTile,
  cx,
  useToast,
  type Tone,
} from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { BeltVisual } from '../components/BeltVisual';
import { AttendanceChart } from '../components/AttendanceChart';

interface Overview {
  member: Member | null;
  role: string;
  eligibility: Eligibility | null;
  balance: { chargedMinor: number; paidMinor: number; outstandingMinor: number };
  currentCoverage: { coverage: Coverage; remainingAfter: number | null };
  outlook: CoverageOutlook;
  lastPayment: { amount_minor: number; paid_on: string; method: PaymentMethod } | null;
  attendance: { status: string; coverage: string | null; date: string; technique_title: string | null }[];
  monthly: { period: string; classes: number }[];
  beltHistory: {
    to_belt: Belt;
    to_stripes: number;
    kind: string;
    promoted_on: string;
  }[];
  recentClasses: {
    date: string;
    technique_title: string | null;
    technique_notes: string | null;
    attended: number;
  }[];
  schedule: {
    group_id: number;
    name_ar: string;
    class_type: string;
    location: string | null;
    weekday: number | null;
    start_time: string | null;
    duration_minutes: number | null;
  }[];
}

const STATUS_TONE: Record<string, Tone> = {
  due: 'good',
  overdue: 'good',
  upcoming: 'info',
  blocked_attendance: 'warning',
  blocked_age: 'warning',
  inactive: 'neutral',
  capped: 'neutral',
  not_due: 'neutral',
};

export function MyProfile() {
  const t = useT();
  const { lang } = useLang();
  const { data, error, loading, reload } = useApi<Overview>('/api/me/overview');
  const [editing, setEditing] = useState(false);

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (!data?.member) {
    return (
      <Card className="p-4">
        <p className="text-sm text-ink-soft">{t('err.member_not_found')}</p>
      </Card>
    );
  }

  const { member, eligibility, balance, outlook, lastPayment } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink">{member.nameAr}</h1>
          <p className="text-xs text-ink-muted">{t('app.tagline')}</p>
        </div>
        <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
          {t('me.editProfile')}
        </Button>
      </div>

      <Card className="p-4">
        <SectionTitle>{t('me.myBelt')}</SectionTitle>
        <BeltVisual belt={member.belt} stripes={member.stripes} size="lg" />
        <p className="mt-2 text-xs text-ink-muted">
          {member.lastPromotionDate
            ? `${t('members.lastPromotion')}: ${formatDate(member.lastPromotionDate, lang)}`
            : t('me.noPromotionYet')}
        </p>
      </Card>

      {eligibility && eligibility.target !== 'none' && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionTitle>{t('me.nextPromotion')}</SectionTitle>
            <Badge tone={STATUS_TONE[eligibility.status] ?? 'neutral'} icon="award">
              {t(promoStatusKey(eligibility.status))}
            </Badge>
          </div>

          <p className="mb-3 text-sm font-medium text-ink">
            {eligibility.target === 'belt'
              ? t('promo.nextBelt', { belt: t(beltKey(eligibility.targetBelt)) })
              : t('promo.nextStripe', { n: eligibility.targetStripes })}
          </p>

          <Gate
            label={t('promo.monthsServed', {
              done: eligibility.monthsElapsed,
              need: eligibility.monthsRequired,
            })}
            done={eligibility.timeGateMet}
            value={
              eligibility.monthsRequired
                ? Math.min(1, eligibility.monthsElapsed / eligibility.monthsRequired)
                : 1
            }
            detail={
              eligibility.eligibleOn && !eligibility.timeGateMet
                ? t('promo.eligibleOn', { date: formatDate(eligibility.eligibleOn, lang) })
                : undefined
            }
          />
          <Gate
            label={t('promo.classesDone', {
              done: eligibility.classesSince,
              need: eligibility.classesRequired,
            })}
            done={eligibility.classGateMet}
            value={
              eligibility.classesRequired
                ? Math.min(1, eligibility.classesSince / eligibility.classesRequired)
                : 1
            }
            detail={
              eligibility.classesShort > 0
                ? t('promo.shortBy', { n: eligibility.classesShort })
                : undefined
            }
            pendingIcon="alert"
          />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label={t('me.classesTotal')}
          value={member.totalClasses}
          sub={`${t('me.sinceLastPromotion')}: ${eligibility?.classesSince ?? 0}`}
          icon="calendar"
        />
        <StatTile
          label={t('me.nextPayment')}
          value={<OutlookValue outlook={outlook} />}
          sub={
            outlook.kind === 'covered_until' && outlook.daysLeft < 100000
              ? t('me.daysLeft', { n: Math.max(0, outlook.daysLeft) })
              : undefined
          }
          tone={outlook.kind === 'due_now' ? 'warning' : 'good'}
          icon="coins"
        />
      </div>

      <Card className="p-4">
        <SectionTitle>{t('me.myBalance')}</SectionTitle>
        <div className="flex items-center justify-between gap-3">
          <p
            className={cx(
              'text-sm',
              balance.outstandingMinor > 0 ? 'font-medium text-ink' : 'text-ink-soft',
            )}
          >
            {balance.outstandingMinor > 0
              ? t('me.owes', { amount: money(balance.outstandingMinor) })
              : t('me.clear')}
          </p>
          <Badge
            tone={data.currentCoverage.coverage === 'uncovered' ? 'warning' : 'good'}
            icon={data.currentCoverage.coverage === 'uncovered' ? 'alert' : 'check'}
          >
            {data.currentCoverage.coverage === 'uncovered'
              ? t('me.noActivePlan')
              : t(coverageKey(data.currentCoverage.coverage))}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {lastPayment
            ? `${t('me.lastPayment')}: ${money(lastPayment.amount_minor)} · ${formatDate(
                lastPayment.paid_on,
                lang,
              )} · ${t(methodKey(lastPayment.method))}`
            : t('pay.never')}
        </p>
      </Card>

      <ScheduleCard schedule={data.schedule} />

      <Card className="p-4">
        <AttendanceChart data={data.monthly} />
      </Card>

      <section>
        <SectionTitle>{t('me.whatWeTrained')}</SectionTitle>
        {data.recentClasses.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-ink-muted">{t('me.noTechniques')}</p>
          </Card>
        ) : (
          <ul className="space-y-1.5">
            {data.recentClasses.map((c, i) => (
              <Card as="li" key={`${c.date}-${i}`} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{c.technique_title}</p>
                    <p className="text-xs text-ink-muted">{formatDate(c.date, lang)}</p>
                    {c.technique_notes && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">
                        {c.technique_notes}
                      </p>
                    )}
                  </div>
                  <Badge tone={c.attended ? 'good' : 'neutral'} icon={c.attended ? 'check' : 'minus'}>
                    {c.attended ? t('me.attended') : t('me.missed')}
                  </Badge>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>{t('members.beltHistory')}</SectionTitle>
        {data.beltHistory.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-ink-muted">{t('me.noPromotionYet')}</p>
          </Card>
        ) : (
          <ul className="space-y-1.5">
            {data.beltHistory.map((p, i) => (
              <Card as="li" key={i} className="flex items-center gap-3 p-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-series-tint text-ink">
                  <Icon name="award" className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    {t(beltKey(p.to_belt))}
                    {p.to_stripes > 0 ? ` · ${t('me.stripesCount', { n: p.to_stripes })}` : ''}
                  </p>
                  <p className="text-xs text-ink-muted">{formatDate(p.promoted_on, lang)}</p>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <EditMySheet
          member={member}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function OutlookValue({ outlook }: { outlook: CoverageOutlook }) {
  const t = useT();
  const { lang } = useLang();
  if (outlook.kind === 'due_now') return <>{t('me.dueNow')}</>;
  if (outlook.kind === 'sessions_left') return <>{t('pay.sessionsLeft', { n: outlook.left })}</>;
  if (outlook.daysLeft > 100000) return <>{t('pay.unlimited')}</>;
  return <span className="text-lg">{formatDate(outlook.date, lang)}</span>;
}

function Gate({
  label,
  done,
  value,
  detail,
  pendingIcon = 'clock',
}: {
  label: string;
  done: boolean;
  value: number;
  detail?: string;
  pendingIcon?: IconName;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm text-ink">
          <Icon
            name={done ? 'check' : pendingIcon}
            className={cx('size-3.5', done ? 'text-good' : 'text-ink-muted')}
          />
          {label}
        </span>
        {detail && <span className="text-xs text-ink-muted">{detail}</span>}
      </div>
      <Meter value={value} tone={done ? 'good' : 'info'} label={label} />
    </div>
  );
}

function ScheduleCard({ schedule }: { schedule: Overview['schedule'] }) {
  const t = useT();
  const { lang } = useLang();

  // One row per slot, grouped by day, skipping groups with no slots yet.
  const byDay = useMemo(() => {
    const rows = schedule.filter((s) => s.weekday != null && s.start_time);
    const map = new Map<number, Overview['schedule']>();
    for (const r of rows) {
      const list = map.get(r.weekday!) ?? [];
      list.push(r);
      map.set(r.weekday!, list);
    }
    return [...map].sort((a, b) => a[0] - b[0]);
  }, [schedule]);

  const groupNames = useMemo(
    () => [...new Set(schedule.map((s) => s.name_ar))],
    [schedule],
  );

  return (
    <Card className="p-4">
      <SectionTitle hint={groupNames.length ? groupNames.join(' · ') : undefined}>
        {t('me.schedule')}
      </SectionTitle>

      {byDay.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('me.noSchedule')}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {byDay.map(([weekday, slots]) => (
            <li key={weekday} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="flex items-center gap-2 text-sm text-ink">
                <Icon name="calendar" className="size-4 text-ink-muted" />
                {t(`day.${weekday}` as 'day.0')}
              </span>
              <span className="flex flex-wrap justify-end gap-1.5">
                {slots.map((s, i) => (
                  <span
                    key={i}
                    className="tnum rounded-full bg-plane px-2.5 py-1 text-xs text-ink-soft"
                  >
                    {formatTime(s.start_time, lang)}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EditMySheet({
  member,
  onClose,
  onSaved,
}: {
  member: Member;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [nameAr, setNameAr] = useState(member.nameAr);
  const [phone, setPhone] = useState(member.phone ?? '');
  const [birthDate, setBirthDate] = useState(member.birthDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPhone, setConfirmPhone] = useState(false);

  const phoneChanged = phone.trim() !== (member.phone ?? '');

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{ loginChangedTo: string | null }>('/api/me/profile', {
        nameAr,
        phone: phone.trim() || undefined,
        birthDate: birthDate || null,
      });
      toast.show(
        res.loginChangedTo
          ? t('me.loginChanged', { login: res.loginChangedTo })
          : t('me.profileSaved'),
        'good',
      );
      onSaved();
    } catch (err) {
      const { key, vars } = errorKey(err);
      setError(t(key as 'err.generic', vars));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (busy) return;
    // Changing the phone changes the sign-in name, so it is confirmed rather
    // than slipped past.
    if (phoneChanged) setConfirmPhone(true);
    else void send();
  }

  if (confirmPhone) {
    return (
      <ConfirmSheet
        open
        onClose={() => setConfirmPhone(false)}
        onConfirm={() => {
          setConfirmPhone(false);
          void send();
        }}
        title={t('members.phone')}
        body={
          <div className="space-y-2">
            <p>{t('me.phoneWarning')}</p>
            <p className="tnum font-medium text-ink" dir="ltr">
              {phone}
            </p>
          </div>
        }
        confirmLabel={t('common.confirm')}
        tone="primary"
        busy={busy}
      />
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('me.editProfile')}
      footer={
        <Button variant="primary" size="lg" onClick={save} disabled={busy || !nameAr.trim()}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('members.name')}>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('members.phone')} hint={t('me.phoneWarning')} error={error ?? undefined}>
          <Input
            type="tel"
            inputMode="tel"
            dir="ltr"
            className="text-start"
            placeholder="05xxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label={t('members.birthDate')} hint={t('common.optional')}>
          <Input
            type="date"
            dir="ltr"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  );
}

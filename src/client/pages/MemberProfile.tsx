import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Belt, Member, MemberStatus, PaymentMethod } from '../../shared/types';
import type { Eligibility } from '../../shared/promotion';
import { BELTS } from '../../shared/types';
import { parseMoney } from '../../shared/billing';
import { today } from '../../shared/dates';
import { beltKey, methodKey, promoStatusKey, statusKey, useLang, useT } from '../i18n';
import { api, errorKey } from '../lib/api';
import { useApi } from '../lib/hooks';
import { formatDate, money } from '../lib/format';
import { isAdmin, useAuth } from '../auth';
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
  Segmented,
  Select,
  Sheet,
  Switch,
  Textarea,
  cx,
  useToast,
  type Tone,
} from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { BeltVisual } from '../components/BeltVisual';
import { AttendanceChart } from '../components/AttendanceChart';

interface Profile {
  member: Member;
  eligibility: Eligibility | null;
  rule: { maxStripes: number; nextBelt: Belt | null } | null;
  balance: { chargedMinor: number; paidMinor: number; outstandingMinor: number };
  promotions: {
    id: number;
    from_belt: Belt | null;
    from_stripes: number | null;
    to_belt: Belt;
    to_stripes: number;
    kind: string;
    promoted_on: string;
    note: string | null;
  }[];
  attendance: {
    id: number;
    status: string;
    coverage: string | null;
    date: string;
    class_type: string;
    technique_title: string | null;
  }[];
  legacyMonthly: { year: number; month: number; classes: number }[];
  purchases: {
    id: number;
    plan_name_ar: string;
    plan_type: string;
    amount_minor: number;
    sessions_total: number | null;
    sessions_used: number;
    valid_from: string;
    valid_until: string | null;
    status: string;
    paid_minor: number;
  }[];
  payments: {
    id: number;
    amount_minor: number;
    paid_on: string;
    method: PaymentMethod;
    note: string | null;
  }[];
}

const STATUS_TONE: Record<string, Tone> = {
  due: 'good',
  overdue: 'critical',
  upcoming: 'info',
  blocked_attendance: 'warning',
  blocked_age: 'warning',
  inactive: 'neutral',
  capped: 'neutral',
  not_due: 'neutral',
};

export function MemberProfile() {
  const { id } = useParams();
  const t = useT();
  const { lang } = useLang();
  const nav = useNavigate();
  const { user } = useAuth();
  const admin = isAdmin(user);

  const { data, error, loading, reload } = useApi<Profile>(id ? `/api/members/${id}` : null);
  const [tab, setTab] = useState<'overview' | 'billing' | 'history'>('overview');
  const [editing, setEditing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (!data) return null;

  const { member, eligibility, balance } = data;

  // Monthly series for the chart: the imported pre-2026 bucket plus every
  // month, recombined the same way the player's own view does it.
  const monthly = [
    ...data.legacyMonthly
      .filter((r) => r.year === 0)
      .map((r) => ({ period: 'earlier', classes: r.classes })),
    ...aggregateMonths(data),
  ];

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => nav('/members')} className="-ms-3">
        <Icon name="chevron" className="size-4 rotate-180 flip-rtl" />
        {t('common.back')}
      </Button>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-ink">{member.nameAr}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
              <Badge tone={member.status === 'active' ? 'good' : 'neutral'}>
                {t(statusKey(member.status))}
              </Badge>
              {member.phone && (
                <a
                  href={`tel:${member.phone}`}
                  className="tnum inline-flex items-center gap-1 text-ink-soft underline-offset-2 hover:underline"
                  dir="ltr"
                >
                  <Icon name="phone" className="size-3.5" />
                  {member.phone}
                </a>
              )}
            </p>
          </div>
          {admin && (
            <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          )}
        </div>

        <div className="mt-4">
          <BeltVisual belt={member.belt} stripes={member.stripes} size="lg" />
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3 text-center">
          <div>
            <dt className="text-xs text-ink-muted">{t('members.totalClasses')}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-ink">{member.totalClasses}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">{t('me.sinceLastPromotion')}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-ink">
              {eligibility?.classesSince ?? 0}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">{t('pay.outstanding')}</dt>
            <dd
              className={cx(
                'mt-0.5 text-lg font-semibold',
                balance.outstandingMinor > 0 ? 'text-ink' : 'text-ink-soft',
              )}
            >
              {money(balance.outstandingMinor)}
            </dd>
          </div>
        </dl>
      </Card>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: t('promo.title') },
          { value: 'billing', label: t('pay.title') },
          { value: 'history', label: t('members.history') },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-4">
          {eligibility && (
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <SectionTitle>{t('me.nextPromotion')}</SectionTitle>
                <Badge tone={STATUS_TONE[eligibility.status] ?? 'neutral'} icon="award">
                  {t(promoStatusKey(eligibility.status))}
                </Badge>
              </div>

              {eligibility.target !== 'none' ? (
                <>
                  <p className="mb-3 text-sm font-medium text-ink">
                    {eligibility.target === 'belt'
                      ? t('promo.nextBelt', { belt: t(beltKey(eligibility.targetBelt)) })
                      : t('promo.nextStripe', { n: eligibility.targetStripes })}
                  </p>

                  <GateRow
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
                      eligibility.eligibleOn
                        ? eligibility.timeGateMet
                          ? t('promo.eligibleSince', {
                              date: formatDate(eligibility.eligibleOn, lang),
                            })
                          : t('promo.eligibleOn', { date: formatDate(eligibility.eligibleOn, lang) })
                        : undefined
                    }
                  />

                  <GateRow
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

                  <Button
                    variant="primary"
                    size="lg"
                    icon="award"
                    className="mt-4"
                    onClick={() => setPromoting(true)}
                  >
                    {t('promo.award')}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-ink-soft">{t('promoStatus.capped')}</p>
              )}
            </Card>
          )}

          <div>
            <SectionTitle>{t('members.beltHistory')}</SectionTitle>
            {data.promotions.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-ink-muted">{t('me.noPromotionYet')}</p>
              </Card>
            ) : (
              <ul className="space-y-1.5">
                {data.promotions.map((p) => (
                  <Card as="li" key={p.id} className="flex items-center gap-3 p-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-series-tint text-ink">
                      <Icon name="award" className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        {t(beltKey(p.to_belt))}
                        {p.to_stripes > 0 ? ` · ${t('me.stripesCount', { n: p.to_stripes })}` : ''}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {formatDate(p.promoted_on, lang)}
                        {p.note ? ` · ${p.note}` : ''}
                      </p>
                    </div>
                  </Card>
                ))}
              </ul>
            )}
            {admin && data.promotions.some((p) => p.kind !== 'initial') && (
              <UndoPromotion memberId={member.id} onDone={reload} />
            )}
          </div>
        </div>
      )}

      {tab === 'billing' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" icon="plus" onClick={() => setSellOpen(true)}>
              {t('pay.sell')}
            </Button>
            <Button icon="coins" onClick={() => setPayOpen(true)}>
              {t('pay.collect')}
            </Button>
          </div>

          <div>
            <SectionTitle>{t('pay.purchases')}</SectionTitle>
            {data.purchases.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-ink-muted">{t('common.none')}</p>
              </Card>
            ) : (
              <ul className="space-y-1.5">
                {data.purchases.map((p) => {
                  const owed = p.amount_minor - p.paid_minor;
                  return (
                    <Card as="li" key={p.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{p.plan_name_ar}</p>
                          <p className="text-xs text-ink-muted">
                            {formatDate(p.valid_from, lang)}
                            {p.valid_until ? ` → ${formatDate(p.valid_until, lang)}` : ''}
                          </p>
                          <p className="mt-1 flex flex-wrap gap-1.5">
                            {p.sessions_total != null && (
                              <Badge tone={p.sessions_used >= p.sessions_total ? 'neutral' : 'info'}>
                                {p.sessions_total - p.sessions_used} / {p.sessions_total}
                              </Badge>
                            )}
                            {owed > 0 ? (
                              <Badge tone="warning" icon="coins">
                                {t('pay.paidOf', {
                                  paid: money(p.paid_minor),
                                  total: money(p.amount_minor),
                                })}
                              </Badge>
                            ) : (
                              <Badge tone="good" icon="check">
                                {money(p.amount_minor)}
                              </Badge>
                            )}
                          </p>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <SectionTitle>{t('pay.payments')}</SectionTitle>
            {data.payments.length === 0 ? (
              <Card className="p-4">
                <p className="text-sm text-ink-muted">{t('pay.never')}</p>
              </Card>
            ) : (
              <ul className="space-y-1.5">
                {data.payments.map((p) => (
                  <Card as="li" key={p.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{money(p.amount_minor)}</p>
                      <p className="text-xs text-ink-muted">
                        {formatDate(p.paid_on, lang)} · {t(methodKey(p.method))}
                        {p.note ? ` · ${p.note}` : ''}
                      </p>
                    </div>
                  </Card>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          <Card className="p-4">
            <AttendanceChart data={monthly} />
          </Card>

          <div>
            <SectionTitle>{t('members.recentAttendance')}</SectionTitle>
            <ul className="space-y-1.5">
              {data.attendance.map((a) => (
                <Card as="li" key={a.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{formatDate(a.date, lang)}</p>
                    {a.technique_title && (
                      <p className="truncate text-xs text-ink-muted">{a.technique_title}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Badge tone={a.status === 'present' || a.status === 'late' ? 'good' : 'neutral'}>
                      {t(`att.${a.status}` as 'att.present')}
                    </Badge>
                    {a.coverage === 'uncovered' && (
                      <Badge tone="warning" icon="alert">
                        {t('coverage.uncovered')}
                      </Badge>
                    )}
                  </div>
                </Card>
              ))}
            </ul>
          </div>
        </div>
      )}

      {admin && (
        <div className="border-t border-hairline pt-4">
          <SectionTitle>{t('members.createLogin')}</SectionTitle>
          <Card className="p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink-soft">
                {member.hasLogin
                  ? `${t('members.role')}: ${t(`role.${member.role ?? 'player'}` as 'role.player')}`
                  : t('members.noLogin')}
              </p>
              <Button size="sm" icon="key" onClick={() => setLoginOpen(true)}>
                {member.hasLogin ? t('members.resetPin') : t('members.createLogin')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {editing && (
        <EditMemberSheet
          member={member}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}

      {promoting && eligibility && (
        <PromoteSheet
          member={member}
          eligibility={eligibility}
          maxStripes={data.rule?.maxStripes ?? 4}
          onClose={() => setPromoting(false)}
          onDone={() => {
            setPromoting(false);
            reload();
          }}
        />
      )}

      {sellOpen && (
        <SellPlanSheet
          memberId={member.id}
          onClose={() => setSellOpen(false)}
          onDone={() => {
            setSellOpen(false);
            reload();
          }}
        />
      )}

      {payOpen && (
        <TakePaymentSheet
          memberId={member.id}
          suggestMinor={Math.max(0, balance.outstandingMinor)}
          onClose={() => setPayOpen(false)}
          onDone={() => {
            setPayOpen(false);
            reload();
          }}
        />
      )}

      {loginOpen && (
        <LoginSheet
          member={member}
          onClose={() => setLoginOpen(false)}
          onDone={() => {
            setLoginOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Rebuilds the per-month series from the imported rows plus recorded classes. */
function aggregateMonths(data: Profile): { period: string; classes: number }[] {
  const counts = new Map<string, number>();
  for (const r of data.legacyMonthly) {
    if (r.year === 0) continue;
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    counts.set(key, (counts.get(key) ?? 0) + r.classes);
  }
  for (const a of data.attendance) {
    if (a.status !== 'present' && a.status !== 'late') continue;
    const key = a.date.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([period, classes]) => ({ period, classes }));
}

function GateRow({
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

function UndoPromotion({ memberId, onDone }: { memberId: number; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function undo() {
    setBusy(true);
    try {
      await api.del(`/api/promotions/member/${memberId}/latest`);
      toast.show(t('common.save'), 'good');
      setOpen(false);
      onDone();
    } catch (err) {
      const { key, vars } = errorKey(err);
      toast.show(t(key as 'err.generic', vars), 'warning');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" icon="refresh" className="mt-2" onClick={() => setOpen(true)}>
        {t('promo.undo')}
      </Button>
      <ConfirmSheet
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={undo}
        title={t('promo.undo')}
        body={t('promo.undoConfirm')}
        confirmLabel={t('common.confirm')}
        busy={busy}
      />
    </>
  );
}

function PromoteSheet({
  member,
  eligibility,
  maxStripes,
  onClose,
  onDone,
}: {
  member: Member;
  eligibility: Eligibility;
  maxStripes: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const toast = useToast();

  const [custom, setCustom] = useState(false);
  const [belt, setBelt] = useState<Belt>(eligibility.targetBelt);
  const [stripes, setStripes] = useState(eligibility.targetStripes);
  const [date, setDate] = useState(() => today());
  const [awardedBy, setAwardedBy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsOverride, setNeedsOverride] = useState(false);

  async function submit(override: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/api/promotions/member/${member.id}`, {
        toBelt: belt,
        toStripes: stripes,
        promotedOn: date,
        awardedBy: awardedBy || null,
        note: note || null,
        override,
      });
      toast.show(t('promo.award'), 'good');
      onDone();
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (code.startsWith('not_eligible')) {
        setNeedsOverride(true);
      } else {
        const { key, vars } = errorKey(err);
        toast.show(t(key as 'err.generic', vars), 'warning');
      }
    } finally {
      setBusy(false);
    }
  }

  if (needsOverride) {
    return (
      <ConfirmSheet
        open
        onClose={() => setNeedsOverride(false)}
        onConfirm={() => {
          setNeedsOverride(false);
          void submit(true);
        }}
        title={t('promo.overrideTitle')}
        body={
          <div className="space-y-2">
            <p>{t('promo.overrideBody')}</p>
            {eligibility.classesShort > 0 && (
              <p className="font-medium text-ink">
                {t('promo.shortBy', { n: eligibility.classesShort })}
              </p>
            )}
            {!eligibility.timeGateMet && eligibility.eligibleOn && (
              <p className="font-medium text-ink">
                {t('promo.eligibleOn', { date: formatDate(eligibility.eligibleOn, lang) })}
              </p>
            )}
          </div>
        }
        confirmLabel={t('promo.overrideConfirm')}
        tone="primary"
        busy={busy}
      />
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('promo.award')}
      footer={
        <Button variant="primary" size="lg" icon="award" onClick={() => submit(false)} disabled={busy}>
          {busy ? t('common.saving') : t('promo.confirm')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="bg-plane p-3">
          <p className="text-xs text-ink-muted">{t('promo.suggested')}</p>
          <p className="text-sm font-medium text-ink">
            {eligibility.target === 'belt'
              ? t('promo.nextBelt', { belt: t(beltKey(eligibility.targetBelt)) })
              : t('promo.nextStripe', { n: eligibility.targetStripes })}
          </p>
        </Card>

        <Switch checked={custom} onChange={setCustom} label={t('promo.customTarget')} />
        <p className="text-xs text-ink-muted">{t('promo.multiStripe')}</p>

        {custom && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('promo.toBelt')}>
              <Select value={belt} onChange={(e) => setBelt(e.target.value as Belt)}>
                {BELTS.map((b) => (
                  <option key={b} value={b}>
                    {t(beltKey(b))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('promo.toStripes')}>
              <Select value={stripes} onChange={(e) => setStripes(Number(e.target.value))}>
                {Array.from({ length: maxStripes + 1 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <Field label={t('promo.date')}>
          <Input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('promo.awardedBy')} hint={t('common.optional')}>
          <Input value={awardedBy} onChange={(e) => setAwardedBy(e.target.value)} />
        </Field>
        <Field label={t('pay.note')} hint={t('common.optional')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function SellPlanSheet({
  memberId,
  onClose,
  onDone,
}: {
  memberId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const plansReq = useApi<{ plans: { id: number; name_ar: string; price_minor: number }[] }>(
    '/api/billing/plans',
  );
  const plans = plansReq.data?.plans ?? [];

  const [planId, setPlanId] = useState('');
  const [payNow, setPayNow] = useState(true);
  const [backfill, setBackfill] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState(false);

  const selected = plans.find((p) => String(p.id) === planId) ?? plans[0];

  async function submit() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ backfilled: number }>('/api/billing/purchases', {
        memberId,
        planId: selected.id,
        payNow,
        method,
        backfill,
      });
      toast.show(
        res.backfilled > 0 ? t('pay.backfilled', { n: res.backfilled }) : t('pay.record'),
        'good',
      );
      onDone();
    } catch (err) {
      const { key, vars } = errorKey(err);
      toast.show(t(key as 'err.generic', vars), 'warning');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('pay.sell')}
      footer={
        <Button variant="primary" size="lg" onClick={submit} disabled={busy || !selected}>
          {busy ? t('common.saving') : t('pay.record')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('pay.plan')}>
          <Select value={planId || String(selected?.id ?? '')} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name_ar} — {money(p.price_minor)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('pay.method')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(['cash', 'bank', 'wallet', 'other'] as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {t(methodKey(m))}
              </option>
            ))}
          </Select>
        </Field>
        <Switch checked={payNow} onChange={setPayNow} label={t('pay.payNow')} />
        <Switch checked={backfill} onChange={setBackfill} label={t('pay.backfill')} />
      </div>
    </Sheet>
  );
}

function TakePaymentSheet({
  memberId,
  suggestMinor,
  onClose,
  onDone,
}: {
  memberId: number;
  suggestMinor: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [amount, setAmount] = useState(() =>
    suggestMinor > 0 ? String(suggestMinor / 100) : '',
  );
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(() => today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const minor = parseMoney(amount);
    if (minor === null || minor <= 0) {
      setError(t('err.bad_amount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/billing/payments', {
        memberId,
        amountMinor: minor,
        method,
        paidOn,
        note: note || null,
      });
      toast.show(t('pay.record'), 'good');
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
      title={t('pay.collect')}
      footer={
        <Button variant="primary" size="lg" onClick={submit} disabled={busy}>
          {busy ? t('common.saving') : t('pay.record')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('pay.amount')} error={error ?? undefined}>
          <Input
            type="text"
            inputMode="decimal"
            dir="ltr"
            className="text-start"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label={t('pay.method')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(['cash', 'bank', 'wallet', 'other'] as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {t(methodKey(m))}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('pay.date')}>
          <Input type="date" dir="ltr" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label={t('pay.note')} hint={t('common.optional')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function EditMemberSheet({
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
  const [joinDate, setJoinDate] = useState(member.joinDate);
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [notes, setNotes] = useState(member.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/members/${member.id}`, {
        nameAr,
        phone: phone || null,
        birthDate: birthDate || null,
        joinDate,
        status,
        notes: notes || null,
      });
      toast.show(t('me.profileSaved'), 'good');
      onSaved();
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
      title={t('members.profile')}
      footer={
        <Button variant="primary" size="lg" onClick={save} disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('members.name')}>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <Field label={t('members.phone')}>
          <Input
            type="tel"
            dir="ltr"
            className="text-start"
            placeholder="05xxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('members.joinDate')}>
            <Input type="date" dir="ltr" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
          </Field>
          <Field label={t('members.birthDate')}>
            <Input
              type="date"
              dir="ltr"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('members.status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as MemberStatus)}>
            {(['active', 'inactive', 'paused'] as MemberStatus[]).map((s) => (
              <option key={s} value={s}>
                {t(statusKey(s))}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('members.notes')} hint={t('common.optional')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && (
          <p className="rounded-xl2 bg-critical-tint px-3 py-2 text-sm text-ink" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function LoginSheet({
  member,
  onClose,
  onDone,
}: {
  member: Member;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [login, setLogin] = useState(member.phone ?? '');
  const [role, setRole] = useState<'player' | 'coach' | 'admin'>(
    (member.role as 'player' | 'coach' | 'admin') ?? 'player',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ pin: string; login: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ pin: string; login: string }>(
        `/api/members/${member.id}/login`,
        { login, role },
      );
      setIssued(res);
    } catch (err) {
      const { key, vars } = errorKey(err);
      setError(t(key as 'err.generic', vars));
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <Sheet
        open
        onClose={() => {
          onDone();
          onClose();
        }}
        title={t('members.pinIssuedFor', { name: member.nameAr })}
        footer={
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              onDone();
              onClose();
            }}
          >
            {t('common.close')}
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="rounded-xl2 bg-warning-tint px-3 py-2 text-sm text-ink">
            {t('members.pinIssued')}
          </p>
          <Card className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-ink-muted">{t('login.phone')}</p>
              <p className="tnum text-sm font-medium text-ink" dir="ltr">
                {issued.login}
              </p>
              <p className="mt-2 text-xs text-ink-muted">{t('login.pin')}</p>
              <p className="tnum text-2xl font-semibold tracking-[0.2em] text-ink" dir="ltr">
                {issued.pin}
              </p>
            </div>
            <Button
              size="sm"
              icon={copied ? 'check' : 'edit'}
              onClick={() => {
                void navigator.clipboard?.writeText(issued.pin).then(() => setCopied(true));
              }}
            >
              {copied ? t('members.copied') : t('members.copyPin')}
            </Button>
          </Card>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={member.hasLogin ? t('members.resetPin') : t('members.createLogin')}
      footer={
        <Button variant="primary" size="lg" icon="key" onClick={submit} disabled={busy}>
          {busy ? t('common.saving') : t('common.confirm')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('login.phone')} error={error ?? undefined}>
          <Input
            type="tel"
            dir="ltr"
            className="text-start"
            placeholder="05xxxxxxxx"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </Field>
        <Field label={t('members.role')}>
          <Select value={role} onChange={(e) => setRole(e.target.value as 'player')}>
            {(['player', 'coach', 'admin'] as const).map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}` as 'role.player')}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

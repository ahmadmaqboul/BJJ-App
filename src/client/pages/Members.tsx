import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Belt, Member, MemberStatus } from '../../shared/types';
import type { Eligibility } from '../../shared/promotion';
import { today } from '../../shared/dates';
import { BELTS } from '../../shared/types';
import { beltKey, promoStatusKey, statusKey, subKey, useT } from '../i18n';
import type {
  SubscriptionState,
  SubscriptionStatus,
} from '../../shared/membership';
import { api, errorKey } from '../lib/api';
import { useApi, useDebounced } from '../lib/hooks';
import { money } from '../lib/format';
import {
  Badge,
  BeltBadge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Segmented,
  Select,
  Sheet,
  cx,
  useToast,
  type Tone,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { isAdmin, useAuth } from '../auth';

interface MemberRow extends Member {
  balance: { chargedMinor: number; paidMinor: number; outstandingMinor: number };
  eligibility: Eligibility | null;
  subscription: SubscriptionStatus;
  /** A month for imported history, a full date for recorded attendance. */
  lastSeen: string | null;
}

/** Subscription state → badge tone. Always paired with its label. */
const SUB_TONE: Record<SubscriptionState, Tone> = {
  subscribed: 'good',
  ending_soon: 'warning',
  expired: 'critical',
  never: 'neutral',
};

type Filter = 'active' | 'inactive' | 'paused' | 'all';

export function Members() {
  const t = useT();
  const nav = useNavigate();
  const { user } = useAuth();

  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 250);
  const [adding, setAdding] = useState(false);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (query.trim()) params.set('q', query.trim());
    return `/api/members?${params}`;
  }, [filter, query]);

  const { data, error, loading, reload } = useApi<{ members: MemberRow[] }>(path);
  const members = data?.members ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">{t('members.title')}</h1>
        {isAdmin(user) && (
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            {t('members.new')}
          </Button>
        )}
      </div>

      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-muted"
        />
        <Input
          className="ps-9"
          placeholder={t('members.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: t('status.active') },
          { value: 'inactive', label: t('status.inactive') },
          { value: 'paused', label: t('status.paused') },
          { value: 'all', label: t('members.all') },
        ]}
      />

      {loading && !data ? (
        <LoadingBlock />
      ) : error && !data ? (
        <ErrorBlock error={error} onRetry={reload} />
      ) : members.length === 0 ? (
        <EmptyState icon="users">{t('members.empty')}</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {members.map((m) => (
            <Card as="li" key={m.id} className="p-3">
              <button
                className="flex w-full items-center gap-3 text-start"
                onClick={() => nav(`/members/${m.id}`)}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{m.nameAr}</span>
                    {m.status !== 'active' && (
                      <Badge tone="neutral">{t(statusKey(m.status))}</Badge>
                    )}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5">
                    <BeltBadge belt={m.belt} stripes={m.stripes} />
                    <span className="tnum text-xs text-ink-muted">
                      {m.totalClasses} {t('members.classes')}
                    </span>
                    <Badge
                      tone={SUB_TONE[m.subscription.state]}
                      icon={m.subscription.state === 'subscribed' ? 'check' : 'coins'}
                    >
                      {t(subKey(m.subscription.state))}
                    </Badge>
                    {m.balance.outstandingMinor > 0 && (
                      <Badge tone="warning" icon="coins">
                        {money(m.balance.outstandingMinor)}
                      </Badge>
                    )}
                    {m.eligibility &&
                      (m.eligibility.status === 'due' || m.eligibility.status === 'overdue') && (
                        <Badge
                          tone={m.eligibility.status === 'overdue' ? 'critical' : 'good'}
                          icon="award"
                        >
                          {t(promoStatusKey(m.eligibility.status))}
                        </Badge>
                      )}
                    {!m.hasLogin && <Badge tone="neutral">{t('members.noLogin')}</Badge>}
                  </p>
                </div>
                <Icon name="chevron" className="size-4 shrink-0 flip-rtl text-ink-muted" />
              </button>
            </Card>
          ))}
        </ul>
      )}

      {adding && (
        <AddMemberSheet
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            nav(`/members/${id}`);
          }}
        />
      )}
    </div>
  );
}

function AddMemberSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const t = useT();
  const toast = useToast();

  const [nameAr, setNameAr] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [joinDate, setJoinDate] = useState(() => today());
  const [belt, setBelt] = useState<Belt>('white');
  const [stripes, setStripes] = useState(0);
  const [status, setStatus] = useState<MemberStatus>('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ member: { id: number } }>('/api/members', {
        nameAr,
        phone: phone || null,
        birthDate: birthDate || null,
        joinDate,
        belt,
        stripes,
        status,
      });
      toast.show(t('common.save'), 'good');
      onCreated(res.member.id);
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
      title={t('members.new')}
      footer={
        <Button variant="primary" size="lg" onClick={create} disabled={busy || !nameAr.trim()}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('members.name')}>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
        </Field>
        <Field label={t('members.phone')} hint={t('common.optional')}>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('members.joinDate')}>
            <Input type="date" dir="ltr" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
          </Field>
          <Field label={t('members.birthDate')} hint={t('common.optional')}>
            <Input type="date" dir="ltr" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('members.belt')}>
            <Select value={belt} onChange={(e) => setBelt(e.target.value as Belt)}>
              {BELTS.map((b) => (
                <option key={b} value={b}>
                  {t(beltKey(b))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('members.stripes')}>
            <Select value={stripes} onChange={(e) => setStripes(Number(e.target.value))}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
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

        {error && (
          <p className={cx('rounded-xl2 bg-critical-tint px-3 py-2 text-sm text-ink')} role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

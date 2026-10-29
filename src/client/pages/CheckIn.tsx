import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AttendanceStatus, Belt, ClassType, Coverage } from '../../shared/types';
import { coverageKey, useLang, useT } from '../i18n';
import { api, errorKey } from '../lib/api';
import { useApi, useDebounced, useOnline } from '../lib/hooks';
import { formatDate, formatTime, money, weekdayOf } from '../lib/format';
import {
  Badge,
  BeltBadge,
  Button,
  Card,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Select,
  Sheet,
  Switch,
  Textarea,
  cx,
  useToast,
  type Tone,
} from '../components/ui';
import { Icon, type IconName } from '../components/Icon';

interface RosterRow {
  memberId: number;
  nameAr: string;
  belt: Belt;
  stripes: number;
  memberStatus: string;
  status: AttendanceStatus | null;
  coverage: Coverage | null;
  purchaseId: number | null;
  preview: { coverage: Coverage; purchaseId: number | null; remainingAfter: number | null };
  outstandingMinor: number;
}

interface SessionDetail {
  session: {
    id: number;
    date: string;
    start_time: string | null;
    class_type: ClassType;
    group_id: number | null;
    technique_title: string | null;
    technique_notes: string | null;
    status: 'open' | 'closed';
  };
  roster: RosterRow[];
}

interface Plan {
  id: number;
  name_ar: string;
  type: 'monthly' | 'package' | 'single';
  price_minor: number;
  sessions_included: number | null;
}

/** Coverage → the tone and icon its badge wears. Never colour alone. */
const COVERAGE_TONE: Record<Coverage, { tone: Tone; icon: IconName }> = {
  monthly: { tone: 'good', icon: 'check' },
  package: { tone: 'good', icon: 'check' },
  single: { tone: 'good', icon: 'check' },
  free: { tone: 'info', icon: 'info' },
  uncovered: { tone: 'warning', icon: 'alert' },
};

const COUNTS = (s: AttendanceStatus | null) => s === 'present' || s === 'late';

export function CheckIn() {
  const { id } = useParams();
  const t = useT();
  const { lang } = useLang();
  const nav = useNavigate();
  const toast = useToast();
  const online = useOnline();

  const detail = useApi<SessionDetail>(id ? `/api/sessions/${id}` : null);
  const plansReq = useApi<{ plans: Plan[] }>('/api/billing/plans');

  /** Local edits, keyed by member. Absent from the map means "unchanged". */
  const [edits, setEdits] = useState<Map<number, AttendanceStatus>>(new Map());
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 200);
  const [saving, setSaving] = useState(false);
  const [sheetFor, setSheetFor] = useState<RosterRow | null>(null);
  const [editMeta, setEditMeta] = useState(false);

  // Reset local edits whenever a different session loads.
  useEffect(() => {
    setEdits(new Map());
  }, [id]);

  const roster = detail.data?.roster ?? [];
  const session = detail.data?.session;

  const effective = useMemo(() => {
    const map = new Map<number, AttendanceStatus | null>();
    for (const r of roster) map.set(r.memberId, edits.get(r.memberId) ?? r.status);
    return map;
  }, [roster, edits]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return roster;
    return roster.filter((r) => r.nameAr.includes(q) || String(r.memberId) === q);
  }, [roster, query]);

  const presentCount = useMemo(
    () => roster.filter((r) => COUNTS(effective.get(r.memberId) ?? null)).length,
    [roster, effective],
  );

  const dirtyCount = edits.size;

  function setStatus(memberId: number, status: AttendanceStatus) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(memberId, status);
      return next;
    });
  }

  function toggle(row: RosterRow) {
    const current = effective.get(row.memberId) ?? null;
    setStatus(row.memberId, COUNTS(current) ? 'absent' : 'present');
  }

  function markAll(status: AttendanceStatus) {
    setEdits((prev) => {
      const next = new Map(prev);
      for (const r of roster) next.set(r.memberId, status);
      return next;
    });
  }

  async function save() {
    if (!id || saving || !dirtyCount) return;
    setSaving(true);
    try {
      await api.post(`/api/sessions/${id}/attendance`, {
        entries: [...edits].map(([memberId, status]) => ({ memberId, status })),
      });
      setEdits(new Map());
      detail.reload();
      toast.show(t('checkin.saved'), 'good');
    } catch (err) {
      const { key, vars } = errorKey(err);
      // Edits are intentionally kept so nothing the coach tapped is lost; they
      // can hit save again once the connection is back.
      toast.show(t(key as 'err.generic', vars), 'warning');
    } finally {
      setSaving(false);
    }
  }

  if (detail.loading && !detail.data) return <LoadingBlock />;
  if (detail.error && !detail.data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />;
  if (!session) return null;

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={() => nav('/classes')} className="-ms-3 mb-1">
            <Icon name="chevron" className="size-4 rotate-180 flip-rtl" />
            {t('common.back')}
          </Button>
          <h1 className="text-lg font-semibold text-ink">{formatDate(session.date, lang)}</h1>
          <p className="text-xs text-ink-soft">
            {weekdayOf(session.date, lang)}
            {session.start_time ? ` · ${formatTime(session.start_time, lang)}` : ''}
            {' · '}
            {t(`classType.${session.class_type}` as 'classType.gi')}
          </p>
        </div>
        <Button size="sm" icon="edit" onClick={() => setEditMeta(true)}>
          {t('classes.technique')}
        </Button>
      </div>

      {session.technique_title && (
        <Card className="bg-series-tint p-3">
          <p className="text-xs text-ink-muted">{t('classes.technique')}</p>
          <p className="text-sm font-medium text-ink">{session.technique_title}</p>
          {session.technique_notes && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">
              {session.technique_notes}
            </p>
          )}
        </Card>
      )}

      {!online && (
        <Card className="flex items-center gap-2 bg-warning-tint p-3">
          <Icon name="wifiOff" className="size-4 shrink-0 text-ink" />
          <p className="text-sm text-ink">{t('checkin.offline')}</p>
        </Card>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-soft">
          {t('checkin.presentCount', { n: presentCount, total: roster.length })}
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => markAll('present')}>
            {t('checkin.allPresent')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => markAll('absent')}>
            {t('checkin.clear')}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-muted"
        />
        <Input
          className="ps-9"
          placeholder={t('checkin.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ul className="space-y-1.5">
        {filtered.map((row) => {
          const status = effective.get(row.memberId) ?? null;
          const counted = COUNTS(status);
          // Which entitlement applies: what is recorded if already saved,
          // otherwise what the server previews for a new check-in.
          const coverage = row.status && COUNTS(row.status) ? row.coverage : row.preview.coverage;
          const cov = coverage ? COVERAGE_TONE[coverage] : null;
          const dirty = edits.has(row.memberId);

          return (
            <Card
              as="li"
              key={row.memberId}
              className={cx('p-0 transition-colors', counted && 'bg-good-tint')}
            >
              <div className="flex items-stretch">
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 p-3 text-start"
                  onClick={() => toggle(row)}
                  aria-pressed={counted}
                >
                  <span
                    className={cx(
                      'grid size-9 shrink-0 place-items-center rounded-full ring-1',
                      counted
                        ? 'bg-good text-white ring-transparent'
                        : 'bg-plane text-ink-muted ring-hairline',
                    )}
                  >
                    <Icon name={counted ? 'check' : 'minus'} className="size-4" strokeWidth={2.5} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{row.nameAr}</span>
                      {dirty && <span className="size-1.5 shrink-0 rounded-full bg-series" />}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <BeltBadge belt={row.belt} stripes={row.stripes} />
                      {status && status !== 'present' && status !== 'absent' && (
                        <Badge tone="info">{t(`att.${status}` as 'att.late')}</Badge>
                      )}
                      {counted && cov && coverage && (
                        <Badge tone={cov.tone} icon={cov.icon}>
                          {t(coverageKey(coverage))}
                          {coverage === 'package' && row.preview.remainingAfter !== null
                            ? ` · ${row.preview.remainingAfter}`
                            : ''}
                        </Badge>
                      )}
                      {row.outstandingMinor > 0 && (
                        <Badge tone="warning" icon="coins">
                          {money(row.outstandingMinor)}
                        </Badge>
                      )}
                    </span>
                  </span>
                </button>

                <button
                  className="grid w-11 shrink-0 place-items-center border-s border-hairline text-ink-muted"
                  onClick={() => setSheetFor(row)}
                  aria-label={t('common.more')}
                >
                  <Icon name="list" className="size-4" />
                </button>
              </div>
            </Card>
          );
        })}
      </ul>

      {dirtyCount > 0 && (
        <div
          className="fixed inset-x-0 bottom-14 z-30 border-t border-hairline bg-surface px-4 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="flex-1 text-sm text-ink-soft">{t('checkin.unsaved', { n: dirtyCount })}</p>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? t('checkin.saving') : t('checkin.save')}
            </Button>
          </div>
        </div>
      )}

      {sheetFor && (
        <MemberSheet
          row={sheetFor}
          current={effective.get(sheetFor.memberId) ?? null}
          plans={plansReq.data?.plans ?? []}
          onStatus={(s) => {
            setStatus(sheetFor.memberId, s);
            setSheetFor(null);
          }}
          onClose={() => setSheetFor(null)}
          onCharged={() => {
            setSheetFor(null);
            detail.reload();
          }}
        />
      )}

      {editMeta && (
        <TechniqueSheet
          sessionId={session.id}
          title={session.technique_title ?? ''}
          notes={session.technique_notes ?? ''}
          onClose={() => setEditMeta(false)}
          onSaved={() => {
            setEditMeta(false);
            detail.reload();
          }}
        />
      )}
    </div>
  );
}

const STATUSES: AttendanceStatus[] = ['present', 'late', 'excused', 'absent'];

function MemberSheet({
  row,
  current,
  plans,
  onStatus,
  onClose,
  onCharged,
}: {
  row: RosterRow;
  current: AttendanceStatus | null;
  plans: Plan[];
  onStatus: (s: AttendanceStatus) => void;
  onClose: () => void;
  onCharged: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [planId, setPlanId] = useState<string>(() => String(plans[0]?.id ?? ''));
  const [payNow, setPayNow] = useState(true);
  const [backfill, setBackfill] = useState(true);
  const [busy, setBusy] = useState(false);

  const uncovered = row.preview.coverage === 'uncovered';

  async function charge() {
    if (!planId || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ backfilled: number }>('/api/billing/purchases', {
        memberId: row.memberId,
        planId: Number(planId),
        payNow,
        method: 'cash',
        backfill,
      });
      toast.show(
        res.backfilled > 0 ? t('pay.backfilled', { n: res.backfilled }) : t('checkin.saved'),
        'good',
      );
      onCharged();
    } catch (err) {
      const { key, vars } = errorKey(err);
      toast.show(t(key as 'err.generic', vars), 'warning');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={row.nameAr}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          {STATUSES.map((s) => (
            <Button
              key={s}
              variant={current === s ? 'primary' : 'secondary'}
              onClick={() => onStatus(s)}
            >
              {t(`att.${s}` as 'att.present')}
            </Button>
          ))}
        </div>

        <div className="border-t border-hairline pt-4">
          <p className="mb-1 text-sm font-semibold text-ink-soft">{t('pay.coverage')}</p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge
              tone={COVERAGE_TONE[row.preview.coverage].tone}
              icon={COVERAGE_TONE[row.preview.coverage].icon}
            >
              {t(coverageKey(row.preview.coverage))}
            </Badge>
            {row.outstandingMinor > 0 && (
              <Badge tone="warning" icon="coins">
                {t('pay.outstanding')}: {money(row.outstandingMinor)}
              </Badge>
            )}
          </div>

          {uncovered && plans.length > 0 && (
            <div className="space-y-3">
              <Field label={t('pay.plan')}>
                <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name_ar} — {money(p.price_minor)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Switch checked={payNow} onChange={setPayNow} label={t('pay.payNow')} />
              <Switch checked={backfill} onChange={setBackfill} label={t('pay.backfill')} />
              <Button variant="primary" size="lg" icon="coins" onClick={charge} disabled={busy}>
                {busy ? t('common.saving') : t('checkin.charge')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function TechniqueSheet({
  sessionId,
  title,
  notes,
  onClose,
  onSaved,
}: {
  sessionId: number;
  title: string;
  notes: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [techniqueTitle, setTitle] = useState(title);
  const [techniqueNotes, setNotes] = useState(notes);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/api/sessions/${sessionId}`, { techniqueTitle, techniqueNotes });
      onSaved();
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
      title={t('classes.technique')}
      footer={
        <Button variant="primary" size="lg" onClick={save} disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('classes.technique')}>
          <Input
            value={techniqueTitle}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('classes.techniquePlaceholder')}
          />
        </Field>
        <Field label={t('classes.notes')} hint={t('common.optional')}>
          <Textarea value={techniqueNotes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

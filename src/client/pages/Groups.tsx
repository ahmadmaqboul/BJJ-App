import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Belt, ClassType, Member } from '../../shared/types';
import { today } from '../../shared/dates';
import { useLang, useT } from '../i18n';
import { api, errorKey } from '../lib/api';
import { useApi } from '../lib/hooks';
import { formatTime } from '../lib/format';
import { isAdmin, useAuth } from '../auth';
import {
  Badge,
  BeltBadge,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Select,
  Sheet,
  cx,
  useToast,
} from '../components/ui';
import { Icon } from '../components/Icon';

interface Slot {
  id?: number;
  weekday: number;
  start_time: string;
  duration_minutes: number;
}

interface GroupRow {
  id: number;
  name_ar: string;
  name_en: string | null;
  class_type: ClassType;
  location: string | null;
  active: number;
  coach_name: string | null;
  slots: Slot[];
  activeMemberCount: number;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const CLASS_TYPES: ClassType[] = ['gi', 'nogi', 'open_mat', 'kids', 'seminar'];

export function Groups() {
  const t = useT();
  const { lang } = useLang();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const admin = isAdmin(user);

  const { data, error, loading, reload } = useApi<{ groups: GroupRow[] }>('/api/groups');
  const [creating, setCreating] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<GroupRow | null>(null);
  const [rosterFor, setRosterFor] = useState<GroupRow | null>(null);
  const [deleting, setDeleting] = useState<GroupRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function startClass(group: GroupRow) {
    try {
      const res = await api.post<{ session: { id: number } }>('/api/sessions', {
        date: today(),
        groupId: group.id,
        startTime: group.slots[0]?.start_time ?? null,
      });
      nav(`/classes/${res.session.id}`);
    } catch (err) {
      const { key, vars } = errorKey(err);
      toast.show(t(key as 'err.generic', vars), 'warning');
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/groups/${deleting.id}`);
      setDeleting(null);
      reload();
    } catch (err) {
      const { key, vars } = errorKey(err);
      toast.show(t(key as 'err.generic', vars), 'warning');
    } finally {
      setBusy(false);
    }
  }

  const groups = data?.groups ?? [];

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => nav('/')} className="-ms-3">
          <Icon name="chevron" className="size-4 rotate-180 flip-rtl" />
          {t('common.back')}
        </Button>
        {admin && (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t('groups.new')}
          </Button>
        )}
      </div>

      <h1 className="text-lg font-semibold text-ink">{t('groups.title')}</h1>

      {groups.length === 0 ? (
        <EmptyState icon="list">{t('groups.empty')}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <Card as="li" key={g.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{g.name_ar}</span>
                    {!g.active && <Badge tone="neutral">{t('groups.inactive')}</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t(`classType.${g.class_type}` as 'classType.gi')}
                    {g.location ? ` · ${g.location}` : ''}
                    {g.coach_name ? ` · ${g.coach_name}` : ''}
                  </p>
                </div>
                <Badge tone="info" icon="users">
                  {g.activeMemberCount}
                </Badge>
              </div>

              <div className="mt-3">
                {g.slots.length === 0 ? (
                  <p className="text-xs text-ink-muted">{t('groups.noSlots')}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {g.slots.map((s) => (
                      <li
                        key={`${s.weekday}-${s.start_time}`}
                        className="flex items-center gap-1.5 rounded-full bg-plane px-2.5 py-1 text-xs text-ink-soft"
                      >
                        <Icon name="calendar" className="size-3.5 text-ink-muted" />
                        {t(`day.${s.weekday}` as 'day.0')}
                        <span className="tnum">{formatTime(s.start_time, lang)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-hairline pt-3">
                <Button size="sm" variant="primary" icon="plus" onClick={() => startClass(g)}>
                  {t('groups.startClass')}
                </Button>
                {admin && (
                  <>
                    <Button size="sm" icon="calendar" onClick={() => setScheduleFor(g)}>
                      {t('groups.schedule')}
                    </Button>
                    <Button size="sm" icon="users" onClick={() => setRosterFor(g)}>
                      {t('groups.editRoster')}
                    </Button>
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(g)}>
                      {t('common.delete')}
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </ul>
      )}

      {creating && (
        <CreateGroupSheet
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            reload();
          }}
        />
      )}

      {scheduleFor && (
        <ScheduleSheet
          group={scheduleFor}
          onClose={() => setScheduleFor(null)}
          onDone={() => {
            setScheduleFor(null);
            reload();
          }}
        />
      )}

      {rosterFor && (
        <RosterSheet
          group={rosterFor}
          onClose={() => setRosterFor(null)}
          onDone={() => {
            setRosterFor(null);
            reload();
          }}
        />
      )}

      <ConfirmSheet
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={t('common.delete')}
        body={t('groups.deleteConfirm')}
        confirmLabel={t('common.delete')}
        busy={busy}
      />
    </div>
  );
}

function CreateGroupSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [nameAr, setNameAr] = useState('');
  const [classType, setClassType] = useState<ClassType>('gi');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/groups', { nameAr, classType, location: location || null });
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
      title={t('groups.new')}
      footer={
        <Button variant="primary" size="lg" onClick={submit} disabled={busy || !nameAr.trim()}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('groups.name')} error={error ?? undefined}>
          <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
        </Field>
        <Field label={t('classes.type')}>
          <Select value={classType} onChange={(e) => setClassType(e.target.value as ClassType)}>
            {CLASS_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {t(`classType.${ct}` as 'classType.gi')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('groups.location')} hint={t('common.optional')}>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function ScheduleSheet({
  group,
  onClose,
  onDone,
}: {
  group: GroupRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [slots, setSlots] = useState<Slot[]>(() =>
    group.slots.map((s) => ({ ...s })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function add() {
    setSlots((all) => [...all, { weekday: 0, start_time: '19:00', duration_minutes: 90 }]);
  }

  function update(i: number, patch: Partial<Slot>) {
    setSlots((all) => all.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/groups/${group.id}/slots`, {
        slots: slots.map((s) => ({
          weekday: s.weekday,
          startTime: s.start_time,
          durationMinutes: s.duration_minutes,
        })),
      });
      toast.show(t('groups.savedSchedule'), 'good');
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
      title={t('groups.schedule')}
      footer={
        <Button variant="primary" size="lg" onClick={save} disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-ink-muted">{t('groups.forGroup', { name: group.name_ar })}</p>

        {slots.map((s, i) => (
          <Card key={i} className="p-3">
            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
              <Field label={t('classes.date')}>
                <Select
                  value={s.weekday}
                  onChange={(e) => update(i, { weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {t(`day.${d}` as 'day.0')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('classes.time')}>
                <Input
                  type="time"
                  dir="ltr"
                  className="w-28"
                  value={s.start_time}
                  onChange={(e) => update(i, { start_time: e.target.value })}
                />
              </Field>
              <Button
                variant="ghost"
                icon="trash"
                aria-label={t('groups.removeSlot')}
                onClick={() => setSlots((all) => all.filter((_, idx) => idx !== i))}
              />
            </div>
          </Card>
        ))}

        <Button icon="plus" onClick={add}>
          {t('groups.addSlot')}
        </Button>

        {error && (
          <p className="rounded-xl2 bg-critical-tint px-3 py-2 text-sm text-ink" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function RosterSheet({
  group,
  onClose,
  onDone,
}: {
  group: GroupRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const all = useApi<{ members: Member[] }>('/api/members?status=all');
  const current = useApi<{ members: { id: number }[] }>(`/api/groups/${group.id}/members`);

  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the selection from the server once both requests land.
  const effective = useMemo(() => {
    if (selected) return selected;
    if (current.data) return new Set(current.data.members.map((m) => m.id));
    return new Set<number>();
  }, [selected, current.data]);

  const members = all.data?.members ?? [];

  function toggle(id: number) {
    const next = new Set(effective);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await api.put(`/api/groups/${group.id}/members`, { memberIds: [...effective] });
      toast.show(t('groups.savedRoster'), 'good');
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
      title={t('groups.members')}
      footer={
        <Button variant="primary" size="lg" onClick={save} disabled={busy}>
          {busy ? t('common.saving') : t('common.save')} · {effective.size}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => setSelected(new Set(members.filter((m) => m.status === 'active').map((m) => m.id)))}
          >
            {t('groups.selectAll')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('groups.clearAll')}
          </Button>
        </div>

        {all.loading || current.loading ? (
          <LoadingBlock />
        ) : (
          <ul className="space-y-1">
            {members.map((m) => {
              const on = effective.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    className={cx(
                      'flex w-full items-center gap-3 rounded-xl2 p-2.5 text-start ring-1 transition-colors',
                      on ? 'bg-good-tint ring-transparent' : 'bg-surface ring-hairline',
                    )}
                    onClick={() => toggle(m.id)}
                    aria-pressed={on}
                  >
                    <span
                      className={cx(
                        'grid size-7 shrink-0 place-items-center rounded-full ring-1',
                        on ? 'bg-good text-white ring-transparent' : 'bg-plane text-ink-muted ring-hairline',
                      )}
                    >
                      <Icon name={on ? 'check' : 'minus'} className="size-3.5" strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.nameAr}</span>
                    <BeltBadge belt={m.belt as Belt} stripes={m.stripes} />
                    {m.status !== 'active' && <Badge tone="neutral">{t('status.inactive')}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

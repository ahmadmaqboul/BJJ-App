import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClassType } from '../../shared/types';
import { today } from '../../shared/dates';
import { useLang, useT } from '../i18n';
import { api, errorKey } from '../lib/api';
import { useApi } from '../lib/hooks';
import { formatDate, formatTime, weekdayOf } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Select,
  Sheet,
  Textarea,
} from '../components/ui';
import { Icon } from '../components/Icon';

interface SessionRow {
  id: number;
  date: string;
  start_time: string | null;
  class_type: ClassType;
  group_id: number | null;
  technique_title: string | null;
  status: 'open' | 'closed';
  present_count: number;
  attendee_count: number;
  uncovered_count: number;
}

interface GroupRow {
  id: number;
  name_ar: string;
  class_type: ClassType;
  active: number;
}

const CLASS_TYPES: ClassType[] = ['gi', 'nogi', 'open_mat', 'kids', 'seminar'];

export function Classes() {
  const t = useT();
  const { lang } = useLang();
  const nav = useNavigate();

  const sessions = useApi<{ sessions: SessionRow[] }>('/api/sessions?limit=60');
  const groups = useApi<{ groups: GroupRow[] }>('/api/groups');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(() => today());
  const [startTime, setStartTime] = useState('19:00');
  const [classType, setClassType] = useState<ClassType>('gi');
  const [groupId, setGroupId] = useState<string>('');
  const [technique, setTechnique] = useState('');
  const [notes, setNotes] = useState('');

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ session: { id: number }; existed?: boolean }>('/api/sessions', {
        date,
        startTime: startTime || null,
        classType,
        groupId: groupId ? Number(groupId) : null,
        techniqueTitle: technique || null,
        techniqueNotes: notes || null,
      });
      setOpen(false);
      setTechnique('');
      setNotes('');
      nav(`/classes/${res.session.id}`);
    } catch (err) {
      const { key, vars } = errorKey(err);
      setError(t(key as 'err.generic', vars));
    } finally {
      setBusy(false);
    }
  }

  const list = sessions.data?.sessions ?? [];
  const activeGroups = (groups.data?.groups ?? []).filter((g) => g.active);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">{t('classes.title')}</h1>
        <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
          {t('classes.new')}
        </Button>
      </div>

      {sessions.loading && !sessions.data ? (
        <LoadingBlock />
      ) : sessions.error && !sessions.data ? (
        <ErrorBlock error={sessions.error} onRetry={sessions.reload} />
      ) : list.length === 0 ? (
        <EmptyState icon="calendar" action={<Button icon="plus" onClick={() => setOpen(true)}>{t('classes.new')}</Button>}>
          {t('classes.empty')}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <Card as="li" key={s.id} className="p-3">
              <button
                className="flex w-full items-center justify-between gap-3 text-start"
                onClick={() => nav(`/classes/${s.id}`)}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    {formatDate(s.date, lang)}
                    {s.start_time && (
                      <span className="tnum text-xs text-ink-muted">
                        {formatTime(s.start_time, lang)}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-soft">
                    <span className="text-ink-muted">{weekdayOf(s.date, lang)}</span>
                    {' · '}
                    {t(`classType.${s.class_type}` as 'classType.gi')}
                    {s.technique_title ? ` · ${s.technique_title}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {s.uncovered_count > 0 && (
                    <Badge tone="warning" icon="alert" title={t('dash.uncovered')}>
                      {s.uncovered_count}
                    </Badge>
                  )}
                  <Badge tone={s.present_count > 0 ? 'info' : 'neutral'}>
                    {s.present_count} {t('classes.present')}
                  </Badge>
                  {s.status === 'closed' && <Badge tone="neutral">{t('classes.closed')}</Badge>}
                  <Icon name="chevron" className="size-4 flip-rtl text-ink-muted" />
                </div>
              </button>
            </Card>
          ))}
        </ul>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('classes.new')}
        footer={
          <Button variant="primary" size="lg" onClick={create} disabled={busy}>
            {busy ? t('common.saving') : t('classes.create')}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('classes.date')}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
            </Field>
            <Field label={t('classes.time')}>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                dir="ltr"
              />
            </Field>
          </div>

          {activeGroups.length > 0 && (
            <Field label={t('groups.title')} hint={t('common.optional')}>
              <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">{t('groups.none')}</option>
                {activeGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label={t('classes.type')}>
            <Select value={classType} onChange={(e) => setClassType(e.target.value as ClassType)}>
              {CLASS_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {t(`classType.${ct}` as 'classType.gi')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('classes.technique')} hint={t('common.optional')}>
            <Input
              value={technique}
              onChange={(e) => setTechnique(e.target.value)}
              placeholder={t('classes.techniquePlaceholder')}
            />
          </Field>

          <Field label={t('classes.notes')} hint={t('common.optional')}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {error && (
            <p className="rounded-xl2 bg-critical-tint px-3 py-2 text-sm text-ink" role="alert">
              {error}
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}

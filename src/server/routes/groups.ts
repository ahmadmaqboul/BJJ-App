import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ClassType } from '../../shared/types';
import type { AppBindings } from '../env';
import { audit, requireAdmin, requireStaff } from '../middleware';
import { readJson } from '../http';

const groups = new Hono<AppBindings>();

const CLASS_TYPES: ClassType[] = ['gi', 'nogi', 'open_mat', 'kids', 'seminar'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface SlotInput {
  weekday?: number;
  startTime?: string;
  durationMinutes?: number;
}

groups.use('*', requireStaff);

/** Groups with their weekly slots and roster size. */
groups.get('/', async (c) => {
  const [list, slots, counts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT g.*, m.name_ar AS coach_name
         FROM training_groups g
         LEFT JOIN members m ON m.id = g.coach_member_id
        ORDER BY g.active DESC, g.sort_order, g.id`,
    ).all(),
    c.env.DB.prepare(
      `SELECT * FROM group_slots ORDER BY group_id, weekday, start_time`,
    ).all<{ id: number; group_id: number; weekday: number; start_time: string; duration_minutes: number }>(),
    c.env.DB.prepare(
      `SELECT gm.group_id, COUNT(*) AS n
         FROM group_members gm
         JOIN members mm ON mm.id = gm.member_id AND mm.status = 'active'
        GROUP BY gm.group_id`,
    ).all<{ group_id: number; n: number }>(),
  ]);

  const slotsByGroup = new Map<number, typeof slots.results>();
  for (const s of slots.results ?? []) {
    const arr = slotsByGroup.get(s.group_id) ?? [];
    arr.push(s);
    slotsByGroup.set(s.group_id, arr);
  }
  const countByGroup = new Map((counts.results ?? []).map((r) => [r.group_id, r.n]));

  return c.json({
    groups: (list.results ?? []).map((g) => {
      const row = g as { id: number };
      return {
        ...g,
        slots: slotsByGroup.get(row.id) ?? [],
        activeMemberCount: countByGroup.get(row.id) ?? 0,
      };
    }),
  });
});

groups.post('/', requireAdmin, async (c) => {
  const b = await readJson<{
    nameAr: string;
    nameEn: string;
    classType: ClassType;
    coachMemberId: number | null;
    location: string;
    notes: string;
    sortOrder: number;
  }>(c.req);

  const nameAr = b.nameAr?.trim();
  if (!nameAr) throw new HTTPException(400, { message: 'name_required' });

  const row = await c.env.DB.prepare(
    `INSERT INTO training_groups (name_ar, name_en, class_type, coach_member_id, location, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      nameAr,
      b.nameEn?.trim() || null,
      b.classType && CLASS_TYPES.includes(b.classType) ? b.classType : 'gi',
      b.coachMemberId ?? null,
      b.location?.trim() || null,
      b.notes?.trim() || null,
      b.sortOrder ?? 100,
    )
    .first<{ id: number }>();

  await audit(c, 'group.create', 'training_group', row!.id, { nameAr });
  return c.json({ group: row }, 201);
});

groups.patch('/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const b = await readJson<{
    nameAr: string;
    nameEn: string | null;
    classType: ClassType;
    coachMemberId: number | null;
    location: string | null;
    notes: string | null;
    active: boolean;
    sortOrder: number;
  }>(c.req);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(v);
  };

  if (b.nameAr !== undefined) {
    if (!b.nameAr.trim()) throw new HTTPException(400, { message: 'name_required' });
    put('name_ar', b.nameAr.trim());
  }
  if (b.nameEn !== undefined) put('name_en', b.nameEn?.trim() || null);
  if (b.classType !== undefined) {
    if (!CLASS_TYPES.includes(b.classType)) throw new HTTPException(400, { message: 'bad_type' });
    put('class_type', b.classType);
  }
  if (b.coachMemberId !== undefined) put('coach_member_id', b.coachMemberId);
  if (b.location !== undefined) put('location', b.location?.trim() || null);
  if (b.notes !== undefined) put('notes', b.notes?.trim() || null);
  if (b.active !== undefined) put('active', b.active ? 1 : 0);
  if (b.sortOrder !== undefined) put('sort_order', b.sortOrder);

  if (!sets.length) throw new HTTPException(400, { message: 'nothing_to_update' });

  binds.push(id);
  const res = await c.env.DB.prepare(`UPDATE training_groups SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'group_not_found' });

  await audit(c, 'group.update', 'training_group', id, b);
  return c.json({
    group: await c.env.DB.prepare(`SELECT * FROM training_groups WHERE id = ?`).bind(id).first(),
  });
});

/**
 * Replaces a group's weekly slots wholesale — editing a schedule is always
 * "here is the new week", never a patch over individual rows.
 */
groups.put('/:id/slots', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const b = await readJson<{ slots: SlotInput[] }>(c.req);
  const slots = b.slots ?? [];

  for (const s of slots) {
    if (!Number.isInteger(s.weekday) || s.weekday! < 0 || s.weekday! > 6) {
      throw new HTTPException(400, { message: 'bad_weekday' });
    }
    if (!s.startTime || !TIME_RE.test(s.startTime)) {
      throw new HTTPException(400, { message: 'bad_start_time' });
    }
    if (s.durationMinutes !== undefined && (!Number.isInteger(s.durationMinutes) || s.durationMinutes < 15)) {
      throw new HTTPException(400, { message: 'bad_duration' });
    }
  }

  // Reject a duplicate day+time inside the submitted set before touching the
  // database, so the unique index never has to be the error message.
  const seen = new Set(slots.map((s) => `${s.weekday}@${s.startTime}`));
  if (seen.size !== slots.length) throw new HTTPException(400, { message: 'duplicate_slot' });

  const exists = await c.env.DB.prepare(`SELECT id FROM training_groups WHERE id = ?`)
    .bind(id)
    .first();
  if (!exists) throw new HTTPException(404, { message: 'group_not_found' });

  const statements = [c.env.DB.prepare(`DELETE FROM group_slots WHERE group_id = ?`).bind(id)];
  for (const s of slots) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO group_slots (group_id, weekday, start_time, duration_minutes) VALUES (?, ?, ?, ?)`,
      ).bind(id, s.weekday, s.startTime, s.durationMinutes ?? 60),
    );
  }
  await c.env.DB.batch(statements);

  await audit(c, 'group.slots', 'training_group', id, { count: slots.length });
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM group_slots WHERE group_id = ? ORDER BY weekday, start_time`,
  )
    .bind(id)
    .all();
  return c.json({ slots: results ?? [] });
});

groups.get('/:id/members', async (c) => {
  const id = Number(c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.name_ar, m.status, m.belt, m.stripes, gm.joined_on
       FROM group_members gm
       JOIN members m ON m.id = gm.member_id
      WHERE gm.group_id = ?
      ORDER BY m.status = 'active' DESC, m.name_ar COLLATE NOCASE`,
  )
    .bind(id)
    .all();
  return c.json({ members: results ?? [] });
});

/** Sets a group's roster. Sending the full list keeps the UI a single save. */
groups.put('/:id/members', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const b = await readJson<{ memberIds: number[] }>(c.req);
  const ids = [...new Set((b.memberIds ?? []).filter((x) => Number.isInteger(x)))];

  const exists = await c.env.DB.prepare(`SELECT id FROM training_groups WHERE id = ?`)
    .bind(id)
    .first();
  if (!exists) throw new HTTPException(404, { message: 'group_not_found' });

  const statements = [c.env.DB.prepare(`DELETE FROM group_members WHERE group_id = ?`).bind(id)];
  for (const memberId of ids) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO group_members (group_id, member_id) VALUES (?, ?)
         ON CONFLICT(group_id, member_id) DO NOTHING`,
      ).bind(id, memberId),
    );
  }
  await c.env.DB.batch(statements);

  await audit(c, 'group.members', 'training_group', id, { count: ids.length });
  return c.json({ count: ids.length });
});

groups.delete('/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  // Classes already recorded against the group keep their history; the
  // foreign key nulls the link rather than deleting attendance.
  const res = await c.env.DB.prepare(`DELETE FROM training_groups WHERE id = ?`).bind(id).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'group_not_found' });
  await audit(c, 'group.delete', 'training_group', id);
  return c.json({ ok: true });
});

export default groups;

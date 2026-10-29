-- Training groups.
--
-- The team runs more than one weekly session and not every member attends all
-- of them, so a group carries its own recurring day/time slots and its own
-- roster. A class session can be linked to a group, which is what narrows the
-- check-in list from "everyone active" to "the people in this group".

CREATE TABLE training_groups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar         TEXT    NOT NULL,
  name_en         TEXT,
  class_type      TEXT    NOT NULL DEFAULT 'gi'
                          CHECK (class_type IN ('gi','nogi','open_mat','kids','seminar')),
  coach_member_id INTEGER          REFERENCES members(id) ON DELETE SET NULL,
  location        TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Recurring weekly slots. weekday follows JS getDay(): 0 = Sunday .. 6 = Saturday,
-- which is also what the existing `class_week_days` setting stores.
CREATE TABLE group_slots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id         INTEGER NOT NULL REFERENCES training_groups(id) ON DELETE CASCADE,
  weekday          INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time       TEXT    NOT NULL,            -- 'HH:MM' local gym time
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  UNIQUE (group_id, weekday, start_time)
);

CREATE INDEX group_slots_group ON group_slots(group_id);

CREATE TABLE group_members (
  group_id  INTEGER NOT NULL REFERENCES training_groups(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  joined_on TEXT    NOT NULL DEFAULT (date('now')),
  PRIMARY KEY (group_id, member_id)
);

CREATE INDEX group_members_member ON group_members(member_id);

ALTER TABLE class_sessions ADD COLUMN group_id INTEGER REFERENCES training_groups(id) ON DELETE SET NULL;

CREATE INDEX class_sessions_group ON class_sessions(group_id);

-- The group the team already runs: two evenings a week, which is where the
-- sheet's "الحصة الأولى (أ)" / "الحصة الثانية (ث)" and its 8-slots-a-month
-- layout come from. Every active member starts in it.
INSERT INTO training_groups (id, name_ar, name_en, class_type, active, sort_order)
VALUES (1, 'المجموعة الأساسية', 'Main group', 'gi', 1, 10);

INSERT INTO group_slots (group_id, weekday, start_time, duration_minutes) VALUES
  (1, 0, '19:00', 90),   -- الأحد
  (1, 2, '19:00', 90);   -- الثلاثاء

INSERT INTO group_members (group_id, member_id, joined_on)
SELECT 1, id, join_date FROM members WHERE status = 'active';

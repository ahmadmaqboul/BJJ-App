-- JUI-Jitsu initial schema
-- Dates are stored as ISO-8601 text ('YYYY-MM-DD' for days, full timestamps
-- for audit trails). Money is stored in minor units (agorot) as INTEGER to
-- avoid float rounding on balances.

------------------------------------------------------------------- members ---

CREATE TABLE members (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar                   TEXT    NOT NULL,
  name_en                   TEXT,
  phone                     TEXT,
  telegram_user_id          TEXT,
  birth_date                TEXT,
  gender                    TEXT             CHECK (gender IN ('male','female')),
  join_date                 TEXT    NOT NULL,
  status                    TEXT    NOT NULL DEFAULT 'active'
                                             CHECK (status IN ('active','inactive','paused')),
  status_changed_on         TEXT,
  belt                      TEXT    NOT NULL DEFAULT 'white'
                                             CHECK (belt IN ('white','blue','purple','brown','black')),
  stripes                   INTEGER NOT NULL DEFAULT 0 CHECK (stripes BETWEEN 0 AND 4),
  last_promotion_date       TEXT,
  -- Attendance carried over from the Google Sheet, which has no per-session
  -- detail. Total classes = legacy_attendance + COUNT(attendance present/late).
  legacy_attendance         INTEGER NOT NULL DEFAULT 0,
  -- Total-class count as it stood at the last promotion, so "classes since
  -- promotion" works for members imported mid-cycle.
  classes_at_last_promotion INTEGER NOT NULL DEFAULT 0,
  notes                     TEXT,
  created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX members_phone_unique ON members(phone) WHERE phone IS NOT NULL;
CREATE INDEX members_status ON members(status);

--------------------------------------------------------------------- users ---

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       INTEGER          REFERENCES members(id) ON DELETE CASCADE,
  login           TEXT    NOT NULL UNIQUE,  -- normalised phone number
  role            TEXT    NOT NULL DEFAULT 'player'
                                   CHECK (role IN ('admin','coach','player')),
  pin_hash        TEXT    NOT NULL,
  pin_salt        TEXT    NOT NULL,
  pin_iterations  INTEGER NOT NULL DEFAULT 100000,
  must_change_pin INTEGER NOT NULL DEFAULT 1,
  disabled        INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX users_member ON users(member_id);

CREATE TABLE auth_sessions (
  id         TEXT    PRIMARY KEY,           -- random 256-bit token id
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  user_agent TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

------------------------------------------------------------------- classes ---

CREATE TABLE class_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT    NOT NULL,          -- YYYY-MM-DD
  start_time      TEXT,                      -- HH:MM, local gym time
  class_type      TEXT    NOT NULL DEFAULT 'gi'
                                  CHECK (class_type IN ('gi','nogi','open_mat','kids','seminar')),
  coach_member_id INTEGER          REFERENCES members(id) ON DELETE SET NULL,
  technique_title TEXT,                      -- "what we worked on" — shown to players
  technique_notes TEXT,
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by      INTEGER          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX class_sessions_slot ON class_sessions(date, class_type, COALESCE(start_time,''));
CREATE INDEX class_sessions_date ON class_sessions(date DESC);

---------------------------------------------------------------- attendance ---

CREATE TABLE attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status      TEXT    NOT NULL CHECK (status IN ('present','absent','late','excused')),
  -- How this attendance was paid for, resolved at check-in time.
  coverage    TEXT             CHECK (coverage IN ('monthly','package','single','free','uncovered')),
  purchase_id INTEGER          REFERENCES purchases(id) ON DELETE SET NULL,
  recorded_by INTEGER          REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, member_id)
);

CREATE INDEX attendance_member ON attendance(member_id);
CREATE INDEX attendance_session ON attendance(session_id);

------------------------------------------------------------------- billing ---

-- The three payment models the team supports side by side.
CREATE TABLE plans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar           TEXT    NOT NULL,
  name_en           TEXT    NOT NULL,
  type              TEXT    NOT NULL CHECK (type IN ('monthly','package','single')),
  price_minor       INTEGER NOT NULL,          -- agorot
  currency          TEXT    NOT NULL DEFAULT 'ILS',
  sessions_included INTEGER,                   -- NULL = unlimited (monthly)
  validity_days     INTEGER,                   -- NULL = never expires
  active            INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0
);

-- One row per thing a member bought. Plan fields are snapshotted so changing a
-- price later never rewrites history.
CREATE TABLE purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id        INTEGER          REFERENCES plans(id) ON DELETE SET NULL,
  plan_name_ar   TEXT    NOT NULL,
  plan_type      TEXT    NOT NULL CHECK (plan_type IN ('monthly','package','single','opening_balance')),
  amount_minor   INTEGER NOT NULL,
  currency       TEXT    NOT NULL DEFAULT 'ILS',
  sessions_total INTEGER,                      -- NULL = unlimited
  sessions_used  INTEGER NOT NULL DEFAULT 0,
  valid_from     TEXT    NOT NULL,
  valid_until    TEXT,                         -- NULL = no expiry
  status         TEXT    NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active','expired','exhausted','cancelled')),
  note           TEXT,
  created_by     INTEGER          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX purchases_member ON purchases(member_id, status);
CREATE INDEX purchases_window ON purchases(valid_from, valid_until);

-- Many payments may settle one purchase, which is how partial balances work.
CREATE TABLE payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  purchase_id  INTEGER          REFERENCES purchases(id) ON DELETE SET NULL,
  amount_minor INTEGER NOT NULL,
  currency     TEXT    NOT NULL DEFAULT 'ILS',
  paid_on      TEXT    NOT NULL,
  method       TEXT    NOT NULL DEFAULT 'cash'
                               CHECK (method IN ('cash','bank','wallet','other')),
  note         TEXT,
  recorded_by  INTEGER          REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX payments_member ON payments(member_id, paid_on DESC);
CREATE INDEX payments_purchase ON payments(purchase_id);

---------------------------------------------------------------- promotions ---

CREATE TABLE promotions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id            INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  from_belt            TEXT,
  from_stripes         INTEGER,
  to_belt              TEXT    NOT NULL,
  to_stripes           INTEGER NOT NULL,
  kind                 TEXT    NOT NULL CHECK (kind IN ('stripe','belt','initial','correction')),
  promoted_on          TEXT    NOT NULL,
  classes_at_promotion INTEGER,
  awarded_by           TEXT,
  note                 TEXT,
  created_by           INTEGER          REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX promotions_member ON promotions(member_id, promoted_on DESC);

-- Editable from the admin UI; these are the thresholds the eligibility engine
-- reads. Seeded in 0002 from what the team's sheet implies (6 months/stripe).
CREATE TABLE promotion_rules (
  belt                 TEXT    PRIMARY KEY
                               CHECK (belt IN ('white','blue','purple','brown','black')),
  months_per_stripe    INTEGER NOT NULL,
  classes_per_stripe   INTEGER NOT NULL,
  max_stripes          INTEGER NOT NULL DEFAULT 4,
  months_to_next_belt  INTEGER NOT NULL,
  classes_to_next_belt INTEGER NOT NULL,
  min_age              INTEGER,
  next_belt            TEXT
);

------------------------------------------------- legacy sheet import & misc ---

-- Monthly attendance totals imported from the spreadsheet, kept so a member's
-- history chart shows real past months instead of starting empty. `year` 0 is
-- the sheet's pre-2026 catch-all column.
CREATE TABLE legacy_monthly_attendance (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  year      INTEGER NOT NULL,
  month     INTEGER NOT NULL CHECK (month BETWEEN 0 AND 12),
  classes   INTEGER NOT NULL,
  PRIMARY KEY (member_id, year, month)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  actor_login   TEXT,
  action        TEXT    NOT NULL,
  entity        TEXT,
  entity_id     INTEGER,
  detail        TEXT,
  at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX audit_log_at ON audit_log(at DESC);
CREATE INDEX audit_log_entity ON audit_log(entity, entity_id);

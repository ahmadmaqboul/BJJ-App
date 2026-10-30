-- A temporary permission to run classes.
--
-- Sometimes a player is asked to take the register because the coach is away.
-- Promoting them to the `coach` role would work, but that role also opens the
-- member list, the money owed, the plans and the promotion rules — far more
-- than someone covering one evening should see, and nothing about it expires.
--
-- So this is a capability rather than a role: it grants exactly "open a class
-- and mark who attended", it sits alongside whatever role the user already has,
-- and it carries its own end date so it lapses on its own instead of relying on
-- somebody remembering to take it back.
--
-- NULL means no grant. A date means the grant is live through that day
-- inclusive, in gym-local time. Staff (admin / coach) never need it — their
-- role already covers classes — so this column stays NULL for them.

ALTER TABLE users ADD COLUMN attendance_until TEXT;

CREATE INDEX users_attendance_grant ON users(attendance_until)
  WHERE attendance_until IS NOT NULL;

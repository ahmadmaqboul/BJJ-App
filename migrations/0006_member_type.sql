-- Member type: is this person a paying player, or a coach who trains for free?
--
-- This is NOT the same thing as `users.role`, and the two are deliberately
-- separate:
--
--   users.role   — what the person can DO in the app (admin / coach / player).
--                  A permission, attached to a login. Someone can have no login
--                  at all and still be a member.
--   member_type  — what they are ON THE MAT (player / coach). Drives whether a
--                  subscription is expected of them.
--
-- They are independent on purpose: a coach who does not administer anything
-- needs no staff login, and an admin who pays like everyone else should still
-- be billed. Folding them together would force one to imply the other.
--
-- A coach still appears on the check-in roster and still accrues attendance and
-- promotions exactly like a player — they simply are never asked for money, and
-- their check-ins record as 'free' rather than 'uncovered'.

ALTER TABLE members ADD COLUMN member_type TEXT NOT NULL DEFAULT 'player'
  CHECK (member_type IN ('player', 'coach'));

CREATE INDEX members_type ON members(member_type);

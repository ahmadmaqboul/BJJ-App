-- Membership status gains a reason.
--
-- A member who stops coming keeps every row they ever had — attendance,
-- payments, belt history — and is only taken off the check-in roster and the
-- promotion board. What was missing is *why* and *since when*, which is the
-- difference between "travelling, will be back" and "quit". `status_changed_on`
-- already existed; this adds the reason beside it.
--
-- Subscription status is deliberately NOT stored here. It is derived from the
-- purchases ledger at read time, because a stored copy would silently go stale
-- the moment a subscription lapsed with nobody looking at it.

ALTER TABLE members ADD COLUMN status_reason TEXT
  CHECK (status_reason IN ('travel','injury','stopped','study','cost','other'));

ALTER TABLE members ADD COLUMN status_note TEXT;

CREATE INDEX members_status_reason ON members(status_reason);

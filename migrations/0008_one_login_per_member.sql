-- A member may have at most one login.
--
-- `users.member_id` had no uniqueness, and the login endpoint upserted on the
-- login string: issuing a member a login under a different phone number
-- therefore created a SECOND user row pointing at the same member instead of
-- moving the existing one.
--
-- That is not just untidy. Every member query LEFT JOINs users, so a member
-- with two logins was returned twice — duplicated in the member list, the
-- check-in roster and the CSV export, and double-counted in the dashboard's
-- active-member total.
--
-- Clean up any duplicates, keeping the most recently created login (the one an
-- admin most likely just issued), then make the database refuse it outright.

DELETE FROM users
 WHERE member_id IS NOT NULL
   AND id NOT IN (
     SELECT MAX(id) FROM users WHERE member_id IS NOT NULL GROUP BY member_id
   );

CREATE UNIQUE INDEX users_one_per_member ON users(member_id)
  WHERE member_id IS NOT NULL;

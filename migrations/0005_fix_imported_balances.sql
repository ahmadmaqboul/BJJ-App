-- Corrects two things the original import got wrong. 0002 has already run in
-- production, so editing it fixes nothing there — this migration repairs the
-- live data.
--
-- 1. "باقي بحسابه ٦٠ ش" means the member has 60₪ sitting WITH the club. It was
--    imported as a 60₪ charge, so he read as owing money when the club in fact
--    owes him. A credit is a payment with nothing charged against it, which
--    leaves his balance negative until the next thing he buys consumes it.
--
-- 2. The "تاريخ اخر دفعة" column was imported as a line of text in the member's
--    notes, so nobody had a subscription and the whole team read as "never
--    subscribed". Each date becomes a real monthly subscription from that day,
--    marked paid.
--
-- Every statement is guarded, so re-running changes nothing and a payment
-- recorded by hand in the meantime is never duplicated or overwritten.
--
-- The per-member INSERTs below are deliberately not one UNION ALL: D1 caps the
-- number of terms in a compound SELECT and rejects the combined form.

------------------------------------------------- 1. حسن حجاوي: credit, not debt ---

-- Release anything the mistaken charge was paying for before deleting it.
UPDATE attendance
   SET coverage = 'uncovered', purchase_id = NULL
 WHERE purchase_id IN (SELECT id FROM purchases WHERE plan_type = 'opening_balance');

DELETE FROM payments
 WHERE purchase_id IN (SELECT id FROM purchases WHERE plan_type = 'opening_balance');

DELETE FROM purchases WHERE plan_type = 'opening_balance';

INSERT INTO payments (member_id, purchase_id, amount_minor, currency, paid_on, method, note)
SELECT m.id, NULL, 6000, 'ILS', '2026-10-29', 'cash',
       'رصيد مدوّر من الشيت: باقي بحسابه ٦٠ ش'
  FROM members m
 WHERE m.name_ar = 'حسن حجاوي'
   AND NOT EXISTS (
     SELECT 1 FROM payments p
      WHERE p.member_id = m.id
        AND p.note = 'رصيد مدوّر من الشيت: باقي بحسابه ٦٠ ش'
   );

--------------------------------------- 2. monthly subscriptions from the sheet ---

-- The amount is the one thing the sheet could not supply: it recorded when
-- each member paid, never how much. It is taken from the monthly plan and said
-- so in the note, so it can be corrected once the real price is set.

INSERT INTO purchases (member_id, plan_id, plan_name_ar, plan_type, amount_minor,
                       currency, sessions_total, sessions_used, valid_from, valid_until,
                       status, note)
SELECT m.id, p.id, 'اشتراك شهري', 'monthly', p.price_minor, p.currency, NULL, 0,
       '2026-10-15',
       date('2026-10-15', '+' || (COALESCE(p.validity_days, 30) - 1) || ' days'),
       'active', 'مستورد من الشيت — المبلغ مفترض من الخطة الشهرية'
  FROM members m
  JOIN plans p ON p.id = (SELECT MIN(id) FROM plans WHERE type = 'monthly')
 WHERE m.name_ar = 'احمد مقبول'
   AND NOT EXISTS (
     SELECT 1 FROM purchases ex WHERE ex.member_id = m.id AND ex.plan_type = 'monthly'
   );

INSERT INTO purchases (member_id, plan_id, plan_name_ar, plan_type, amount_minor,
                       currency, sessions_total, sessions_used, valid_from, valid_until,
                       status, note)
SELECT m.id, p.id, 'اشتراك شهري', 'monthly', p.price_minor, p.currency, NULL, 0,
       '2026-10-04',
       date('2026-10-04', '+' || (COALESCE(p.validity_days, 30) - 1) || ' days'),
       'active', 'مستورد من الشيت — المبلغ مفترض من الخطة الشهرية'
  FROM members m
  JOIN plans p ON p.id = (SELECT MIN(id) FROM plans WHERE type = 'monthly')
 WHERE m.name_ar = 'سامح عبد الهادي'
   AND NOT EXISTS (
     SELECT 1 FROM purchases ex WHERE ex.member_id = m.id AND ex.plan_type = 'monthly'
   );

INSERT INTO purchases (member_id, plan_id, plan_name_ar, plan_type, amount_minor,
                       currency, sessions_total, sessions_used, valid_from, valid_until,
                       status, note)
SELECT m.id, p.id, 'اشتراك شهري', 'monthly', p.price_minor, p.currency, NULL, 0,
       '2026-10-04',
       date('2026-10-04', '+' || (COALESCE(p.validity_days, 30) - 1) || ' days'),
       'active', 'مستورد من الشيت — المبلغ مفترض من الخطة الشهرية'
  FROM members m
  JOIN plans p ON p.id = (SELECT MIN(id) FROM plans WHERE type = 'monthly')
 WHERE m.name_ar = 'محمد دويكات'
   AND NOT EXISTS (
     SELECT 1 FROM purchases ex WHERE ex.member_id = m.id AND ex.plan_type = 'monthly'
   );

INSERT INTO purchases (member_id, plan_id, plan_name_ar, plan_type, amount_minor,
                       currency, sessions_total, sessions_used, valid_from, valid_until,
                       status, note)
SELECT m.id, p.id, 'اشتراك شهري', 'monthly', p.price_minor, p.currency, NULL, 0,
       '2026-10-04',
       date('2026-10-04', '+' || (COALESCE(p.validity_days, 30) - 1) || ' days'),
       'active', 'مستورد من الشيت — المبلغ مفترض من الخطة الشهرية'
  FROM members m
  JOIN plans p ON p.id = (SELECT MIN(id) FROM plans WHERE type = 'monthly')
 WHERE m.name_ar = 'محمد ريحان'
   AND NOT EXISTS (
     SELECT 1 FROM purchases ex WHERE ex.member_id = m.id AND ex.plan_type = 'monthly'
   );

INSERT INTO purchases (member_id, plan_id, plan_name_ar, plan_type, amount_minor,
                       currency, sessions_total, sessions_used, valid_from, valid_until,
                       status, note)
SELECT m.id, p.id, 'اشتراك شهري', 'monthly', p.price_minor, p.currency, NULL, 0,
       '2026-10-20',
       date('2026-10-20', '+' || (COALESCE(p.validity_days, 30) - 1) || ' days'),
       'active', 'مستورد من الشيت — المبلغ مفترض من الخطة الشهرية'
  FROM members m
  JOIN plans p ON p.id = (SELECT MIN(id) FROM plans WHERE type = 'monthly')
 WHERE m.name_ar = 'غالب ابو سير'
   AND NOT EXISTS (
     SELECT 1 FROM purchases ex WHERE ex.member_id = m.id AND ex.plan_type = 'monthly'
   );

INSERT INTO purchases (member_id, plan_id, plan_name_ar, plan_type, amount_minor,
                       currency, sessions_total, sessions_used, valid_from, valid_until,
                       status, note)
SELECT m.id, p.id, 'اشتراك شهري', 'monthly', p.price_minor, p.currency, NULL, 0,
       '2026-10-16',
       date('2026-10-16', '+' || (COALESCE(p.validity_days, 30) - 1) || ' days'),
       'active', 'مستورد من الشيت — المبلغ مفترض من الخطة الشهرية'
  FROM members m
  JOIN plans p ON p.id = (SELECT MIN(id) FROM plans WHERE type = 'monthly')
 WHERE m.name_ar = 'حمزة الصدر'
   AND NOT EXISTS (
     SELECT 1 FROM purchases ex WHERE ex.member_id = m.id AND ex.plan_type = 'monthly'
   );

-- Mark each of those subscriptions paid in full, on the day the sheet recorded.
INSERT INTO payments (member_id, purchase_id, amount_minor, currency, paid_on, method, note)
SELECT pu.member_id, pu.id, pu.amount_minor, pu.currency, pu.valid_from, 'cash', 'مستورد من الشيت — المبلغ مفترض من الخطة الشهرية'
  FROM purchases pu
 WHERE pu.note = 'مستورد من الشيت — المبلغ مفترض من الخطة الشهرية'
   AND NOT EXISTS (SELECT 1 FROM payments pm WHERE pm.purchase_id = pu.id);

-- The note on the member row is now duplicated by real ledger rows.
UPDATE members
   SET notes = NULL
 WHERE notes LIKE 'آخر دفعة في الشيت:%'
   AND notes NOT LIKE '%·%';

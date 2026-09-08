-- The seven confirmed autopay arrangements, for the production database (Neon SQL
-- editor). Creates any missing vendor first, then the rules.
--
-- Safe to run more than once: every insert is guarded by the table's own unique
-- constraint, so a second run changes nothing.
--
-- ---------------------------------------------------------------------------
-- Two decisions worth knowing before you run it
-- ---------------------------------------------------------------------------
--
-- 1. `effective_from` is 2026-01-01, not today.
--
--    The autopay lookup is asked about the *document's* date, not today's
--    (src/server/ai/suggest.ts passes `onDate: documentDate`). That is deliberate:
--    re-opening a document filed last year should show what was true when it was
--    filed. But it means a rule dated today does not cover a bill dated in March —
--    so with today's date, every autopay bill in the January-to-July import would be
--    escalated to Review instead of archived, and the whole point of the list would
--    be lost exactly when it is needed most.
--
--    2026-01-01 is not a fiction: these arrangements were confirmed over months of
--    manual process before this platform existed, which is what `effective_from`
--    records. When they were confirmed *on the platform* is a different fact, and the
--    schema keeps it separately — `confirmed_at` is now, against your name.
--
-- 2. Summit Township is two vendors, "(Water)" and "(Sewer)".
--
--    An autopay rule is unique per (vendor, entity, effective_from), so water and sewer
--    cannot be two rules on one vendor record. They are two accounts and two bills, so
--    two vendors is the honest shape rather than a workaround.
--
-- 3. The sewer rule starts today, and only the sewer rule.
--
--    Danny set that one up at some point; nobody has said when. Backdating it would
--    silently archive sewer bills from earlier in the year that may well have been paid
--    by hand — which is the one failure this whole list exists to prevent. Starting
--    today means earlier sewer bills go to Review instead, which is the safe direction
--    to be wrong in. If you know the month he set it up, change the date on that one
--    row and it will cover bills from then on.

-- ---------------------------------------------------------------------------
-- Pre-flight. Run this first: it must return exactly one row.
--
-- Every rule below hangs off the confirming user and the company group. If either
-- lookup finds nothing, the inserts quietly write zero rows rather than failing, so
-- check here instead of wondering later why the Autopay tab is still empty. A group
-- count above 1 means the joins below need a company_group_id filter added.
-- ---------------------------------------------------------------------------

SELECT
  (SELECT count(*) FROM app_user WHERE lower(email) = 'kg@colabservice.com') AS confirming_user,
  (SELECT count(DISTINCT company_group_id) FROM entity) AS company_groups,
  (SELECT count(*) FROM entity WHERE code IN ('CP', 'MM')) AS entities_needed;

-- ---------------------------------------------------------------------------
-- Vendors. Only the missing ones are created.
-- ---------------------------------------------------------------------------

INSERT INTO vendor (id, company_group_id, name, aliases, created_at, updated_at)
SELECT gen_random_uuid()::text, g.id, v.name, ARRAY[]::text[], now(), now()
FROM (SELECT DISTINCT company_group_id AS id FROM entity) g
CROSS JOIN (VALUES
  ('Ally Financial'),
  ('Bank of America'),
  ('Erie Insurance'),
  ('AmTrust'),
  ('Summit Township (Water)'),
  ('Summit Township (Sewer)'),
  ('Marquette Bank')
) AS v(name)
ON CONFLICT (company_group_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The seven rules.
-- ---------------------------------------------------------------------------

INSERT INTO autopay_rule (
  id, company_group_id, vendor_id, entity_id,
  account_last4, payment_method, covers_full_balance,
  effective_from, confirmed_by_user_id, confirmed_at, notes
)
SELECT
  gen_random_uuid()::text,
  e.company_group_id,
  ve.id,
  e.id,
  r.account_last4,
  r.payment_method,
  r.covers_full_balance,
  r.effective_from::date,
  u.id,
  now(),
  r.notes
FROM (VALUES
  ('Ally Financial',          'MM', NULL,   NULL,          true,  '2026-01-01',
   'Dodge Durango loan. Confirmed on full auto-pay.'),
  ('Bank of America',         'CP', NULL,   NULL,          true,  '2026-01-01',
   'Audi Q7 loan. Confirmed on full auto-pay.'),
  ('Erie Insurance',          'MM', '3754', 'Direct debit', true, '2026-01-01',
   'Commercial Auto + Workers Comp. Drafted on the 10th of the month from the account ending 3754.'),
  ('AmTrust',                 'MM', NULL,   'ACH',         true,  '2026-01-01',
   'Confirmed by ACH prenote on the operating account.'),
  ('Summit Township (Water)', 'MM', NULL,   NULL,          true,  '2026-01-01',
   'Water bill. Confirmed on full auto-pay.'),
  ('Summit Township (Sewer)', 'MM', NULL,   NULL,          true,  CURRENT_DATE::text,
   'Sewer bill. Danny set this up on auto-pay. The start date is the day it was recorded here, not the day he set it up — bills dated earlier are deliberately not covered, so they go to Review rather than being archived unseen. Correct this date if the month is known.'),
  ('Marquette Bank',          'MM', NULL,   NULL,          false, '2026-01-01',
   'ATTENTION: only the minimum / finance charge is drafted automatically. Danny still pays the principal by hand. This rule therefore never archives a statement on its own — the filter escalates it to Review and quotes this caveat.')
) AS r(vendor_name, entity_code, account_last4, payment_method, covers_full_balance, effective_from, notes)
JOIN entity e ON e.code = r.entity_code
JOIN vendor ve ON ve.name = r.vendor_name AND ve.company_group_id = e.company_group_id
CROSS JOIN (SELECT id FROM app_user WHERE lower(email) = 'kg@colabservice.com') u
ON CONFLICT (vendor_id, entity_id, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Check the result. Expect seven rows; Marquette Bank is the only "part of the bill".
-- ---------------------------------------------------------------------------

SELECT
  e.code AS entity,
  v.name AS vendor,
  CASE WHEN r.covers_full_balance THEN 'full' ELSE 'PART ONLY' END AS coverage,
  r.effective_from,
  r.account_last4,
  u.email AS confirmed_by
FROM autopay_rule r
JOIN entity e ON e.id = r.entity_id
JOIN vendor v ON v.id = r.vendor_id
JOIN app_user u ON u.id = r.confirmed_by_user_id
ORDER BY e.code, v.name;

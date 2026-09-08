-- The CoLAB group's confirmed facts: the corrected MM legal name, the entity aliases,
-- and the seven autopay arrangements with the vendors they hang off.
--
-- ---------------------------------------------------------------------------
-- Why data is in a migration at all
-- ---------------------------------------------------------------------------
--
-- Normally it would not be. Migrations carry the shape of the schema, and this group's
-- own records belong in a seed or a console script — which is where they started, in
-- docs/fix-production-entities.sql and docs/seed-autopay-rules.sql.
--
-- Except the build runs migrations and not the seed, and nobody with a database
-- credential is reliably at a keyboard when a deploy happens. Leaving these as scripts
-- meant the autopay list stayed empty in production until somebody remembered to paste
-- SQL into a console, and an empty autopay list has one consequence: every bill that is
-- already paid automatically gets escalated for a human decision. The whole point of
-- the list is to stop that.
--
-- Every statement is guarded on the group's slug, so a company group onboarded later
-- never receives CoLAB's vendors or rules. And every insert is guarded by its table's
-- own unique constraint, so this is a no-op on a database where the doc scripts were
-- already run by hand.

-- ---------------------------------------------------------------------------
-- 1. MM's legal name. Corrected in the seed's code, which an already-seeded
--    database never re-reads.
-- ---------------------------------------------------------------------------

UPDATE entity e
SET legal_name = 'Munar Mortgage LLC'
FROM company_group g
WHERE e.company_group_id = g.id
  AND g.slug = 'colab'
  AND e.code = 'MM'
  AND e.legal_name <> 'Munar Mortgage LLC';

-- ---------------------------------------------------------------------------
-- 2. Aliases. These are what let an incoming scan be matched to an entity: a
--    document prints a legal name, a trading name, or a DBA that shares no words
--    with either — MM trades as Keystone Alliance Mortgage.
-- ---------------------------------------------------------------------------

INSERT INTO entity_alias (id, entity_id, alias_text, source)
SELECT gen_random_uuid()::text, e.id, v.alias, 'NAME'
FROM entity e
JOIN company_group g ON g.id = e.company_group_id AND g.slug = 'colab'
JOIN (VALUES
  ('CP',  'CoLAB Processing'),
  ('CP',  'Co/LAB Processing LLC'),
  ('CCS', 'CoLAB Concierge Service'),
  ('CCS', 'CoLAB Concierge Services'),
  ('MM',  'Munar Mortgage'),
  ('MM',  'Munar Mortgage LLC'),
  ('MM',  'Keystone Alliance Mortgage'),
  ('MMT', 'Marsh & Munar Team'),
  ('MMT', 'Marsh & Munar Team LLC'),
  ('OP',  'CoLAB Ops Perfection'),
  ('OP',  'CO/LAB OPS PERFECTION, LLC')
) AS v(code, alias) ON v.code = e.code
ON CONFLICT (entity_id, alias_text) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The vendors the autopay rules name. Only the missing ones are created.
-- ---------------------------------------------------------------------------

INSERT INTO vendor (id, company_group_id, name, aliases, created_at, updated_at)
SELECT gen_random_uuid()::text, g.id, v.name, ARRAY[]::text[], now(), now()
FROM company_group g
CROSS JOIN (VALUES
  ('Ally Financial'),
  ('Bank of America'),
  ('Erie Insurance'),
  ('AmTrust'),
  ('Summit Township (Water)'),
  ('Summit Township (Sewer)'),
  ('Marquette Bank')
) AS v(name)
WHERE g.slug = 'colab'
ON CONFLICT (company_group_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. The seven rules.
--
-- Two dates, on purpose:
--
--   * effective_from is 2026-01-01 for six of them. The autopay lookup is asked about
--     the *document's* date, not today's, so that re-opening an old document shows what
--     was true when it was filed. A rule dated today therefore would not cover a bill
--     dated in March, and every autopay bill in the January-to-July import would be
--     escalated instead of archived. These arrangements were confirmed over months of
--     manual process before this platform existed, which is exactly what the field
--     records; when they were confirmed *here* is a separate fact, kept in confirmed_at.
--
--   * The sewer rule starts today. Danny set that one up at some point and nobody has
--     said when. Backdating it would silently archive earlier sewer bills that may well
--     have been paid by hand — the one failure this list exists to prevent. Starting
--     today sends earlier ones to Review instead, which is the safe direction to be
--     wrong in.
--
-- covers_full_balance is false for Marquette Bank alone: only the minimum and finance
-- charge are drafted, the principal is still paid by hand, so that rule must never
-- archive a statement on its own.
--
-- confirmed_by is the group's owner — preferring the address that actually confirmed
-- these, and falling back to whoever owns the group rather than writing no rows at all.
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
  voucher.user_id,
  now(),
  r.notes
FROM (VALUES
  ('Ally Financial',          'MM', NULL,   NULL,           true,  '2026-01-01',
   'Dodge Durango loan. Confirmed on full auto-pay.'),
  ('Bank of America',         'CP', NULL,   NULL,           true,  '2026-01-01',
   'Audi Q7 loan. Confirmed on full auto-pay.'),
  ('Erie Insurance',          'MM', '3754', 'Direct debit', true,  '2026-01-01',
   'Commercial Auto + Workers Comp. Drafted on the 10th of the month from the account ending 3754.'),
  ('AmTrust',                 'MM', NULL,   'ACH',          true,  '2026-01-01',
   'Confirmed by ACH prenote on the operating account.'),
  ('Summit Township (Water)', 'MM', NULL,   NULL,           true,  '2026-01-01',
   'Water bill. Confirmed on full auto-pay.'),
  ('Summit Township (Sewer)', 'MM', NULL,   NULL,           true,  CURRENT_DATE::text,
   'Sewer bill. Danny set this up on auto-pay. The start date is the day it was recorded here, not the day he set it up — bills dated earlier are deliberately not covered, so they go to Review rather than being archived unseen. Correct this date if the month is known.'),
  ('Marquette Bank',          'MM', NULL,   NULL,           false, '2026-01-01',
   'ATTENTION: only the minimum / finance charge is drafted automatically. Danny still pays the principal by hand. This rule therefore never archives a statement on its own — the filter escalates it to Review and quotes this caveat.')
) AS r(vendor_name, entity_code, account_last4, payment_method, covers_full_balance, effective_from, notes)
JOIN entity e ON e.code = r.entity_code
JOIN company_group g ON g.id = e.company_group_id AND g.slug = 'colab'
JOIN vendor ve ON ve.name = r.vendor_name AND ve.company_group_id = g.id
JOIN (
  SELECT m.user_id
  FROM membership m
  JOIN company_group g2 ON g2.id = m.company_group_id AND g2.slug = 'colab'
  JOIN app_user u ON u.id = m.user_id
  WHERE m.role = 'OWNER'
  ORDER BY (lower(u.email) = 'kg@colabservice.com') DESC, m.created_at ASC
  LIMIT 1
) AS voucher ON true
-- Guarded on the rule existing at all, not on its key.
--
-- The unique constraint is (vendor_id, entity_id, effective_from), and the sewer rule's
-- date is CURRENT_DATE — so if these were inserted by hand from
-- docs/seed-autopay-rules.sql on one day and this migration ran on the next, the key
-- would differ and a second, overlapping sewer rule would appear. An open rule for this
-- vendor and entity already existing is the thing that actually means "nothing to do".
WHERE NOT EXISTS (
  SELECT 1 FROM autopay_rule x
  WHERE x.vendor_id = ve.id AND x.entity_id = e.id AND x.effective_to IS NULL
)
ON CONFLICT (vendor_id, entity_id, effective_from) DO NOTHING;

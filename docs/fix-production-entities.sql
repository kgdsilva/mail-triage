-- One-off, for the production database (Neon SQL editor).
--
-- Two things the build does not carry across: the build runs migrations, not the seed,
-- and the seed's entity upsert only ever touched sort order. So a legal name corrected
-- in code does not reach a database that was already seeded.
--
-- Safe to run more than once.

UPDATE entity SET legal_name = 'Munar Mortgage LLC'
WHERE code = 'MM' AND legal_name = 'Marsh & Munar';

-- Aliases are what let an incoming scan be matched to an entity. A document prints a
-- legal name, a trading name, or a DBA that shares no words with either -- MM trades as
-- Keystone Alliance Mortgage.
INSERT INTO entity_alias (id, entity_id, alias_text, source)
SELECT gen_random_uuid()::text, e.id, v.alias, 'NAME'
FROM entity e
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

-- Check the result.
SELECT e.code, e.legal_name, count(a.id) AS aliases
FROM entity e LEFT JOIN entity_alias a ON a.entity_id = e.id
GROUP BY e.code, e.legal_name, e.sort_order ORDER BY e.sort_order;

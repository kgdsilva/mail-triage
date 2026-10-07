-- The starting set of spend categories, for every company group that already exists.
--
-- In a migration rather than the seed for the reason every other list here is: the build
-- runs migrations and does not run the seed, so a list that only the seed creates is a
-- list production never gets. Editable afterwards — these are a starting point, not a
-- taxonomy anybody is stuck with.
INSERT INTO "category" (id, company_group_id, name, sort_order, is_active)
SELECT gen_random_uuid()::text, g.id, v.name, v.ord, true
FROM company_group g
CROSS JOIN (VALUES
  ('Technology', 10),
  ('Legal', 20),
  ('Insurance', 30),
  ('Marketing', 40),
  ('Office/Rent', 50),
  ('Utilities', 60),
  ('Other', 70)
) AS v(name, ord)
ON CONFLICT (company_group_id, name) DO NOTHING;

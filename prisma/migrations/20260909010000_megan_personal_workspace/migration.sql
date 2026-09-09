-- A second workspace: "Megan's Personal Items", alongside the businesses.
--
-- A workspace is a `company_group` — the tenant boundary this schema has had since the
-- start. Megan's businesses and Megan's personal affairs share a person and nothing
-- else, so they are two groups rather than two labels inside one. That is also what
-- stops a personal water bill ever reaching a business log: by construction, not by
-- filtering.
--
-- Data in a migration, again, and for the same reason as
-- 20260909003000_colab_confirmed_data: the build runs migrations and not the seed, so
-- this is the only thing that reaches production on a deploy. prisma/seed.ts creates
-- both workspaces too, for a database built from scratch.
--
-- Everything is guarded on the slug and idempotent.

-- ---------------------------------------------------------------------------
-- 1. The businesses workspace gets the name it is now called by.
-- ---------------------------------------------------------------------------

UPDATE company_group SET name = 'Megan''s Companies' WHERE slug = 'colab';

-- ---------------------------------------------------------------------------
-- 2. The new workspace, with the same conventions as the first.
-- ---------------------------------------------------------------------------

-- created_at and updated_at are set by hand throughout this file, and always in UTC.
--
-- Two traps, both found by testing rather than by reading:
--
--   * Prisma's @updatedAt is applied by the client, not by a database default, so a
--     column that is never null through the app is NOT NULL with nothing to fall back
--     on in raw SQL. Leaving it out made the first version of this file fail outright.
--   * These columns are `timestamp without time zone`, and Prisma writes UTC into them.
--     Plain `now()` writes the *session's* local wall clock instead — three hours off on
--     a developer machine set to São Paulo. That is not cosmetic here: the fallback
--     workspace is the one with the oldest membership, so a membership stamped three
--     hours early quietly became everybody's default workspace.
INSERT INTO company_group (id, name, slug, timezone, settings, created_at, updated_at)
SELECT
  gen_random_uuid()::text,
  'Megan''s Personal Items',
  'megan-personal',
  'America/New_York',
  '{"filenameTemplate":"{entity}_{date}_{type}_{amount}","dateFormat":"MM-DD-YY","currency":"USD"}'::jsonb,
  (now() AT TIME ZONE 'utc'),
  (now() AT TIME ZONE 'utc')
WHERE NOT EXISTS (SELECT 1 FROM company_group WHERE slug = 'megan-personal');

-- ---------------------------------------------------------------------------
-- 3. Document types, copied from the businesses workspace.
--
-- Copied rather than re-listed so the two taxonomies cannot drift apart in this file.
-- Each group owns its copy from here on and can rename or disable freely.
-- ---------------------------------------------------------------------------

INSERT INTO document_type (id, company_group_id, code, label, default_action, sort_order, is_active)
SELECT gen_random_uuid()::text, new.id, t.code, t.label, t.default_action, t.sort_order, t.is_active
FROM company_group new
CROSS JOIN document_type t
JOIN company_group old ON old.id = t.company_group_id AND old.slug = 'colab'
WHERE new.slug = 'megan-personal'
ON CONFLICT (company_group_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. The four entities. Provisional: the codes and the fourth name are still being
--    settled, which is why LBC says so in its own legal name.
-- ---------------------------------------------------------------------------

INSERT INTO entity (id, company_group_id, code, legal_name, sort_order, is_segregated, metadata, created_at, updated_at)
SELECT gen_random_uuid()::text, g.id, e.code, e.legal_name, e.sort_order, false, '{}'::jsonb, (now() AT TIME ZONE 'utc'), (now() AT TIME ZONE 'utc')
FROM company_group g
CROSS JOIN (VALUES
  ('MGP', 'Megan Marsh (Personal)',                 10),
  ('LBP', 'Laban Marsh (Personal)',                 20),
  ('HSH', 'Household / Shared',                     30),
  ('LBC', 'Laban''s Company (name to be confirmed)', 40)
) AS e(code, legal_name, sort_order)
WHERE g.slug = 'megan-personal'
ON CONFLICT (company_group_id, code) DO NOTHING;

-- Aliases only where a document would actually print something. "Household / Shared"
-- and the unnamed company have nothing to match on yet, and inventing an alias is how
-- the wrong entity gets picked.
INSERT INTO entity_alias (id, entity_id, alias_text, source)
SELECT gen_random_uuid()::text, e.id, v.alias, 'NAME'
FROM entity e
JOIN company_group g ON g.id = e.company_group_id AND g.slug = 'megan-personal'
JOIN (VALUES
  ('MGP', 'Megan Marsh'),
  ('LBP', 'Laban Marsh')
) AS v(code, alias) ON v.code = e.code
ON CONFLICT (entity_id, alias_text) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. A folder tree per entity, the same shape as the businesses use. Two passes,
--    because a child needs its parent's id.
-- ---------------------------------------------------------------------------

INSERT INTO storage_folder (id, company_group_id, entity_id, name, path_cache)
SELECT gen_random_uuid()::text, g.id, e.id, f.name, e.code || ' > ' || f.name
FROM company_group g
JOIN entity e ON e.company_group_id = g.id
CROSS JOIN (VALUES ('Finances'), ('Insurance'), ('Legal'), ('Correspondence')) AS f(name)
WHERE g.slug = 'megan-personal'
ON CONFLICT (company_group_id, path_cache) DO NOTHING;

INSERT INTO storage_folder (id, company_group_id, entity_id, parent_id, name, path_cache)
SELECT
  gen_random_uuid()::text, g.id, e.id, parent.id, c.child,
  e.code || ' > ' || c.parent || ' > ' || c.child
FROM company_group g
JOIN entity e ON e.company_group_id = g.id
CROSS JOIN (VALUES
  ('Finances', 'Tax IRS'),
  ('Finances', 'Tax State'),
  ('Finances', 'Bills'),
  ('Finances', 'Bank Statements'),
  ('Finances', 'Checks Received'),
  ('Correspondence', 'Spam')
) AS c(parent, child)
JOIN storage_folder parent
  ON parent.company_group_id = g.id
 AND parent.path_cache = e.code || ' > ' || c.parent
WHERE g.slug = 'megan-personal'
ON CONFLICT (company_group_id, path_cache) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Membership — owners only.
--
-- Deliberately not everyone who works the business mail. Personal post is personal:
-- the operators who triage CoLAB's mail have no reason to see a household water bill,
-- and access here is granted by adding someone in Settings, not inherited. Whoever
-- owns the businesses workspace owns this one, so there is somebody who can.
-- ---------------------------------------------------------------------------

INSERT INTO membership (id, user_id, company_group_id, role, entity_scope, is_active, created_at)
SELECT gen_random_uuid()::text, m.user_id, new.id, 'OWNER', ARRAY[]::text[], true, (now() AT TIME ZONE 'utc')
FROM membership m
JOIN company_group old ON old.id = m.company_group_id AND old.slug = 'colab'
CROSS JOIN company_group new
WHERE new.slug = 'megan-personal'
  AND m.role = 'OWNER'
  AND m.is_active = true
ON CONFLICT (user_id, company_group_id) DO NOTHING;

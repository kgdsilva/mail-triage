-- Re-creates the hand-written indexes that Prisma cannot represent and therefore
-- proposes dropping on every migration diff. Safe to run any number of times.
--
--   npm run db:repair
--
-- The CHECK constraints and the generated search_vector column are not repeated here:
-- Prisma leaves constraints alone, and rebuilding a generated column would rewrite the
-- whole table. If a migration ever does drop search_vector, restore it from
-- prisma/sql/invariants.sql instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "document_search_vector_idx"
  ON "document" USING GIN ("search_vector");

CREATE INDEX IF NOT EXISTS "document_open_queue_idx"
  ON "document" ("company_group_id", "due_date")
  WHERE "deleted_at" IS NULL AND "status" IN ('WAITING', 'IN_PROGRESS');

CREATE INDEX IF NOT EXISTS "vendor_name_trgm_idx"
  ON "vendor" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "entity_alias_text_trgm_idx"
  ON "entity_alias" USING GIN ("alias_text" gin_trgm_ops);

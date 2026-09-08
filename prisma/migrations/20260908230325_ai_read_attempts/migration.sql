-- Counts read attempts on a document, and keeps the last failure's message.
--
-- Hand-written on purpose. `prisma migrate dev` wants to write two more things into
-- this file, and both are wrong:
--
--   * DROP INDEX on document_search_vector_idx, vendor_name_trgm_idx and
--     entity_alias_text_trgm_idx. Those live in prisma/sql/invariants.sql, not in
--     schema.prisma, so every diff sees them as strays and offers to remove them.
--     Dropping them silently turns log search and fuzzy vendor matching into table
--     scans.
--   * ALTER COLUMN "search_vector" DROP DEFAULT, which Postgres refuses outright
--     because it is a generated column — that is what made the generated migration
--     fail rather than quietly do damage.
--
-- If a future migration is generated from a schema change, delete those lines from it
-- before applying.

ALTER TABLE "document" ADD COLUMN "ai_read_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "document" ADD COLUMN "ai_read_error" TEXT;

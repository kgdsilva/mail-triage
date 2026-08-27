-- ---------------------------------------------------------------------------
-- Hand-written additions appended to the initial migration.
--
-- Prisma's schema language cannot express CHECK constraints, generated columns,
-- partial indexes or extensions. Kept here as a file so that if the initial
-- migration is ever recreated, these are re-appended rather than lost:
--
--   cat prisma/sql/invariants.sql >> prisma/migrations/<timestamp>_init/migration.sql
-- ---------------------------------------------------------------------------

-- The core audit invariant: archiving a document always has a stated reason, so
-- "why wasn't I shown this?" is answerable months later. Enforced by the database
-- rather than the application because it is the one rule that must never bend.
ALTER TABLE "document" ADD CONSTRAINT "document_archive_requires_reason"
  CHECK ("disposition" <> 'ARCHIVE' OR "disposition_reason" IS NOT NULL);

-- An autopay rule that ends before it starts would silently stop matching.
ALTER TABLE "autopay_rule" ADD CONSTRAINT "autopay_rule_effective_range"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- A document cannot be a chargeback of, or duplicate of, itself.
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_no_self_reference"
  CHECK ("from_document_id" <> "to_document_id");

-- Full-text search over the master log. A generated column keeps it in sync with
-- no trigger and no application code to forget. Weights: the final filename is the
-- strongest signal, then the original name and the human summary, then internal notes.
-- Vendor name and entity code live on other tables and are matched by join, not here.
ALTER TABLE "document" DROP COLUMN "search_vector";
ALTER TABLE "document" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("final_filename", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("original_filename", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("summary_note", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("internal_notes", '')), 'C')
  ) STORED;
CREATE INDEX "document_search_vector_idx" ON "document" USING GIN ("search_vector");

-- The open-queue read is the hottest query in the app (every role's landing page).
-- A partial index keeps it off the archived and soft-deleted bulk.
CREATE INDEX "document_open_queue_idx" ON "document" ("company_group_id", "due_date")
  WHERE "deleted_at" IS NULL AND "status" IN ('WAITING', 'IN_PROGRESS');

-- Trigram matching for vendor de-duplication on the classify screen ("Berkheimer"
-- vs "Berkheimer Tax Innovations") and for fuzzy entity-alias lookup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "vendor_name_trgm_idx" ON "vendor" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "entity_alias_text_trgm_idx" ON "entity_alias" USING GIN ("alias_text" gin_trgm_ops);

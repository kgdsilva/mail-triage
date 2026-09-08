-- Trigram indexes on the two filename columns, so searching part of a filename is a
-- real query rather than a table scan.
--
-- The search itself was the bug: filenames were only reachable through the generated
-- tsvector, and Postgres indexes "MUNAR_7-5-26_Berkheimer payment.pdf" as one token,
-- so no word inside a filename could ever be found. searchIds now also matches with
-- ILIKE; these indexes are what make that hold up at a few thousand documents.
--
-- Hand-written: a generated migration would also try to drop the indexes and the
-- generated column that live in prisma/sql/invariants.sql. See the note in
-- 20260908230325_ai_read_attempts.

CREATE INDEX IF NOT EXISTS "document_original_filename_trgm_idx"
  ON "document" USING GIN ("original_filename" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "document_final_filename_trgm_idx"
  ON "document" USING GIN ("final_filename" gin_trgm_ops);

-- Renames the Prisma field `User.avatarUrl` to `User.image`, which the Auth.js Prisma
-- adapter writes to by name. The database column is still `avatar_url` via @map, so
-- there is nothing to change here.
--
-- Prisma originally generated DROP INDEX statements for document_search_vector_idx,
-- vendor_name_trgm_idx and entity_alias_text_trgm_idx, plus an ALTER on the generated
-- search_vector column. Those objects are hand-written (prisma/sql/invariants.sql) and
-- Prisma cannot represent them, so it reads them as drift on every diff. They must be
-- removed from generated migrations -- see "Migrations" in the README.
SELECT 1;

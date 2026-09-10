-- The prefix the scanner types at the front of a filename.
--
-- Postgres will not let an enum value be added and used in the same transaction, and
-- Prisma wraps each migration in one — so the value is added here and used by the
-- migration that follows it.
ALTER TYPE "AliasSource" ADD VALUE IF NOT EXISTS 'FILENAME';

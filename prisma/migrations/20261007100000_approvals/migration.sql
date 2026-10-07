-- Invoice approval, an accountant who cannot approve, and a history nobody can rewrite.
--
-- Additive only: every statement adds a type, a column, a table or a trigger. Nothing
-- is dropped, renamed or rewritten, and no existing row changes meaning.

-- ---------------------------------------------------------------------------
-- 1. Two roles.
--
-- Separate values rather than one "external" role, because they are opposites: the
-- approver decides what may be spent and the accountant settles it, and the whole point
-- of the workflow is that no one person does both.
--
-- Added in their own statement: Postgres will not let an enum value be added and used in
-- the same transaction, and Prisma wraps each migration in one.
-- ---------------------------------------------------------------------------

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'APPROVER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';

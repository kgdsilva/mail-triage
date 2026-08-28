-- Roles stop describing who does what, and the document says what it needs.
--
-- PAYER and CONFIRMER were labels on people, but in practice whoever pays or confirms
-- varies document by document: the same person may confirm one item and pay the next.
-- So the access role keeps only what is genuinely fixed about a person (what they may
-- see and change), and what a document is asking for moves onto the document.
--
-- Safe to drop the two enum values: no membership row uses them.

CREATE TYPE "ActionKind" AS ENUM ('PAY', 'CONFIRM', 'REVIEW');

-- Drop the Role-typed columns FIRST. Both are unread by any code, and the old enum
-- type cannot be dropped while they still depend on it.
--
-- assigned_role put an access role on a document, which never made sense. action_kind
-- replaces it: what this document asks its assignee to do.
ALTER TABLE "document" DROP COLUMN "assigned_role",
  ADD COLUMN "action_kind" "ActionKind";

ALTER TABLE "routing_rule" DROP COLUMN "route_to_role",
  ADD COLUMN "route_to_action_kind" "ActionKind";

-- Now the enum swap: PAYER/CONFIRMER out, MEMBER in as the standard operational role.
-- No explicit BEGIN/COMMIT here -- the migration engine already runs this in one
-- transaction, and a nested block aborts it.
CREATE TYPE "Role_new" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'VIEWER');
ALTER TABLE "membership" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";

-- Password sign-in alongside Google. Null for Google-only accounts.
ALTER TABLE "app_user" ADD COLUMN "password_hash" TEXT;

-- Existing action items predate action_kind. REVIEW is the honest default: it says
-- "a human still has to look at this" without inventing a claim that it needs paying.
UPDATE "document" SET "action_kind" = 'REVIEW'
  WHERE "disposition" = 'ACTION' AND "action_kind" IS NULL;

-- A document in someone's queue must say what it is asking for, and an archived
-- document must not sit in a queue at all.
ALTER TABLE "document" ADD CONSTRAINT "document_action_requires_kind"
  CHECK (("disposition" = 'ACTION') = ("action_kind" IS NOT NULL));

-- The dashboard's only query: my open items, grouped by what they ask for.
CREATE INDEX "document_my_queue_idx"
  ON "document" ("assigned_to_user_id", "action_kind", "due_date")
  WHERE "deleted_at" IS NULL AND "status" IN ('WAITING', 'IN_PROGRESS');

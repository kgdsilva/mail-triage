-- The approval chain, the invoice number, spend categories and the demo flag.

-- ---------------------------------------------------------------------------
-- Where a payable bill stands.
--
-- Its own column rather than another `status` value, because "approved" and "finished"
-- are different facts and a bill can be approved and unpaid for a week. Null on
-- everything that is not a payable bill, which is most of the log.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'NEEDS_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "approval_status" "ApprovalStatus";
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "approval_note" TEXT;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "approval_decided_by_user_id" TEXT;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "approval_decided_at" TIMESTAMP(3);
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "invoice_number" TEXT;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "category_id" TEXT;
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- What the money was for, as opposed to what the paper was.
--
-- A separate list from document types on purpose: "Bill" and "Technology" answer
-- different questions, and the existing types are wired into the filing rules and the
-- review defaults, so overloading them would have made a software invoice file itself
-- as a kind of mail.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "category" (
  "id" TEXT NOT NULL,
  "company_group_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "category_company_group_id_name_key"
  ON "category" ("company_group_id", "name");

DO $$ BEGIN
  ALTER TABLE "category" ADD CONSTRAINT "category_company_group_id_fkey"
    FOREIGN KEY ("company_group_id") REFERENCES "company_group" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "document" ADD CONSTRAINT "document_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "document" ADD CONSTRAINT "document_approval_decided_by_user_id_fkey"
    FOREIGN KEY ("approval_decided_by_user_id") REFERENCES "app_user" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The approver's screen asks one question — what is pending for these companies — and
-- the accountant's asks the next one. Both are this index.
CREATE INDEX IF NOT EXISTS "document_approval_idx"
  ON "document" ("company_group_id", "approval_status", "due_date")
  WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- A cheque number kept apart from the method, so it can be reconciled on its own.
-- ---------------------------------------------------------------------------

ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "reference" TEXT;

-- ---------------------------------------------------------------------------
-- The history nobody can rewrite.
--
-- Every write path in the app already only ever inserts into document_event, so this
-- changes no behaviour — it removes the possibility. "Who approved this, and when" is
-- the answer an audit exists to get, and a trail an administrator could quietly correct
-- is not evidence of anything.
--
-- The one escape hatch is the demo purge, which has to be able to take its own rows out
-- again; it opens the door with a transaction-local flag, from a script that lives in
-- the repository for anyone to read. A direct superuser connection can of course still
-- do as it likes — that is true of every database and not something an application can
-- promise away.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION document_event_is_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.purge_demo', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;

  RAISE EXCEPTION
    'document_event is append-only: history cannot be % (document %)',
    lower(TG_OP), COALESCE(OLD.document_id, NEW.document_id)
    USING HINT = 'Record what changed as a new event instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_event_append_only ON "document_event";
CREATE TRIGGER document_event_append_only
  BEFORE UPDATE OR DELETE ON "document_event"
  FOR EACH ROW EXECUTE FUNCTION document_event_is_append_only();

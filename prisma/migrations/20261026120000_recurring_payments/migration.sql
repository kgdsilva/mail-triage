-- Money owed on a schedule that nobody drafts automatically.
--
-- Additive only: one new table and two nullable columns. Nothing is dropped, renamed or
-- rewritten, no existing row changes meaning, and every payment already recorded stays
-- exactly what it was — an ordinary payment with both new columns null.
--
-- The case: two lawyers on monthly retainer. No invoice arrives, no scan reaches the
-- scanner, so nothing in this system ever mentions them. The money leaves only if
-- somebody remembers, which is the one job software is better at than people.
--
-- Not an autopay rule, though it looks adjacent. An autopay rule records that the vendor
-- takes the money by itself and exists so a bill can be archived unseen. This is its
-- mirror: the money moves only by hand. One removes work, the other creates it.

-- ---------------------------------------------------------------------------
-- 1. The standing obligation.
-- ---------------------------------------------------------------------------

CREATE TABLE "recurring_payment" (
  "id"                   TEXT NOT NULL,
  "company_group_id"     TEXT NOT NULL,
  "entity_id"            TEXT NOT NULL,
  "vendor_id"            TEXT,
  "payee_name"           TEXT NOT NULL,
  "amount"               DECIMAL(12,2),
  "day_of_month"         INTEGER NOT NULL,
  "method"               TEXT,
  "notes"                TEXT,
  "effective_from"       DATE NOT NULL,
  "effective_to"         DATE,
  "last_reminded_period" TEXT,
  "created_by_user_id"   TEXT NOT NULL,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recurring_payment_pkey" PRIMARY KEY ("id")
);

-- A day outside the month cannot be due, and 0 or 32 is a typo that would otherwise
-- make an obligation that is never owed and never chased. 29 to 31 are allowed and fall
-- back to the last day of a short month; the code does that, not the column.
ALTER TABLE "recurring_payment"
  ADD CONSTRAINT "recurring_payment_day_of_month_check"
  CHECK ("day_of_month" BETWEEN 1 AND 31);

CREATE INDEX "recurring_payment_company_group_id_entity_id_idx"
  ON "recurring_payment" ("company_group_id", "entity_id");

ALTER TABLE "recurring_payment"
  ADD CONSTRAINT "recurring_payment_company_group_id_fkey"
  FOREIGN KEY ("company_group_id") REFERENCES "company_group" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recurring_payment"
  ADD CONSTRAINT "recurring_payment_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recurring_payment"
  ADD CONSTRAINT "recurring_payment_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recurring_payment"
  ADD CONSTRAINT "recurring_payment_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. How a payment says which month of which obligation it answers.
--
-- On `payment` rather than in a table of its own, because a retainer paid is a payment:
-- it leaves the same account, wants the same receipt, and belongs in the same Paid tab
-- and the same totals as every other. A parallel record would be a second ledger that
-- the first one does not know about, which is how two different answers to "what did we
-- pay in October" come to exist.
-- ---------------------------------------------------------------------------

ALTER TABLE "payment" ADD COLUMN "recurring_payment_id" TEXT;
ALTER TABLE "payment" ADD COLUMN "recurring_period" TEXT;

COMMENT ON COLUMN "payment"."recurring_period" IS
  'The month this answers, as YYYY-MM. Deliberately not derived from paid_on: a retainer for October paid on 3 November is still October''s, and deriving it would mark November done while October stayed owing.';

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_recurring_payment_id_fkey"
  FOREIGN KEY ("recurring_payment_id") REFERENCES "recurring_payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One month of one obligation can only be settled once. Postgres treats nulls as
-- distinct, so this constrains recurring payments and leaves the thousands of ordinary
-- ones — both columns null — entirely alone.
CREATE UNIQUE INDEX "payment_recurring_payment_id_recurring_period_key"
  ON "payment" ("recurring_payment_id", "recurring_period");

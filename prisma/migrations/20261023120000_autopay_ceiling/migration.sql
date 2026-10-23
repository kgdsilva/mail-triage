-- A ceiling on what autopay may settle without an approver seeing it.
--
-- Additive only: one nullable column. Nothing is dropped, renamed or rewritten, every
-- existing rule keeps working exactly as before, and a null means "use the group's
-- ceiling" rather than "no ceiling".
--
-- The reason is Eric's, in his words: "I really just want to make sure we have approval
-- for a $5,000 check" and "we don't need an approval on your $15 subscription charge."
-- Those are the same sentence from both ends — the amount is what decides, not the
-- arrangement. Confirmed autopay stops a bill from needing an approver; it should not
-- stop five thousand dollars from needing one.

-- AlterTable
ALTER TABLE "autopay_rule" ADD COLUMN "ceiling" DECIMAL(12,2);

COMMENT ON COLUMN "autopay_rule"."ceiling" IS
  'Above this amount the bill goes for approval even though autopay is confirmed. Null means the company group''s own ceiling applies.';

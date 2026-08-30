-- Not every automatic payment settles the whole bill.
--
-- A card can have the minimum or finance charge drafted automatically while the
-- principal is still paid by hand. Recorded as an ordinary autopay rule, that bill gets
-- archived without anyone seeing it and the manual half never gets paid -- the exact
-- failure this platform exists to prevent. Existing rules are full coverage, which is
-- what they meant when they were entered.
ALTER TABLE "autopay_rule"
  ADD COLUMN "covers_full_balance" BOOLEAN NOT NULL DEFAULT true;

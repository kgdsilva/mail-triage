-- Phase 1.5: importing the historical spreadsheet log.
--
-- Three things, all of which have to exist before the first row can be imported.

-- ---------------------------------------------------------------------------
-- 1. Where a historical document used to live.
--
-- The spreadsheet's Box link is the way back to the copy the team already knows,
-- for as long as the changeover lasts. A column rather than a line inside the
-- notes, because it has to be clickable and because it says something the notes
-- do not: this row came from somewhere else.
-- ---------------------------------------------------------------------------

ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "legacy_box_url" TEXT;

-- ---------------------------------------------------------------------------
-- 2. What an import could not resolve, kept on the batch.
--
-- A spreadsheet row naming a company code that matches no entity cannot become a
-- document — there is no entity to hang it on, and inventing one would attach real
-- mail to a company that does not exist here. Dropping it silently is how a
-- document disappears, so it is recorded on the batch and shown on the import
-- screen until somebody resolves it.
-- ---------------------------------------------------------------------------

ALTER TABLE "batch" ADD COLUMN IF NOT EXISTS "import_report" JSONB;

-- ---------------------------------------------------------------------------
-- 3. A Payroll document type.
--
-- The historical log has eight W2/1099 rows and a "Human Resources > Payroll"
-- folder they were filed into. The seeded taxonomy has no such type, so they would
-- all land in "Other" — which is the type that means "we did not say", and it would
-- make eight payroll documents unfindable as payroll.
--
-- ASK rather than ARCHIVE: a W2 is a deadline-bearing document about a person, and
-- pre-filling "file it away" for that class of mail is the wrong default.
--
-- Added to every existing group, since the seed only runs for new ones.
-- ---------------------------------------------------------------------------

INSERT INTO "document_type" (id, company_group_id, code, label, default_action, sort_order, is_active)
SELECT gen_random_uuid()::text, g.id, 'PAYROLL', 'Payroll (W2/1099)', 'ASK', 65, true
FROM company_group g
ON CONFLICT (company_group_id, code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. The sewer autopay's real start date.
--
-- Left at the recording date when the seven rules were loaded, because nobody knew
-- when Danny had set it up. He confirmed it by email on 3 June 2026: water was
-- already on autopay, sewer was not, and he enrolled it and paid the past-due
-- invoice that day.
--
-- This matters beyond tidiness. The filter asks whether a rule was in effect *on the
-- document's date*, so with an effective date of today, every sewer bill in the
-- historical import — five months of them — would read as "not on autopay" and be
-- escalated for a decision that was already made.
-- ---------------------------------------------------------------------------

UPDATE autopay_rule r
SET effective_from = DATE '2026-06-03',
    notes = 'Sewer bill. Danny enrolled this on auto-pay and paid the past-due invoice on '
         || '2026-06-03, confirmed by him by email that day: "I took care of Summit. It looks '
         || 'like water was set to autopay, but sewer was not. I set Sewer up on auto pay and '
         || 'submitted payment for the past-due invoice." Water was already enrolled before that.'
FROM company_group g, vendor v
WHERE r.company_group_id = g.id
  AND g.slug = 'colab'
  AND v.id = r.vendor_id
  AND v.name = 'Summit Township (Sewer)'
  AND r.effective_from > DATE '2026-06-03';

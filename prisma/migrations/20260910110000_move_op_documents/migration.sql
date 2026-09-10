-- Twenty Ops Perfection documents filed under CoLAB Processing.
--
-- ---------------------------------------------------------------------------
-- Why these twenty, and why in a migration
-- ---------------------------------------------------------------------------
--
-- The historical spreadsheet's Company Code says CP on all twenty. The evidence that
-- they are OP is the name the scan arrived under: nineteen were saved as OP_, OPr_,
-- OpsPrfProcessing_ or OptsPerfection_ — written by the person holding the paper — and
-- the twentieth names the EDD account 233-1313-3 in its note, which is Ops Perfection's
-- (Processing's is 212-8349-4, and the rows that quote that one are genuinely CP).
--
-- The lasting fix is in the spreadsheet, and it was delivered as a corrected export.
-- This does the same thing to the rows already in production, because the corrected file
-- has to be imported by a person and these documents are wrong until somebody does. Both
-- paths converge: re-importing the corrected CSV afterwards is a no-op on the entity,
-- since it says the same thing this does.
--
-- Guarded on the document still being on CP, so it is a no-op wherever it has already
-- been corrected — by the CSV or by this migration running once.
--
-- The final filenames keep their CP_ prefix on purpose. The PDFs in Box are named that
-- way, and the platform matches a file to its row by name; renaming the row here would
-- orphan twenty attachments to fix a prefix. The entity field is what the platform files
-- by, and it is now right.

-- ---------------------------------------------------------------------------
-- 1. OP's folders. Two passes, because a child needs its parent's id.
-- ---------------------------------------------------------------------------

INSERT INTO storage_folder (id, company_group_id, entity_id, parent_id, name, path_cache, sort_order, created_at)
SELECT gen_random_uuid()::text, g.id, e.id, NULL, 'Finances', 'OP > Finances', 0,
       (now() AT TIME ZONE 'utc')
FROM company_group g
JOIN entity e ON e.company_group_id = g.id AND e.code = 'OP'
WHERE g.slug = 'colab'
ON CONFLICT (company_group_id, path_cache) DO NOTHING;

INSERT INTO storage_folder (id, company_group_id, entity_id, parent_id, name, path_cache, sort_order, created_at)
SELECT gen_random_uuid()::text, g.id, e.id, parent.id, v.name, 'OP > Finances > ' || v.name, 0,
       (now() AT TIME ZONE 'utc')
FROM company_group g
JOIN entity e ON e.company_group_id = g.id AND e.code = 'OP'
JOIN storage_folder parent
  ON parent.company_group_id = g.id AND parent.path_cache = 'OP > Finances'
CROSS JOIN (VALUES ('Tax IRS'), ('Bills & Expenses'), ('Statements')) AS v(name)
WHERE g.slug = 'colab'
ON CONFLICT (company_group_id, path_cache) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The move. Entity and folder together — a document on OP still filed under
--    "CP > Finances > Tax IRS" is half-moved, and the folder is what Box mirrors.
-- ---------------------------------------------------------------------------

UPDATE document d
SET entity_id = op.id,
    storage_folder_id = COALESCE(target.id, d.storage_folder_id),
    updated_at = (now() AT TIME ZONE 'utc')
FROM company_group g
JOIN entity op ON op.company_group_id = g.id AND op.code = 'OP'
JOIN entity cp ON cp.company_group_id = g.id AND cp.code = 'CP'
CROSS JOIN (VALUES
  ('CP_01-30-26_Berkheimer_DelinquentLST_30',                  'Tax IRS'),
  ('CP_03-03-26_TexasWorkforce_UnpaidTax_224',                 'Bills & Expenses'),
  ('CP_03-09-26_PADeptLabor_TaxNotice',                        'Tax IRS'),
  ('CP_03-30-26_TexasWorkforce_MissingReportNotice',           'Tax IRS'),
  ('CP_04-01-26_CA_EDD_FormDelinquencyNotice_123125',          'Tax IRS'),
  ('CP_04-20-26_CA_EDD_UnreportedWagesNotice',                 'Tax IRS'),
  ('CP_04-22-26_Berkheimer_DelinquentNotice_Q4',               'Tax IRS'),
  ('CP_05-05-26_TexasWorkforce_MissingReportNotice',           'Tax IRS'),
  ('CP_05-11-26_IRS_AddressUpdate_Notice',                     'Tax IRS'),
  ('CP_06-01-26_IRS_PenaltyNotice_255',                        'Tax IRS'),
  ('CP_06-08-26_CAEDD_OffsetCollections_9688',                 'Tax IRS'),
  ('CP_06-09-26_TexasWorkforce_StatementOfAccount_331',        'Tax IRS'),
  ('CP_06-12-26_PADOL_UCBalance_706',                          'Tax IRS'),
  ('CP_06-24-26_ColoradoFAMLI_UnreportedWages_156',            'Tax IRS'),
  ('CP_07-05-26_PADeptRevenue_AccountStatement_465',           'Tax IRS'),
  ('CP_07-05-26_PAEmployerWithholding_StatementOfAccount_465', 'Tax IRS'),
  ('CP_07-13-26_CAEDD_FormDelinquency_Q1-2026',                'Tax IRS'),
  ('CP_07-13-26_IRS_CP311A_AccountAccess_Gilbert',             'Statements'),
  ('CP_1-20-26_EDDCaliforniaStatement',                        'Bills & Expenses'),
  ('CP_1-28-26_BerkheimerLateFee_1-20-26',                     'Bills & Expenses')
) AS v(final_filename, folder)
LEFT JOIN storage_folder target
  ON target.company_group_id = g.id
 AND target.path_cache = 'OP > Finances > ' || v.folder
WHERE d.company_group_id = g.id
  AND g.slug = 'colab'
  AND d.entity_id = cp.id
  AND d.final_filename = v.final_filename
  AND d.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Say so in each document's history.
--
-- The master log is the audit backbone: a company changing under a filed document is
-- exactly the kind of thing somebody will ask about in six months, and "it was always
-- OP" is not an answer. Attributed to the group's owner, who confirmed the mapping,
-- rather than left as an anonymous system action.
-- ---------------------------------------------------------------------------

INSERT INTO document_event (id, document_id, actor_user_id, action, from_value, to_value, created_at)
SELECT gen_random_uuid()::text, d.id, owner.user_id, 'reclassified',
       jsonb_build_object('entityCode', 'CP'),
       jsonb_build_object(
         'entityCode', 'OP',
         'via', 'op-correction',
         'reason', 'Scanned as OP; the spreadsheet Company Code said CP'
       ),
       (now() AT TIME ZONE 'utc')
FROM document d
JOIN company_group g ON g.id = d.company_group_id AND g.slug = 'colab'
JOIN entity op ON op.company_group_id = g.id AND op.code = 'OP' AND op.id = d.entity_id
LEFT JOIN LATERAL (
  SELECT m.user_id
  FROM membership m
  WHERE m.company_group_id = g.id AND m.role = 'OWNER' AND m.is_active = true
  ORDER BY m.created_at ASC
  LIMIT 1
) owner ON true
WHERE d.final_filename IN (
  'CP_01-30-26_Berkheimer_DelinquentLST_30',
  'CP_03-03-26_TexasWorkforce_UnpaidTax_224',
  'CP_03-09-26_PADeptLabor_TaxNotice',
  'CP_03-30-26_TexasWorkforce_MissingReportNotice',
  'CP_04-01-26_CA_EDD_FormDelinquencyNotice_123125',
  'CP_04-20-26_CA_EDD_UnreportedWagesNotice',
  'CP_04-22-26_Berkheimer_DelinquentNotice_Q4',
  'CP_05-05-26_TexasWorkforce_MissingReportNotice',
  'CP_05-11-26_IRS_AddressUpdate_Notice',
  'CP_06-01-26_IRS_PenaltyNotice_255',
  'CP_06-08-26_CAEDD_OffsetCollections_9688',
  'CP_06-09-26_TexasWorkforce_StatementOfAccount_331',
  'CP_06-12-26_PADOL_UCBalance_706',
  'CP_06-24-26_ColoradoFAMLI_UnreportedWages_156',
  'CP_07-05-26_PADeptRevenue_AccountStatement_465',
  'CP_07-05-26_PAEmployerWithholding_StatementOfAccount_465',
  'CP_07-13-26_CAEDD_FormDelinquency_Q1-2026',
  'CP_07-13-26_IRS_CP311A_AccountAccess_Gilbert',
  'CP_1-20-26_EDDCaliforniaStatement',
  'CP_1-28-26_BerkheimerLateFee_1-20-26'
)
  AND d.deleted_at IS NULL
  -- One event, however many times this runs.
  AND NOT EXISTS (
    SELECT 1 FROM document_event e
    WHERE e.document_id = d.id AND e.to_value ->> 'via' = 'op-correction'
  );

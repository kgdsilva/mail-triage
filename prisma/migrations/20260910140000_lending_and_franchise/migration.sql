-- Two identities, confirmed: Munar Mortgage trades as Co/LAB Lending, and Marsh & Munar
-- Team is CoLAB Franchise.
--
-- ---------------------------------------------------------------------------
-- Why this is worth a migration rather than a note
-- ---------------------------------------------------------------------------
--
-- Aliases are what let an incoming scan be matched to a company at all. A document does
-- not say "MM" — it says whatever is printed on it, and here that is a name sharing no
-- words with the legal one. Both the filename parser and the AI reader match against
-- this table, so a missing alias is a document that arrives unidentified, every month,
-- for as long as it is missing.
--
-- MM already carried "Keystone Alliance Mortgage" for the same reason.

INSERT INTO entity_alias (id, entity_id, alias_text, source)
SELECT gen_random_uuid()::text, e.id, v.alias, v.source::"AliasSource"
FROM entity e
JOIN company_group g ON g.id = e.company_group_id AND g.slug = 'colab'
JOIN (VALUES
  -- Printed on the document.
  ('MM',  'Co/LAB Lending',      'NAME'),
  ('MM',  'Co/LAB Lending LLC',  'NAME'),
  ('MM',  'CoLAB Lending',       'NAME'),
  ('MM',  'CoLAB Lending LLC',   'NAME'),
  ('MMT', 'CoLAB Franchise',     'NAME'),
  ('MMT', 'Co/LAB Franchise',    'NAME'),
  ('MMT', 'CoLAB Franchise LLC', 'NAME'),
  -- Typed at the front of a scan. "COLAB" alone would be ambiguous between these two,
  -- which is exactly why the prefix tier compares the whole token and never a fragment.
  ('MM',  'ColabLending',        'FILENAME'),
  ('MM',  'CoLABLendiong',       'FILENAME'),
  ('MMT', 'ColabFranchise',      'FILENAME')
) AS v(code, alias, source) ON v.code = e.code
ON CONFLICT (entity_id, alias_text) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The one document this settles.
--
-- Filed under CP, while its own note reads "Co/LAB Lending LLC (EIN 46-5594137, dba
-- Keystone Alliance Mortgage — same operation as Munar Mortgage)". It was left alone
-- when the other twenty moved, because Co/LAB Lending was not a name this platform knew
-- and guessing which company it meant was not something to do quietly. Now it is known.
-- ---------------------------------------------------------------------------

UPDATE document d
SET entity_id = mm.id,
    storage_folder_id = COALESCE(target.id, d.storage_folder_id),
    updated_at = (now() AT TIME ZONE 'utc')
FROM company_group g
JOIN entity mm ON mm.company_group_id = g.id AND mm.code = 'MM'
JOIN entity cp ON cp.company_group_id = g.id AND cp.code = 'CP'
LEFT JOIN storage_folder target
  ON target.company_group_id = g.id AND target.path_cache = 'MM > Finances > Tax IRS'
WHERE d.company_group_id = g.id
  AND g.slug = 'colab'
  AND d.entity_id = cp.id
  AND d.deleted_at IS NULL
  AND d.final_filename = 'COLAB_06-15-26_IRS_LTR3852C_7004ConvertedTo1120S_Dec2025';

INSERT INTO document_event (id, document_id, actor_user_id, action, from_value, to_value, created_at)
SELECT gen_random_uuid()::text, d.id, owner.user_id, 'reclassified',
       jsonb_build_object('entityCode', 'CP'),
       jsonb_build_object(
         'entityCode', 'MM',
         'via', 'lending-identity',
         'reason', 'Co/LAB Lending is Munar Mortgage, confirmed by the owner'
       ),
       (now() AT TIME ZONE 'utc')
FROM document d
JOIN company_group g ON g.id = d.company_group_id AND g.slug = 'colab'
JOIN entity mm ON mm.id = d.entity_id AND mm.code = 'MM'
LEFT JOIN LATERAL (
  SELECT m.user_id FROM membership m
  WHERE m.company_group_id = g.id AND m.role = 'OWNER' AND m.is_active = true
  ORDER BY m.created_at ASC LIMIT 1
) owner ON true
WHERE d.final_filename = 'COLAB_06-15-26_IRS_LTR3852C_7004ConvertedTo1120S_Dec2025'
  AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_event e
    WHERE e.document_id = d.id AND e.to_value ->> 'via' = 'lending-identity'
  );

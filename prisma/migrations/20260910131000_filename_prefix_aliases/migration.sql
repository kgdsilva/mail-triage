-- The prefixes the scanner actually types, and a back-fill for the batch that arrived
-- before they existed.
--
-- ---------------------------------------------------------------------------
-- Why these prefixes
-- ---------------------------------------------------------------------------
--
-- Not invented: read off 352 historical scans. Whoever digitises the post writes the
-- company at the front of the filename, and the same handful of words comes back every
-- time — Processing_, Munar_, Concierge_, Marsh_, OP_ — including two spellings that are
-- plainly typos and still need to resolve, because a typo is not a reason for a document
-- to arrive unidentified.
--
-- "MUNAR" is the one that made this necessary. It appears inside "Marsh & Munar Team"
-- as well as "Munar Mortgage", so as a substring it identified two companies and the
-- parser correctly declined to choose. As a whole prefix it identifies one.
--
-- MUNAR is filed as MM even though thirteen historical MUNAR_ scans turned out to be
-- MMT against a hundred and thirty-two for MM. That is the right trade because this
-- fills in a field on a form: the operator sees it on Review and a wrong guess costs one
-- keystroke, while a blank one costs the same keystroke every single time. MMT scans are
-- named Marsh_, which resolves to MMT on its own.

INSERT INTO entity_alias (id, entity_id, alias_text, source)
SELECT gen_random_uuid()::text, e.id, v.prefix, 'FILENAME'
FROM entity e
JOIN company_group g ON g.id = e.company_group_id AND g.slug = 'colab'
JOIN (VALUES
  ('CP',  'Processing'),
  ('CP',  'Processsing'),
  ('CCS', 'Concierge'),
  ('CCS', 'Concerierge'),
  ('MM',  'Munar'),
  ('MMT', 'Marsh'),
  ('OP',  'OPr'),
  ('OP',  'OpsPrfProcessing'),
  ('OP',  'OptsPerfection')
) AS v(code, prefix) ON v.code = e.code
ON CONFLICT (entity_id, alias_text) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The batch that arrived first.
--
-- Four documents uploaded before the alias existed, sitting as "Entity not identified"
-- with obviously-Munar filenames. This is the pre-fill they would have been given, done
-- late — so it is restricted to documents nobody has classified yet and whose entity is
-- still empty. It never overwrites a person's answer, and every one of them still has to
-- be confirmed on Review.
-- ---------------------------------------------------------------------------

UPDATE document d
SET entity_id = a.entity_id,
    updated_at = (now() AT TIME ZONE 'utc')
FROM company_group g, entity_alias a, entity e
WHERE d.company_group_id = g.id
  AND g.slug = 'colab'
  AND a.entity_id = e.id
  AND e.company_group_id = g.id
  AND a.source = 'FILENAME'
  AND d.entity_id IS NULL
  AND d.disposition = 'UNREVIEWED'
  AND d.deleted_at IS NULL
  AND regexp_replace(upper(split_part(d.original_filename, '_', 1)), '[^A-Z0-9]', '', 'g')
      = regexp_replace(upper(a.alias_text), '[^A-Z0-9]', '', 'g');

-- Said out loud on each document, with no actor: this was the system reading a filename,
-- not a person deciding anything.
INSERT INTO document_event (id, document_id, actor_user_id, action, from_value, to_value, created_at)
SELECT gen_random_uuid()::text, d.id, NULL, 'classified',
       jsonb_build_object('entityId', NULL),
       jsonb_build_object(
         'entityCode', e.code,
         'via', 'filename-prefix-backfill',
         'prefix', split_part(d.original_filename, '_', 1)
       ),
       (now() AT TIME ZONE 'utc')
FROM document d
JOIN company_group g ON g.id = d.company_group_id AND g.slug = 'colab'
JOIN entity e ON e.id = d.entity_id
WHERE d.disposition = 'UNREVIEWED'
  AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_event ev
    WHERE ev.document_id = d.id AND ev.to_value ->> 'via' = 'filename-prefix-backfill'
  )
  AND EXISTS (
    SELECT 1 FROM entity_alias a
    WHERE a.entity_id = e.id
      AND a.source = 'FILENAME'
      AND regexp_replace(upper(split_part(d.original_filename, '_', 1)), '[^A-Z0-9]', '', 'g')
          = regexp_replace(upper(a.alias_text), '[^A-Z0-9]', '', 'g')
  );

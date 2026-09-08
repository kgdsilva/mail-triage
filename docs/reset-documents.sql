-- Clears the test documents from production so the real operation starts on an empty
-- log. Paste into the Neon SQL editor.
--
-- What it deletes: documents, their history, their links, their notifications, and the
-- batches they arrived in.
--
-- What it keeps: entities and aliases, document types, vendors, autopay rules, storage
-- folders, members and users. Every setting configured so far survives.
--
-- Run this ONCE, before any real mail is uploaded. After go-live it must never be run
-- again: the master log is the audit backbone, and from that point on removing a
-- document is what the Remove button does — a soft delete that keeps the record.
--
-- Note on stored files: the PDFs themselves live in R2 and are not reachable from SQL.
-- Deleting these rows leaves those objects orphaned. They cost a few cents and nothing
-- references them; delete them from the Cloudflare R2 dashboard if you want the bucket
-- clean too.

-- ---------------------------------------------------------------------------
-- 1. Look before you leap. Run this on its own first.
-- ---------------------------------------------------------------------------

SELECT 'documents'     AS what, count(*) FROM document
UNION ALL SELECT 'document_event',   count(*) FROM document_event
UNION ALL SELECT 'document_link',    count(*) FROM document_link
UNION ALL SELECT 'notification',     count(*) FROM notification
UNION ALL SELECT 'batch',            count(*) FROM batch
UNION ALL SELECT 'entity (kept)',    count(*) FROM entity
UNION ALL SELECT 'entity_alias (kept)', count(*) FROM entity_alias
UNION ALL SELECT 'document_type (kept)', count(*) FROM document_type
UNION ALL SELECT 'vendor (kept)',    count(*) FROM vendor
UNION ALL SELECT 'autopay_rule (kept)', count(*) FROM autopay_rule
UNION ALL SELECT 'membership (kept)', count(*) FROM membership;

-- ---------------------------------------------------------------------------
-- 2. The reset. All or nothing.
-- ---------------------------------------------------------------------------

BEGIN;

DELETE FROM document_link;
DELETE FROM notification;
DELETE FROM document_event;
DELETE FROM document;
DELETE FROM batch;

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Confirm: the first five are 0, the rest are untouched.
-- ---------------------------------------------------------------------------

SELECT 'documents'     AS what, count(*) FROM document
UNION ALL SELECT 'document_event',   count(*) FROM document_event
UNION ALL SELECT 'document_link',    count(*) FROM document_link
UNION ALL SELECT 'notification',     count(*) FROM notification
UNION ALL SELECT 'batch',            count(*) FROM batch
UNION ALL SELECT 'entity (kept)',    count(*) FROM entity
UNION ALL SELECT 'entity_alias (kept)', count(*) FROM entity_alias
UNION ALL SELECT 'document_type (kept)', count(*) FROM document_type
UNION ALL SELECT 'vendor (kept)',    count(*) FROM vendor
UNION ALL SELECT 'autopay_rule (kept)', count(*) FROM autopay_rule
UNION ALL SELECT 'membership (kept)', count(*) FROM membership;

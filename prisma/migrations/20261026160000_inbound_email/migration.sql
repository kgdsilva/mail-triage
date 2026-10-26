-- The log of everything that reached the forwarding address.
--
-- Additive only: one new table. Nothing is dropped, renamed or rewritten.
--
-- The address is a door onto the public internet, so this is first an audit trail — who
-- sent what, and was it let in — and second the answer to the question this feature will
-- be asked forty times a week: "I forwarded that invoice, did it arrive?" Without a
-- record the honest answer is "look in the log and guess".
--
-- Refusals are stored like acceptances. An email dropped silently is indistinguishable
-- from one that was never sent, and those have opposite remedies: one is "check your
-- forwarding rule", the other "ask to be added to the senders".

CREATE TABLE "inbound_email" (
  "id"                TEXT NOT NULL,
  "company_group_id"  TEXT NOT NULL,
  "provider_id"       TEXT NOT NULL,
  "from_address"      TEXT NOT NULL,
  "to_address"        TEXT NOT NULL,
  "subject"           TEXT,
  "outcome"           TEXT NOT NULL,
  "reason"            TEXT,
  "documents_created" INTEGER NOT NULL DEFAULT 0,
  "received_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inbound_email_pkey" PRIMARY KEY ("id")
);

-- Unique, because providers retry a webhook on any non-2xx reply and a slow reply counts
-- as one. Without this, one email that took too long to process becomes two documents.
CREATE UNIQUE INDEX "inbound_email_provider_id_key" ON "inbound_email" ("provider_id");

CREATE INDEX "inbound_email_company_group_id_received_at_idx"
  ON "inbound_email" ("company_group_id", "received_at");

ALTER TABLE "inbound_email"
  ADD CONSTRAINT "inbound_email_company_group_id_fkey"
  FOREIGN KEY ("company_group_id") REFERENCES "company_group" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON COLUMN "inbound_email"."outcome" IS
  'accepted | refused | ignored. Three and not two: refused means somebody was turned away and may need to be let in; ignored means there was nothing to take, such as a reply with no attachment.';

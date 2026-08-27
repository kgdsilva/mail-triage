-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'PAYER', 'CONFIRMER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AliasSource" AS ENUM ('NAME', 'ADDRESS', 'EIN', 'ACCOUNT_NUMBER');

-- CreateEnum
CREATE TYPE "DefaultAction" AS ENUM ('ARCHIVE', 'ACTION', 'ASK');

-- CreateEnum
CREATE TYPE "BatchSource" AS ENUM ('MANUAL_UPLOAD', 'DRIVE_IMPORT', 'BOX_IMPORT', 'EMAIL', 'HISTORICAL_IMPORT');

-- CreateEnum
CREATE TYPE "Disposition" AS ENUM ('UNREVIEWED', 'ARCHIVE', 'ACTION');

-- CreateEnum
CREATE TYPE "DispositionReason" AS ENUM ('AUTOPAY', 'INCOMING_CHECK', 'SPAM_SOLICITATION', 'FYI_STATEMENT', 'DEADLINE_NOTICE', 'MANUAL_INVOICE', 'RISK_PENALTY', 'OTHER');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'DONE', 'ARCHIVED', 'VOID');

-- CreateEnum
CREATE TYPE "LinkRelation" AS ENUM ('CHARGEBACK_OF', 'DUPLICATE_OF', 'SUPERSEDES', 'RELATED_TO', 'SAME_ISSUE_AS');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateTable
CREATE TABLE "company_group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "email_verified" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "entity_scope" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT,
    "is_segregated" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_alias" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "alias_text" TEXT NOT NULL,
    "source" "AliasSource" NOT NULL DEFAULT 'NAME',

    CONSTRAINT "entity_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_type" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "default_action" "DefaultAction" NOT NULL DEFAULT 'ASK',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "document_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_folder" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "path_cache" TEXT NOT NULL,
    "box_folder_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "known_spam" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopay_rule" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "account_last4" TEXT,
    "payment_method" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "confirmed_by_user_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "autopay_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_rule" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "match" JSONB NOT NULL DEFAULT '{}',
    "route_to_role" "Role",
    "route_to_user_id" TEXT,
    "also_notify_user_ids" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" "BatchSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "original_filename" TEXT NOT NULL,
    "final_filename" TEXT,
    "storage_key" TEXT,
    "storage_bucket" TEXT,
    "mime_type" TEXT,
    "byte_size" INTEGER,
    "page_count" INTEGER,
    "sha256" TEXT,
    "entity_id" TEXT,
    "document_type_id" TEXT,
    "vendor_id" TEXT,
    "document_date" DATE,
    "due_date" DATE,
    "amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "disposition" "Disposition" NOT NULL DEFAULT 'UNREVIEWED',
    "disposition_reason" "DispositionReason",
    "status" "DocStatus" NOT NULL DEFAULT 'WAITING',
    "assigned_to_user_id" TEXT,
    "assigned_role" "Role",
    "notified_at" TIMESTAMP(3),
    "storage_folder_id" TEXT,
    "filed_at" TIMESTAMP(3),
    "summary_note" TEXT,
    "internal_notes" TEXT,
    "ai_suggestion" JSONB,
    "ai_confidence" DECIMAL(4,3),
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "search_vector" tsvector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_link" (
    "id" TEXT NOT NULL,
    "from_document_id" TEXT NOT NULL,
    "to_document_id" TEXT NOT NULL,
    "relation" "LinkRelation" NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "document_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_event" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "from_value" JSONB,
    "to_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "acted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_token" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "company_group_slug_key" ON "company_group"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "membership_company_group_id_role_idx" ON "membership"("company_group_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "membership_user_id_company_group_id_key" ON "membership"("user_id", "company_group_id");

-- CreateIndex
CREATE INDEX "entity_company_group_id_is_active_idx" ON "entity"("company_group_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "entity_company_group_id_code_key" ON "entity"("company_group_id", "code");

-- CreateIndex
CREATE INDEX "entity_alias_alias_text_idx" ON "entity_alias"("alias_text");

-- CreateIndex
CREATE UNIQUE INDEX "entity_alias_entity_id_alias_text_key" ON "entity_alias"("entity_id", "alias_text");

-- CreateIndex
CREATE UNIQUE INDEX "document_type_company_group_id_code_key" ON "document_type"("company_group_id", "code");

-- CreateIndex
CREATE INDEX "storage_folder_company_group_id_entity_id_idx" ON "storage_folder"("company_group_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_folder_company_group_id_path_cache_key" ON "storage_folder"("company_group_id", "path_cache");

-- CreateIndex
CREATE INDEX "vendor_company_group_id_known_spam_idx" ON "vendor"("company_group_id", "known_spam");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_company_group_id_name_key" ON "vendor"("company_group_id", "name");

-- CreateIndex
CREATE INDEX "autopay_rule_company_group_id_entity_id_idx" ON "autopay_rule"("company_group_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "autopay_rule_vendor_id_entity_id_effective_from_key" ON "autopay_rule"("vendor_id", "entity_id", "effective_from");

-- CreateIndex
CREATE INDEX "routing_rule_company_group_id_priority_idx" ON "routing_rule"("company_group_id", "priority");

-- CreateIndex
CREATE INDEX "batch_company_group_id_created_at_idx" ON "batch"("company_group_id", "created_at");

-- CreateIndex
CREATE INDEX "document_company_group_id_status_disposition_idx" ON "document"("company_group_id", "status", "disposition");

-- CreateIndex
CREATE INDEX "document_company_group_id_entity_id_document_date_idx" ON "document"("company_group_id", "entity_id", "document_date");

-- CreateIndex
CREATE INDEX "document_company_group_id_due_date_idx" ON "document"("company_group_id", "due_date");

-- CreateIndex
CREATE INDEX "document_assigned_to_user_id_status_idx" ON "document"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "document_sha256_idx" ON "document"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "document_link_from_document_id_to_document_id_relation_key" ON "document_link"("from_document_id", "to_document_id", "relation");

-- CreateIndex
CREATE INDEX "document_event_document_id_created_at_idx" ON "document_event"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_idx" ON "notification"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_provider_account_id_key" ON "account"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_session_token_key" ON "session"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_identifier_token_key" ON "verification_token"("identifier", "token");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity" ADD CONSTRAINT "entity_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_alias" ADD CONSTRAINT "entity_alias_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_type" ADD CONSTRAINT "document_type_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_folder" ADD CONSTRAINT "storage_folder_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_folder" ADD CONSTRAINT "storage_folder_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_folder" ADD CONSTRAINT "storage_folder_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "storage_folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopay_rule" ADD CONSTRAINT "autopay_rule_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopay_rule" ADD CONSTRAINT "autopay_rule_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopay_rule" ADD CONSTRAINT "autopay_rule_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopay_rule" ADD CONSTRAINT "autopay_rule_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rule" ADD CONSTRAINT "routing_rule_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rule" ADD CONSTRAINT "routing_rule_route_to_user_id_fkey" FOREIGN KEY ("route_to_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_storage_folder_id_fkey" FOREIGN KEY ("storage_folder_id") REFERENCES "storage_folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_from_document_id_fkey" FOREIGN KEY ("from_document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_to_document_id_fkey" FOREIGN KEY ("to_document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_event" ADD CONSTRAINT "document_event_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_event" ADD CONSTRAINT "document_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions appended to the initial migration.
--
-- Prisma's schema language cannot express CHECK constraints, generated columns,
-- partial indexes or extensions. Kept here as a file so that if the initial
-- migration is ever recreated, these are re-appended rather than lost:
--
--   cat prisma/sql/invariants.sql >> prisma/migrations/<timestamp>_init/migration.sql
-- ---------------------------------------------------------------------------

-- The core audit invariant: archiving a document always has a stated reason, so
-- "why wasn't I shown this?" is answerable months later. Enforced by the database
-- rather than the application because it is the one rule that must never bend.
ALTER TABLE "document" ADD CONSTRAINT "document_archive_requires_reason"
  CHECK ("disposition" <> 'ARCHIVE' OR "disposition_reason" IS NOT NULL);

-- An autopay rule that ends before it starts would silently stop matching.
ALTER TABLE "autopay_rule" ADD CONSTRAINT "autopay_rule_effective_range"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- A document cannot be a chargeback of, or duplicate of, itself.
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_no_self_reference"
  CHECK ("from_document_id" <> "to_document_id");

-- Full-text search over the master log. A generated column keeps it in sync with
-- no trigger and no application code to forget. Weights: the final filename is the
-- strongest signal, then the original name and the human summary, then internal notes.
-- Vendor name and entity code live on other tables and are matched by join, not here.
ALTER TABLE "document" DROP COLUMN "search_vector";
ALTER TABLE "document" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("final_filename", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("original_filename", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("summary_note", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("internal_notes", '')), 'C')
  ) STORED;
CREATE INDEX "document_search_vector_idx" ON "document" USING GIN ("search_vector");

-- The open-queue read is the hottest query in the app (every role's landing page).
-- A partial index keeps it off the archived and soft-deleted bulk.
CREATE INDEX "document_open_queue_idx" ON "document" ("company_group_id", "due_date")
  WHERE "deleted_at" IS NULL AND "status" IN ('WAITING', 'IN_PROGRESS');

-- Trigram matching for vendor de-duplication on the classify screen ("Berkheimer"
-- vs "Berkheimer Tax Innovations") and for fuzzy entity-alias lookup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "vendor_name_trgm_idx" ON "vendor" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "entity_alias_text_trgm_idx" ON "entity_alias" USING GIN ("alias_text" gin_trgm_ops);

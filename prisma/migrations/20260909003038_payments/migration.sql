-- The payment table: a bill that was paid, and the proof.
--
-- Hand-trimmed. The generated version also wanted to DROP the five indexes and the
-- generated column that live in prisma/sql/invariants.sql, because they are not in
-- schema.prisma and every diff therefore reads them as strays. See the note in
-- 20260908230325_ai_read_attempts.

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "document_id" TEXT,
    "entity_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "payee_name" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paid_on" DATE NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "receipt_storage_key" TEXT,
    "receipt_storage_bucket" TEXT,
    "receipt_filename" TEXT,
    "receipt_mime_type" TEXT,
    "receipt_byte_size" INTEGER,
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_company_group_id_paid_on_idx" ON "payment"("company_group_id", "paid_on");

-- CreateIndex
CREATE INDEX "payment_company_group_id_entity_id_idx" ON "payment"("company_group_id", "entity_id");

-- CreateIndex
CREATE INDEX "payment_document_id_idx" ON "payment"("document_id");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payment of nothing is not a payment, and a negative one is a refund — which is a
-- different thing this table does not model yet. Better refused at the door than
-- silently averaged into a total later.
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_positive" CHECK ("amount" > 0);

-- A receipt is either wholly there or wholly absent: a key with no bucket cannot be
-- fetched, and a bucket with no key names nothing.
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_receipt_complete" CHECK (
    ("receipt_storage_key" IS NULL AND "receipt_storage_bucket" IS NULL)
    OR ("receipt_storage_key" IS NOT NULL AND "receipt_storage_bucket" IS NOT NULL)
  );

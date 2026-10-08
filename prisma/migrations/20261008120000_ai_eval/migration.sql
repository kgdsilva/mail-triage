-- Measuring the reader against documents whose answer is already known.
--
-- Additive only: two new tables and their indexes. Nothing is dropped, renamed or
-- rewritten, no existing row changes meaning, and nothing here touches `document` —
-- which is the point. Scoring the history by writing `ai_suggestion` onto it would
-- grade the answer key.
--
-- Separate tables rather than a column, for three reasons: a run has to be repeatable
-- so two runs can be compared after a change; the truth is snapshotted as it stood at
-- run time, so later corrections do not silently rewrite yesterday's score; and the raw
-- extraction is kept beside the pipeline's conclusion, so the next run is still
-- comparable after the entity decision moves from the model into the code.

-- CreateTable
CREATE TABLE "ai_eval_run" (
    "id" TEXT NOT NULL,
    "company_group_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "note" TEXT,
    "document_count" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ai_eval_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_result" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,

    -- The answer key as it stood when this ran.
    "truth_entity_id" TEXT,
    "truth_document_type_id" TEXT,
    "truth_disposition" TEXT NOT NULL,
    "truth_action_kind" TEXT,

    -- What the page said, and what the pipeline made of it. Both, deliberately.
    "extraction" JSONB,
    "suggestion" JSONB,
    "read_error" TEXT,

    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_eval_result_run_id_document_id_key" ON "ai_eval_result"("run_id", "document_id");

-- CreateIndex
CREATE INDEX "ai_eval_result_document_id_idx" ON "ai_eval_result"("document_id");

-- CreateIndex
CREATE INDEX "ai_eval_run_company_group_id_started_at_idx" ON "ai_eval_run"("company_group_id", "started_at");

-- AddForeignKey
ALTER TABLE "ai_eval_run" ADD CONSTRAINT "ai_eval_run_company_group_id_fkey" FOREIGN KEY ("company_group_id") REFERENCES "company_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_result" ADD CONSTRAINT "ai_eval_result_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_eval_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_eval_result" ADD CONSTRAINT "ai_eval_result_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

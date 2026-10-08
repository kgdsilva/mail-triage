'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import { readDocument } from '@/server/ai/read-document'
import { buildSuggestion } from '@/server/ai/suggest'
import { PILOT_SIZE, evalWhere, pilotDone } from '@/server/eval'
import { requireAdmin } from '@/server/session'
import type { Prisma } from '@/generated/prisma/client'

/**
 * Running the evaluation from the screen, in slices.
 *
 * ---------------------------------------------------------------------------
 * The one rule
 * ---------------------------------------------------------------------------
 *
 * Nothing here writes to `document`. Not the entity, not the decision, not the status,
 * not `aiSuggestion`. The imported history *is* the answer key, and the ordinary reading
 * path would overwrite it, adopt an entity from the page and possibly auto-apply a
 * decision — it would mark its own homework. That is why this calls `readDocument` and
 * `buildSuggestion` rather than `analyzeDocument`: the same prompt and the same rules as
 * production, with the writes left out.
 *
 * Only `ai_eval_run` and `ai_eval_result` are written.
 *
 * ---------------------------------------------------------------------------
 * Why slices
 * ---------------------------------------------------------------------------
 *
 * A read takes several seconds and a serverless function is killed after a few minutes,
 * so 347 of them cannot happen in one request. Each call takes a few documents and says
 * what is left, exactly as the reader button on Review does. Resuming is free and needs
 * no state: a slice is "documents in the set that this run has no result for yet", so
 * closing the tab and coming back later continues where it stopped.
 */

export type SliceResult = {
  processed: number
  failed: number
  remaining: number
  inputTokens: number
  outputTokens: number
  lastError: string | null
}

/**
 * Opens a run and fixes what it will cover.
 *
 * The pilot is the first ten documents of the set. The full run is the set, and it stays
 * refused until a pilot has read something — spending two dollars to discover the
 * reader cannot reach the files is avoidable, and the pilot is six cents.
 */
export async function startEvalRun(
  scope: 'pilot' | 'full',
  label: string,
  note?: string,
): Promise<{ runId: string; total: number }> {
  const session = await requireAdmin()

  if (scope === 'full' && !(await pilotDone(session.companyGroupId))) {
    throw new Error('Run the pilot of 10 first — the full set stays locked until it has read.')
  }

  const where = evalWhere(session.companyGroupId)
  const total =
    scope === 'pilot'
      ? Math.min(PILOT_SIZE, await prisma.document.count({ where }))
      : await prisma.document.count({ where })

  const run = await prisma.aiEvalRun.create({
    data: {
      companyGroupId: session.companyGroupId,
      label: label.trim() || (scope === 'pilot' ? 'Pilot of 10' : 'Full set'),
      model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5',
      note: note?.trim() || null,
      documentCount: total,
    },
    select: { id: true },
  })

  revalidatePath('/settings/evaluation')
  return { runId: run.id, total }
}

/**
 * Reads the next few documents of a run.
 *
 * `size` is small on purpose. Four is what the reader button uses and it keeps every
 * request well inside the platform's limit while staying visibly fast.
 */
export async function runEvalSlice(runId: string, size = 4): Promise<SliceResult> {
  const session = await requireAdmin()

  const run = await prisma.aiEvalRun.findFirst({
    where: { id: runId, companyGroupId: session.companyGroupId },
    select: { id: true, documentCount: true },
  })
  if (!run) throw new Error('Run not found')

  const done = await prisma.aiEvalResult.findMany({
    where: { runId: run.id },
    select: { documentId: true },
  })
  const doneIds = done.map((d) => d.documentId)

  /*
   * Ordered by creation and capped at the run's own size, so a pilot of ten always means
   * the same ten documents however many times it is resumed — and the slice is simply
   * the first few of those not yet recorded.
   */
  const candidates = await prisma.document.findMany({
    where: evalWhere(session.companyGroupId),
    orderBy: { createdAt: 'asc' },
    take: run.documentCount,
    select: {
      id: true,
      entityId: true,
      documentTypeId: true,
      disposition: true,
      actionKind: true,
    },
  })

  const pending = candidates.filter((d) => !doneIds.includes(d.id))
  const slice = pending.slice(0, size)

  let processed = 0
  let failed = 0
  let inputTokens = 0
  let outputTokens = 0
  let lastError: string | null = null

  for (const doc of slice) {
    // Copied in rather than joined at report time: a correction made next week must not
    // rewrite what this run scored.
    const truth = {
      truthEntityId: doc.entityId,
      truthDocumentTypeId: doc.documentTypeId,
      truthDisposition: doc.disposition,
      truthActionKind: doc.actionKind,
    }

    const read = await readDocument(session.companyGroupId, doc.id)

    if (!read.ok) {
      failed += 1
      lastError = read.error
      await prisma.aiEvalResult.create({
        data: { runId: run.id, documentId: doc.id, ...truth, readError: read.error },
      })
      continue
    }

    const suggestion = await buildSuggestion(session.companyGroupId, read.extraction)
    processed += 1
    inputTokens += read.usage.input
    outputTokens += read.usage.output

    await prisma.aiEvalResult.create({
      data: {
        runId: run.id,
        documentId: doc.id,
        ...truth,
        extraction: read.extraction as unknown as Prisma.InputJsonValue,
        suggestion: suggestion as unknown as Prisma.InputJsonValue,
        inputTokens: read.usage.input,
        outputTokens: read.usage.output,
      },
    })
  }

  const remaining = pending.length - slice.length

  const totals = await prisma.aiEvalResult.aggregate({
    where: { runId: run.id },
    _sum: { inputTokens: true, outputTokens: true },
  })

  await prisma.aiEvalRun.update({
    where: { id: run.id },
    data: {
      inputTokens: totals._sum.inputTokens ?? 0,
      outputTokens: totals._sum.outputTokens ?? 0,
      ...(remaining === 0 ? { finishedAt: new Date() } : {}),
    },
  })

  if (remaining === 0) revalidatePath('/settings/evaluation')

  return { processed, failed, remaining, inputTokens, outputTokens, lastError }
}

/**
 * Closes a run that was stopped part way.
 *
 * The results already recorded stay, and the report says how many of the intended
 * documents they cover — a half-run is still evidence, as long as it is labelled as one.
 */
export async function finishEvalRun(runId: string) {
  const session = await requireAdmin()
  const run = await prisma.aiEvalRun.findFirst({
    where: { id: runId, companyGroupId: session.companyGroupId },
    select: { id: true },
  })
  if (!run) throw new Error('Run not found')

  await prisma.aiEvalRun.update({ where: { id: run.id }, data: { finishedAt: new Date() } })
  revalidatePath('/settings/evaluation')
}

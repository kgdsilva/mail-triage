'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { analyzeDocument, type AiSuggestion } from '@/server/ai/suggest'
import { recordEvent } from '@/server/documents'
import { aiConfigured } from '@/server/ai/read-document'
import { requireTriage } from '@/server/session'

/**
 * Reads a document and returns the proposal, without committing anything.
 *
 * Called from the classify screen when a document has not been read yet, and by the
 * background pass that runs after an upload. Reading is cached on the record, so this
 * is safe to call repeatedly — it only costs money the first time, or when forced.
 */
export async function analyzeForClassify(
  documentId: string,
  force = false,
): Promise<{ ok: boolean; suggestion?: AiSuggestion; error?: string }> {
  const session = await requireTriage()
  const result = await analyzeDocument(session.companyGroupId, documentId, { force })

  if (result.ok) {
    revalidatePath(`/classify/${documentId}`)
    revalidatePath('/', 'layout')
  }
  return result
}

export async function isAiAvailable() {
  await requireTriage()
  return aiConfigured()
}

/**
 * Reads a slice of the documents that have never been read, and reports what is left.
 *
 * Deliberately a slice rather than the whole backlog. A serverless function is killed
 * at a few minutes, and a read takes several seconds, so one request can only ever get
 * through a handful — an "analyse everything" endpoint would simply time out partway
 * through an import and leave no record of where it stopped. The caller loops instead,
 * which also means progress is visible and the work can be stopped or resumed.
 */
export async function analyzeUnread(
  limit = 4,
): Promise<{
  processed: number
  applied: number
  escalated: number
  failed: number
  remaining: number
  lastError?: string
}> {
  const session = await requireTriage()
  if (!aiConfigured()) {
    return {
      processed: 0, applied: 0, escalated: 0, failed: 0, remaining: 0,
      lastError: 'ANTHROPIC_API_KEY is not set',
    }
  }

  const batch = await prisma.document.findMany({
    where: {
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      aiSuggestion: { equals: Prisma.DbNull },
      storageKey: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(1, limit), 10),
    select: { id: true },
  })

  let processed = 0
  let applied = 0
  let escalated = 0
  let failed = 0
  let lastError: string | undefined

  for (const doc of batch) {
    const result = await analyzeDocument(session.companyGroupId, doc.id)
    if (result.ok) {
      processed += 1
      if (result.applied) applied += 1
      else escalated += 1
    } else {
      failed += 1
      lastError = result.error
      // Mark it so a document that cannot be read never blocks the queue behind it —
      // otherwise the same failure is retried forever and the loop never drains.
      await prisma.document.update({
        where: { id: doc.id },
        data: { aiSuggestion: { error: result.error, failedAt: new Date().toISOString() } },
      })
    }
  }

  const remaining = await prisma.document.count({
    where: {
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      aiSuggestion: { equals: Prisma.DbNull },
      storageKey: { not: null },
    },
  })

  if (processed > 0) {
    // Layout scope: the nav badge is rendered there and has to move with the screen.
    revalidatePath('/', 'layout')
  }

  return { processed, applied, escalated, failed, remaining, lastError }
}

/** How many documents are still waiting to be read — drives the button's label. */
export async function countUnread(): Promise<{ unread: number; available: boolean }> {
  const session = await requireTriage()
  const unread = await prisma.document.count({
    where: {
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      aiSuggestion: { equals: Prisma.DbNull },
      storageKey: { not: null },
    },
  })
  return { unread, available: aiConfigured() }
}

/**
 * Answers the reader's question about whose document this is, and acts on the answer.
 *
 * The reader flags mail addressed to a name it does not recognise, and that is a
 * question only a person can settle — but until now the row offered pay, archive and
 * spam, three answers to a different question. Naming the entity here re-runs the
 * decision with the gap closed, so the row comes back with a real proposal instead of
 * needing a second guess.
 *
 * "Not company mail" is its own answer: personal post lands in a business scan pile
 * often enough that recording it as such is worth more than filing it under OTHER.
 */
export async function resolveEntity(
  documentId: string,
  entityId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireTriage()

  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      disposition: 'UNREVIEWED',
    },
    select: { id: true, entityId: true },
  })
  if (!doc) return { ok: false, error: 'Document not found, or already decided' }

  if (entityId === 'NOT_OURS') {
    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: {
          disposition: 'ARCHIVE',
          dispositionReason: 'NOT_COMPANY_MAIL',
          actionKind: null,
          status: 'ARCHIVED',
          reviewedByUserId: session.userId,
          reviewedAt: new Date(),
        },
      })
      await recordEvent(
        {
          documentId: doc.id,
          actorUserId: session.userId,
          action: 'classified',
          fromValue: { disposition: 'UNREVIEWED' },
          toValue: { disposition: 'ARCHIVE', dispositionReason: 'NOT_COMPANY_MAIL' },
        },
        tx,
      )
    })

    revalidatePath('/', 'layout')
    return { ok: true }
  }

  const entity = await prisma.entity.findFirst({
    where: { id: entityId, companyGroupId: session.companyGroupId, isActive: true },
    select: { id: true, code: true },
  })
  if (!entity) return { ok: false, error: 'Unknown entity' }

  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { entityId: entity.id } })
    await recordEvent(
      {
        documentId: doc.id,
        actorUserId: session.userId,
        action: 'reclassified',
        fromValue: { entityId: doc.entityId },
        toValue: { entityId: entity.id, source: 'answered on review' },
      },
      tx,
    )
  })

  // Read it again now the gap is closed: the filing rules can reach the autopay list,
  // and what was a question can come back as a proposal — or file itself, if the group
  // has that turned on.
  await analyzeDocument(session.companyGroupId, doc.id, { force: true })

  revalidatePath('/', 'layout')
  return { ok: true }
}

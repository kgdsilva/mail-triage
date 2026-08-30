'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { analyzeDocument, type AiSuggestion } from '@/server/ai/suggest'
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
    revalidatePath('/review')
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
    revalidatePath('/review')
    revalidatePath('/log')
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

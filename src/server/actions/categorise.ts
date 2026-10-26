'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import { recordEvent } from '@/server/documents'
import { readDocument } from '@/server/ai/read-document'
import {
  categoryByName,
  needsCategoryWhere,
  needsRereadWhere,
  otherCategoryId,
} from '@/server/categorise'
import { requireAdmin } from '@/server/session'

/**
 * Reads a few documents and writes their category. Nothing else.
 *
 * Sliced for the same reason every other long job here is: a read takes seconds and a
 * serverless function is killed after minutes, so 435 of them cannot be one request.
 * Resuming needs no state — a slice is "has a file, has no category", so stopping and
 * starting again simply continues.
 *
 * It halts on a platform failure rather than walking the backlog collecting the same
 * error, and a platform failure is never held against a document: that distinction cost
 * this project a whole backlog once already.
 */

export type CategoriseResult = {
  processed: number
  filled: number
  /** Read fine, but the reader found no category that fits. Not a failure. */
  unmatched: number
  failed: number
  remaining: number
  inputTokens: number
  outputTokens: number
  lastError: string | null
  halted: boolean
}

/**
 * `reread` is the second pass: the documents the first list could not place.
 *
 * One function rather than two, because the only differences are which documents are
 * picked and which event retires them. A copy would be a copy of the halt handling, the
 * slice bounds and the "a person's choice wins" transaction — the three things here that
 * were got wrong once each and are now right.
 */
export async function categoriseSlice(
  size = 4,
  mode: 'fill' | 'reread' = 'fill',
): Promise<CategoriseResult> {
  const session = await requireAdmin()

  const other = mode === 'reread' ? await otherCategoryId(session.companyGroupId) : null
  const where =
    mode === 'reread'
      ? needsRereadWhere(session.companyGroupId, other)
      : needsCategoryWhere(session.companyGroupId)
  const event = mode === 'reread' ? 'recategorised' : 'categorised'

  const docs = await prisma.document.findMany({
    where,
    // Oldest first, so a run that is stopped and resumed moves through the log in a
    // predictable order rather than revisiting the same end of it.
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(1, size), 10),
    select: { id: true },
  })

  const byName = await categoryByName(session.companyGroupId)

  let processed = 0
  let filled = 0
  let unmatched = 0
  let failed = 0
  let inputTokens = 0
  let outputTokens = 0
  let lastError: string | null = null
  let halted = false

  for (const doc of docs) {
    const read = await readDocument(session.companyGroupId, doc.id)

    if (!read.ok) {
      lastError = read.error
      if (read.cause === 'environment') {
        // The platform, not the page. Stop; nothing is recorded against the document.
        halted = true
        break
      }
      failed += 1
      continue
    }

    processed += 1
    inputTokens += read.usage.input
    outputTokens += read.usage.output

    const name = read.extraction.categoryName?.trim().toLowerCase()
    const categoryId = name ? byName.get(name) : undefined

    if (!categoryId) {
      /*
       * No category fits, and that is an answer. A bank statement belongs to none of
       * them, and forcing it into "Other" would make the filter Eric wants mean less.
       *
       * The event is written anyway, with a null category. That is what stops this
       * document being read — and paid for — on every subsequent pass, and it is the
       * difference between a run that finishes and one that never does.
       */
      unmatched += 1
      await recordEvent({
        documentId: doc.id,
        actorUserId: session.userId,
        action: event,
        toValue: {
          category: null,
          via: mode === 'reread' ? 'reread' : 'backfill',
          readAs: read.extraction.categoryName,
          readAsType: read.extraction.documentTypeCode,
        },
      })
      continue
    }

    await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: a person may have set one while this ran, and
      // their choice always wins.
      /*
       * On the second pass "unchanged" means still null or still Other — those are the
       * two answers this pass exists to replace. Anything else means somebody or
       * something decided in between, and that decision stands.
       */
      const fresh = await tx.document.findFirst({
        where:
          mode === 'reread'
            ? { id: doc.id, OR: [{ categoryId: null }, ...(other ? [{ categoryId: other }] : [])] }
            : { id: doc.id, categoryId: null },
        select: { id: true },
      })
      if (!fresh) return

      await tx.document.update({ where: { id: doc.id }, data: { categoryId } })
      await recordEvent(
        {
          documentId: doc.id,
          actorUserId: session.userId,
          action: event,
          toValue: {
            category: read.extraction.categoryName,
            via: mode === 'reread' ? 'reread' : 'backfill',
            // The type is deliberately not written, but what the reader thought it was
            // is worth keeping: it is the evidence for typing the 28 insurance
            // documents later without paying to read them twice.
            readAsType: read.extraction.documentTypeCode,
          },
        },
        tx,
      )
      filled += 1
    })
  }

  const remaining = await prisma.document.count({ where })

  if (filled > 0) revalidatePath('/', 'layout')

  return {
    processed,
    filled,
    unmatched,
    failed,
    remaining,
    inputTokens,
    outputTokens,
    lastError,
    halted,
  }
}

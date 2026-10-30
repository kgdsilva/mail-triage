'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import { archiveWithReason, quickDecide, recordEvent, type ArchiveReason } from '@/server/documents'
import { approversFor, toDecideWhere } from '@/server/to-decide'
import { entityWhere, visibleEntityIds } from '@/server/scope'
import { requirePaymentTriage, requireSession } from '@/server/session'

/**
 * The accountant's three answers to "what is this".
 *
 * Narrow by construction: each one re-reads the document through `toDecideWhere`, so
 * none of them can touch a document that is not a money document awaiting a decision —
 * not an HR letter, not something already approved, not a cheque received. The role
 * check alone would not give that; the predicate does.
 */

type Result = { ok: boolean; error?: string }

/** The document, only if it is genuinely this person's to decide. */
async function decidable(session: Awaited<ReturnType<typeof requirePaymentTriage>>, id: string) {
  const scope = await visibleEntityIds(session)
  return prisma.document.findFirst({
    where: {
      id,
      ...toDecideWhere(session.companyGroupId),
      ...entityWhere(scope),
    },
    select: { id: true, entityId: true, amount: true, originalFilename: true },
  })
}

/**
 * Sends it for approval: this has to be paid, and somebody else says yes.
 *
 * Refuses when the company has no approver. The alternative — marking it PENDING anyway
 * — produces a bill that is waiting on nobody and looks exactly like one waiting on
 * somebody slow, and the difference only shows up when it is overdue.
 */
export async function markNeedsPayment(documentId: string, note?: string): Promise<Result> {
  const session = await requirePaymentTriage()

  const doc = await decidable(session, documentId)
  if (!doc) return { ok: false, error: 'Not yours to decide — it may have moved.' }
  if (!doc.entityId) return { ok: false, error: 'Set the company on this first.' }
  if (doc.amount === null) {
    return { ok: false, error: 'Put the amount on it first — an approver needs to know what they are clearing.' }
  }

  const approvers = await approversFor(session.companyGroupId, doc.entityId)
  if (approvers.length === 0) {
    return {
      ok: false,
      error:
        'That company has no approver yet, so this would wait on nobody. Ask for an approver to be assigned in Settings → Members first.',
    }
  }

  await quickDecide(session.companyGroupId, documentId, session.userId, 'PAY')

  if (note?.trim()) {
    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: { internalNotes: note.trim().slice(0, 2000) },
      })
      await recordEvent(
        {
          documentId,
          actorUserId: session.userId,
          action: 'note_added',
          toValue: { note: note.trim().slice(0, 2000), by: 'accounting' },
        },
        tx,
      )
    })
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Not a bill: files it, with the reason on the record.
 *
 * The reason is required and comes from a list rather than a free box, because this is
 * the decision an auditor reads back: "why was this never paid" has to answer itself a
 * year later, and "archived" alone does not.
 */
export async function markNotABill(documentId: string, reason: string): Promise<Result> {
  const session = await requirePaymentTriage()

  /*
   * The reasons are the ones the database already knows, not a new vocabulary. Every
   * archived document in the log is filed under one of these, and inventing a parallel
   * set here would split the same decision across two words and make the Master log's
   * reason filter lie.
   */
  const REASONS: Record<string, ArchiveReason> = {
    spam: 'SPAM_SOLICITATION',
    statement: 'FYI_STATEMENT',
    check: 'INCOMING_CHECK',
    'not-ours': 'NOT_COMPANY_MAIL',
    other: 'OTHER',
  }
  const mapped = REASONS[reason]
  if (!mapped) return { ok: false, error: 'Choose why it is not a bill.' }

  const doc = await decidable(session, documentId)
  if (!doc) return { ok: false, error: 'Not yours to decide — it may have moved.' }

  await archiveWithReason(session.companyGroupId, documentId, session.userId, mapped)

  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Somebody else's problem, said out loud.
 *
 * Money-adjacent mail that is not a payment — an HR letter that arrived with an invoice,
 * a legal notice for Megan. It leaves the accountant's tab and lands in the named
 * person's queue with the note, which is the same handoff the triage screen does; it is
 * repeated here only because the accountant cannot reach that screen.
 */
export async function markNeedsOtherAction(
  documentId: string,
  toUserId: string,
  note: string,
): Promise<Result> {
  const session = await requirePaymentTriage()

  const typed = note.trim()
  if (typed.length < 3) return { ok: false, error: 'Say briefly what is needed.' }

  const doc = await decidable(session, documentId)
  if (!doc) return { ok: false, error: 'Not yours to decide — it may have moved.' }

  const recipient = await prisma.membership.findFirst({
    where: { userId: toUserId, companyGroupId: session.companyGroupId, isActive: true },
    select: { userId: true },
  })
  if (!recipient) return { ok: false, error: 'That person is not an active member.' }

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        disposition: 'ACTION',
        dispositionReason: null,
        actionKind: 'REVIEW',
        status: 'WAITING',
        assignedToUserId: recipient.userId,
        reviewedByUserId: session.userId,
        reviewedAt: new Date(),
      },
    })
    await recordEvent(
      {
        documentId,
        actorUserId: session.userId,
        action: 'routed',
        toValue: { assignedToUserId: recipient.userId, actionKind: 'REVIEW', note: typed, from: 'accounting' },
      },
      tx,
    )
  })

  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * The answer to a question somebody handed you.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own action
 * ---------------------------------------------------------------------------
 *
 * Writing a note anywhere else in this file goes through requirePaymentTriage, which an
 * approver does not have and should not: notes on the money queue are the accountant's.
 * But the person who can answer "do we have property in Homestead?" is precisely the
 * approver, and before this he had no way to write the answer down — he could read the
 * question and not reply to it.
 *
 * The permission is therefore not a role at all. It is being the person it was handed
 * to: whoever is named on the document may answer it, whatever their role, and nobody
 * else may. That is narrower than any role check would be.
 *
 * Answering clears the assignment and leaves the note behind. It does not route the
 * document anywhere, because it never left the queue it was in — the accountant still
 * has to decide what it is, and now has the answer to decide with.
 */
export async function answerHandover(documentId: string, answer: string): Promise<Result> {
  const session = await requireSession()

  const text = answer.trim()
  if (!text) return { ok: false, error: 'Write the answer first.' }

  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      // The whole permission check: it is yours because your name is on it.
      assignedToUserId: session.userId,
    },
    select: { id: true, internalNotes: true },
  })

  if (!doc) {
    return { ok: false, error: 'Not yours to answer — it may have been handed on.' }
  }

  const note = text.slice(0, 2000)

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        // Kept, not replaced: the question that was asked is part of the record, and an
        // answer that erased it would leave the next reader with a reply to nothing.
        internalNotes: doc.internalNotes ? `${doc.internalNotes}\n\n${note}` : note,
        assignedToUserId: null,
      },
    })
    await recordEvent(
      {
        documentId,
        actorUserId: session.userId,
        action: 'note_added',
        toValue: { note, by: 'handover-answer' },
      },
      tx,
    )
  })

  revalidatePath('/', 'layout')
  return { ok: true }
}

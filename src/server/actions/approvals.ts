'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ApprovalStatus } from '@/generated/prisma/enums'
import { prisma } from '@/server/db/client'
import { recordEvent } from '@/server/documents'
import { entityWhere, visibleEntityIds } from '@/server/scope'
import { returnTo } from '@/server/returns'
import { requireApprover } from '@/server/session'

/**
 * Approving, refusing, and asking a question about a bill.
 *
 * Three verbs on one path, because they differ only in what they write and in whether a
 * note is required — and keeping them together is what makes it obvious that all three
 * are recorded the same way. There is no fourth verb that quietly changes a bill: an
 * approver cannot edit the document, which is what makes their approval mean anything.
 */

export type Decision = 'APPROVED' | 'DENIED' | 'NEEDS_REVIEW'

const noteSchema = z.string().trim().min(3, 'Say briefly why.').max(2000)

/**
 * The bills this person is allowed to decide, checked at the moment of writing.
 *
 * Re-read rather than trusted from the page that drew the button: a list is a view from
 * a moment ago, and the scope might have changed since — or the id might never have been
 * on any list this person was shown.
 */
async function decidable(session: { companyGroupId: string; role: string; entityScope: string[]; userId: string }, ids: string[]) {
  const scope = await visibleEntityIds(session as never)

  return prisma.document.findMany({
    where: {
      id: { in: ids },
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      // Having a status is what makes it a bill. Not `actionKind: 'PAY'`: a bill that
      // was sent back is a REVIEW action, and changing that earlier decision is
      // explicitly allowed.
      approvalStatus: { not: null },
      ...entityWhere(scope),
    },
    select: { id: true, approvalStatus: true, assignedToUserId: true, amount: true },
  })
}

async function decide(
  documentIds: string[],
  decision: Decision,
  note: string | null,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const session = await requireApprover()

  if (decision !== 'APPROVED') {
    const parsed = noteSchema.safeParse(note ?? '')
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'A note is required.' }
    }
    note = parsed.data
  } else {
    note = null
  }

  const targets = await decidable(session, documentIds)
  if (targets.length === 0) return { ok: false, error: 'Nothing to decide — it may have moved.' }

  const returning = decision !== 'APPROVED'
  const returnee = returning ? await returnTo(session.companyGroupId) : null

  for (const target of targets) {
    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: target.id },
        data: {
          approvalStatus: decision as ApprovalStatus,
          approvalNote: note,
          approvalDecidedByUserId: session.userId,
          approvalDecidedAt: new Date(),
          ...(returning
            ? {
                actionKind: 'REVIEW' as const,
                status: 'WAITING' as const,
                assignedToUserId: returnee,
              }
            : {}),
        },
      })

      await recordEvent(
        {
          documentId: target.id,
          actorUserId: session.userId,
          action:
            decision === 'APPROVED'
              ? 'approved'
              : decision === 'DENIED'
                ? 'denied'
                : 'needs_review',
          fromValue: { approvalStatus: target.approvalStatus },
          toValue: {
            approvalStatus: decision,
            note,
            ...(returning ? { returnedTo: returnee, actionKind: 'REVIEW' } : {}),
          },
        },
        tx,
      )
    })
  }

  revalidatePath('/', 'layout')
  return { ok: true, count: targets.length }
}

/** One click, no note. The common case, and the only one that is one click. */
export async function approveBill(documentId: string) {
  return decide([documentId], 'APPROVED', null)
}

export async function denyBill(documentId: string, note: string) {
  return decide([documentId], 'DENIED', note)
}

export async function flagForReview(documentId: string, note: string) {
  return decide([documentId], 'NEEDS_REVIEW', note)
}

/**
 * Approving a batch.
 *
 * The count comes back so the screen can say what actually happened rather than what was
 * asked for — if two of eleven moved out of scope while the page sat open, "9 approved"
 * is the truth and "11 approved" is not.
 */
export async function approveSelected(documentIds: string[]) {
  return decide(documentIds, 'APPROVED', null)
}

/** Totals for the bulk confirmation, so nobody approves a number they have not seen. */
export async function selectionTotal(documentIds: string[]) {
  const session = await requireApprover()
  const targets = await decidable(session, documentIds)

  const total = targets.reduce((sum, t) => sum + Number(t.amount ?? 0), 0)
  return { count: targets.length, total }
}

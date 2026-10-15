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

  /*
   * A refusal must say why; an approval may.
   *
   * They are not the same obligation. Sending a bill back without a reason leaves the
   * next person guessing, so the note is required and has a minimum. Approving is the
   * common path and has to stay one click — but an approver often knows something the
   * person paying does not ("pay this with the Munar card"), and before this there was
   * nowhere to put it: the note was discarded on approval.
   */
  if (decision !== 'APPROVED') {
    const parsed = noteSchema.safeParse(note ?? '')
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'A note is required.' }
    }
    note = parsed.data
  } else {
    const typed = (note ?? '').trim()
    if (typed.length > 2000) return { ok: false, error: 'That note is too long.' }
    note = typed.length > 0 ? typed : null
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
export async function approveBill(documentId: string, note?: string) {
  return decide([documentId], 'APPROVED', note ?? null)
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

/**
 * Approves a bill that was already paid at the till, and records the payment with it.
 *
 * The case is a card charged at the moment of purchase — an Amex on a subscription, a
 * conference ticket. Sending that through the queue asks the accountant to "pay" money
 * that has already left, and the bill sits in Ready to pay as a lie until somebody
 * notices. So the two acts are recorded as what they were: one person, one moment.
 *
 * This is the single exception to the rule that nobody settles what they approved, and
 * it is narrow on purpose:
 *
 *   - only an approver can reach it, and only for bills inside their own entity scope;
 *   - the method and the last four digits are both required, so the trail names the
 *     card rather than saying "paid, somehow";
 *   - the approval and the payment are two separate events on the document, not one —
 *     an audit that cannot see both halves cannot see the exception either.
 *
 * It is not a way to pay a bill by cheque or transfer without a second person. Those
 * still go to the accountant, which is the whole control.
 */
export async function approveAndRecordCardPayment(
  documentId: string,
  input: { method: string; reference: string; note?: string },
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireApprover()

  const method = input.method.trim()
  if (method.length < 2) return { ok: false, error: 'Say which card or account paid it.' }

  // Four digits, because that is what a card statement shows and what reconciling
  // against it needs. Not the whole number — this record is read by people.
  const reference = input.reference.trim()
  if (!/^\d{4}$/.test(reference)) {
    return { ok: false, error: 'Enter the last four digits of the card.' }
  }

  const [target] = await decidable(session, [documentId])
  if (!target) return { ok: false, error: 'Nothing to decide — it may have moved.' }
  if (target.approvalStatus === 'APPROVED') {
    return { ok: false, error: 'That bill is already approved — record the payment from Accounting.' }
  }

  const doc = await prisma.document.findFirstOrThrow({
    where: { id: documentId },
    select: { id: true, entityId: true, vendorId: true, amount: true, status: true },
  })
  if (!doc.entityId) return { ok: false, error: 'Set the company on this bill first.' }
  if (doc.amount === null) return { ok: false, error: 'Set the amount on this bill first.' }

  const note = (input.note ?? '').trim().slice(0, 2000) || null

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: doc.id },
      data: {
        approvalStatus: 'APPROVED',
        approvalNote: note,
        approvalDecidedByUserId: session.userId,
        approvalDecidedAt: new Date(),
        // Paid is finished: it leaves every queue, the accountant's included.
        status: 'DONE',
      },
    })

    await recordEvent(
      {
        documentId: doc.id,
        actorUserId: session.userId,
        action: 'approved',
        fromValue: { approvalStatus: target.approvalStatus },
        toValue: { approvalStatus: 'APPROVED', note, via: 'approve-and-pay' },
      },
      tx,
    )

    const payment = await tx.payment.create({
      data: {
        companyGroupId: session.companyGroupId,
        documentId: doc.id,
        entityId: doc.entityId!,
        vendorId: doc.vendorId,
        amount: doc.amount!,
        paidOn: new Date(),
        method,
        reference,
        note: 'Paid by card at purchase; approved and recorded together.',
        recordedByUserId: session.userId,
      },
      select: { id: true },
    })

    await recordEvent(
      {
        documentId: doc.id,
        actorUserId: session.userId,
        action: 'status_changed',
        fromValue: { status: doc.status },
        toValue: {
          status: 'DONE',
          via: 'approve-and-pay',
          paymentId: payment.id,
          method,
          reference,
        },
      },
      tx,
    )
  })

  revalidatePath('/', 'layout')
  return { ok: true }
}

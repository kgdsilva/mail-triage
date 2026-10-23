'use server'

import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import { recordEvent } from '@/server/documents'
import { approversFor } from '@/server/to-decide'
import { visibleEntityIds } from '@/server/scope'
import { requireBillAdder } from '@/server/session'
import { buildKey, deleteObject, putObject } from '@/server/storage'

/**
 * A bill that did not arrive as post.
 *
 * The platform was built around a scanner: mail arrives, somebody photographs it, the
 * reader describes it, a person decides. That covers the post and nothing else — and a
 * growing share of what has to be paid never touches paper. A vendor emails the invoice
 * to the approver. A subscription renews and the only record is a web page. The
 * accountant is sent a statement directly.
 *
 * For those, this is the front door: one form, a file, and the bill is in the approval
 * queue in the same state it would have reached by any other route. No parallel path
 * through the system, no second kind of bill — the difference ends at how it got in.
 *
 * ---------------------------------------------------------------------------
 * The rules it keeps
 * ---------------------------------------------------------------------------
 *
 *   - A file is required, always. Eric's rule, and the reason is that a link dies with
 *     the account: cancel the subscription and the invoice you were keeping is a 404.
 *     A screenshot or a printed page is fine; nothing is not.
 *   - It refuses when the company has no approver, exactly as the accountant's button
 *     does. A bill waiting on nobody is the failure this workflow is for.
 *   - Who added it is recorded, and shows on the approval card. Somebody adding a
 *     payable and then approving it is a conflict the history has to be able to show,
 *     even where it is not forbidden — an approver adding a bill for their own company
 *     is often the whole point, so it is visible rather than blocked.
 */

const MAX_BYTES = 4 * 1024 * 1024
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'])

export type AddBillResult = { ok: boolean; error?: string; documentId?: string }

export async function addBill(formData: FormData): Promise<AddBillResult> {
  const session = await requireBillAdder()

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Attach the invoice. A link is not enough — it dies with the account.' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'That file is over 4 MB. Save it smaller, or ask for it to be uploaded as a batch.' }
  }

  const contentType = file.type || 'application/pdf'
  if (!ALLOWED.has(contentType)) {
    return { ok: false, error: `${contentType} is not a document the reader can open.` }
  }

  const entityId = String(formData.get('entityId') ?? '').trim()
  const vendorName = String(formData.get('vendorName') ?? '').trim()
  const amountRaw = String(formData.get('amount') ?? '').replace(/[^0-9.]/g, '')
  const dueDate = String(formData.get('dueDate') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!entityId) return { ok: false, error: 'Choose which company owes this.' }
  if (vendorName.length < 2) return { ok: false, error: 'Who is it from?' }

  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Enter the amount — the approver is clearing a number.' }
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return { ok: false, error: 'That due date is not a date.' }
  }

  // Scoped as well as owned: an approver can only add bills for their own companies.
  const scope = await visibleEntityIds(session)
  const entity = await prisma.entity.findFirst({
    where: {
      id: entityId,
      companyGroupId: session.companyGroupId,
      isActive: true,
      ...(scope === null ? {} : { id: { in: scope } }),
    },
    select: { id: true, code: true },
  })
  if (!entity) return { ok: false, error: 'That is not one of your companies.' }

  const approvers = await approversFor(session.companyGroupId, entity.id)
  if (approvers.length === 0) {
    return {
      ok: false,
      error: `${entity.code} has no approver yet, so this would wait on nobody. Ask for one to be assigned in Settings → Members first.`,
    }
  }

  /*
   * The vendor is matched, never invented. Vendors carry autopay rules and a typo that
   * creates a second "Verizon" is how a rule ends up attached to a record nothing uses.
   */
  const vendor = await prisma.vendor.findFirst({
    where: {
      companyGroupId: session.companyGroupId,
      name: { equals: vendorName, mode: 'insensitive' },
    },
    select: { id: true },
  })

  const billType = await prisma.documentType.findFirst({
    where: { companyGroupId: session.companyGroupId, code: 'BILL' },
    select: { id: true },
  })

  const bytes = Buffer.from(await file.arrayBuffer())
  const key = buildKey(session.companyGroupId, path.extname(file.name) || '.pdf')
  const stored = await putObject(key, bytes, contentType)

  try {
    // Same content already here? Say so rather than quietly making a second copy of a
    // bill somebody is about to approve twice.
    const twin = await prisma.document.findFirst({
      where: { companyGroupId: session.companyGroupId, sha256: stored.sha256, deletedAt: null },
      select: { id: true, originalFilename: true },
    })
    if (twin) {
      await deleteObject(stored.key, stored.bucket)
      return {
        ok: false,
        error: `That exact file is already here, as “${twin.originalFilename}”. Check it before adding another.`,
      }
    }

    const doc = await prisma.document.create({
      data: {
        companyGroupId: session.companyGroupId,
        originalFilename: file.name,
        storageKey: stored.key,
        storageBucket: stored.bucket,
        mimeType: contentType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        entityId: entity.id,
        documentTypeId: billType?.id ?? null,
        vendorId: vendor?.id ?? null,
        amount: amount.toFixed(2),
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null,
        // Straight into the approval queue: whoever added it already knows it is a bill.
        disposition: 'ACTION',
        dispositionReason: 'MANUAL_INVOICE',
        actionKind: 'PAY',
        status: 'WAITING',
        approvalStatus: 'PENDING',
        summaryNote: note || null,
        reviewedByUserId: session.userId,
        reviewedAt: new Date(),
      },
      select: { id: true },
    })

    await recordEvent({
      documentId: doc.id,
      actorUserId: session.userId,
      action: 'added_by_hand',
      toValue: {
        originalFilename: file.name,
        entity: entity.code,
        vendorName,
        amount: amount.toFixed(2),
        dueDate: dueDate || null,
        note: note || null,
        // So the approval card can say who put it there, which is the control.
        addedBy: session.userName,
      },
    })

    revalidatePath('/', 'layout')
    return { ok: true, documentId: doc.id }
  } catch (err) {
    // Never leave an orphan object when the row could not be written.
    await deleteObject(stored.key, stored.bucket)
    throw err
  }
}

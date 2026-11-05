'use server'

import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import { recordEvent } from '@/server/documents'
import { approversFor } from '@/server/to-decide'
import { someoneOf } from '@/lib/whose-turn'
import { visibleEntityIds } from '@/server/scope'
import { requireBillAdder } from '@/server/session'
import {
  buildKey,
  deleteObject,
  headObject,
  presignPut,
  putObject,
  storageBucket,
  supportsDirectUpload,
} from '@/server/storage'

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

/**
 * Two ceilings, because there are two ways in.
 *
 * `MAX_INLINE` is not ours. A server action's whole request body is capped at 4.5 MB on
 * every Vercel plan, and a larger one is rejected at the edge before any of this runs —
 * so a form that posts the bytes can never carry more, whatever we write here.
 *
 * `MAX_DIRECT` is the real limit, and it applies when the browser uploads to object
 * storage itself and sends only the keys. That is the same road the batch upload has
 * always taken; this form simply never took it, which is why attaching two photographs
 * of hotel receipts failed while attaching the same two to a batch did not.
 */
const MAX_INLINE = 4 * 1024 * 1024
const MAX_DIRECT = 50 * 1024 * 1024
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'])

export type SignedBillUpload =
  | { ok: true; key: string; url: string }
  | { ok: false; error: string }

/**
 * A short-lived URL the browser can PUT one receipt to, bypassing this server.
 *
 * Gated by the same permission as adding the bill itself, and the key is built here so
 * it cannot be written outside the caller's own company group.
 */
export async function signBillUpload(
  filename: string,
  contentType: string,
  size: number,
): Promise<SignedBillUpload> {
  const session = await requireBillAdder()

  if (!supportsDirectUpload()) {
    return { ok: false, error: 'Direct upload is not configured here.' }
  }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'That file is empty.' }
  if (size > MAX_DIRECT) {
    return {
      ok: false,
      error: `“${filename}” is ${(size / 1024 / 1024).toFixed(1)} MB and the limit is 50 MB. Scan it at a lower resolution, or split it.`,
    }
  }
  if (!ALLOWED.has(contentType)) {
    return { ok: false, error: `${contentType} is not a document the reader can open.` }
  }

  const key = buildKey(session.companyGroupId, path.extname(filename) || '.pdf')
  return { ok: true, key, url: await presignPut(key, contentType) }
}

/** One receipt that already reached storage, as the form reports it back. */
type Uploaded = { key: string; name: string; type: string; sha256: string | null }

function readUploaded(raw: string): Uploaded[] | null {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter((u) => u && typeof u.key === 'string' && typeof u.name === 'string')
      .map((u) => ({
        key: String(u.key),
        name: String(u.name),
        type: typeof u.type === 'string' && u.type ? String(u.type) : 'application/pdf',
        sha256: typeof u.sha256 === 'string' && u.sha256 ? String(u.sha256) : null,
      }))
  } catch {
    return null
  }
}

export type AddBillResult = {
  ok: boolean
  error?: string
  documentId?: string
  /** Where it went, in words — including when the answer is "nobody, yet". */
  went?: string
}

export async function addBill(formData: FormData): Promise<AddBillResult> {
  const session = await requireBillAdder()

  /*
   * One bill, several pieces of paper.
   *
   * "If I travel and pay for food, a hotel and an Uber, it is all one reimbursement
   * cheque but it is from three receipts." That is one thing to approve and one cheque
   * to write, evidenced by three files — so the first file is the bill and the rest are
   * filed beside it and linked to it. They are real documents, kept and searchable, and
   * they are archived on arrival so none of them turns up in a queue asking to be
   * decided: there is nothing to decide about a receipt that belongs to a bill.
   */
  /*
   * One list, whichever road the files came by.
   *
   * When the browser could upload to storage itself it has already done so and sends
   * back keys; when it could not, the bytes are in this request. Everything after this
   * point is written once and does not care which happened — the only difference is
   * where the object comes from, and `place` is the one function that knows.
   */
  const uploadedRaw = String(formData.get('uploads') ?? '').trim()
  const uploaded = uploadedRaw ? readUploaded(uploadedRaw) : null
  if (uploadedRaw && !uploaded) {
    return { ok: false, error: 'The upload could not be read. Choose the files again.' }
  }

  type Part = { name: string; type: string; file?: File; key?: string; sha256?: string | null }

  let parts: Part[]
  if (uploaded && uploaded.length > 0) {
    for (const u of uploaded) {
      // Signed for this group, but checked again rather than trusted from the round trip.
      if (!u.key.startsWith(`${session.companyGroupId}/`)) {
        return { ok: false, error: 'That upload does not belong to this workspace.' }
      }
      if (!ALLOWED.has(u.type)) {
        return { ok: false, error: `${u.type} is not a document the reader can open.` }
      }
    }
    parts = uploaded.map((u) => ({ name: u.name, type: u.type, key: u.key, sha256: u.sha256 }))
  } else {
    const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
    for (const f of files) {
      const type = f.type || 'application/pdf'
      if (!ALLOWED.has(type)) {
        return { ok: false, error: `${type} is not a document the reader can open.` }
      }
    }
    /*
     * This branch only runs where the browser could not upload directly, and there the
     * platform's 4.5 MB body cap is a wall we cannot move. Said as a total, with the
     * number, because "upload failed" sends somebody back to try the same thing again.
     */
    const total = files.reduce((sum, f) => sum + f.size, 0)
    if (total > MAX_INLINE) {
      return {
        ok: false,
        error: `Those ${files.length} files come to ${(total / 1024 / 1024).toFixed(1)} MB together, and the limit here is 4 MB. Upload them as a batch instead.`,
      }
    }
    parts = files.map((f) => ({ name: f.name, type: f.type || 'application/pdf', file: f }))
  }

  const [first, ...extras] = parts

  if (!first) {
    return { ok: false, error: 'Attach the invoice. A link is not enough — it dies with the account.' }
  }

  /** Where the object actually is, however it got there. */
  const place = async (part: Part) => {
    if (part.key) {
      const head = await headObject(part.key)
      if (!head) throw new Error(`“${part.name}” did not arrive in storage.`)
      return {
        key: part.key,
        bucket: storageBucket(),
        byteSize: head.byteSize,
        // Hashed in the browser: with a direct upload the bytes never pass through
        // here, so this is a duplicate hint rather than a guarantee.
        sha256: part.sha256 ?? null,
      }
    }
    const bytes = Buffer.from(await part.file!.arrayBuffer())
    return putObject(buildKey(session.companyGroupId, path.extname(part.name) || '.pdf'), bytes, part.type)
  }

  const file = { name: first.name }
  const contentType = first.type

  const categoryId = String(formData.get('categoryId') ?? '').trim()
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

  /*
   * No approver is a warning, not a wall.
   *
   * This used to refuse the whole thing: no approver, no bill. The reasoning was that a
   * bill waiting on nobody looks exactly like a bill waiting on somebody slow — which is
   * true, and is an argument for saying so, not for turning the bill away. The money is
   * owed either way. Refusing the record does not make the bill stop existing; it keeps
   * it in somebody's inbox instead of in the one place the office looks, which is the
   * failure this whole system exists to prevent.
   *
   * The visible half is already built: a bill with nobody to clear it reads "Waiting on
   * approval — no approver is assigned", in red, on the row. So it is recorded, and the
   * screen says plainly what it is waiting for.
   */
  const approvers = await approversFor(session.companyGroupId, entity.id)

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

  /*
   * Checked against this group's own categories rather than trusted from the form: the
   * id arrives from a browser, and a category belonging to another workspace would file
   * the bill under a name nobody here can see.
   */
  const category = categoryId
    ? await prisma.category.findFirst({
        where: { id: categoryId, companyGroupId: session.companyGroupId, isActive: true },
        select: { id: true },
      })
    : null

  const billType = await prisma.documentType.findFirst({
    where: { companyGroupId: session.companyGroupId, code: 'BILL' },
    select: { id: true },
  })

  const stored = await place(first)

  try {
    // Same content already here? Say so rather than quietly making a second copy of a
    // bill somebody is about to approve twice.
    const twin = stored.sha256
      ? await prisma.document.findFirst({
          where: { companyGroupId: session.companyGroupId, sha256: stored.sha256, deletedAt: null },
          select: { id: true, originalFilename: true },
        })
      : null
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
        /*
         * The typed name, kept when it matched no vendor — which on a reimbursement is
         * every time. Before this it was thrown away and the approver was shown the
         * filename of the first receipt instead of the person being paid.
         */
        payeeName: vendor ? null : vendorName,
        categoryId: category?.id ?? null,
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

    /*
     * The other receipts, filed beside the bill and pointed at it.
     *
     * Archived on creation, with no amount: the total is on the bill, and repeating each
     * receipt's own figure here would double it in every report that sums the log. They
     * carry no type either — a receipt is evidence, not a kind of mail.
     *
     * A failure here does not undo the bill. The bill is the thing that has to exist;
     * a receipt that did not attach can be uploaded again, and losing the approval over
     * it would be the worse trade.
     *
     * But it is said out loud. This used to swallow the failure on the reasoning that
     * "the panel shows it by not listing it" — which is only true for somebody who
     * knows how many receipts there should have been. Everyone downstream sees a bill
     * with one receipt and no reason to doubt it, and the accountant pays the full
     * amount against half the evidence. A dropped receipt is now named, on the screen
     * of the person who just attached it, while they still have the file open.
     */
    const dropped: string[] = []
    for (const extra of extras) {
      try {
        const extraType = extra.type
        const extraStored = await place(extra)

        const receipt = await prisma.document.create({
          data: {
            companyGroupId: session.companyGroupId,
            originalFilename: extra.name,
            storageKey: extraStored.key,
            storageBucket: extraStored.bucket,
            mimeType: extraType,
            byteSize: extraStored.byteSize,
            sha256: extraStored.sha256,
            entityId: entity.id,
            disposition: 'ARCHIVE',
            dispositionReason: 'OTHER',
            status: 'DONE',
            summaryNote: `Receipt filed with ${file.name}.`,
            reviewedByUserId: session.userId,
            reviewedAt: new Date(),
          },
          select: { id: true },
        })

        await prisma.documentLink.create({
          data: {
            fromDocumentId: receipt.id,
            toDocumentId: doc.id,
            relation: 'RELATED_TO',
            createdByUserId: session.userId,
            note: 'Receipt for this bill',
          },
        })

        await recordEvent({
          documentId: receipt.id,
          actorUserId: session.userId,
          action: 'added_by_hand',
          toValue: {
            originalFilename: extra.name,
            entity: entity.code,
            receiptFor: file.name,
            addedBy: session.userName,
          },
        })
      } catch {
        dropped.push(extra.name)
      }
    }

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
        receipts: extras.length || undefined,
        // So the approval card can say who put it there, which is the control.
        addedBy: session.userName,
      },
    })

    revalidatePath('/', 'layout')

    const waiting =
      approvers.length > 0
        ? `Added, and it is now waiting on ${someoneOf(approvers.map((a) => a.name?.trim() || a.email))}.`
        : `Added — but ${entity.code} has nobody who can approve it, so it is waiting on no one. Assign an approver in Settings → Members.`

    return {
      ok: true,
      documentId: doc.id,
      went:
        dropped.length > 0
          ? `${waiting} ${dropped.length === 1 ? 'One receipt' : `${dropped.length} receipts`} did not attach — ${dropped.join(', ')}. Add ${dropped.length === 1 ? 'it' : 'them'} to the bill before it is paid.`
          : waiting,
    }
  } catch (err) {
    // Never leave an orphan object when the row could not be written.
    await deleteObject(stored.key, stored.bucket)
    throw err
  }
}

'use server'

import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import { recordEvent } from '@/server/documents'
import { requireSession } from '@/server/session'
import {
  buildKey,
  headObject,
  presignPut,
  putObject,
  storageBucket,
  supportsDirectUpload,
} from '@/server/storage'

/** A receipt is a scan or a phone photo, so the same shapes documents accept. */
const RECEIPT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff', 'image/heic'])
const MAX_RECEIPT_BYTES = 25 * 1024 * 1024

export type PaymentInput = {
  /** The bill being settled, when the payment starts from one. */
  documentId?: string | null
  entityId: string
  vendorId?: string | null
  payeeName?: string | null
  amount: string
  paidOn: string
  method?: string | null
  note?: string | null
  /** Set by the direct-upload path once the bytes are already in storage. */
  receipt?: { key: string; filename: string; contentType: string } | null
}

/** True when the browser may PUT straight to object storage. */
export async function receiptUploadMode() {
  await requireSession()
  return { direct: supportsDirectUpload() }
}

/**
 * A signed URL for one receipt.
 *
 * Same reasoning as document uploads: Vercel caps a request body at 4.5 MB on every
 * plan, and a photo of a receipt taken on a phone clears that easily. The key is built
 * server-side and namespaced by company group, so a signed URL can never be aimed at
 * another tenant's prefix.
 */
export async function signReceiptUpload(filename: string, contentType: string, size: number) {
  const session = await requireSession()

  if (!Number.isFinite(size) || size <= 0) throw new Error('Empty file')
  if (size > MAX_RECEIPT_BYTES) throw new Error('Receipt is over 25 MB')
  if (!RECEIPT_TYPES.has(contentType)) throw new Error(`${contentType} is not accepted`)

  const key = buildKey(session.companyGroupId, path.extname(filename))
  return { key, url: await presignPut(key, contentType) }
}

/**
 * Records that a bill was paid.
 *
 * Both halves of the ask meet here: marking something paid from the bills screen, and
 * entering a payment that happened outside the platform. The difference is only whether
 * `documentId` is set — a payment with no document is a first-class row, not a
 * degraded one, because plenty of bills were paid before any of this existed.
 *
 * Everything is verified against the caller's own company group: the document, the
 * entity and the vendor. A payment that referenced another tenant's entity would be
 * invisible to both of them.
 */
export async function recordPayment(input: PaymentInput, formData?: FormData) {
  const session = await requireSession()

  const entity = await prisma.entity.findFirst({
    where: { id: input.entityId, companyGroupId: session.companyGroupId },
    select: { id: true, code: true },
  })
  if (!entity) throw new Error('Choose which company paid this')

  const amount = Number(String(input.amount).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) throw new Error('Enter the date it was paid')

  const document = input.documentId
    ? await prisma.document.findFirst({
        where: {
          id: input.documentId,
          companyGroupId: session.companyGroupId,
          deletedAt: null,
        },
        select: { id: true, status: true, originalFilename: true },
      })
    : null
  if (input.documentId && !document) throw new Error('Document not found')

  /*
   * The payee, resolved as far as it can be without asking.
   *
   * A typed name is matched to a vendor already on record so a manually entered
   * payment still counts towards that vendor's history — but a name that matches
   * nothing is kept as text rather than quietly creating a vendor. Vendors carry
   * autopay rules; inventing one from a typo is how a rule gets attached to the wrong
   * record.
   */
  const typed = input.payeeName?.trim()
  const vendorId = input.vendorId
    ? (
        await prisma.vendor.findFirst({
          where: { id: input.vendorId, companyGroupId: session.companyGroupId },
          select: { id: true },
        })
      )?.id ?? null
    : typed
      ? (
          await prisma.vendor.findFirst({
            where: {
              companyGroupId: session.companyGroupId,
              name: { equals: typed, mode: 'insensitive' },
            },
            select: { id: true },
          })
        )?.id ?? null
      : null

  // --- the proof --------------------------------------------------------------
  let receipt: {
    key: string
    bucket: string
    filename: string
    mimeType: string
    byteSize: number
  } | null = null

  if (input.receipt) {
    // Already in storage. The key is re-checked against this group's prefix rather
    // than trusted, and the size is read back from storage rather than from the client.
    if (!input.receipt.key.startsWith(`${session.companyGroupId}/`)) {
      throw new Error('That upload does not belong to this workspace')
    }
    const stored = await headObject(input.receipt.key)
    if (!stored) throw new Error('The receipt did not reach storage')
    receipt = {
      key: input.receipt.key,
      bucket: storageBucket(),
      filename: input.receipt.filename,
      mimeType: input.receipt.contentType,
      byteSize: stored.byteSize,
    }
  } else {
    const file = formData?.get('receipt')
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_RECEIPT_BYTES) throw new Error('Receipt is over 25 MB')
      const contentType = file.type || 'application/pdf'
      if (!RECEIPT_TYPES.has(contentType)) throw new Error(`${contentType} is not accepted`)

      const bytes = Buffer.from(await file.arrayBuffer())
      const put = await putObject(
        buildKey(session.companyGroupId, path.extname(file.name)),
        bytes,
        contentType,
      )
      receipt = {
        key: put.key,
        bucket: put.bucket,
        filename: file.name,
        mimeType: contentType,
        byteSize: put.byteSize,
      }
    }
  }

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        companyGroupId: session.companyGroupId,
        documentId: document?.id ?? null,
        entityId: entity.id,
        vendorId,
        payeeName: input.payeeName?.trim() || null,
        amount: amount.toFixed(2),
        paidOn: new Date(`${input.paidOn}T00:00:00Z`),
        method: input.method?.trim() || null,
        note: input.note?.trim() || null,
        receiptStorageKey: receipt?.key ?? null,
        receiptStorageBucket: receipt?.bucket ?? null,
        receiptFilename: receipt?.filename ?? null,
        receiptMimeType: receipt?.mimeType ?? null,
        receiptByteSize: receipt?.byteSize ?? null,
        recordedByUserId: session.userId,
      },
      select: { id: true },
    })

    // Paying a bill also finishes it. Recorded as an event on the document so the log
    // says why it closed rather than just that it did.
    if (document) {
      await tx.document.update({ where: { id: document.id }, data: { status: 'DONE' } })
      await recordEvent(
        {
          documentId: document.id,
          actorUserId: session.userId,
          action: 'status_changed',
          fromValue: { status: document.status },
          toValue: {
            status: 'DONE',
            via: 'payment-recorded',
            paymentId: created.id,
            amount: amount.toFixed(2),
            paidOn: input.paidOn,
            receipt: Boolean(receipt),
          },
        },
        tx,
      )
    }

    return created
  })

  revalidatePath('/', 'layout')
  return { id: payment.id, hasReceipt: Boolean(receipt) }
}

/**
 * Attaches a receipt to a payment that was recorded without one, or replaces it.
 *
 * The common case is honest bookkeeping catching up: the payment gets entered the day
 * it happens and the proof turns up later.
 */
export async function attachReceipt(
  paymentId: string,
  receipt: { key: string; filename: string; contentType: string } | null,
  formData?: FormData,
) {
  const session = await requireSession()

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, companyGroupId: session.companyGroupId },
    select: { id: true },
  })
  if (!payment) throw new Error('Payment not found')

  let stored: { key: string; bucket: string; filename: string; mimeType: string; byteSize: number }

  if (receipt) {
    if (!receipt.key.startsWith(`${session.companyGroupId}/`)) {
      throw new Error('That upload does not belong to this workspace')
    }
    const head = await headObject(receipt.key)
    if (!head) throw new Error('The receipt did not reach storage')
    stored = {
      key: receipt.key,
      bucket: storageBucket(),
      filename: receipt.filename,
      mimeType: receipt.contentType,
      byteSize: head.byteSize,
    }
  } else {
    const file = formData?.get('receipt')
    if (!(file instanceof File) || file.size === 0) throw new Error('Choose a file')
    if (file.size > MAX_RECEIPT_BYTES) throw new Error('Receipt is over 25 MB')
    const contentType = file.type || 'application/pdf'
    if (!RECEIPT_TYPES.has(contentType)) throw new Error(`${contentType} is not accepted`)

    const bytes = Buffer.from(await file.arrayBuffer())
    const put = await putObject(
      buildKey(session.companyGroupId, path.extname(file.name)),
      bytes,
      contentType,
    )
    stored = {
      key: put.key,
      bucket: put.bucket,
      filename: file.name,
      mimeType: contentType,
      byteSize: put.byteSize,
    }
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      receiptStorageKey: stored.key,
      receiptStorageBucket: stored.bucket,
      receiptFilename: stored.filename,
      receiptMimeType: stored.mimeType,
      receiptByteSize: stored.byteSize,
    },
  })

  revalidatePath('/', 'layout')
}

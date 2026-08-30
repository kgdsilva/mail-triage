'use server'

import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import {
  classifyDocument,
  quickDecide,
  recordEvent,
  setArchiveReason,
  type QuickDecision,
} from '@/server/documents'
import { parseIncomingFilename } from '@/server/filename-parse'
import { canSeeWholeLog, requireSession, requireTriage } from '@/server/session'
import {
  buildKey,
  deleteObject,
  headObject,
  presignPut,
  putObject,
  storageBucket,
  supportsDirectUpload,
} from '@/server/storage'

const MAX_BYTES = 50 * 1024 * 1024
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'])

export type UploadResult = { batchId: string; created: number; skipped: string[] }

/**
 * Ingests a batch of scans. Files land in our own storage and become UNREVIEWED rows in
 * the master log; nothing is classified here.
 *
 * Duplicate detection is by content hash: re-uploading the same scan links the new row
 * to the original rather than creating a silent second copy of the same bill.
 */
export async function uploadBatch(formData: FormData): Promise<UploadResult> {
  const session = await requireTriage()
  const files = formData.getAll('files').filter((f): f is File => f instanceof File)
  const label = String(formData.get('label') || '').trim() || defaultBatchLabel()

  if (files.length === 0) throw new Error('No files selected.')

  const batch = await prisma.batch.create({
    data: {
      companyGroupId: session.companyGroupId,
      label,
      source: 'MANUAL_UPLOAD',
      uploadedByUserId: session.userId,
    },
  })

  const skipped: string[] = []
  let created = 0

  for (const file of files) {
    if (file.size === 0 || file.size > MAX_BYTES) {
      skipped.push(`${file.name} (${file.size === 0 ? 'empty' : 'over 50 MB'})`)
      continue
    }
    const contentType = file.type || 'application/pdf'
    if (!ALLOWED.has(contentType)) {
      skipped.push(`${file.name} (${contentType} not accepted)`)
      continue
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const key = buildKey(session.companyGroupId, path.extname(file.name))
    const stored = await putObject(key, bytes, contentType)

    try {
      const prefill = await parseIncomingFilename(session.companyGroupId, file.name)
      const duplicate = await prisma.document.findFirst({
        where: {
          companyGroupId: session.companyGroupId,
          sha256: stored.sha256,
          deletedAt: null,
        },
        select: { id: true },
      })

      const doc = await prisma.document.create({
        data: {
          companyGroupId: session.companyGroupId,
          batchId: batch.id,
          originalFilename: file.name,
          storageKey: stored.key,
          storageBucket: stored.bucket,
          mimeType: contentType,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          entityId: prefill.entityId,
          documentDate: prefill.documentDate,
        },
      })

      await recordEvent({
        documentId: doc.id,
        actorUserId: session.userId,
        action: 'uploaded',
        toValue: { originalFilename: file.name, batch: label, byteSize: stored.byteSize },
      })

      if (duplicate) {
        await prisma.documentLink.create({
          data: {
            fromDocumentId: doc.id,
            toDocumentId: duplicate.id,
            relation: 'DUPLICATE_OF',
            createdByUserId: session.userId,
            note: 'Identical file content (sha256) already in the log.',
          },
        })
      }

      created += 1
    } catch (err) {
      // Never leave an orphaned object behind when the row could not be written.
      await deleteObject(stored.key, stored.bucket)
      throw err
    }
  }

  revalidatePath('/', 'layout')
  return { batchId: batch.id, created, skipped }
}

function defaultBatchLabel() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')} mail`
}

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), 'Invalid date')

const optionalId = z
  .string()
  .trim()
  .transform((v) => (v ? v : null))

const classifySchema = z.object({
  documentId: z.string().min(1),
  entityId: optionalId,
  documentTypeId: optionalId,
  vendorId: optionalId,
  storageFolderId: optionalId,
  assignedToUserId: optionalId,
  documentDate: optionalDate,
  dueDate: optionalDate,
  amount: z
    .string()
    .trim()
    .transform((v) => (v ? Number(v.replace(/[$,]/g, '')) : null))
    .refine((n) => n === null || (Number.isFinite(n) && n >= 0), 'Invalid amount'),
  disposition: z.enum(['UNREVIEWED', 'ARCHIVE', 'ACTION']),
  // What the assignee is being asked to do. Only meaningful on ACTION; the database
  // enforces that pairing, so normalise it here rather than trusting the form.
  actionKind: z
    .string()
    .trim()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || ['PAY', 'CONFIRM', 'REVIEW'].includes(v),
      'Invalid action',
    ),
  dispositionReason: z
    .string()
    .trim()
    .transform((v) => (v ? v : null)),
  status: z.enum(['WAITING', 'IN_PROGRESS', 'DONE', 'ARCHIVED', 'VOID']),
  finalFilename: z.string().trim().nullable().default(null),
  summaryNote: z.string().trim().nullable().default(null),
  internalNotes: z.string().trim().nullable().default(null),
})

export type ActionState = { ok: boolean; error?: string; nextId?: string | null }

export async function saveClassification(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireTriage()
  const parsed = classifySchema.safeParse(Object.fromEntries(formData))

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  const { documentId, dispositionReason, actionKind, ...rest } = parsed.data

  // Keep the two fields consistent before they reach the database: an item in a queue
  // says what it needs, an archived one is in no queue at all. Defaulting to REVIEW
  // rather than rejecting means a classifier who picked ACTION and nothing else still
  // gets a usable item — "someone has to look at this" — instead of a form error.
  const resolvedActionKind =
    rest.disposition === 'ACTION' ? ((actionKind ?? 'REVIEW') as never) : null

  try {
    await classifyDocument(session.companyGroupId, documentId, session.userId, {
      ...rest,
      actionKind: resolvedActionKind,
      dispositionReason: dispositionReason as never,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save.' }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Marks a queue item resolved. Used by the role queues and the log row menu. */
export async function setStatus(documentId: string, status: 'WAITING' | 'IN_PROGRESS' | 'DONE') {
  const session = await requireSession()
  const before = await prisma.document.findFirst({
    where: {
      id: documentId,
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      // A member may resolve what is theirs, and nothing else.
      ...(canSeeWholeLog(session.role) ? {} : { assignedToUserId: session.userId }),
    },
    select: { status: true },
  })
  if (!before) throw new Error('Document not found')

  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: documentId }, data: { status } })
    await recordEvent(
      {
        documentId,
        actorUserId: session.userId,
        action: 'status_changed',
        fromValue: { status: before.status },
        toValue: { status },
      },
      tx,
    )
  })

  revalidatePath('/log')
}

/**
 * Hands a document on to the next person, changing what it is asking for.
 *
 * This is how "Danny confirms it, then someone else pays it" works. One assignee and
 * one action at a time: the document moves, and the step that just finished stays in
 * the audit trail rather than lingering as a second open assignment. That keeps a
 * person's dashboard honest — it only ever shows what is theirs right now.
 */
export async function handOffDocument(documentId: string, formData: FormData) {
  const session = await requireSession()

  const toUserId = String(formData.get('toUserId') ?? '').trim()
  const actionKind = String(formData.get('actionKind') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  if (!toUserId) throw new Error('Choose who this goes to.')
  if (!['PAY', 'CONFIRM', 'REVIEW'].includes(actionKind)) {
    throw new Error('Choose what the next person needs to do.')
  }

  const before = await prisma.document.findFirst({
    where: {
      id: documentId,
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      // You can only hand on a document that is currently yours, unless you are one of
      // the roles that oversees the whole log.
      ...(canSeeWholeLog(session.role) ? {} : { assignedToUserId: session.userId }),
    },
    select: { assignedToUserId: true, actionKind: true, disposition: true },
  })
  if (!before) throw new Error('Document not found')
  if (before.disposition !== 'ACTION') {
    throw new Error('Only an action item can be handed off.')
  }

  // The recipient has to be a real, active member of this group — otherwise the
  // document would vanish into an assignment nobody can see.
  const recipient = await prisma.membership.findFirst({
    where: { userId: toUserId, companyGroupId: session.companyGroupId, isActive: true },
    select: { userId: true },
  })
  if (!recipient) throw new Error('That person is not an active member.')

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        assignedToUserId: toUserId,
        actionKind: actionKind as never,
        status: 'WAITING',
        ...(note ? { internalNotes: note } : {}),
      },
    })
    await recordEvent(
      {
        documentId,
        actorUserId: session.userId,
        action: 'routed',
        fromValue: { assignedToUserId: before.assignedToUserId, actionKind: before.actionKind },
        toValue: { assignedToUserId: toUserId, actionKind, note: note || null },
      },
      tx,
    )
  })

  revalidatePath('/', 'layout')
}

/**
 * Marks an item finished from the dashboard, without opening the classify screen.
 * Resolving is the common case; anything more (changing the amount, refiling) belongs
 * on the document itself.
 */
export async function resolveDocument(documentId: string) {
  const session = await requireSession()

  const before = await prisma.document.findFirst({
    where: {
      id: documentId,
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      ...(canSeeWholeLog(session.role) ? {} : { assignedToUserId: session.userId }),
    },
    select: { status: true },
  })
  if (!before) throw new Error('Document not found')

  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: documentId }, data: { status: 'DONE' } })
    await recordEvent(
      {
        documentId,
        actorUserId: session.userId,
        action: 'status_changed',
        fromValue: { status: before.status },
        toValue: { status: 'DONE' },
      },
      tx,
    )
  })

  revalidatePath('/', 'layout')
}

/**
 * One-click decision from the review table. Goes through the same decision path and the
 * same invariants as the classify form — the table is a faster way to answer the
 * question, not a second way to write the answer.
 */
export async function decideQuickly(documentId: string, decision: QuickDecision) {
  const session = await requireTriage()
  await quickDecide(session.companyGroupId, documentId, session.userId, decision)

  revalidatePath('/', 'layout')
}

/** Sharpens an archive reason from the review table. */
export async function refineArchiveReason(documentId: string, formData: FormData) {
  const session = await requireTriage()
  const reason = String(formData.get('reason') ?? '')

  const allowed = [
    'AUTOPAY',
    'INCOMING_CHECK',
    'SPAM_SOLICITATION',
    'FYI_STATEMENT',
    'OTHER',
  ] as const
  if (!(allowed as readonly string[]).includes(reason)) {
    throw new Error('Unknown archive reason')
  }

  await setArchiveReason(session.companyGroupId, documentId, session.userId, reason as never)
  revalidatePath('/', 'layout')
}

/**
 * Direct-to-storage upload, in three steps: open a batch, sign a URL per file, then
 * register what landed.
 *
 * Vercel caps a function's request body at 4.5 MB on every plan, so a scan larger than
 * that never reaches uploadBatch — the platform rejects it before any of our code runs.
 * The browser therefore PUTs the bytes straight to R2 and only tells the server about
 * it afterwards. Local development has no object storage, so `direct` is false there
 * and the form falls back to uploadBatch.
 */
export async function beginUpload(
  label: string,
): Promise<{ batchId: string | null; direct: boolean }> {
  const session = await requireTriage()

  // Only the direct path needs a batch up front, to hang each signed upload on. The
  // fallback path lets uploadBatch create its own — creating one here too would leave
  // an empty orphan batch behind on every local upload.
  if (!supportsDirectUpload()) return { batchId: null, direct: false }

  const batch = await prisma.batch.create({
    data: {
      companyGroupId: session.companyGroupId,
      label: label.trim() || defaultBatchLabel(),
      source: 'MANUAL_UPLOAD',
      uploadedByUserId: session.userId,
    },
  })

  return { batchId: batch.id, direct: true }
}

/**
 * Signs one upload. The key is chosen here, never by the browser, so an upload cannot
 * be written outside the caller's company group prefix or over an existing document.
 */
export async function signUpload(
  batchId: string,
  filename: string,
  contentType: string,
  size: number,
): Promise<{ key: string; url: string }> {
  const session = await requireTriage()

  const batch = await prisma.batch.findFirst({
    where: { id: batchId, companyGroupId: session.companyGroupId },
    select: { id: true },
  })
  if (!batch) throw new Error('Batch not found')

  if (!Number.isFinite(size) || size <= 0) throw new Error('Empty file')
  if (size > MAX_BYTES) throw new Error('Over 50 MB')
  if (!ALLOWED.has(contentType)) throw new Error(`${contentType} not accepted`)

  const key = buildKey(session.companyGroupId, path.extname(filename))
  return { key, url: await presignPut(key, contentType) }
}

/**
 * Records a file that reached storage. Mirrors uploadBatch's bookkeeping: filename
 * pre-fill, duplicate link by content hash, and an audit event.
 *
 * The hash is computed in the browser, because the server never sees these bytes. That
 * makes it a convenience signal for spotting a re-scanned document, not a security
 * control — a wrong hash costs a missed duplicate hint, nothing more. The byte size,
 * by contrast, is read back from storage rather than trusted from the client.
 */
export async function attachUpload(input: {
  batchId: string
  key: string
  filename: string
  contentType: string
  sha256: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireTriage()

  const batch = await prisma.batch.findFirst({
    where: { id: input.batchId, companyGroupId: session.companyGroupId },
    select: { id: true, label: true },
  })
  if (!batch) throw new Error('Batch not found')

  // The key was signed for this group, but re-check rather than trust the round trip.
  if (!input.key.startsWith(`${session.companyGroupId}/`)) {
    throw new Error('Key does not belong to this workspace')
  }

  const stored = await headObject(input.key)
  if (!stored) return { ok: false, error: 'File did not reach storage' }

  const sha256 = /^[0-9a-f]{64}$/.test(input.sha256 ?? '') ? input.sha256 : null

  const prefill = await parseIncomingFilename(session.companyGroupId, input.filename)
  const duplicate = sha256
    ? await prisma.document.findFirst({
        where: { companyGroupId: session.companyGroupId, sha256, deletedAt: null },
        select: { id: true },
      })
    : null

  const doc = await prisma.document.create({
    data: {
      companyGroupId: session.companyGroupId,
      batchId: batch.id,
      originalFilename: input.filename,
      storageKey: input.key,
      storageBucket: storageBucket(),
      mimeType: input.contentType,
      byteSize: stored.byteSize,
      sha256,
      entityId: prefill.entityId,
      documentDate: prefill.documentDate,
    },
  })

  await recordEvent({
    documentId: doc.id,
    actorUserId: session.userId,
    action: 'uploaded',
    toValue: {
      originalFilename: input.filename,
      batch: batch.label,
      byteSize: stored.byteSize,
      via: 'direct-upload',
    },
  })

  if (duplicate) {
    await prisma.documentLink.create({
      data: {
        fromDocumentId: doc.id,
        toDocumentId: duplicate.id,
        relation: 'DUPLICATE_OF',
        createdByUserId: session.userId,
        note: 'Identical file content (sha256) already in the log.',
      },
    })
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}


/**
 * Removes a document from the log — from view, not from existence.
 *
 * The master log is the audit backbone: a filed document is evidence that something was
 * received and what was decided about it, so nothing here is ever destroyed. Setting
 * deletedAt takes the row out of every list while keeping the record, the stored file
 * and the whole event history intact, and the removal is itself an event naming who did
 * it. Anything removed can be listed and put back.
 */
export async function deleteDocument(documentId: string) {
  const session = await requireTriage()

  const doc = await prisma.document.findFirst({
    where: { id: documentId, companyGroupId: session.companyGroupId, deletedAt: null },
    select: { id: true, originalFilename: true },
  })
  if (!doc) throw new Error('Document not found')

  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } })
    await recordEvent(
      {
        documentId: doc.id,
        actorUserId: session.userId,
        action: 'removed_from_log',
        toValue: { originalFilename: doc.originalFilename },
      },
      tx,
    )
  })

  revalidatePath('/log')
  revalidatePath('/review')
  revalidatePath('/')
}

/** Puts a removed document back in the log. */
export async function restoreDocument(documentId: string) {
  const session = await requireTriage()

  const doc = await prisma.document.findFirst({
    where: { id: documentId, companyGroupId: session.companyGroupId, deletedAt: { not: null } },
    select: { id: true },
  })
  if (!doc) throw new Error('Document not found')

  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { deletedAt: null } })
    await recordEvent(
      { documentId: doc.id, actorUserId: session.userId, action: 'restored_to_log' },
      tx,
    )
  })

  revalidatePath('/log')
  revalidatePath('/review')
}

'use server'

import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { classifyDocument, recordEvent } from '@/server/documents'
import { parseIncomingFilename } from '@/server/filename-parse'
import { canSeeWholeLog, requireSession, requireTriage } from '@/server/session'
import { buildKey, deleteObject, putObject } from '@/server/storage'

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

  revalidatePath('/log')
  revalidatePath('/classify')
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

  revalidatePath('/log')
  revalidatePath('/classify')
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

  revalidatePath('/')
  revalidatePath('/log')
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

  revalidatePath('/')
  revalidatePath('/log')
}

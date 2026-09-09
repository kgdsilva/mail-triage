'use server'

import path from 'node:path'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import {
  attachStoredFile,
  buildPlan,
  commitPlan,
  matchRowForFile,
  reconciliation,
  storedReport,
  type AttachResult,
} from '@/server/import'
import { requireTriage } from '@/server/session'
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
 * Phase 1.5 — the historical spreadsheet and the PDFs that go with it.
 *
 * Two separate steps on purpose. The spreadsheet is the record of what happened and can
 * be imported, checked and re-imported freely; the files are hundreds of megabytes that
 * arrive over several sittings. Coupling them would mean neither could be done alone.
 */

const MAX_BYTES = 50 * 1024 * 1024
const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'])

export type PreviewResult = {
  totalRows: number
  willCreate: number
  willUpdate: number
  blocked: { line: number; reason: string; finalFilename: string; companyCode: string }[]
  dateSwaps: { line: number; detail: string }[]
  folderRepairs: { line: number; detail: string }[]
  ambiguousAmounts: { line: number; detail: string }[]
  unknownPeople: string[]
  newFolders: { path: string; documents: number }[]
  byMonth: { label: string; rows: number }[]
  withAmount: number
  withDueDate: number
  assigned: number
  openAfterImport: number
}

/** Reads the file and reports what would happen. Writes nothing. */
export async function previewImport(csv: string): Promise<PreviewResult> {
  const session = await requireTriage()
  const { plan } = await buildPlan(session.companyGroupId, csv)

  return {
    totalRows: plan.totalRows,
    willCreate: plan.planned.length - plan.existing,
    willUpdate: plan.existing,
    blocked: plan.blocked.map(({ line, reason, finalFilename, companyCode }) => ({
      line,
      reason,
      finalFilename,
      companyCode,
    })),
    dateSwaps: plan.dateSwaps,
    folderRepairs: plan.folderRepairs,
    ambiguousAmounts: plan.ambiguousAmounts,
    unknownPeople: plan.unknownPeople,
    newFolders: plan.newFolders,
    byMonth: plan.byMonth,
    withAmount: plan.planned.filter((p) => p.amount !== null).length,
    withDueDate: plan.planned.filter((p) => p.dueDate !== null).length,
    assigned: plan.planned.filter((p) => p.assignedToUserId !== null).length,
    openAfterImport: plan.planned.filter((p) => p.status === 'WAITING').length,
  }
}

export async function runImport(csv: string) {
  const session = await requireTriage()
  const result = await commitPlan(session.companyGroupId, session.userId, csv)
  revalidatePath('/', 'layout')
  return result
}

export async function importState() {
  const session = await requireTriage()
  const [report, counts] = await Promise.all([
    storedReport(session.companyGroupId),
    reconciliation(session.companyGroupId),
  ])
  return { report, counts, direct: supportsDirectUpload() }
}

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

export type FileTarget =
  | { mode: 'direct'; documentId: string | null; key: string; url: string }
  | { mode: 'form' }
  /** Its row already has this file. Nothing is uploaded, so resuming is free. */
  | { mode: 'skip'; reason: string }

/**
 * Finds the row a file belongs to, and hands back somewhere to put the bytes.
 *
 * Matching is on the final filename with the extension stripped, case-folded — the
 * convention makes that unique, and it is the one field the spreadsheet and the file
 * genuinely share. A file that matches nothing still gets a key: it is stored and given
 * a row of its own rather than refused, because a PDF nobody can place is exactly the
 * thing that must not be dropped on the floor.
 */
export async function prepareFile(
  filename: string,
  contentType: string,
  size: number,
): Promise<FileTarget> {
  const session = await requireTriage()

  if (size === 0 || size > MAX_BYTES) throw new Error(`${filename}: empty or over 50 MB.`)
  if (!ALLOWED.has(contentType)) throw new Error(`${filename}: ${contentType} not accepted.`)

  const match = await matchRowForFile(session.companyGroupId, filename)
  if (match.kind === 'already') {
    return { mode: 'skip', reason: `${match.finalFilename} already has its file` }
  }

  // Checked after the match so a file that needs no upload costs nothing either way.
  if (!supportsDirectUpload()) return { mode: 'form' }

  const documentId = match.kind === 'row' ? match.documentId : null
  const key = buildKey(session.companyGroupId, path.extname(filename))
  return { mode: 'direct', documentId, key, url: await presignPut(key, contentType) }
}

export async function attachFile(input: {
  documentId: string | null
  key: string
  filename: string
  contentType: string
  sha256: string | null
}): Promise<AttachResult> {
  const session = await requireTriage()

  // The key is server-issued, but it arrives back from the browser, so the prefix is
  // re-checked: it is what confines a write to this workspace.
  if (!input.key.startsWith(`${session.companyGroupId}/`)) {
    return { ok: false, error: 'that upload does not belong to this workspace' }
  }

  const head = await headObject(input.key)
  if (!head) return { ok: false, error: 'the file never arrived in storage' }

  const result = await attachStoredFile(session, {
    documentId: input.documentId,
    key: input.key,
    bucket: storageBucket(),
    filename: input.filename,
    contentType: input.contentType,
    byteSize: head.byteSize,
    sha256: input.sha256,
  })
  revalidatePath('/import')
  return result
}

/**
 * The path taken in local development, where there is no object storage: the bytes go
 * through the server action. Vercel's 4.5 MB body cap makes this unusable in production,
 * which is exactly why prepareFile reports which mode is available.
 */
export async function attachFileForm(formData: FormData): Promise<AttachResult> {
  const session = await requireTriage()
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'no file' }

  if (file.size === 0 || file.size > MAX_BYTES) return { ok: false, error: 'empty or over 50 MB' }
  const contentType = file.type || 'application/pdf'
  if (!ALLOWED.has(contentType)) return { ok: false, error: `${contentType} not accepted` }

  const match = await matchRowForFile(session.companyGroupId, file.name)
  if (match.kind === 'already') return { ok: false, error: 'already has its file' }
  const documentId = match.kind === 'row' ? match.documentId : null
  const bytes = Buffer.from(await file.arrayBuffer())
  const stored = await putObject(buildKey(session.companyGroupId, path.extname(file.name)), bytes, contentType)

  try {
    const result = await attachStoredFile(session, {
      documentId,
      key: stored.key,
      bucket: stored.bucket,
      filename: file.name,
      contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
    })
    revalidatePath('/import')
    return result
  } catch (err) {
    await deleteObject(stored.key, stored.bucket)
    throw err
  }
}


/** The spreadsheet rows still waiting for their PDF, for the report on the screen. */
export async function awaitingFiles(limit = 500) {
  const session = await requireTriage()
  return prisma.document.findMany({
    where: {
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      storageKey: null,
      batch: { source: 'HISTORICAL_IMPORT' },
      finalFilename: { not: null },
    },
    select: {
      id: true,
      finalFilename: true,
      legacyBoxUrl: true,
      entity: { select: { code: true } },
      batch: { select: { label: true } },
    },
    orderBy: [{ entityId: 'asc' }, { finalFilename: 'asc' }],
    take: limit,
  })
}

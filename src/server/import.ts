import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { deleteObject } from '@/server/storage'
import {
  COLUMNS,
  amountFromNote,
  dateFromFilename,
  decide,
  dueFromFilename,
  mapStatus,
  mapType,
  matchKey,
  normalizePath,
  parsePeople,
  parseCsv,
  planFolderRepairs,
  reviewedDate,
  toRecords,
  type RawRow,
} from '@/server/import-map'

/**
 * Turning the historical spreadsheet into master-log rows.
 *
 * One resolution pass, used by both the dry run and the real import, so what the
 * preview promises is exactly what gets written. The preview simply stops before the
 * transaction.
 */

export type PlannedRow = {
  line: number
  finalFilename: string
  originalFilename: string
  monthFolder: string
  entityId: string
  entityCode: string
  documentTypeId: string | null
  typeCode: string | null
  disposition: 'ARCHIVE' | 'ACTION'
  dispositionReason: string | null
  actionKind: 'PAY' | 'CONFIRM' | 'REVIEW' | null
  status: 'WAITING' | 'DONE'
  documentDate: Date | null
  dueDate: Date | null
  amount: number | null
  reviewedAt: Date | null
  assignedToUserId: string | null
  folderPath: string[] | null
  summaryNote: string | null
  internalNotes: string | null
  legacyBoxUrl: string | null
}

/** A row that cannot become a document, kept verbatim so nothing is lost. */
export type BlockedRow = {
  line: number
  reason: string
  monthFolder: string
  finalFilename: string
  companyCode: string
  notes: string
}

export type Note = { line: number; detail: string }

export type ImportPlan = {
  totalRows: number
  planned: PlannedRow[]
  blocked: BlockedRow[]
  /** Corrections applied to the data, each one listed rather than assumed. */
  dateSwaps: Note[]
  folderRepairs: Note[]
  ambiguousAmounts: Note[]
  /** Names in "Notified (Who)" that match no user account. */
  unknownPeople: string[]
  /** Folders the import would create, with how many documents land in each. */
  newFolders: { path: string; documents: number }[]
  /** Rows already imported, matched by final filename — a re-run updates these. */
  existing: number
  byMonth: { label: string; rows: number }[]
}

type Ctx = {
  companyGroupId: string
  entities: Map<string, { id: string; code: string }>
  types: Map<string, string>
  users: { id: string; name: string | null; email: string }[]
  folders: Map<string, { id: string; name: string; parentPath: string | null }>
  existingKeys: Map<string, string>
}

async function loadContext(companyGroupId: string): Promise<Ctx> {
  const [entities, types, users, folders, existing] = await Promise.all([
    prisma.entity.findMany({ where: { companyGroupId }, select: { id: true, code: true } }),
    prisma.documentType.findMany({ where: { companyGroupId }, select: { id: true, code: true } }),
    prisma.membership.findMany({
      where: { companyGroupId, isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.storageFolder.findMany({
      where: { companyGroupId },
      select: { id: true, name: true, pathCache: true },
    }),
    prisma.document.findMany({
      where: { companyGroupId, finalFilename: { not: null }, deletedAt: null },
      select: { id: true, finalFilename: true },
    }),
  ])

  const folderMap = new Map<string, { id: string; name: string; parentPath: string | null }>()
  for (const f of folders) {
    const parts = f.pathCache.split(' > ')
    folderMap.set(f.pathCache, {
      id: f.id,
      name: f.name,
      parentPath: parts.length > 2 ? parts.slice(0, -1).join(' > ') : null,
    })
  }

  return {
    companyGroupId,
    entities: new Map(entities.map((e) => [e.code.toUpperCase(), e])),
    types: new Map(types.map((t) => [t.code, t.id])),
    users: users.map((m) => m.user),
    folders: folderMap,
    existingKeys: new Map(existing.map((d) => [matchKey(d.finalFilename!), d.id])),
  }
}

/**
 * Matches a spreadsheet name against the people who actually have accounts here.
 *
 * First name, full name or email, and only an exact match — "Monica & Anna" names two
 * people and the document has one assignee, so the first who has an account gets it and
 * the original cell is kept on the document. Nobody is created: a user record is an
 * account that can sign in, and a spreadsheet cell is not authority to make one.
 */
function matchUser(ctx: Ctx, names: string[], emails: string[]) {
  for (const email of emails) {
    const hit = ctx.users.find((u) => u.email.toLowerCase() === email)
    if (hit) return hit
  }
  for (const name of names) {
    const n = name.toLowerCase()
    const hit = ctx.users.find(
      (u) =>
        u.email.toLowerCase().split('@')[0] === n ||
        (u.name ?? '').toLowerCase() === n ||
        (u.name ?? '').toLowerCase().split(' ')[0] === n ||
        initials(u.name) === n,
    )
    if (hit) return hit
  }
  return null
}

function initials(name: string | null) {
  return (name ?? '')
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toLowerCase()
}

export function planImport(ctx: Ctx, records: RawRow[]): ImportPlan {
  const plan: ImportPlan = {
    totalRows: records.length,
    planned: [],
    blocked: [],
    dateSwaps: [],
    folderRepairs: [],
    ambiguousAmounts: [],
    unknownPeople: [],
    newFolders: [],
    existing: 0,
    byMonth: [],
  }

  const unknownPeople = new Set<string>()
  const newFolders = new Map<string, number>()
  const monthCounts = new Map<string, number>()

  /*
   * Folder truncations are found across the whole file before any row is placed — the
   * evidence that "Copies of" is a cut-off "Copies of Checks" is that the second is
   * twenty times more common, and no single row can see that.
   */
  const existingPaths = new Set(ctx.folders.keys())
  const repairs = planFolderRepairs(
    records.flatMap((r) => {
      const parts = normalizePath(r[COLUMNS.finalLocation] ?? '')
      if (parts.length < 2) return []
      return [{ parent: parts.slice(0, -1).join(' > '), leaf: parts[parts.length - 1] }]
    }),
    existingPaths,
  )

  records.forEach((r, i) => {
    // Line number in the file the user exported, header included, so a reported problem
    // can be found by scrolling to it.
    const line = i + 2
    const finalFilename = r[COLUMNS.finalFilename] ?? ''
    const companyCode = (r[COLUMNS.companyCode] ?? '').toUpperCase()
    const notes = r[COLUMNS.notes] ?? ''

    const blocked = (reason: string) =>
      plan.blocked.push({
        line,
        reason,
        monthFolder: r[COLUMNS.monthFolder] || '',
        finalFilename,
        companyCode,
        notes,
      })

    if (!finalFilename) return blocked('No final file name — nothing to match a PDF against.')
    if (/^https?:\/\//i.test(finalFilename)) {
      return blocked('The final file name cell holds a Box link instead of a file name.')
    }

    const entity = ctx.entities.get(companyCode)
    if (!entity) {
      return blocked(
        companyCode
          ? `Company code "${companyCode}" is not one of this workspace's companies.`
          : 'No company code.',
      )
    }

    const typeCode = mapType(r[COLUMNS.documentType] ?? '')
    if (!typeCode) return blocked(`Document type "${r[COLUMNS.documentType]}" is not recognised.`)

    const status = mapStatus(r[COLUMNS.status] ?? '')
    if (!status) return blocked(`Status "${r[COLUMNS.status]}" is neither Waiting nor Done.`)

    const decision = decide(r[COLUMNS.actionTaken] ?? '', typeCode)
    if (!decision) return blocked(`Action taken "${r[COLUMNS.actionTaken]}" is not recognised.`)

    const originalFilename = r[COLUMNS.originalFilename] || finalFilename
    const documentDate =
      dateFromFilename(finalFilename) ?? dateFromFilename(originalFilename) ?? null

    const reviewed = reviewedDate(r[COLUMNS.dateReviewed] ?? '', r[COLUMNS.monthFolder] ?? '')
    if (reviewed.dayFirst && reviewed.date) {
      plan.dateSwaps.push({
        line,
        detail: `${reviewed.raw} read as ${reviewed.date.toISOString().slice(0, 10)} (${
          r[COLUMNS.monthFolder]
        })`,
      })
    }

    // An explicit column always wins over anything read out of prose.
    const money = amountFromNote(notes)
    const declared = Number((r[COLUMNS.amount] ?? '').replace(/[$,\s]/g, ''))
    const amount = Number.isFinite(declared) && declared > 0 ? declared : money.amount
    if (money.ambiguous && !amount) {
      plan.ambiguousAmounts.push({ line, detail: `${finalFilename} — ${notes.slice(0, 90)}` })
    }

    const people = parsePeople(r[COLUMNS.notifiedWho] ?? '')
    const assignee = matchUser(ctx, people.names, people.emails)
    if (!assignee) people.names.forEach((n) => unknownPeople.add(n))

    // --- folder ---------------------------------------------------------
    let folderPath: string[] | null = null
    const parts = normalizePath(r[COLUMNS.finalLocation] ?? '')
    if (parts.length >= 2) {
      const parent = parts.slice(0, -1).join(' > ')
      const leaf = parts[parts.length - 1]
      const repaired = repairs.get(`${parent}|${leaf}`)

      if (repaired) {
        plan.folderRepairs.push({
          line,
          detail: `"${parent} > ${leaf}" filed as "${parent} > ${repaired}"`,
        })
      }

      folderPath = repaired ? [...parts.slice(0, -1), repaired] : parts

      // Every level that does not exist yet is one this import will create.
      for (let d = 1; d < folderPath.length; d += 1) {
        const path = folderPath.slice(0, d + 1).join(' > ')
        if (!existingPaths.has(path)) {
          newFolders.set(path, (newFolders.get(path) ?? 0) + 1)
        }
      }
    }

    const rawNotes: string[] = []
    const notified = (r[COLUMNS.notifiedWho] ?? '').trim()
    if (notified && notified !== '-' && !assignee) rawNotes.push(`Notified: ${notified}`)
    else if (notified && notified !== '-' && people.names.length > 1) {
      rawNotes.push(`Notified: ${notified}`)
    }
    rawNotes.push(`Imported from the historical log — action taken: ${r[COLUMNS.actionTaken]}.`)

    if (ctx.existingKeys.has(matchKey(finalFilename))) plan.existing += 1
    monthCounts.set(
      r[COLUMNS.monthFolder] || 'Historical import',
      (monthCounts.get(r[COLUMNS.monthFolder] || 'Historical import') ?? 0) + 1,
    )

    plan.planned.push({
      line,
      finalFilename,
      originalFilename,
      monthFolder: r[COLUMNS.monthFolder] || 'Historical import',
      entityId: entity.id,
      entityCode: entity.code,
      documentTypeId: ctx.types.get(typeCode) ?? null,
      typeCode,
      disposition: decision.disposition,
      dispositionReason: decision.reason,
      actionKind: decision.actionKind,
      status,
      documentDate,
      dueDate: dueFromFilename(finalFilename, documentDate),
      amount: amount ?? null,
      reviewedAt: reviewed.date,
      assignedToUserId: assignee?.id ?? null,
      folderPath,
      summaryNote: notes || null,
      internalNotes: rawNotes.join(' '),
      legacyBoxUrl: r[COLUMNS.boxLink] || null,
    })
  })

  plan.unknownPeople = [...unknownPeople].sort()
  plan.newFolders = [...newFolders.entries()]
    .map(([path, documents]) => ({ path, documents }))
    .sort((a, b) => a.path.localeCompare(b.path))
  plan.byMonth = [...monthCounts.entries()].map(([label, rows]) => ({ label, rows }))

  return plan
}

export async function buildPlan(companyGroupId: string, csv: string) {
  const { records, missing } = toRecords(parseCsv(csv))
  if (missing.length) {
    throw new Error(
      `The file is missing these columns: ${missing.join(', ')}. Export the master sheet ` +
        'with its original header row.',
    )
  }
  if (records.length === 0) throw new Error('The file has a header row and no data.')

  const ctx = await loadContext(companyGroupId)
  return { plan: planImport(ctx, records), ctx }
}

/** Creates a folder and every missing ancestor, keeping pathCache consistent. */
async function ensureFolder(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  entityId: string,
  parts: string[],
): Promise<string | null> {
  let parentId: string | null = null
  let path = parts[0]

  // parts[0] is the entity's code, which is a prefix rather than a folder of its own —
  // the tree starts at "CP > Finances", exactly as the seed builds it.
  for (let i = 1; i < parts.length; i += 1) {
    path = `${path} > ${parts[i]}`
    const known = ctx.folders.get(path)
    if (known) {
      parentId = known.id
      continue
    }
    const parent: string | null = parentId
    const created: { id: string } = await tx.storageFolder.upsert({
      where: { companyGroupId_pathCache: { companyGroupId: ctx.companyGroupId, pathCache: path } },
      create: {
        companyGroupId: ctx.companyGroupId,
        entityId,
        parentId: parent,
        name: parts[i],
        pathCache: path,
      },
      update: {},
      select: { id: true },
    })
    ctx.folders.set(path, { id: created.id, name: parts[i], parentPath: null })
    parentId = created.id
  }

  return parentId
}

export type ImportResult = {
  batches: number
  created: number
  updated: number
  blocked: number
  foldersCreated: number
}

/**
 * Writes the plan.
 *
 * One batch per Month Folder, so "January" stays something you can look at whole, and
 * every row carries the batch's HISTORICAL_IMPORT source — which is what keeps these
 * documents out of the AI reader and out of the Review queue. They were decided months
 * ago; asking the model to read them again would cost money to re-derive an answer that
 * is already in the row.
 *
 * Re-running is safe: a row is matched by its final filename and updated in place, so a
 * corrected spreadsheet can simply be imported again. Attached PDFs are never touched
 * by a re-import.
 */
export async function commitPlan(
  companyGroupId: string,
  userId: string,
  csv: string,
): Promise<ImportResult> {
  const { plan, ctx } = await buildPlan(companyGroupId, csv)

  const byMonth = new Map<string, PlannedRow[]>()
  for (const row of plan.planned) {
    if (!byMonth.has(row.monthFolder)) byMonth.set(row.monthFolder, [])
    byMonth.get(row.monthFolder)!.push(row)
  }

  const foldersBefore = ctx.folders.size
  let created = 0
  let updated = 0

  for (const [label, rows] of byMonth) {
    // One transaction per month rather than one for the whole file: 352 rows under a
    // single lock on the busiest table is a long time to hold it, and a month is a unit
    // a person can reason about if one ever needs re-running.
    await prisma.$transaction(
      async (tx) => {
        const batchLabel = `${label} (historical)`
        const batch =
          (await tx.batch.findFirst({
            where: { companyGroupId, source: 'HISTORICAL_IMPORT', label: batchLabel },
            select: { id: true },
          })) ??
          (await tx.batch.create({
            data: {
              companyGroupId,
              label: batchLabel,
              source: 'HISTORICAL_IMPORT',
              uploadedByUserId: userId,
              closedAt: new Date(),
            },
            select: { id: true },
          }))

        for (const row of rows) {
          const folderId = row.folderPath
            ? await ensureFolder(tx, ctx, row.entityId, row.folderPath)
            : null

          const data = {
            companyGroupId,
            batchId: batch.id,
            originalFilename: row.originalFilename,
            finalFilename: row.finalFilename,
            entityId: row.entityId,
            documentTypeId: row.documentTypeId,
            documentDate: row.documentDate,
            dueDate: row.dueDate,
            amount: row.amount === null ? null : new Prisma.Decimal(row.amount),
            disposition: row.disposition,
            dispositionReason: row.dispositionReason as never,
            status: row.status,
            actionKind: row.actionKind as never,
            assignedToUserId: row.assignedToUserId,
            storageFolderId: folderId,
            filedAt: row.reviewedAt,
            summaryNote: row.summaryNote,
            internalNotes: row.internalNotes,
            legacyBoxUrl: row.legacyBoxUrl,
            reviewedByUserId: userId,
            reviewedAt: row.reviewedAt,
          }

          const existingId = ctx.existingKeys.get(matchKey(row.finalFilename))
          if (existingId) {
            await tx.document.update({ where: { id: existingId }, data })
            updated += 1
          } else {
            const doc = await tx.document.create({ data, select: { id: true } })
            ctx.existingKeys.set(matchKey(row.finalFilename), doc.id)
            await tx.documentEvent.create({
              data: {
                documentId: doc.id,
                actorUserId: userId,
                action: 'imported',
                toValue: {
                  source: 'historical spreadsheet',
                  line: row.line,
                  monthFolder: row.monthFolder,
                },
              },
            })
            created += 1
          }
        }
      },
      { timeout: 120_000 },
    )
  }

  /*
   * The report lives on a batch of its own, holding no documents.
   *
   * It has to survive the page being closed: a row blocked because its company code
   * matches no entity exists nowhere else — not as a document, not as a file — and a
   * list of those that only ever appeared in a toast is a list of documents quietly
   * lost. A dedicated row is also the only place the whole file's findings fit, since
   * blocked rows do not belong to any month that got a batch.
   */
  const report = {
    importedAt: new Date().toISOString(),
    totalRows: plan.totalRows,
    imported: created + updated,
    blocked: plan.blocked,
    dateSwaps: plan.dateSwaps,
    folderRepairs: plan.folderRepairs,
    ambiguousAmounts: plan.ambiguousAmounts,
    unknownPeople: plan.unknownPeople,
    newFolders: plan.newFolders,
  } as unknown as Prisma.InputJsonValue

  const existingReport = await prisma.batch.findFirst({
    where: { companyGroupId, source: 'HISTORICAL_IMPORT', label: REPORT_BATCH_LABEL },
    select: { id: true },
  })
  if (existingReport) {
    await prisma.batch.update({ where: { id: existingReport.id }, data: { importReport: report } })
  } else {
    await prisma.batch.create({
      data: {
        companyGroupId,
        label: REPORT_BATCH_LABEL,
        source: 'HISTORICAL_IMPORT',
        uploadedByUserId: userId,
        closedAt: new Date(),
        importReport: report,
      },
    })
  }

  return {
    batches: byMonth.size,
    created,
    updated,
    blocked: plan.blocked.length,
    foldersCreated: ctx.folders.size - foldersBefore,
  }
}

export const REPORT_BATCH_LABEL = 'Historical import — findings'

export type StoredReport = {
  importedAt: string
  totalRows: number
  imported: number
  blocked: BlockedRow[]
  dateSwaps: Note[]
  folderRepairs: Note[]
  ambiguousAmounts: Note[]
  unknownPeople: string[]
  newFolders: { path: string; documents: number }[]
}

export async function storedReport(companyGroupId: string): Promise<StoredReport | null> {
  const batch = await prisma.batch.findFirst({
    where: { companyGroupId, source: 'HISTORICAL_IMPORT', label: REPORT_BATCH_LABEL },
    select: { importReport: true },
  })
  return (batch?.importReport as StoredReport | null) ?? null
}

/**
 * The two halves of the reconciliation, counted from the data rather than remembered
 * from the run: spreadsheet rows still waiting for their PDF, and files that arrived
 * without a row.
 */
export async function reconciliation(companyGroupId: string) {
  const [awaitingFile, unmatchedFiles, attached] = await Promise.all([
    prisma.document.count({
      where: {
        companyGroupId,
        deletedAt: null,
        storageKey: null,
        batch: { source: 'HISTORICAL_IMPORT' },
      },
    }),
    prisma.document.count({
      where: {
        companyGroupId,
        deletedAt: null,
        disposition: 'UNREVIEWED',
        batch: { source: 'HISTORICAL_IMPORT' },
      },
    }),
    prisma.document.count({
      where: {
        companyGroupId,
        deletedAt: null,
        storageKey: { not: null },
        batch: { source: 'HISTORICAL_IMPORT' },
      },
    }),
  ])

  return { awaitingFile, unmatchedFiles, attached }
}



// ---------------------------------------------------------------------------
// Matching the PDFs to the rows
// ---------------------------------------------------------------------------

export type RowMatch =
  | { kind: 'row'; documentId: string }
  | { kind: 'already'; finalFilename: string }
  | { kind: 'none' }

/**
 * Which spreadsheet row a file belongs to.
 *
 * Three answers, and the third is the one that matters in practice. Uploading several
 * hundred PDFs takes more than one sitting: a tab gets closed, a laptop sleeps, and the
 * obvious way to resume is to drag the same folder in again. If a file whose row already
 * has its PDF simply "matched nothing", every file already done would come back as an
 * unplaceable duplicate on Review — the resume would create the mess it was meant to
 * avoid.
 *
 * So a name whose row is already satisfied is reported as such and skipped, before any
 * bytes are uploaded. The final filename is unique by convention, which is what makes
 * the name enough to say "this one is done"; a genuinely different file arriving under a
 * name already taken is reported as skipped rather than silently replacing the stored
 * copy, because overwriting a filed document is a decision a person makes.
 */
export async function matchRowForFile(
  companyGroupId: string,
  filename: string,
): Promise<RowMatch> {
  const key = matchKey(filename)

  const candidates = await prisma.document.findMany({
    where: {
      companyGroupId,
      deletedAt: null,
      finalFilename: { not: null },
      batch: { source: 'HISTORICAL_IMPORT' },
    },
    select: { id: true, finalFilename: true, storageKey: true },
  })

  const hits = candidates.filter((c) => matchKey(c.finalFilename!) === key)
  if (hits.length !== 1) return { kind: 'none' }
  if (hits[0].storageKey) return { kind: 'already', finalFilename: hits[0].finalFilename! }
  return { kind: 'row', documentId: hits[0].id }
}

export type AttachResult =
  | { ok: true; matched: boolean; duplicate?: boolean }
  | { ok: false; error: string }

export async function attachStoredFile(
  session: { companyGroupId: string; userId: string },
  file: {
    documentId: string | null
    key: string
    bucket: string
    filename: string
    contentType: string
    byteSize: number
    sha256: string | null
  },
): Promise<AttachResult> {
  const storage = {
    storageKey: file.key,
    storageBucket: file.bucket,
    mimeType: file.contentType,
    byteSize: file.byteSize,
    sha256: file.sha256,
  }

  if (file.documentId) {
    const row = await prisma.document.findFirst({
      where: {
        id: file.documentId,
        companyGroupId: session.companyGroupId,
        deletedAt: null,
        storageKey: null,
      },
      select: { id: true },
    })
    if (!row) return { ok: false, error: 'that row already has a file attached' }

    await prisma.$transaction([
      prisma.document.update({ where: { id: row.id }, data: storage }),
      prisma.documentEvent.create({
        data: {
          documentId: row.id,
          actorUserId: session.userId,
          action: 'file-attached',
          toValue: { originalFilename: file.filename, byteSize: file.byteSize },
        },
      }),
    ])
    return { ok: true, matched: true }
  }

  /*
   * No row matched. The file becomes an unclassified document in the import batch, so
   * it lands on Review asking to be identified.
   *
   * This is the project's rule applied to the import: ambiguity resolves to action,
   * never to a silent archive. A PDF whose name nobody recognises is the likeliest
   * candidate for a document that quietly never existed here.
   */
  /*
   * A file that matched no row, and that we already hold byte for byte.
   *
   * Elsewhere in the app a re-uploaded scan is kept and linked to the original, so the
   * repetition is visible. Here that is the wrong trade: resuming an interrupted drag of
   * two hundred unrecognised PDFs would put two hundred linked copies on Review, and the
   * duplicate is not news — it is the same drag, finishing. The stored object goes too,
   * so nothing is left behind paying for storage.
   */
  if (file.sha256) {
    const seen = await prisma.document.findFirst({
      where: { companyGroupId: session.companyGroupId, sha256: file.sha256, deletedAt: null },
      select: { id: true },
    })
    if (seen) {
      await deleteObject(file.key, file.bucket)
      return { ok: true, matched: false, duplicate: true }
    }
  }

  const batch = await unmatchedBatch(session)

  const doc = await prisma.document.create({
    data: {
      companyGroupId: session.companyGroupId,
      batchId: batch,
      originalFilename: file.filename,
      ...storage,
    },
    select: { id: true },
  })
  await prisma.documentEvent.create({
    data: {
      documentId: doc.id,
      actorUserId: session.userId,
      action: 'uploaded',
      toValue: {
        originalFilename: file.filename,
        note: 'Historical PDF that matched no spreadsheet row.',
      },
    },
  })

  return { ok: true, matched: false }
}

const UNMATCHED_LABEL = 'Historical files with no spreadsheet row'

async function unmatchedBatch(session: { companyGroupId: string; userId: string }) {
  const found = await prisma.batch.findFirst({
    where: {
      companyGroupId: session.companyGroupId,
      source: 'HISTORICAL_IMPORT',
      label: UNMATCHED_LABEL,
    },
    select: { id: true },
  })
  if (found) return found.id

  const created = await prisma.batch.create({
    data: {
      companyGroupId: session.companyGroupId,
      label: UNMATCHED_LABEL,
      source: 'HISTORICAL_IMPORT',
      uploadedByUserId: session.userId,
    },
    select: { id: true },
  })
  return created.id
}


import { Prisma } from '@/generated/prisma/client'
import type { Disposition, DispositionReason, DocStatus } from '@/generated/prisma/enums'
import { prisma } from '@/server/db/client'

export type LogFilters = {
  q?: string
  entityIds?: string[]
  documentTypeIds?: string[]
  statuses?: DocStatus[]
  dispositions?: Disposition[]
  dateFrom?: Date
  dateTo?: Date
  /** Segregated entities (OP) sit in their own view rather than the group-wide list. */
  view?: 'main' | 'segregated' | 'all'
  page?: number
  pageSize?: number
}

export const DEFAULT_PAGE_SIZE = 50

/**
 * Resolves the free-text box against the generated `search_vector` (filenames and human
 * notes) plus a trigram match on vendor name, which the vector cannot cover because the
 * vendor lives on another table.
 *
 * Returns null when there is no query, meaning "do not constrain by id".
 */
async function searchIds(companyGroupId: string, q: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT d.id
    FROM "document" d
    LEFT JOIN "vendor" v ON v.id = d.vendor_id
    WHERE d.company_group_id = ${companyGroupId}
      AND (
        d.search_vector @@ websearch_to_tsquery('english', ${q})
        OR v.name ILIKE ${'%' + q + '%'}
      )
    LIMIT 5000
  `
  return rows.map((r) => r.id)
}

export async function buildWhere(
  companyGroupId: string,
  filters: LogFilters,
): Promise<Prisma.DocumentWhereInput> {
  const where: Prisma.DocumentWhereInput = {
    companyGroupId,
    // Soft delete only — the master log never loses a row, it just stops showing it.
    deletedAt: null,
  }

  if (filters.q?.trim()) {
    where.id = { in: await searchIds(companyGroupId, filters.q.trim()) }
  }
  if (filters.entityIds?.length) where.entityId = { in: filters.entityIds }
  if (filters.documentTypeIds?.length) where.documentTypeId = { in: filters.documentTypeIds }
  if (filters.statuses?.length) where.status = { in: filters.statuses }
  if (filters.dispositions?.length) where.disposition = { in: filters.dispositions }

  if (filters.dateFrom || filters.dateTo) {
    where.documentDate = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    }
  }

  // The segregated view is a display split, never a permission: `all` is always
  // available and no role is prevented from seeing OP.
  if (filters.view === 'main') where.entity = { isSegregated: false }
  if (filters.view === 'segregated') where.entity = { isSegregated: true }

  return where
}

export const LOG_INCLUDE = {
  entity: { select: { code: true, legalName: true, isSegregated: true } },
  batch: { select: { label: true } },
  documentType: { select: { label: true, code: true } },
  vendor: { select: { name: true } },
  storageFolder: { select: { pathCache: true } },
  assignedTo: { select: { name: true, email: true } },
} satisfies Prisma.DocumentInclude

export async function listDocuments(companyGroupId: string, filters: LogFilters) {
  const where = await buildWhere(companyGroupId, filters)
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(500, filters.pageSize ?? DEFAULT_PAGE_SIZE)

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: LOG_INCLUDE,
      // Undated documents are usually the freshly uploaded ones; keep them visible.
      orderBy: [{ documentDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.document.count({ where }),
  ])

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
}

/** Every row of the filtered set, unpaginated, for CSV export. */
export async function listAllForExport(companyGroupId: string, filters: LogFilters) {
  const where = await buildWhere(companyGroupId, filters)
  return prisma.document.findMany({
    where,
    include: LOG_INCLUDE,
    orderBy: [{ documentDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: 20000,
  })
}

export function getDocument(companyGroupId: string, id: string) {
  return prisma.document.findFirst({
    where: { id, companyGroupId, deletedAt: null },
    include: {
      ...LOG_INCLUDE,
      batch: { select: { id: true, label: true } },
      events: {
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { name: true, email: true } } },
      },
    },
  })
}

/** The next document still awaiting a decision — drives auto-advance on the classify screen. */
export async function nextUnreviewed(companyGroupId: string, afterId?: string) {
  return prisma.document.findFirst({
    where: {
      companyGroupId,
      deletedAt: null,
      disposition: 'UNREVIEWED',
      ...(afterId ? { id: { not: afterId } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
}

export async function countUnreviewed(companyGroupId: string) {
  return prisma.document.count({
    where: { companyGroupId, deletedAt: null, disposition: 'UNREVIEWED' },
  })
}

export type EventInput = {
  documentId: string
  actorUserId: string | null
  action: string
  fromValue?: Prisma.InputJsonValue
  toValue?: Prisma.InputJsonValue
}

/**
 * Appends to the audit trail. Takes an optional transaction client so an event and the
 * change it describes commit together — a recorded change with no event, or an event
 * with no change, would both undermine the log.
 */
export function recordEvent(event: EventInput, tx: Prisma.TransactionClient = prisma) {
  return tx.documentEvent.create({ data: event })
}

export type ClassifyInput = {
  entityId: string | null
  documentTypeId: string | null
  vendorId: string | null
  documentDate: Date | null
  dueDate: Date | null
  amount: number | null
  disposition: Disposition
  dispositionReason: DispositionReason | null
  status: DocStatus
  storageFolderId: string | null
  finalFilename: string | null
  summaryNote: string | null
  internalNotes: string | null
  assignedToUserId: string | null
}

/**
 * Commits a classification and records what changed, in one transaction.
 *
 * The archive-needs-a-reason rule is checked here as well as by the database CHECK
 * constraint. The constraint is the guarantee; this is so the operator gets a sentence
 * instead of a Postgres error.
 */
export async function classifyDocument(
  companyGroupId: string,
  documentId: string,
  actorUserId: string,
  input: ClassifyInput,
) {
  if (input.disposition === 'UNREVIEWED') {
    throw new Error('Choose Archive or Send for action — a document cannot be filed undecided.')
  }
  if (input.disposition === 'ARCHIVE' && !input.dispositionReason) {
    throw new Error('Archiving requires a reason — it is what makes the decision auditable.')
  }

  const before = await prisma.document.findFirst({
    where: { id: documentId, companyGroupId, deletedAt: null },
  })
  if (!before) throw new Error('Document not found')

  return prisma.$transaction(async (tx) => {
    const updated = await tx.document.update({
      where: { id: documentId },
      data: {
        ...input,
        amount: input.amount == null ? null : new Prisma.Decimal(input.amount),
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        filedAt: input.storageFolderId ? new Date() : null,
      },
    })

    await recordEvent(
      {
        documentId,
        actorUserId,
        action: before.disposition === 'UNREVIEWED' ? 'classified' : 'reclassified',
        fromValue: {
          disposition: before.disposition,
          dispositionReason: before.dispositionReason,
          status: before.status,
          entityId: before.entityId,
        },
        toValue: {
          disposition: updated.disposition,
          dispositionReason: updated.dispositionReason,
          status: updated.status,
          entityId: updated.entityId,
        },
      },
      tx,
    )

    return updated
  })
}

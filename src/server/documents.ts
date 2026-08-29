import { Prisma } from '@/generated/prisma/client'
import type { ActionKind, Disposition, DispositionReason, DocStatus } from '@/generated/prisma/enums'
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
  /**
   * Limits the result to documents assigned to this user. Set for roles that do not
   * browse the group-wide log (MEMBER) — see canSeeWholeLog in server/session.ts.
   * This is a permission boundary, so it is applied last and cannot be overridden by
   * anything the caller puts in the query string.
   */
  restrictToUserId?: string
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

  // Applied last: a restricted viewer never sees beyond their own assignments.
  if (filters.restrictToUserId) where.assignedToUserId = filters.restrictToUserId

  return where
}

export const LOG_INCLUDE = {
  // sortOrder drives the entity's badge colour; code drives the type icon.
  entity: { select: { code: true, legalName: true, isSegregated: true, sortOrder: true } },
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

/**
 * `restrictToUserId` guards direct URL access: without it a member could open any
 * document by guessing an id, which the filtered log would never have shown them.
 */
export function getDocument(companyGroupId: string, id: string, restrictToUserId?: string) {
  return prisma.document.findFirst({
    where: {
      id,
      companyGroupId,
      deletedAt: null,
      ...(restrictToUserId ? { assignedToUserId: restrictToUserId } : {}),
    },
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
  /** Null unless disposition is ACTION — the database enforces that pairing. */
  actionKind: ActionKind | null
}

/**
 * The rules a decision must satisfy, wherever it was made — the full classify form or a
 * one-click decision on the review table. Checked here as well as by the database CHECK
 * constraints: the constraints are the guarantee, this is so a person gets a sentence
 * instead of a Postgres error.
 */
function assertDecisionCoherent(input: {
  disposition: Disposition
  dispositionReason: DispositionReason | null
  actionKind: ActionKind | null
}) {
  if (input.disposition === 'UNREVIEWED') {
    throw new Error('Choose Archive or Send for action — a document cannot be filed undecided.')
  }
  if (input.disposition === 'ARCHIVE' && !input.dispositionReason) {
    throw new Error('Archiving requires a reason — it is what makes the decision auditable.')
  }
  if (input.disposition === 'ACTION' && !input.actionKind) {
    throw new Error('An action item needs to say what it is asking for: pay, confirm or review.')
  }
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
  assertDecisionCoherent(input)

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

/**
 * The three one-click decisions on the review table.
 *
 * A quick decision answers "what is this?" and nothing else. It deliberately does not
 * set a vendor, amount, folder or final filename — that is the classify form's job — so
 * a document decided here is decided but NOT yet filed. The review table shows that
 * difference rather than implying the work is finished.
 */
export type QuickDecision = 'PAY' | 'ARCHIVE' | 'SPAM'

const QUICK_DECISIONS: Record<
  QuickDecision,
  { disposition: Disposition; dispositionReason: DispositionReason | null; actionKind: ActionKind | null; status: DocStatus }
> = {
  // Needs paying: it enters someone's queue, unassigned until routed.
  PAY: {
    disposition: 'ACTION',
    dispositionReason: 'MANUAL_INVOICE',
    actionKind: 'PAY',
    status: 'WAITING',
  },
  // "No payment needed" is the brief's FYI bucket: seen, nothing to do. Not OTHER,
  // which would make every archived document's reason say nothing in six months.
  ARCHIVE: {
    disposition: 'ARCHIVE',
    dispositionReason: 'FYI_STATEMENT',
    actionKind: null,
    status: 'ARCHIVED',
  },
  SPAM: {
    disposition: 'ARCHIVE',
    dispositionReason: 'SPAM_SOLICITATION',
    actionKind: null,
    status: 'ARCHIVED',
  },
}

export async function quickDecide(
  companyGroupId: string,
  documentId: string,
  actorUserId: string,
  decision: QuickDecision,
) {
  const target = QUICK_DECISIONS[decision]
  if (!target) throw new Error('Unknown decision')
  assertDecisionCoherent(target)

  const before = await prisma.document.findFirst({
    where: { id: documentId, companyGroupId, deletedAt: null },
    select: {
      disposition: true,
      dispositionReason: true,
      actionKind: true,
      status: true,
      documentTypeId: true,
    },
  })
  if (!before) throw new Error('Document not found')

  // Calling something spam is also a statement about what type it is. Only fill the
  // type when it is still empty — never overwrite a type a person already chose.
  let documentTypeId: string | undefined
  if (decision === 'SPAM' && !before.documentTypeId) {
    const spamType = await prisma.documentType.findFirst({
      where: { companyGroupId, code: 'SPAM', isActive: true },
      select: { id: true },
    })
    documentTypeId = spamType?.id
  }

  return prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        ...target,
        ...(documentTypeId ? { documentTypeId } : {}),
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
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
          actionKind: before.actionKind,
          status: before.status,
        },
        toValue: { ...target, via: 'quick-review' },
      },
      tx,
    )
  })
}

/**
 * Sharpens why something was archived, from the review table, without reopening the
 * full form. The default reason a quick archive applies is a reasonable guess; this is
 * how it becomes accurate.
 */
export async function setArchiveReason(
  companyGroupId: string,
  documentId: string,
  actorUserId: string,
  reason: DispositionReason,
) {
  const before = await prisma.document.findFirst({
    where: { id: documentId, companyGroupId, deletedAt: null, disposition: 'ARCHIVE' },
    select: { dispositionReason: true },
  })
  if (!before) throw new Error('Document not found, or not archived')

  return prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: { dispositionReason: reason },
    })
    await recordEvent(
      {
        documentId,
        actorUserId,
        action: 'reclassified',
        fromValue: { dispositionReason: before.dispositionReason },
        toValue: { dispositionReason: reason },
      },
      tx,
    )
  })
}

/** Rows for the review sweep: everything still undecided, plus decided ones on request. */
export function listForReview(
  companyGroupId: string,
  opts: { includeDecided: boolean; entityId?: string | null },
) {
  return prisma.document.findMany({
    where: {
      companyGroupId,
      deletedAt: null,
      ...(opts.includeDecided ? {} : { disposition: 'UNREVIEWED' }),
      ...(opts.entityId ? { entityId: opts.entityId } : {}),
    },
    include: {
      entity: { select: { id: true, code: true, legalName: true, sortOrder: true } },
      documentType: { select: { label: true, code: true } },
      vendor: { select: { name: true } },
      batch: { select: { label: true } },
    },
    orderBy: [
      { disposition: 'asc' },
      { entity: { sortOrder: 'asc' } },
      { documentDate: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'asc' },
    ],
    take: 500,
  })
}

/** Incoming third-party checks, for reconciliation. Archived, so never in a queue. */
export function listChecks(companyGroupId: string, entityId?: string | null) {
  return prisma.document.findMany({
    where: {
      companyGroupId,
      deletedAt: null,
      documentType: { code: 'CHECK' },
      ...(entityId ? { entityId } : {}),
    },
    include: {
      entity: { select: { id: true, code: true, sortOrder: true } },
      vendor: { select: { name: true } },
      batch: { select: { label: true } },
    },
    orderBy: [{ documentDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 500,
  })
}

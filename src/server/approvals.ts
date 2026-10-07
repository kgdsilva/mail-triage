import type { ApprovalStatus } from '@/generated/prisma/enums'
import { prisma } from '@/server/db/client'
import { entityWhere, visibleEntityIds } from '@/server/scope'
import type { Session } from '@/server/session'

/**
 * Bills waiting on a person, and the ones that already got an answer.
 *
 * The approver's screen and the accountant's screen are two questions about the same
 * column, so they share this reader rather than each growing their own query that drifts
 * from the other.
 */

const OPEN = ['WAITING', 'IN_PROGRESS'] as const

export const BILL_INCLUDE = {
  entity: { select: { id: true, code: true, legalName: true, sortOrder: true } },
  vendor: { select: { name: true } },
  category: { select: { name: true } },
  documentType: { select: { label: true, code: true } },
  approvalDecidedBy: { select: { name: true, email: true } },
  payments: {
    select: { id: true, paidOn: true, amount: true, method: true, reference: true },
    orderBy: { paidOn: 'desc' as const },
    take: 1,
  },
} as const

export type BillFilters = {
  statuses: ApprovalStatus[]
  entityId?: string | null
  /** Paid bills have left the queue; unpaid ones have not. Undefined means either. */
  settled?: boolean
}

/**
 * Ordered the way a payment run reads: overdue first, then by due date, then by when it
 * arrived.
 *
 * Which is one `ORDER BY`, not three — an overdue bill is simply one whose due date has
 * already passed, so ascending due dates put them at the top on their own. Undated bills
 * sort last and fall back to their received date; a bill with no deadline is not urgent,
 * and nulls-first would have buried the ones that are.
 */
const BILL_ORDER = [
  { dueDate: { sort: 'asc' as const, nulls: 'last' as const } },
  { createdAt: 'asc' as const },
]

function where(companyGroupId: string, ids: string[] | null, filters: BillFilters) {
  return {
    companyGroupId,
    deletedAt: null,
    /*
     * Carrying an approval status is what makes a document a bill here, and it is a
     * better test than `actionKind: 'PAY'` — which is what this used to say, and which
     * quietly lost every bill the moment it was refused. Sending one back changes its
     * action to REVIEW so it appears on Needs a decision, and the approver still has to
     * be able to find it, both to read their own note and to change their mind.
     *
     * Only a payable bill is ever given a status, so this cannot pull in a cheque or a
     * notice; see approvalFor in server/documents.ts.
     */
    approvalStatus: { in: filters.statuses },
    ...(filters.settled === undefined
      ? {}
      : filters.settled
        ? { status: 'DONE' as const }
        : { status: { in: [...OPEN] } }),
    ...entityWhere(ids),
    // A company chosen in the query string is narrowed to one in scope before it gets
    // here; this only ever further restricts.
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
  }
}

export async function listBills(session: Session, filters: BillFilters) {
  const ids = await visibleEntityIds(session)

  return prisma.document.findMany({
    where: where(session.companyGroupId, ids, filters),
    include: BILL_INCLUDE,
    orderBy: BILL_ORDER,
    take: 500,
  })
}

/**
 * The numbers on the tabs, counted independently of what is being shown — their job is
 * to say what you are not currently looking at.
 */
export async function billCounts(session: Session, entityId?: string | null) {
  const ids = await visibleEntityIds(session)
  const base = { entityId: entityId ?? null }

  const [pending, approvedUnpaid, denied, needsReview, paid] = await Promise.all([
    prisma.document.count({
      where: where(session.companyGroupId, ids, { ...base, statuses: ['PENDING'], settled: false }),
    }),
    prisma.document.count({
      where: where(session.companyGroupId, ids, {
        ...base,
        statuses: ['APPROVED'],
        settled: false,
      }),
    }),
    prisma.document.count({
      where: where(session.companyGroupId, ids, { ...base, statuses: ['DENIED'] }),
    }),
    prisma.document.count({
      where: where(session.companyGroupId, ids, { ...base, statuses: ['NEEDS_REVIEW'] }),
    }),
    prisma.document.count({
      where: where(session.companyGroupId, ids, { ...base, statuses: ['APPROVED'], settled: true }),
    }),
  ])

  return { pending, approvedUnpaid, denied, needsReview, paid }
}

/** The full trail for one bill, oldest first — the order somebody reads a story in. */
export async function billHistory(session: Session, documentId: string) {
  const ids = await visibleEntityIds(session)

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      ...entityWhere(ids),
    },
    select: { id: true },
  })
  if (!document) return null

  return prisma.documentEvent.findMany({
    where: { documentId },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

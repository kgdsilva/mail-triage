import { prisma } from '@/server/db/client'

/**
 * The board: everything waiting on a decision, from every company, in one place.
 *
 * This replaced a per-person queue, and the reason is worth keeping written down. A
 * queue only its owner can see is a queue where work stops invisibly: the week somebody
 * is away, seven bills sit in their name and nothing on any other screen says so. The
 * board is shared, and whose an item is becomes a tag on the card rather than the
 * boundary of what you are allowed to look at.
 *
 * Grouped by company, because that is the first question anyone asks of a piece of mail,
 * and because the people reading it think in companies — not in "my items".
 */

const OPEN = ['WAITING', 'IN_PROGRESS'] as const

export type BoardScope = 'mine' | 'everyone' | 'unassigned'

export type BoardFilters = {
  scope: BoardScope
  userId: string
  /** A single company, from the picker. */
  entityId?: string | null
  /** A single person, from the people filter. Ignored unless scope is `everyone`. */
  assigneeId?: string | null
}

export const BOARD_INCLUDE = {
  entity: { select: { id: true, code: true, legalName: true, sortOrder: true } },
  vendor: { select: { name: true } },
  documentType: { select: { label: true, code: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
} as const

function where(filters: BoardFilters, companyGroupId: string) {
  return {
    companyGroupId,
    deletedAt: null,
    status: { in: [...OPEN] },
    disposition: 'ACTION' as const,
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.scope === 'mine' ? { assignedToUserId: filters.userId } : {}),
    ...(filters.scope === 'unassigned' ? { assignedToUserId: null } : {}),
    ...(filters.scope === 'everyone' && filters.assigneeId
      ? { assignedToUserId: filters.assigneeId }
      : {}),
  }
}

export async function listBoard(companyGroupId: string, filters: BoardFilters) {
  return prisma.document.findMany({
    where: where(filters, companyGroupId),
    include: BOARD_INCLUDE,
    // Soonest due first, and undated last rather than first: a document with no
    // deadline is not urgent, and sorting nulls to the top buries the ones that are.
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 400,
  })
}

/**
 * The three numbers on the tabs, counted independently of what is being shown.
 *
 * They have to be the totals rather than the filtered view, because their whole job is
 * to say what you are *not* looking at — "everyone: 23" while you read your own four is
 * the sentence the old screen could not say.
 */
export async function boardCounts(companyGroupId: string, userId: string) {
  const base = {
    companyGroupId,
    deletedAt: null,
    status: { in: [...OPEN] },
    disposition: 'ACTION' as const,
  }

  const [mine, everyone, unassigned] = await Promise.all([
    prisma.document.count({ where: { ...base, assignedToUserId: userId } }),
    prisma.document.count({ where: base }),
    prisma.document.count({ where: { ...base, assignedToUserId: null } }),
  ])

  return { mine, everyone, unassigned }
}

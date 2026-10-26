import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/server/db/client'
import { toDecideWhere } from '@/server/to-decide'

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
  approvalDecidedBy: { select: { name: true, email: true } },
} as const

function where(filters: BoardFilters, companyGroupId: string): Prisma.DocumentWhereInput {
  return {
    companyGroupId,
    deletedAt: null,
    status: { in: [...OPEN] },
    disposition: 'ACTION' as const,
    /*
     * A bill that is with an approver is not waiting on a decision here.
     *
     * Each of the three screens answers to one person, and an item belongs to exactly
     * one of them: this board is what the office has to deal with, Bills to approve is
     * what an approver has to clear, Accounting is what the accountant has to settle.
     *
     * Approved was excluded first, for the obvious half — it waits on money, not on a
     * decision. Pending was left in, and that was the costly half: of nine items on this
     * board, seven were bills sitting in Eric's queue. The first screen anybody opens
     * was three-quarters other people's work, offered as though anyone could pick it up,
     * when only the named approver can act on it at all.
     *
     * A refusal stays: denied and needs-review both come back as a REVIEW action
     * assigned to a person, and both genuinely need somebody here to act.
     *
     * Spelled as an OR with an explicit null rather than `notIn`, because a comparison
     * on a nullable column drops NULLs in SQL — and every document that is not a bill
     * has no approval status at all, so it would have emptied the board.
     */
    OR: [
      { approvalStatus: null },
      { approvalStatus: { notIn: ['APPROVED', 'PENDING'] } },
    ],
    /*
     * And a money document still waiting on the accountant is not here either.
     *
     * Deciding whether something has to be paid is his job now, and the whole point of
     * moving it was to stop the same question living on two screens. The exclusion uses
     * the very predicate his tab selects by, so the two cannot drift: anything that
     * leaves this board appears there, and nothing can fall between them.
     *
     * What stays: a document nobody could place to a company. That is not a payment
     * question yet, however much money it mentions, and it stays with whoever can work
     * out whose it is.
     */
    NOT: { AND: [toDecideWhere(companyGroupId)] },
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
  /*
   * The list's own predicate, not a copy of it.
   *
   * This was a hand-kept duplicate with two comments promising it matched — and it
   * stopped matching the moment the list changed, which is exactly what a comment
   * promising a copy is worth. A count that disagrees with the list it labels is worse
   * than no count, because the number is read first and believed.
   */
  const base = where({ scope: 'everyone', userId }, companyGroupId)

  const [mine, everyone, unassigned] = await Promise.all([
    prisma.document.count({ where: { ...base, assignedToUserId: userId } }),
    prisma.document.count({ where: base }),
    prisma.document.count({ where: { ...base, assignedToUserId: null } }),
  ])

  return { mine, everyone, unassigned }
}

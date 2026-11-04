import type { Prisma } from '@/generated/prisma/client'
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
  // Who holds it now, which is a different person from who decided it the moment a
  // bill is refused and lands back on somebody's desk.
  assignedTo: { select: { id: true, name: true, email: true } },
  payments: {
    select: { id: true, paidOn: true, amount: true, method: true, reference: true },
    orderBy: { paidOn: 'desc' as const },
    take: 1,
  },
  /*
   * Whatever was filed with this bill — the three receipts behind one reimbursement
   * cheque. The bill is the `to` side of the link, so these are the documents pointing
   * at it, and an approver can open each one before saying yes to the total.
   */
  linksTo: {
    where: { relation: 'RELATED_TO' as const },
    orderBy: { createdAt: 'asc' as const },
    take: 20,
    select: { fromDocument: { select: { id: true, originalFilename: true } } },
  },
  /*
   * The reply to a question the approver asked.
   *
   * Without it his own screen was the one place the answer never reached: he asks, the
   * office answers on the board, and his row still showed only his own question. The
   * same two kinds of event the board reads, so the two screens cannot tell different
   * stories about one conversation.
   */
  events: {
    where: {
      OR: [
        { action: 'routed' },
        { action: 'note_added', toValue: { path: ['by'], equals: 'handover-answer' } },
      ],
    },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
    select: {
      action: true,
      createdAt: true,
      toValue: true,
      actor: { select: { name: true, email: true } },
    },
  },
} satisfies Prisma.DocumentInclude

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

/**
 * Documents somebody handed to this person by name, waiting on their answer.
 *
 * ---------------------------------------------------------------------------
 * Why an approver needs this at all
 * ---------------------------------------------------------------------------
 *
 * The accountant hands over a notice nobody in the office can place — "do we have
 * property in Homestead?" — and the only person who knows is the approver. Before this,
 * that document went to the shared board, and an approver cannot open the shared board:
 * WORK_ROLES has never included them. So it arrived nowhere. The approver's words were
 * "it says Chris passed this to you, but in bills to approve, I don't see it."
 *
 * Handing over is a request for an answer, not a transfer of the work. The document
 * stays in whatever queue already held it — the accountant still has to decide what it
 * is once the question comes back — and this is simply the named person's own copy of
 * the question, on the one screen they have.
 *
 * `except` is for the reader who can already see some of these somewhere else. The
 * accountant's own money queue shows a handed document with the question on it, so
 * without this the same notice would sit on two of his tabs at once — which is the exact
 * duplication that made "Needs a decision" and "Bills to approve" unreadable, and the
 * reason that filter is now written in one place.
 *
 * ---------------------------------------------------------------------------
 * Why this one list ignores the entity scope
 * ---------------------------------------------------------------------------
 *
 * Every other query here is cut down to the companies a person may see, and this one
 * deliberately is not, because the permission it answers to is different. `answerHandover`
 * lets you reply to anything with your name on it, whatever your role and whatever your
 * scope — being named is the permission. Filtering the list by scope therefore produced a
 * document that was assigned to you, answerable by you, and invisible to you.
 *
 * It is not a leak: somebody who is allowed to see the document chose to put your name on
 * it and ask you a question. That is an explicit act by an authorised person, and it is
 * the whole point of handing it over.
 *
 * It matters more than it sounds. The person who knows the answer is rarely the person
 * who owns the company — the payroll questions in this office go to one man for all five
 * entities, and scoping him to his own would mean the four he actually knows about never
 * reach him.
 */
export async function listHandedTo(session: Session, except?: Prisma.DocumentWhereInput) {
  return prisma.document.findMany({
    where: {
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      status: { in: [...OPEN] },
      assignedToUserId: session.userId,
      // A bill routed for payment reaches them through the approval tabs instead; this
      // is the other kind of handover, where somebody wants something answered.
      actionKind: 'REVIEW',
      /*
       * Not your own question coming back at you.
       *
       * Sending a bill back assigns it to whoever reads the post — and when that is you,
       * every bill you asked about turned up here as though somebody had asked *you*,
       * under the heading "Questions for you", with "No question was written down"
       * where your own question was. It is already on your list, under Your questions,
       * saying what you asked.
       */
      /*
       * Both exclusions in one AND, because two `NOT` keys on one object is one key.
       *
       * And the first is an OR of two `not`s rather than a NOT of an AND — the same
       * thing in logic and emphatically not the same thing in SQL. `NOT (status =
       * 'NEEDS_REVIEW' AND decided_by = me)` over two NULL columns evaluates to NULL,
       * not TRUE, and a row that answers NULL is dropped. An exclusion meant to hide a
       * handful of bills hid every handover that is not a bill at all, which is most of
       * them. Prisma's `not` handles the null itself.
       */
      AND: [
        {
          /*
           * "Not a bill you yourself asked about", written so a null survives it.
           *
           * Prisma's `not` does not match NULL — measured, not assumed: over 483
           * documents whose approvalStatus is null, `{ not: 'NEEDS_REVIEW' }` keeps 13.
           * So each half of the negation needs its null spelled out, and all four
           * branches together keep every one of the 483 while still excluding the one
           * row this exists to exclude.
           */
          OR: [
            { approvalStatus: null },
            { approvalStatus: { not: 'NEEDS_REVIEW' } },
            { approvalDecidedByUserId: null },
            { approvalDecidedByUserId: { not: session.userId } },
          ],
        },
        ...(except ? [{ NOT: except }] : []),
      ],
    },
    include: BILL_INCLUDE,
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 200,
  })
}

/**
 * The badge on the handover tab.
 *
 * Takes the same `except` as the list, because a count that includes what the list
 * excludes is a tab that says 7 and shows 2 — and a badge that disagrees with its own
 * list is how every miscount in this project started.
 */
export async function handedToCount(session: Session, except?: Prisma.DocumentWhereInput) {
  return prisma.document.count({
    where: {
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      status: { in: [...OPEN] },
      assignedToUserId: session.userId,
      actionKind: 'REVIEW',
      // The same pair of exclusions as the list, or the badge counts what the list
      // refuses to show.
      AND: [
        {
          /*
           * "Not a bill you yourself asked about", written so a null survives it.
           *
           * Prisma's `not` does not match NULL — measured, not assumed: over 483
           * documents whose approvalStatus is null, `{ not: 'NEEDS_REVIEW' }` keeps 13.
           * So each half of the negation needs its null spelled out, and all four
           * branches together keep every one of the 483 while still excluding the one
           * row this exists to exclude.
           */
          OR: [
            { approvalStatus: null },
            { approvalStatus: { not: 'NEEDS_REVIEW' } },
            { approvalDecidedByUserId: null },
            { approvalDecidedByUserId: { not: session.userId } },
          ],
        },
        ...(except ? [{ NOT: except }] : []),
      ],
    },
  })
}

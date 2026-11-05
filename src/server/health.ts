import { prisma } from '@/server/db/client'
import { APPROVE_ROLES } from '@/server/session'

/**
 * What is wrong right now, found without being asked.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * Everything on this screen is something that already happened here, and that was
 * found by somebody noticing rather than by the system saying so:
 *
 *   - A company with nobody who can approve. An approver was told "MMT has no approver
 *     yet" and could not add a bill; it was found because he complained. Today a second
 *     company is in that state and nobody has hit it yet.
 *   - A bill waiting on an approver who does not exist. It looks exactly like a bill
 *     waiting on somebody slow, which is why it can sit for a month.
 *   - A question with no question in it. "No question was written down" is on the
 *     approver's screen right now — somebody handed a document over and wrote nothing,
 *     so the other person has a task and no idea what is being asked.
 *   - Money approved and never sent.
 *   - A bill with no file, which cannot be checked by the person approving it.
 *   - Cheques filed under a spend category, which silently doubles every total that
 *     groups by category. That one was 182 rows when it was found by hand.
 *
 * Each check is a question somebody already had to ask out loud. None is a hypothesis
 * about what might go wrong one day.
 *
 * ---------------------------------------------------------------------------
 * What it will not do
 * ---------------------------------------------------------------------------
 *
 * It does not fix anything, and it does not hide a check that reads zero. A list that
 * only shows problems cannot tell you the difference between "nothing is wrong" and
 * "the check stopped running" — and the second is how a monitor quietly becomes
 * decoration. Zero is reported as zero, in green, with the same sentence.
 */

export type Finding = {
  key: string
  /** The problem, in the words somebody would use out loud. */
  title: string
  /** Why it matters — what it costs if it is left alone. */
  because: string
  /** What to do about it. */
  fix: string
  count: number
  /** A few of them by name, so the number is not the only thing on offer. */
  examples: string[]
  /** Where to go and see them. */
  href?: string
}

const OPEN = ['WAITING', 'IN_PROGRESS'] as const
const NAME = (d: { finalFilename: string | null; originalFilename: string }) =>
  d.finalFilename ?? d.originalFilename

export async function healthReport(companyGroupId: string): Promise<Finding[]> {
  /*
   * Who can approve, per company, resolved once.
   *
   * By capability rather than by the APPROVER role: an owner and an administrator can
   * clear a bill too, and asking only for APPROVER reported companies as having nobody
   * while three people who could were signed in. That exact mistake is why an approver
   * was turned away from adding a bill.
   */
  const [entities, approvers] = await Promise.all([
    prisma.entity.findMany({
      where: { companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, legalName: true },
    }),
    prisma.membership.findMany({
      where: { companyGroupId, isActive: true, role: { in: [...APPROVE_ROLES] } },
      select: { entityScope: true },
    }),
  ])

  const covers = (entityId: string) =>
    approvers.some((m) => m.entityScope.length === 0 || m.entityScope.includes(entityId))

  const orphanEntities = entities.filter((e) => !covers(e.id))
  const orphanIds = orphanEntities.map((e) => e.id)

  const base = { companyGroupId, deletedAt: null }
  const days = (n: number) => new Date(Date.now() - n * 864e5)

  const [
    waitingOnNobody,
    silentHandovers,
    approvedUnpaid,
    billsWithNoFile,
    chequesWithCategory,
    noCompany,
  ] = await Promise.all([
    orphanIds.length === 0
      ? Promise.resolve([])
      : prisma.document.findMany({
          where: { ...base, approvalStatus: 'PENDING', entityId: { in: orphanIds } },
          select: { id: true, finalFilename: true, originalFilename: true },
          take: 5,
        }),

    /*
     * Handed to somebody with nothing written down.
     *
     * Read from the event rather than from the document, because the question lives in
     * the handover — a document can carry notes that are not questions, and an imported
     * row once turned up on the approver's list asking "Imported from the historical
     * log", which nobody had asked.
     *
     * The empty ones are sorted out in JavaScript rather than in the query. A JSON path
     * that is absent and one that holds an empty string are different things to
     * Postgres and the same thing to a person waiting to be asked something, and
     * writing that distinction into a filter is how a check quietly stops matching.
     */
    prisma.documentEvent.findMany({
      where: { action: 'routed', document: { ...base, status: { in: [...OPEN] } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        toValue: true,
        document: { select: { id: true, finalFilename: true, originalFilename: true } },
      },
    }),

    prisma.document.findMany({
      where: {
        ...base,
        approvalStatus: 'APPROVED',
        status: { in: [...OPEN] },
        approvalDecidedAt: { lt: days(14) },
      },
      select: { id: true, finalFilename: true, originalFilename: true },
      take: 5,
    }),

    prisma.document.findMany({
      where: {
        ...base,
        disposition: 'ACTION',
        actionKind: 'PAY',
        status: { in: [...OPEN] },
        storageKey: null,
      },
      select: { id: true, finalFilename: true, originalFilename: true },
      take: 5,
    }),

    prisma.document.findMany({
      where: { ...base, documentType: { code: 'CHECK' }, categoryId: { not: null } },
      select: { id: true, finalFilename: true, originalFilename: true },
      take: 5,
    }),

    prisma.document.findMany({
      where: { ...base, entityId: null, status: { in: [...OPEN] } },
      select: { id: true, finalFilename: true, originalFilename: true },
      take: 5,
    }),
  ])

  const count = async (where: Parameters<typeof prisma.document.count>[0]) =>
    prisma.document.count(where)

  const [nWaiting, nApproved, nNoFile, nCheques, nNoCompany] = await Promise.all([
    orphanIds.length === 0
      ? Promise.resolve(0)
      : count({ where: { ...base, approvalStatus: 'PENDING', entityId: { in: orphanIds } } }),
    count({
      where: {
        ...base,
        approvalStatus: 'APPROVED',
        status: { in: [...OPEN] },
        approvalDecidedAt: { lt: days(14) },
      },
    }),
    count({
      where: { ...base, disposition: 'ACTION', actionKind: 'PAY', status: { in: [...OPEN] }, storageKey: null },
    }),
    count({ where: { ...base, documentType: { code: 'CHECK' }, categoryId: { not: null } } }),
    count({ where: { ...base, entityId: null, status: { in: [...OPEN] } } }),
    Promise.resolve(0),
  ])

  /** A handover with nothing asked in it. */
  const wordless = (v: unknown) => {
    if (!v || typeof v !== 'object') return true
    const note = (v as { note?: unknown }).note
    return typeof note !== 'string' || note.trim() === ''
  }
  const silent = silentHandovers.filter((e) => wordless(e.toValue))
  const nSilentFound = silent.length

  return [
    {
      key: 'no-approver',
      title: 'Companies with nobody who can approve',
      because:
        'A bill for one of these has nowhere to go. It is recorded, it is owed, and no screen will ever put it in front of a person who can clear it.',
      fix: 'Settings → Members: tick the company for whoever approves it.',
      count: orphanEntities.length,
      examples: orphanEntities.map((e) => `${e.code} — ${e.legalName}`),
      href: '/settings/members',
    },
    {
      key: 'waiting-on-nobody',
      title: 'Bills waiting on an approver who does not exist',
      because:
        'On the row this looks exactly like a bill waiting on somebody slow. That is how one sits for a month without anybody being wrong.',
      fix: 'Give the company an approver, and these move on their own.',
      count: nWaiting,
      examples: waitingOnNobody.map(NAME),
      href: '/settings/members',
    },
    {
      key: 'silent-handover',
      title: 'Handed to somebody with no question written down',
      because:
        'The other person now has a task and no idea what is being asked. Their screen says, in as many words, "No question was written down."',
      fix: 'Open it and ask the question, or take it back.',
      count: nSilentFound,
      examples: silent.slice(0, 5).map((e) => NAME(e.document)),
    },
    {
      key: 'approved-unpaid',
      title: 'Approved more than 14 days ago and still not paid',
      because:
        'Somebody cleared this money to go out and it has not gone. Either it was paid outside the system and nobody recorded it, or the supplier is still waiting.',
      fix: 'Accounting → Ready to pay: pay it, or record the payment that already happened.',
      count: nApproved,
      examples: approvedUnpaid.map(NAME),
      href: '/accounting?tab=ready',
    },
    {
      key: 'no-file',
      title: 'Bills with no document attached',
      because:
        'The approver is being asked to clear a number with nothing behind it. The rule here is that a file is always required, because a link dies with the account.',
      fix: 'Open it and attach the invoice, or remove it from the log.',
      count: nNoFile,
      examples: billsWithNoFile.map(NAME),
    },
    {
      key: 'cheque-category',
      title: 'Cheques filed under a spend category',
      because:
        'A cheque is money moving, not a kind of spending. Every total that groups by category counts these twice — quietly, and in the direction that makes spending look higher.',
      fix: 'Master log: filter to cheques and clear the category.',
      count: nCheques,
      examples: chequesWithCategory.map(NAME),
      href: '/log',
    },
    {
      key: 'no-company',
      title: 'Open documents that belong to no company',
      because:
        'Every queue in this system is scoped by company, so a document without one reaches none of them. It is in the log and nowhere else.',
      fix: 'Open it and set the company.',
      count: nNoCompany,
      examples: noCompany.map(NAME),
      href: '/log',
    },
  ]
}

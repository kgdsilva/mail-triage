import Link from 'next/link'
import { prisma } from '@/server/db/client'
import { canSeeWholeLog, requireSession } from '@/server/session'
import { DocumentCard } from '@/components/dashboard-card'

export const dynamic = 'force-dynamic'

/**
 * The landing screen: what is on my plate, grouped by what it is asking of me.
 *
 * Deliberately not "the payer's screen" or "the confirmer's screen". Whoever pays or
 * confirms varies document by document, so one person can have items in more than one
 * group at once, and the groups are a property of the documents rather than of them.
 */
const GROUPS = [
  {
    kind: 'PAY' as const,
    title: 'To pay',
    blurb: 'Bills routed to you. Amount and due date are what matter.',
  },
  {
    kind: 'CONFIRM' as const,
    title: 'To confirm',
    blurb: 'Needs your decision or verification before money moves.',
  },
  {
    kind: 'REVIEW' as const,
    title: 'To review',
    blurb: 'Worth your eyes, nothing to pay yet.',
  },
]

const OPEN = ['WAITING', 'IN_PROGRESS'] as const

export default async function Dashboard() {
  const session = await requireSession()
  const oversees = canSeeWholeLog(session.role)

  const [mine, unassigned, people] = await Promise.all([
    prisma.document.findMany({
      where: {
        companyGroupId: session.companyGroupId,
        deletedAt: null,
        assignedToUserId: session.userId,
        status: { in: [...OPEN] },
        disposition: 'ACTION',
      },
      include: {
        entity: { select: { code: true } },
        vendor: { select: { name: true } },
        documentType: { select: { label: true } },
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    }),

    // Action items nobody owns are invisible on everyone's dashboard, so whoever
    // oversees the log needs to see them somewhere.
    oversees
      ? prisma.document.findMany({
          where: {
            companyGroupId: session.companyGroupId,
            deletedAt: null,
            assignedToUserId: null,
            status: { in: [...OPEN] },
            disposition: 'ACTION',
          },
          include: {
            entity: { select: { code: true } },
            vendor: { select: { name: true } },
            documentType: { select: { label: true } },
          },
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          take: 25,
        })
      : Promise.resolve([]),

    prisma.membership.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const options = people.map((m) => ({
    id: m.user.id,
    label: m.user.name ?? m.user.email,
  }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">
          {session.userName.split(' ')[0]}&rsquo;s queue
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {mine.length === 0
            ? 'Nothing is waiting on you.'
            : `${mine.length} item${mine.length === 1 ? '' : 's'} waiting on you.`}
        </p>
      </div>

      {GROUPS.map((group) => {
        const items = mine.filter((d) => d.actionKind === group.kind)
        if (items.length === 0) return null

        return (
          <section key={group.kind}>
            <h2 className="text-sm font-semibold">
              {group.title}
              <span className="ml-2 text-xs font-normal text-neutral-500">{items.length}</span>
            </h2>
            <p className="mb-2 text-xs text-neutral-500">{group.blurb}</p>
            <div className="space-y-2">
              {items.map((doc) => (
                <DocumentCard key={doc.id} doc={serialize(doc)} people={options} />
              ))}
            </div>
          </section>
        )
      })}

      {mine.length === 0 && (
        <p className="rounded border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          When someone routes a document to you, it shows up here grouped by what it
          needs — pay, confirm, or review.
        </p>
      )}

      {unassigned.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">
            Unassigned
            <span className="ml-2 text-xs font-normal text-neutral-500">{unassigned.length}</span>
          </h2>
          <p className="mb-2 text-xs text-neutral-500">
            Marked for action but not routed to anyone yet, so they are on nobody&rsquo;s
            queue.
          </p>
          <div className="space-y-2">
            {unassigned.map((doc) => (
              <DocumentCard key={doc.id} doc={serialize(doc)} people={options} />
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-neutral-500">
        <Link href="/log" className="underline">
          {canSeeWholeLog(session.role) ? 'Open the full master log' : 'See everything routed to you'}
        </Link>
      </p>
    </div>
  )
}

/** Decimal and Date do not cross into a client component; format them here. */
function serialize(doc: {
  id: string
  originalFilename: string
  finalFilename: string | null
  summaryNote: string | null
  amount: unknown
  dueDate: Date | null
  actionKind: string | null
  entity: { code: string } | null
  vendor: { name: string } | null
  documentType: { label: string } | null
}) {
  return {
    id: doc.id,
    title: doc.finalFilename ?? doc.originalFilename,
    summaryNote: doc.summaryNote,
    amount: doc.amount == null ? null : String(doc.amount),
    dueDate: doc.dueDate ? doc.dueDate.toISOString().slice(0, 10) : null,
    actionKind: doc.actionKind,
    entityCode: doc.entity?.code ?? null,
    vendorName: doc.vendor?.name ?? null,
    typeLabel: doc.documentType?.label ?? null,
  }
}

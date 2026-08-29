import Link from 'next/link'
import { ArrowRight, Banknote, CheckCheck, Eye, Inbox, ShieldQuestion } from 'lucide-react'
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
    Icon: Banknote,
  },
  {
    kind: 'CONFIRM' as const,
    title: 'To confirm',
    blurb: 'Needs your decision or verification before money moves.',
    Icon: ShieldQuestion,
  },
  {
    kind: 'REVIEW' as const,
    title: 'To review',
    blurb: 'Worth your eyes, nothing to pay yet.',
    Icon: Eye,
  },
]

const OPEN = ['WAITING', 'IN_PROGRESS'] as const

const CARD_INCLUDE = {
  entity: { select: { code: true, sortOrder: true } },
  vendor: { select: { name: true } },
  documentType: { select: { label: true, code: true } },
} as const

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
      include: CARD_INCLUDE,
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
          include: CARD_INCLUDE,
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

  const options = people.map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email }))
  const firstName = session.userName.split(' ')[0]

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-9">
        <h1 className="text-[26px] font-bold tracking-tight text-navy-900">
          {firstName}&rsquo;s queue
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          {mine.length === 0
            ? 'Nothing is waiting on you.'
            : `${mine.length} item${mine.length === 1 ? '' : 's'} waiting on you.`}
        </p>
      </header>

      <div className="space-y-10">
        {GROUPS.map(({ kind, title, blurb, Icon }) => {
          const items = mine.filter((d) => d.actionKind === kind)
          if (items.length === 0) return null

          return (
            <section key={kind}>
              <div className="mb-3 flex items-baseline gap-2.5">
                <Icon className="size-4 translate-y-0.5 text-navy-500" aria-hidden />
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-navy-900">
                  {title}
                </h2>
                <span className="rounded-full bg-navy-50 px-1.5 py-0.5 text-[11px] font-semibold text-navy-700">
                  {items.length}
                </span>
                <span className="hidden text-[12.5px] text-subtle sm:inline">{blurb}</span>
              </div>
              <div className="space-y-2.5">
                {items.map((doc) => (
                  <DocumentCard key={doc.id} doc={serialize(doc)} people={options} />
                ))}
              </div>
            </section>
          )
        })}

        {mine.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
            <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-navy-50 text-navy-500">
              <Inbox className="size-6" strokeWidth={1.6} aria-hidden />
            </span>
            <h3 className="text-[14.5px] font-semibold text-navy-900">Nothing is waiting on you</h3>
            <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
              When someone routes a document to you, it shows up here grouped by what it
              needs — pay, confirm, or review.
            </p>
          </div>
        )}

        {unassigned.length > 0 && (
          <section>
            <div className="mb-3 flex items-baseline gap-2.5">
              <CheckCheck className="size-4 translate-y-0.5 text-subtle" aria-hidden />
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.09em] text-navy-900">
                Unassigned
              </h2>
              <span className="rounded-full bg-line-soft px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                {unassigned.length}
              </span>
              <span className="hidden text-[12.5px] text-subtle sm:inline">
                Marked for action but not routed to anyone yet.
              </span>
            </div>
            <div className="space-y-2.5">
              {unassigned.map((doc) => (
                <DocumentCard key={doc.id} doc={serialize(doc)} people={options} />
              ))}
            </div>
          </section>
        )}
      </div>

      <Link
        href="/log"
        className="mt-10 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-navy-700"
      >
        {canSeeWholeLog(session.role) ? 'Open the full master log' : 'See everything routed to you'}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
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
  entity: { code: string; sortOrder: number } | null
  vendor: { name: string } | null
  documentType: { label: string; code: string } | null
}) {
  return {
    id: doc.id,
    title: doc.finalFilename ?? doc.originalFilename,
    summaryNote: doc.summaryNote,
    amount:
      doc.amount == null
        ? null
        : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(
            Number(String(doc.amount)),
          ),
    dueDate: doc.dueDate ? doc.dueDate.toISOString().slice(0, 10) : null,
    actionKind: doc.actionKind,
    entityCode: doc.entity?.code ?? null,
    entityIndex: doc.entity?.sortOrder ?? 0,
    typeCode: doc.documentType?.code ?? null,
    vendorName: doc.vendor?.name ?? null,
    typeLabel: doc.documentType?.label ?? null,
  }
}

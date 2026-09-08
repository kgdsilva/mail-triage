import Link from 'next/link'
import { ArrowRight, CircleAlert, Inbox, Wallet } from 'lucide-react'
import { prisma } from '@/server/db/client'
import { canSeeWholeLog, requireSession } from '@/server/session'
import { DocumentCard } from '@/components/dashboard-card'
import { CompanyPicker } from '@/components/company-picker'
import { urgency } from '@/lib/theme'

export const dynamic = 'force-dynamic'

const OPEN = ['WAITING', 'IN_PROGRESS'] as const

const CARD_INCLUDE = {
  entity: { select: { code: true, sortOrder: true } },
  vendor: { select: { name: true } },
  documentType: { select: { label: true, code: true } },
} as const

/**
 * The landing screen: what is on my plate, soonest first.
 *
 * Deliberately not "the payer's screen" or "the confirmer's screen". Whoever pays or
 * confirms varies document by document, so one person can have items of every kind at
 * once — which is why this is one list ordered by when it is due, with the company and
 * the ask carried on each card, rather than three lists to check in turn.
 */
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>
}) {
  const session = await requireSession()
  const oversees = canSeeWholeLog(session.role)
  const { entity } = await searchParams

  const forEntity = entity ? { entityId: entity } : {}

  const [mine, unassigned, people, entities] = await Promise.all([
    prisma.document.findMany({
      where: {
        companyGroupId: session.companyGroupId,
        deletedAt: null,
        assignedToUserId: session.userId,
        status: { in: [...OPEN] },
        disposition: 'ACTION',
        ...forEntity,
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
            ...forEntity,
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

    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, legalName: true, sortOrder: true },
    }),
  ])

  const options = people.map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email }))
  const firstName = session.userName.split(' ')[0]
  const cards = mine.map(serialize)

  const owed = cards.reduce(
    (sum, c) => sum + (c.amount ? Number(c.amount.replace(/,/g, '')) : 0),
    0,
  )
  const overdue = cards.filter((c) => urgency(c.dueDate) === 'overdue').length

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-[28px] font-extrabold text-navy-900">{firstName}&rsquo;s queue</h1>
        <p className="mt-1 text-[15px] text-muted">
          {cards.length === 0
            ? 'Nothing is waiting on you.'
            : `${cards.length} item${cards.length === 1 ? '' : 's'} waiting on you.`}
        </p>
      </header>

      {/* The two numbers worth knowing before reading a single card. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <CompanyPicker entities={entities} value={entity ?? null} />

        {owed > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-gold-50 px-3 py-1.5 text-[12.5px] font-semibold text-gold-800">
            <Wallet className="size-3.5" aria-hidden />
            <span className="tabular">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(owed)}
            </span>
            in your queue
          </span>
        )}
        {overdue > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-danger-100 px-3 py-1.5 text-[12.5px] font-bold text-danger-700">
            <CircleAlert className="size-3.5" aria-hidden />
            {overdue} overdue
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {cards.map((doc) => (
          <DocumentCard key={doc.id} doc={doc} people={options} />
        ))}
      </div>

      {cards.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-teal-100 text-teal-700">
            <Inbox className="size-6" strokeWidth={1.6} aria-hidden />
          </span>
          <h3 className="text-[15px] font-bold text-navy-900">
            {entity ? 'Nothing for this company' : 'Nothing is waiting on you'}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
            When someone routes a document to you it shows up here, soonest due first,
            tagged with the company it belongs to.
          </p>
        </div>
      )}

      {unassigned.length > 0 && (
        <section className="mt-9">
          <div className="mb-3 flex items-baseline gap-2.5">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.09em] text-navy-900">
              Not routed to anyone
            </h2>
            <span className="rounded-full bg-line-soft px-1.5 py-0.5 text-[11px] font-bold text-muted">
              {unassigned.length}
            </span>
            <span className="hidden text-[12.5px] text-subtle sm:inline">
              Marked for action, waiting on someone to own it.
            </span>
          </div>
          <div className="space-y-2.5">
            {unassigned.map((doc) => (
              <DocumentCard key={doc.id} doc={serialize(doc)} people={options} />
            ))}
          </div>
        </section>
      )}

      <Link
        href="/log"
        className="mt-10 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-navy-700"
      >
        {oversees ? 'Open the full master log' : 'See everything routed to you'}
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
  storageKey: string | null
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
    hasFile: Boolean(doc.storageKey),
  }
}

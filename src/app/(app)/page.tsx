import Link from 'next/link'
import { ArrowRight, CircleAlert, Inbox, Wallet } from 'lucide-react'
import { prisma } from '@/server/db/client'
import { boardCounts, listBoard, type BoardScope } from '@/server/board'
import { canDecide, canSeeWholeLog, requireWorker } from '@/server/session'
import { DocumentCard, type CardDoc } from '@/components/dashboard-card'
import { BoardFilters } from '@/components/board-filters'
import { CompanyPicker } from '@/components/company-picker'
import { entityAccent, entityColor, urgency } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * The board: everything waiting on a decision, grouped by company.
 *
 * This was one person's queue, and the change is the point. A queue only its owner can
 * see is a queue where work stops invisibly — the week somebody is away, seven bills sit
 * in their name and no other screen says so. So the list is shared, and whose an item is
 * became a tag on the card rather than the limit of what you may look at.
 *
 * It still opens on your own items, because that is what you came to do. What is new is
 * that the tab beside it says how many belong to everybody else, which is the sentence
 * the old screen had no way of saying.
 */
export default async function Board({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; who?: string; person?: string }>
}) {
  const session = await requireWorker()
  const decides = canDecide(session.role)
  const { entity, who, person } = await searchParams

  const scope: BoardScope = who === 'everyone' || who === 'unassigned' ? who : 'mine'

  const [items, counts, people, entities] = await Promise.all([
    listBoard(session.companyGroupId, {
      scope,
      userId: session.userId,
      entityId: entity ?? null,
      assigneeId: person ?? null,
    }),
    boardCounts(session.companyGroupId, session.userId),

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

  const options = people
    // Nobody hands a document to the scanner — she has no screen to receive it on — and
    // a VIEWER is read-only by definition.
    .filter((m) => m.role !== 'UPLOADER' && m.role !== 'VIEWER')
    .map((m) => ({ id: m.user.id, label: m.user.name ?? m.user.email }))

  const cards = items.map((doc) => serialize(doc, session.userId))

  const owed = cards.reduce((sum, c) => sum + (c.amount ? Number(c.amount.replace(/,/g, '')) : 0), 0)
  const overdue = cards.filter((c) => urgency(c.dueDate) === 'overdue').length

  /*
   * Grouped by company, in the order the companies are configured. That is the first
   * question anyone asks of a piece of mail, and it is how the people reading this think
   * — not in "mine" and "theirs".
   */
  const groups = new Map<string, { code: string; name: string; index: number; docs: CardDoc[] }>()
  for (const [i, doc] of items.entries()) {
    const key = doc.entity?.id ?? 'none'
    if (!groups.has(key)) {
      groups.set(key, {
        code: doc.entity?.code ?? '—',
        name: doc.entity?.legalName ?? 'Company not identified',
        index: doc.entity?.sortOrder ?? 0,
        docs: [],
      })
    }
    groups.get(key)!.docs.push(cards[i])
  }

  const heading =
    scope === 'mine'
      ? `${session.userName.split(' ')[0]}’s items`
      : scope === 'unassigned'
        ? 'Waiting for someone to own it'
        : 'Everything on the board'

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <h1 className="text-[28px] font-extrabold text-navy-900">Needs a decision</h1>
        <p className="mt-1 text-[15px] text-muted">
          Everything waiting on a person, from every company. Whoever picks it up first
          can act on it.
        </p>
      </header>

      <BoardFilters
        scope={scope}
        counts={counts}
        people={options}
        person={person ?? null}
        entity={entity ?? null}
      />

      <div className="mb-5 mt-4 flex flex-wrap items-center gap-3">
        <CompanyPicker entities={entities} value={entity ?? null} />

        {owed > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-gold-50 px-3 py-1.5 text-[12.5px] font-semibold text-gold-800">
            <Wallet className="size-3.5" aria-hidden />
            <span className="tabular">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(owed)}
            </span>
            to go out
          </span>
        )}
        {overdue > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-danger-100 px-3 py-1.5 text-[12.5px] font-bold text-danger-700">
            <CircleAlert className="size-3.5" aria-hidden />
            {overdue} overdue
          </span>
        )}
      </div>

      {cards.length > 0 && (
        <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.09em] text-navy-900">
          {heading} · {cards.length}
        </p>
      )}

      <div className="space-y-6">
        {[...groups.values()]
          .sort((a, b) => a.index - b.index)
          .map((group) => (
            <section key={group.code}>
              <div className="mb-2.5 flex items-center gap-2.5">
                <span
                  className={`h-4 w-1.5 rounded-sm ${entityAccent(group.code, group.index)}`}
                  aria-hidden
                />
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider ${entityColor(group.code, group.index)}`}
                >
                  {group.code}
                </span>
                <h2 className="text-[14px] font-bold text-navy-900">{group.name}</h2>
                <span className="text-[12.5px] text-subtle">
                  {group.docs.length} item{group.docs.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="space-y-2.5">
                {group.docs.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    people={options}
                    entities={entities}
                    canDecide={decides}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>

      {cards.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-teal-100 text-teal-700">
            <Inbox className="size-6" strokeWidth={1.6} aria-hidden />
          </span>
          <h3 className="text-[15px] font-bold text-navy-900">
            {scope === 'mine' && counts.everyone > 0
              ? 'Nothing is waiting on you'
              : 'Nothing is waiting on anyone'}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
            {scope === 'mine' && counts.everyone > 0 ? (
              <>
                {counts.everyone} {counts.everyone === 1 ? 'item is' : 'items are'} still on
                the board for other people —{' '}
                <Link href="/?who=everyone" className="font-semibold text-navy-700 underline">
                  see everything
                </Link>
                .
              </>
            ) : (
              'When a document is decided to need a person, it appears here, soonest due first, tagged with the company it belongs to.'
            )}
          </p>
        </div>
      )}

      <Link
        href="/log"
        className="mt-10 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-navy-700"
      >
        {canSeeWholeLog(session.role) ? 'Open the full master log' : 'See everything routed to you'}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  )
}

/** Decimal and Date do not cross into a client component; format them here. */
function serialize(
  doc: {
    id: string
    originalFilename: string
    finalFilename: string | null
    summaryNote: string | null
    amount: unknown
    dueDate: Date | null
    actionKind: string | null
    storageKey: string | null
    entity: { id: string; code: string; sortOrder: number } | null
    vendor: { name: string } | null
    documentType: { label: string; code: string } | null
    assignedTo: { id: string; name: string | null; email: string } | null
  },
  viewerId: string,
): CardDoc {
  return {
    id: doc.id,
    title: doc.finalFilename ?? doc.originalFilename,
    summaryNote: doc.summaryNote,
    // Formatted here, with the grouping separator the card shows and the two decimals
    // a Decimal's own toString drops — "33.4" beside "1,095.00" reads as a typo.
    amount:
      doc.amount == null
        ? null
        : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(
            Number(String(doc.amount)),
          ),
    dueDate: doc.dueDate ? doc.dueDate.toISOString().slice(0, 10) : null,
    actionKind: doc.actionKind,
    entityId: doc.entity?.id ?? null,
    entityCode: doc.entity?.code ?? null,
    entityIndex: doc.entity?.sortOrder ?? 0,
    typeCode: doc.documentType?.code ?? null,
    typeLabel: doc.documentType?.label ?? null,
    vendorName: doc.vendor?.name ?? null,
    assigneeName: doc.assignedTo ? (doc.assignedTo.name ?? doc.assignedTo.email) : null,
    mine: doc.assignedTo?.id === viewerId,
    hasFile: Boolean(doc.storageKey),
  }
}

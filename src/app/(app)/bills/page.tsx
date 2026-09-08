import { Wallet } from 'lucide-react'
import { prisma } from '@/server/db/client'
import { canSeeWholeLog, isAdmin, requireSession } from '@/server/session'
import { BillsList, type Bill } from '@/components/bills-list'
import { CompanyPicker } from '@/components/company-picker'
import { urgency } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * Everything with money to send out, on one screen, soonest first.
 *
 * The master log answers "what happened to this document"; this answers the only
 * question a payment run asks — what has to leave, and when. Same records, same
 * decision path as the classify form: nothing here writes anything the rest of the app
 * cannot also write.
 */
export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>
}) {
  const session = await requireSession()
  const { entity } = await searchParams
  const wholeLog = canSeeWholeLog(session.role)

  const [rows, entities] = await Promise.all([
    prisma.document.findMany({
      where: {
        companyGroupId: session.companyGroupId,
        deletedAt: null,
        disposition: 'ACTION',
        actionKind: 'PAY',
        status: { in: ['WAITING', 'IN_PROGRESS'] },
        ...(entity ? { entityId: entity } : {}),
        // A member works their own queue rather than the whole group's payables.
        ...(wholeLog ? {} : { assignedToUserId: session.userId }),
      },
      include: {
        entity: { select: { code: true, sortOrder: true } },
        vendor: { select: { name: true } },
        documentType: { select: { label: true, code: true } },
        assignedTo: { select: { name: true, email: true } },
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    }),

    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, legalName: true, sortOrder: true },
    }),
  ])

  const bills: Bill[] = rows.map((d) => ({
    id: d.id,
    title: d.finalFilename ?? d.originalFilename,
    vendorName: d.vendor?.name ?? null,
    typeLabel: d.documentType?.label ?? null,
    typeCode: d.documentType?.code ?? null,
    summaryNote: d.summaryNote,
    amount:
      d.amount == null
        ? null
        : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(
            Number(String(d.amount)),
          ),
    dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
    entityCode: d.entity?.code ?? null,
    entityIndex: d.entity?.sortOrder ?? 0,
    assignee: d.assignedTo?.name ?? d.assignedTo?.email ?? null,
    hasFile: Boolean(d.storageKey),
  }))

  const total = bills.reduce(
    (sum, b) => sum + (b.amount ? Number(b.amount.replace(/,/g, '')) : 0),
    0,
  )
  const overdue = bills.filter((b) => urgency(b.dueDate) === 'overdue')
  const overdueTotal = overdue.reduce(
    (sum, b) => sum + (b.amount ? Number(b.amount.replace(/,/g, '')) : 0),
    0,
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-[28px] font-extrabold text-navy-900">Bills to pay</h1>
        <p className="mt-1 text-[15px] text-muted">
          {wholeLog
            ? 'Everything open with money to send out, across every company.'
            : 'Everything open with money to send out, routed to you.'}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Open" value={money(total)} count={`${bills.length} bill${bills.length === 1 ? '' : 's'}`} tone="bg-navy-50 text-navy-900" />
        <Figure
          label="Overdue"
          value={money(overdueTotal)}
          count={`${overdue.length} bill${overdue.length === 1 ? '' : 's'}`}
          tone={overdue.length > 0 ? 'bg-danger-100 text-danger-700' : 'bg-line-soft text-muted'}
        />
        <div className="flex items-center rounded-xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
          <CompanyPicker entities={entities} value={entity ?? null} />
        </div>
      </div>

      {bills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-16 text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-teal-100 text-teal-700">
            <Wallet className="size-6" strokeWidth={1.6} aria-hidden />
          </span>
          <h3 className="text-[15px] font-bold text-navy-900">Nothing to pay</h3>
          <p className="mt-1 text-[13px] text-muted">
            {entity
              ? 'This company has no open bills.'
              : 'Every bill that came in has been paid, archived or handed on.'}
          </p>
        </div>
      ) : (
        <BillsList bills={bills} canTriage={isAdmin(session.role)} />
      )}
    </div>
  )
}

/** One headline number, coloured by whether it is good news. */
function Figure({
  label,
  value,
  count,
  tone,
}: {
  label: string
  value: string
  count: string
  tone: string
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-subtle">
        {label}
      </span>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="display tabular text-[22px] font-extrabold tracking-tight text-navy-900">
          {value}
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${tone}`}>{count}</span>
      </div>
    </div>
  )
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

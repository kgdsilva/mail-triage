import { Plus, Receipt } from 'lucide-react'
import { prisma } from '@/server/db/client'
import { listPayments, paymentTotals } from '@/server/payments'
import { canSeeWholeLog, requireWorker } from '@/server/session'
import { CompanyPicker } from '@/components/company-picker'
import { PaymentsList, type PaidRow } from '@/components/payments-list'
import { ManualPayment } from '@/components/manual-payment'

export const dynamic = 'force-dynamic'

/**
 * What has been paid, and the proof.
 *
 * The counterpart to Bills to pay: that screen is the work still ahead, this is the
 * record of what is behind. Two ways in — marking a bill paid on the other screen, or
 * entering one here that was paid before this platform existed or never had a scan.
 * Neither is the lesser path.
 */
export default async function PaidPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>
}) {
  const session = await requireWorker()
  const { entity } = await searchParams
  const wholeLog = canSeeWholeLog(session.role)

  const filters = {
    entityId: entity || null,
    // A member sees the payments they recorded; overseers see the group's history.
    restrictToUserId: wholeLog ? null : session.userId,
  }

  const [payments, totals, entities] = await Promise.all([
    listPayments(session.companyGroupId, filters),
    paymentTotals(session.companyGroupId, filters),
    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, legalName: true, sortOrder: true },
    }),
  ])

  const rows: PaidRow[] = payments.map((p) => ({
    id: p.id,
    entityCode: p.entity?.code ?? null,
    entityIndex: p.entity?.sortOrder ?? 0,
    entityName: p.entity?.legalName ?? null,
    payee: p.vendor?.name ?? p.payeeName ?? 'Not recorded',
    amount: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(
      Number(p.amount.toString()),
    ),
    paidOn: p.paidOn.toISOString().slice(0, 10),
    method: p.method,
    note: p.note,
    recordedBy: p.recordedBy.name ?? p.recordedBy.email,
    documentName: p.document ? (p.document.finalFilename ?? p.document.originalFilename) : null,
    receiptFilename: p.receiptFilename,
    receiptIsPdf: (p.receiptMimeType ?? '').includes('pdf'),
    hasReceipt: Boolean(p.receiptStorageKey),
  }))

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-[28px] font-extrabold text-navy-900">Bills paid</h1>
        <p className="mt-1 text-[15px] text-muted">
          {wholeLog
            ? 'Every payment on record, with its proof. Nothing here is ever removed.'
            : 'The payments you have recorded, with their proof.'}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="This month" value={money(totals.monthTotal)} note={`${totals.monthCount} payment${totals.monthCount === 1 ? '' : 's'}`} tone="bg-ok-100 text-ok-700" />
        <Figure label="All time" value={money(totals.total)} note={`${totals.count} payment${totals.count === 1 ? '' : 's'}`} tone="bg-navy-50 text-navy-900" />
        <Figure
          label="Missing a receipt"
          value={String(totals.missingReceipt)}
          note={totals.missingReceipt === 0 ? 'every payment has proof' : 'attach from the row'}
          tone={totals.missingReceipt > 0 ? 'bg-gold-100 text-gold-800' : 'bg-line-soft text-muted'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
        <CompanyPicker entities={entities} value={entity ?? null} />
        <span className="ml-auto">
          <ManualPayment entities={entities} />
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-16 text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-ok-100 text-ok-700">
            <Receipt className="size-6" strokeWidth={1.6} aria-hidden />
          </span>
          <h3 className="text-[15px] font-bold text-navy-900">Nothing recorded yet</h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted">
            Mark a bill paid on <strong className="font-semibold">Bills to pay</strong> and it
            lands here with its receipt — or use{' '}
            <span className="inline-flex items-center gap-1 align-middle font-semibold text-navy-900">
              <Plus className="size-3" aria-hidden />
              Record a payment
            </span>{' '}
            above for one paid outside the platform.
          </p>
        </div>
      ) : (
        <PaymentsList payments={rows} />
      )}
    </div>
  )
}

/** One headline number, coloured by whether it is good news. */
function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone: string
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-subtle">
        {label}
      </span>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className="display tabular text-[22px] font-extrabold tracking-tight text-navy-900">
          {value}
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${tone}`}>{note}</span>
      </div>
    </div>
  )
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

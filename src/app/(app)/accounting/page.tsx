import Link from 'next/link'
import { Clock } from 'lucide-react'
import type { ApprovalStatus } from '@/generated/prisma/enums'
import { billCounts, listBills } from '@/server/approvals'
import { narrowEntityChoice, visibleEntities, visibleEntityIds } from '@/server/scope'
import { canApprove, canSettle, requireSettler } from '@/server/session'
import { AccountingTable, type AccountingBill } from '@/components/accounting-table'
import { ApprovalsTable, type ApprovalBill } from '@/components/approvals-table'
import { CompanyPicker } from '@/components/company-picker'
import { formatMoney } from '@/components/badges'

export const dynamic = 'force-dynamic'

/**
 * The accountant's three questions, in the order they get asked.
 *
 * What may I pay, what is still stuck with somebody, and what did I already pay. The
 * middle tab is read-only on purpose: its job is to let the accountant see what to chase
 * and who to chase, not to let them clear it themselves — which would undo the one
 * separation this workflow exists to keep.
 */

const TABS = ['ready', 'waiting', 'denied', 'paid'] as const
type Tab = (typeof TABS)[number]

/*
 * "Denied" sits next to "Ready to pay" on purpose: the two together are the whole
 * question this screen answers — what to pay, and what not to. A refused bill used to
 * appear in none of these tabs at all. It simply left "Waiting on approval" and was
 * gone, so from here a refusal and a bill nobody had decided yet looked identical.
 */
const LABELS: Record<Tab, string> = {
  ready: 'Ready to pay',
  waiting: 'Waiting on approval',
  denied: 'Denied',
  paid: 'Paid',
}

/** Whole days since a date, for "waiting 5 days". */
function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5))
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; entity?: string }>
}) {
  const session = await requireSettler()
  const { tab, entity } = await searchParams

  const active: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'ready'
  const scope = await visibleEntityIds(session)
  const chosen = narrowEntityChoice(entity, scope)

  const statuses: ApprovalStatus[] =
    active === 'waiting'
      ? ['PENDING', 'NEEDS_REVIEW']
      : active === 'denied'
        ? ['DENIED']
        : ['APPROVED']

  const [bills, counts, entities] = await Promise.all([
    listBills(session, {
      statuses,
      entityId: chosen,
      // A refusal is shown whether or not money ever moved: if a denied bill somehow
      // carries a payment, that is the one case somebody most needs to see.
      ...(active === 'denied' ? {} : { settled: active === 'paid' }),
    }),
    billCounts(session, chosen),
    visibleEntities(session),
  ])

  const count: Record<Tab, number> = {
    ready: counts.approvedUnpaid,
    waiting: counts.pending + counts.needsReview,
    denied: counts.denied,
    paid: counts.paid,
  }

  const readyTotal = bills.reduce((sum, b) => sum + Number(b.amount ?? 0), 0)

  const accountingRows: AccountingBill[] = bills.map((d) => ({
    id: d.id,
    title: d.finalFilename ?? d.originalFilename,
    vendorName: d.vendor?.name ?? null,
    invoiceNumber: d.invoiceNumber,
    amount: d.amount === null ? null : formatMoney(d.amount),
    // Two decimals, so the form shows 486.90 rather than the Decimal's own 486.9 —
    // which reads like a typo next to a column of money.
    amountRaw: d.amount === null ? null : Number(d.amount.toString()).toFixed(2),
    entityId: d.entityId,
    entityCode: d.entity?.code ?? null,
    companyName: d.entity?.legalName ?? null,
    entityIndex: d.entity?.sortOrder ?? 0,
    dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
    receivedDate: d.createdAt.toISOString(),
    categoryName: d.category?.name ?? d.documentType?.label ?? null,
    approvedBy: d.approvalDecidedBy?.name ?? d.approvalDecidedBy?.email ?? null,
    approvedAt: d.approvalDecidedAt?.toISOString() ?? null,
    hasFile: Boolean(d.storageKey),
    payment: d.payments[0]
      ? {
          paidOn: d.payments[0].paidOn.toISOString().slice(0, 10),
          amount: d.payments[0].amount.toString(),
          method: d.payments[0].method,
          reference: d.payments[0].reference,
        }
      : null,
    refusal:
      d.approvalStatus === 'DENIED'
        ? {
            by: d.approvalDecidedBy?.name ?? d.approvalDecidedBy?.email ?? null,
            at: d.approvalDecidedAt?.toISOString() ?? null,
            note: d.approvalNote,
          }
        : null,
  }))

  /* The waiting tab reuses the approver's own table with its actions switched off, so
     the accountant reads exactly what the approver sees — including the note on a bill
     that was sent back, which is usually the answer to "why is this still here". */
  const waitingRows: ApprovalBill[] = bills.map((d) => ({
    id: d.id,
    title: d.finalFilename ?? d.originalFilename,
    vendorName: d.vendor?.name ?? null,
    invoiceNumber: d.invoiceNumber,
    amount: d.amount === null ? null : formatMoney(d.amount),
    amountValue: d.amount === null ? 0 : Number(d.amount.toString()),
    companyCode: d.entity?.code ?? null,
    companyName: d.entity?.legalName ?? null,
    companyIndex: d.entity?.sortOrder ?? 0,
    dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
    receivedDate: d.createdAt.toISOString(),
    categoryName: d.category?.name ?? d.documentType?.label ?? null,
    status: d.approvalStatus ?? 'PENDING',
    note: d.approvalNote,
    decidedBy: d.approvalDecidedBy?.name ?? d.approvalDecidedBy?.email ?? null,
    decidedAt: d.approvalDecidedAt?.toISOString() ?? null,
    hasFile: Boolean(d.storageKey),
  }))

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Accounting</h1>
        <p className="mt-1 text-sm text-muted">
          What is cleared to pay, what an approver refused, what is still waiting on one,
          and the history of what went out. Payments are made in QuickBooks; this records
          them.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          {TABS.map((t) => {
            const on = t === active
            return (
              <Link
                key={t}
                href={`/accounting?tab=${t}${chosen ? `&entity=${chosen}` : ''}`}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  on
                    ? 'bg-navy-700 text-white'
                    : 'text-muted hover:bg-navy-50 hover:text-navy-700 active:bg-navy-100'
                }`}
              >
                {LABELS[t]}
                <span
                  className={`tabular rounded-full px-1.5 text-[11px] font-bold ${
                    on
                      ? 'bg-white/20 text-white'
                      : t === 'ready' && count[t] > 0
                        ? 'bg-ok-100 text-ok-700'
                        : 'bg-line-soft text-muted'
                  }`}
                >
                  {count[t]}
                </span>
              </Link>
            )
          })}
        </div>

        <CompanyPicker entities={entities} value={chosen} />

        {active === 'ready' && readyTotal > 0 && (
          <span className="tabular rounded-full bg-ok-100 px-3 py-1.5 text-[12.5px] font-semibold text-ok-700">
            {formatMoney({ toString: () => String(readyTotal) })} cleared to pay
          </span>
        )}
      </div>

      {active === 'waiting' ? (
        <>
          {/* How long each has been sitting, which is what turns this list into a
              conversation with the approver rather than a wait. */}
          <ul className="space-y-1">
            {waitingRows.map((r) => {
              const waited = daysSince(r.receivedDate)
              const overdue =
                r.dueDate && r.dueDate < new Date().toISOString().slice(0, 10)
                  ? daysSince(`${r.dueDate}T00:00:00Z`)
                  : 0
              return (
                <li
                  key={`age-${r.id}`}
                  className="flex flex-wrap items-center gap-2 px-1 text-[12.5px]"
                >
                  <Clock className="size-3.5 flex-none text-subtle" aria-hidden />
                  <span className="font-semibold text-navy-900">
                    {r.vendorName ?? r.title}
                  </span>
                  <span className="text-muted">
                    waiting {waited} day{waited === 1 ? '' : 's'}
                  </span>
                  {overdue > 0 && (
                    <span className="rounded-full bg-danger-100 px-2 py-0.5 text-[11.5px] font-bold text-danger-700">
                      {overdue} day{overdue === 1 ? '' : 's'} overdue
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <ApprovalsTable
            bills={waitingRows}
            canDecide={false}
            showCompany={entities.length > 1}
            // Pending and needs-review are mixed here, so the status is the useful part.
            showStatus
          />
        </>
      ) : (
        <AccountingTable
          bills={accountingRows}
          mode={active === 'paid' ? 'paid' : active === 'denied' ? 'denied' : 'ready'}
          entities={entities}
          canSettle={canSettle(session.role)}
        />
      )}

      {canApprove(session.role) && (
        <p className="text-[12.5px] text-subtle">
          You can also approve, because you are an administrator. The accountant role
          cannot — approving and paying are deliberately different people.
        </p>
      )}
    </div>
  )
}

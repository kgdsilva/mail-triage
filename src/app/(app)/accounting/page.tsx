import Link from 'next/link'
import { PageHelp } from '@/components/page-help'
import { Clock } from 'lucide-react'
import type { ApprovalStatus } from '@/generated/prisma/enums'
import { billCounts, listBills } from '@/server/approvals'
import { narrowEntityChoice, visibleEntities, visibleEntityIds } from '@/server/scope'
import { canApprove, canSettle, requireSettler } from '@/server/session'
import { prisma } from '@/server/db/client'
import { countToDecide, handoff, listToDecide } from '@/server/to-decide'
import { canAddBill, canTriagePayments } from '@/server/session'
import { AddBill } from '@/components/add-bill'
import { AccountingTable, type AccountingBill } from '@/components/accounting-table'
import { ToDecideList } from '@/components/to-decide-list'
import { ChecksTable } from '@/components/checks-table'
import { listChecks } from '@/server/documents'
import { ApprovalsTable, type ApprovalBill } from '@/components/approvals-table'
import { CompanyPicker } from '@/components/company-picker'
import { formatMoney } from '@/components/badges'
import { RecurringLine, type Row as RecurringRow } from '@/components/recurring-line'
import { periodOf, previousPeriod, recurringFor } from '@/server/recurring'

export const dynamic = 'force-dynamic'

/**
 * The accountant's three questions, in the order they get asked.
 *
 * What may I pay, what is still stuck with somebody, and what did I already pay. The
 * middle tab is read-only on purpose: its job is to let the accountant see what to chase
 * and who to chase, not to let them clear it themselves — which would undo the one
 * separation this workflow exists to keep.
 */

const TABS = ['decide', 'ready', 'waiting', 'denied', 'paid', 'checks'] as const
type Tab = (typeof TABS)[number]

/*
 * "Denied" sits next to "Ready to pay" on purpose: the two together are the whole
 * question this screen answers — what to pay, and what not to. A refused bill used to
 * appear in none of these tabs at all. It simply left "Waiting on approval" and was
 * gone, so from here a refusal and a bill nobody had decided yet looked identical.
 */
/*
 * "Is it a bill?" rather than "To decide", because the board is already called "Needs a
 * decision" and two screens whose names both mean "somebody must decide" is the thing
 * that made this confusing. The tab is named after the question it answers.
 */
const LABELS: Record<Tab, string> = {
  decide: 'Is it a bill?',
  ready: 'Ready to pay',
  waiting: 'Waiting on approval',
  denied: 'Denied',
  paid: 'Paid',
  checks: 'Checks received',
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

  /*
   * "To decide" is the landing tab because it is the first question of the day: is this
   * a bill at all. Ready to pay is the second. Before this the decision lived on a
   * different screen the accountant could not even open.
   */
  const active: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : 'decide'
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

  const thisPeriod = periodOf(new Date())
  const [checkRows, decideRows, decideCount, handoverPeople, recurring] = await Promise.all([
    active === 'checks' ? listChecks(session.companyGroupId, chosen) : Promise.resolve([]),
    active === 'decide' ? listToDecide(session, chosen) : Promise.resolve([]),
    countToDecide(session, chosen),
    canTriagePayments(session.role)
      ? prisma.membership.findMany({
          where: {
            companyGroupId: session.companyGroupId,
            isActive: true,
            userId: { not: session.userId },
            role: { in: ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER'] },
          },
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { id: true, name: true, email: true } } },
        })
      : Promise.resolve([]),
    /*
     * Two months, not one. A retainer missed in September is still owed in October, and
     * a list that resets on the 1st is how a missed month stops existing.
     */
    recurringFor(session.companyGroupId, [previousPeriod(thisPeriod), thisPeriod], scope),
  ])

  const count: Record<Tab, number> = {
    decide: decideCount,
    ready: counts.approvedUnpaid,
    waiting: counts.pending + counts.needsReview,
    denied: counts.denied,
    paid: counts.paid,
    checks: checkRows.length,
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
    approvalNote: d.approvalNote,
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

  const monthName = (period: string) =>
    new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'long',
      timeZone: 'UTC',
    })

  const recurringRows: RecurringRow[] = recurring.map((r) => ({
    id: r.id,
    payeeName: r.payeeName,
    entityCode: r.entityCode,
    amount: r.amount === null ? null : formatMoney(r.amount),
    // Blank when the amount varies, so the form asks rather than suggesting a figure
    // somebody would accept without checking.
    rawAmount: r.amount === null ? '' : Number(r.amount.toString()).toFixed(2),
    period: r.period,
    periodLabel: monthName(r.period),
    dueLabel: `due ${r.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`,
    daysLate: r.daysLate,
    paid: r.paid
      ? {
          amount: formatMoney(r.paid.amount),
          paidOn: r.paid.paidOn.toLocaleDateString('en-US', { timeZone: 'UTC' }),
          recordedBy: r.paid.recordedBy,
        }
      : null,
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

      {/* One per tab: the six answer six different questions. */}
      <PageHelp topic={`accounting.${active}`} />

      {/* Above the tabs, so it is read on the way to whatever the accountant came for:
          these are the only bills that nothing in the post will ever remind anyone of. */}
      <RecurringLine rows={recurringRows} canSettle={canSettle(session.role)} />

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

      {/* The way in for a bill that did not arrive as post. */}
      {canAddBill(session.role) && <AddBill entities={entities} />}

      {active === 'checks' ? (
        <ChecksTable rows={checkRows} />
      ) : active === 'decide' ? (
        <ToDecideList
          rows={decideRows.map((d) => ({
            id: d.id,
            title: d.finalFilename ?? d.originalFilename,
            vendorName: d.vendor?.name ?? null,
            amount: d.amount === null ? null : d.amount.toString(),
            dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
            receivedDate: d.createdAt.toISOString(),
            entityCode: d.entity?.code ?? null,
            companyName: d.entity?.legalName ?? null,
            entityIndex: d.entity?.sortOrder ?? 0,
            typeLabel: d.documentType?.label ?? null,
            categoryName: d.category?.name ?? null,
            summary: d.summaryNote,
            hasFile: Boolean(d.storageKey),
            handedBy: handoff(d, session.userId)?.by ?? null,
            handNote: handoff(d, session.userId)?.note ?? null,
          }))}
          people={handoverPeople.map((m) => ({
            id: m.user.id,
            name: m.user.name ?? m.user.email,
          }))}
        />
      ) : active === 'waiting' ? (
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

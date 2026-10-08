import Link from 'next/link'
import type { ApprovalStatus } from '@/generated/prisma/enums'
import { billCounts, listBills } from '@/server/approvals'
import { narrowEntityChoice, visibleEntities, visibleEntityIds } from '@/server/scope'
import { canApprove, canConfigure, requireApprover } from '@/server/session'
import { ApprovalsBoard, ShortcutHint, type BoardBill } from '@/components/approvals-board'
import { CompanyPicker } from '@/components/company-picker'
import { formatMoney } from '@/components/badges'

export const dynamic = 'force-dynamic'

/**
 * Bills to approve.
 *
 * The whole screen is one question — what is waiting on you — so it opens on that and
 * nothing else. The other tabs exist because an approver is allowed to change their mind,
 * which means yesterday's answers have to be reachable; they are not where the work is.
 */

const TABS = [
  { key: 'pending', label: 'Waiting on you', statuses: ['PENDING'] as ApprovalStatus[] },
  { key: 'approved', label: 'Approved', statuses: ['APPROVED'] as ApprovalStatus[] },
  {
    key: 'returned',
    label: 'Sent back',
    statuses: ['DENIED', 'NEEDS_REVIEW'] as ApprovalStatus[],
  },
] as const

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; entity?: string }>
}) {
  const session = await requireApprover()
  const { tab, entity } = await searchParams

  const active = TABS.find((t) => t.key === tab) ?? TABS[0]
  const scope = await visibleEntityIds(session)
  const chosen = narrowEntityChoice(entity, scope)

  const [bills, counts, entities] = await Promise.all([
    listBills(session, {
      statuses: [...active.statuses],
      entityId: chosen,
      // An approved bill stays on the Approved tab after it is paid; the pending list is
      // only what is still open.
      settled: active.key === 'pending' ? false : undefined,
    }),
    billCounts(session, chosen),
    visibleEntities(session),
  ])

  const rows: BoardBill[] = bills.map((d) => ({
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

  /*
   * The totals moved into the board, which now groups by the same three buckets it
   * counts — keeping a second, separate sum up here was how the top of the screen and
   * the middle of it ended up disagreeing about what "overdue" meant.
   */
  const tabCount = (key: (typeof TABS)[number]['key']) =>
    key === 'pending'
      ? counts.pending
      : key === 'approved'
        ? counts.approvedUnpaid + counts.paid
        : counts.denied + counts.needsReview

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Bills to approve</h1>
          <ShortcutHint />
        </div>
        <p className="mt-1 text-sm text-muted">
          {entities.length === 1
            ? `Everything waiting on you for ${entities[0].legalName}.`
            : 'Everything waiting on you, for the companies you approve.'}{' '}
          Open the invoice, then approve, deny or send it back with a question.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          {TABS.map((t) => {
            const on = t.key === active.key
            const count = tabCount(t.key)
            return (
              <Link
                key={t.key}
                href={`/approvals?tab=${t.key}${chosen ? `&entity=${chosen}` : ''}`}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  on
                    ? 'bg-navy-700 text-white'
                    : 'text-muted hover:bg-navy-50 hover:text-navy-700 active:bg-navy-100'
                }`}
              >
                {t.label}
                <span
                  className={`tabular rounded-full px-1.5 text-[11px] font-bold ${
                    on
                      ? 'bg-white/20 text-white'
                      : t.key === 'pending' && count > 0
                        ? 'bg-gold-100 text-gold-800'
                        : 'bg-line-soft text-muted'
                  }`}
                >
                  {count}
                </span>
              </Link>
            )
          })}
        </div>

        {entities.length > 1 && <CompanyPicker entities={entities} value={chosen} />}

      </div>

      <ApprovalsBoard
        bills={rows}
        canDecide={canApprove(session.role)}
        showCompany={entities.length > 1}
        // Everything on this tab is pending, so saying so on every row is repeating the
        // tab's own name fourteen times.
        showStatus={active.key !== 'pending'}
      />

      {canConfigure(session.role) && (
        <p className="text-[12.5px] text-subtle">
          You are seeing every company because you are an administrator. An approver sees
          only the companies assigned to them in Settings.
        </p>
      )}
    </div>
  )
}

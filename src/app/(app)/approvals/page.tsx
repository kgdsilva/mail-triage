import Link from 'next/link'
import { PageHelp } from '@/components/page-help'
import type { ApprovalStatus } from '@/generated/prisma/enums'
import { billCounts, handedToCount, listBills, listHandedTo } from '@/server/approvals'
import { HandedToYou, type Handover } from '@/components/handed-to-you'
import { narrowEntityChoice, visibleEntities, visibleEntityIds } from '@/server/scope'
import { canAddBill, canApprove, canConfigure, requireApprover } from '@/server/session'
import { AddBill } from '@/components/add-bill'
import { ApprovalsBoard, ShortcutHint, type BoardBill } from '@/components/approvals-board'
import { CompanyPicker } from '@/components/company-picker'
import { formatMoney } from '@/components/badges'
import { settlerName } from '@/server/destinations'
import { whoseTurn } from '@/lib/whose-turn'
import { nearDuplicatesFor } from '@/server/near-duplicates'

export const dynamic = 'force-dynamic'

/**
 * Bills to approve.
 *
 * The whole screen is one question — what is waiting on you — so it opens on that and
 * nothing else. The other tabs exist because an approver is allowed to change their mind,
 * which means yesterday's answers have to be reachable; they are not where the work is.
 */

/*
 * One list of what is waiting on you, and filters on it.
 *
 * ---------------------------------------------------------------------------
 * Said twice in the same meeting, about two different things
 * ---------------------------------------------------------------------------
 *
 * "Sent back" held a denial and a question in one bucket, which is how an approver came
 * to say of his own bills: "it's in sent back, which I don't know what that means." A
 * denial is a decision and is finished; a question is the absence of one, and the bill
 * is still his — so a bill he asked about stays in "Waiting on you".
 *
 * And of a document the accountant handed him: "it'd be great if, if he passes something
 * to me, it puts it back into my waiting on me — bills to approve." Which is the same
 * sentence again. It arrived first as its own tab, which was the obvious shape and the
 * wrong one: it is a third thing that is waiting on him, and a tab he has to remember to
 * click is a tab he does not click. "It says Chris passed this to you, but in bills to
 * approve, I don't see it" is not fixed by a second place to not see it.
 *
 * So the first tab is everything waiting on him — bills to clear, bills he asked about,
 * and questions somebody asked him — and the rest are filters on that, for when he wants
 * one kind. The pair of question tabs is deliberately symmetric: what you asked, and
 * what was asked of you.
 */
const TABS = [
  {
    key: 'pending',
    label: 'Waiting on you',
    statuses: ['PENDING', 'NEEDS_REVIEW'] as ApprovalStatus[],
  },
  {
    key: 'questions',
    label: 'Your questions',
    statuses: ['NEEDS_REVIEW'] as ApprovalStatus[],
  },
  {
    key: 'handed',
    label: 'Questions for you',
    statuses: [] as ApprovalStatus[],
  },
  { key: 'approved', label: 'Approved', statuses: ['APPROVED'] as ApprovalStatus[] },
  { key: 'denied', label: 'Denied', statuses: ['DENIED'] as ApprovalStatus[] },
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

  const handedTab = active.key === 'handed'
  // The first tab carries the handovers as well, which is the whole point of it being
  // the first tab: one place that answers "what is waiting on me".
  const showsHandovers = handedTab || active.key === 'pending'

  const [bills, counts, entities, handed, handedCount, settler] = await Promise.all([
    // The handover tab reads a different question, so the bill query is skipped rather
    // than run with an empty status list that would match nothing anyway.
    handedTab
      ? Promise.resolve([])
      : listBills(session, {
          statuses: [...active.statuses],
          entityId: chosen,
          // An approved bill stays on the Approved tab after it is paid; the pending
          // list is only what is still open.
          settled: active.key === 'pending' ? false : undefined,
        }),
    billCounts(session, chosen),
    visibleEntities(session),
    showsHandovers ? listHandedTo(session) : Promise.resolve([]),
    handedToCount(session),
    settlerName(session.companyGroupId),
  ])

  const handovers: Handover[] = handed.map((d) => ({
    id: d.id,
    title: d.finalFilename ?? d.originalFilename,
    companyCode: d.entity?.code ?? null,
    question: d.internalNotes,
    receivedDate: d.createdAt.toISOString(),
  }))

  /*
   * Asked after the bills are known, rather than as part of that query: it is a question
   * about the rows on screen, and two queries about five visible bills beat a join that
   * every other caller of listBills would then carry.
   */
  const duplicates = await nearDuplicatesFor(
    session.companyGroupId,
    bills.map((d) => d.id),
  )

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
    duplicates: duplicates.get(d.id) ?? [],
    /*
     * Worked out here rather than in the row, because the answer is a person's name and
     * the browser has never been told any names. The row renders a label it was handed.
     */
    turn: whoseTurn({
      approvalStatus: d.approvalStatus,
      settled: d.status === 'DONE',
      holder: d.assignedTo?.name?.trim() || d.assignedTo?.email || null,
      // A bill awaiting approval is assigned to nobody — the approver is implied by the
      // screen, not written on the row. On this screen that approver is the reader, so
      // "waiting on you" is the true label and the generic "with the approver" is not.
      isYou: d.approvalStatus === 'PENDING' || d.assignedTo?.id === session.userId,
      settler,
    }),
  }))

  /*
   * The totals moved into the board, which now groups by the same three buckets it
   * counts — keeping a second, separate sum up here was how the top of the screen and
   * the middle of it ended up disagreeing about what "overdue" meant.
   */
  // Each tab counts exactly what it shows, now that a question and a denial are no
  // longer added together under one heading.
  const tabCount = (key: (typeof TABS)[number]['key']) =>
    key === 'pending'
      ? counts.pending + counts.needsReview + handedCount
      : key === 'questions'
        ? counts.needsReview
        : key === 'handed'
          ? handedCount
          : key === 'approved'
            ? counts.approvedUnpaid + counts.paid
            : counts.denied

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Bills to approve</h1>
          <ShortcutHint />
          {/*
            The approver's own way in. Eric gets invoices by email that never touch the
            post; before this his only route was forwarding them to somebody with an
            upload button. Adding is not approving — the history records who did which.
          */}
          {canAddBill(session.role) && <AddBill entities={entities} />}
          {/*
            Said here as well as on the Members screen, because this is where somebody
            finds out — an approver with no companies sees an empty list, and an empty
            list is indistinguishable from "nothing to do" unless it says otherwise.
          */}
          {session.role === 'APPROVER' && session.entityScope.length === 0 && (
            <p className="w-full rounded-xl border border-gold-500 bg-gold-50 px-4 py-2.5 text-[12.5px] text-navy-900">
              <span className="font-bold">No companies are assigned to you yet</span>, so nothing
              can reach you here. Ask an administrator to tick your companies in Settings →
              Members.
            </p>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          {entities.length === 1
            ? `Everything waiting on you for ${entities[0].legalName}.`
            : 'Everything waiting on you, for the companies you approve.'}{' '}
          Open the invoice, then approve, deny or ask a question about it.
        </p>
      </header>

      <PageHelp topic={handedTab ? 'approvals.handed' : 'approvals'} />

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

      {/*
        Questions first, and above the money.
        A bill is waiting on a deadline; a question is waiting on a person who cannot
        get on with their work until it is answered. The list is short and the bills are
        long, so putting it second would have buried it under a scroll.
      */}
      {active.key === 'pending' && handovers.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-[12.5px] font-bold uppercase tracking-wide text-amber-800">
            Questions for you · {handovers.length}
          </h2>
          <HandedToYou items={handovers} />
        </section>
      )}

      {handedTab ? (
        <HandedToYou items={handovers} />
      ) : (
        <ApprovalsBoard
          bills={rows}
          canDecide={canApprove(session.role)}
          showCompany={entities.length > 1}
          // The pending tab now holds two kinds — not yet looked at, and asked about —
          // so the row says which. The question badge carries that for the asked ones.
          showStatus={active.key !== 'pending'}
        />
      )}

      {canConfigure(session.role) && (
        <p className="text-[12.5px] text-subtle">
          You are seeing every company because you are an administrator. An approver sees
          only the companies assigned to them in Settings.
        </p>
      )}
    </div>
  )
}

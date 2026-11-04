'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { ArrowRight, Check, HelpCircle, Reply } from 'lucide-react'
import { approveBill, approveSelected } from '@/server/actions/approvals'
import { BillPanel, STATUS_LABEL, type PanelBill } from '@/components/bill-panel'
import { formatDate, formatMoney } from '@/components/badges'
import { DUE_TONE, describeDue } from '@/lib/due'
import { TURN_TONE, type Turn } from '@/lib/whose-turn'
import { DuplicateWarning } from '@/components/duplicate-warning'
import { BTN, entityColor } from '@/lib/theme'

export type BoardBill = PanelBill & {
  amountValue: number
  /** Whose turn it is now, worked out on the server where the names are. */
  turn: Turn
}

/**
 * Bills to approve, as a worklist rather than a table.
 *
 * The dense table answered "what is waiting on me" in one screen, and then left the
 * reading to you: eight columns of equal weight, and the question an approver actually
 * asks — what is late — buried in one of them.
 *
 * So the urgency is the structure. Three figures at the top say how much is overdue, how
 * much lands this week and how much there is altogether; the list is grouped under the
 * same three headings; and each row leads with the vendor and the money, with the
 * invoice number and category demoted to a second line because they are what you check
 * *after* deciding to look.
 *
 * Everything that worked is still here — tabs, the company filter, bulk select, the side
 * panel with its auto-advance — because the point of this branch is a layout to compare,
 * not a different feature set.
 */

type Bucket = 'overdue' | 'week' | 'later'

const BUCKETS: { key: Bucket; label: string; tone: string }[] = [
  { key: 'overdue', label: 'Overdue', tone: 'bg-danger-100 text-danger-700' },
  { key: 'week', label: 'Due this week', tone: 'bg-gold-100 text-gold-800' },
  { key: 'later', label: 'Later', tone: 'bg-line-soft text-muted' },
]

/**
 * Which pile a bill is in.
 *
 * One function, used by the cards, the sections and nothing else — so a bill cannot be
 * counted as overdue at the top of the screen and filed under "Later" six inches below,
 * which is what happens when two places each decide for themselves.
 *
 * A bill with no due date is "Later": it is not urgent, and putting it in a bucket named
 * after a deadline it does not have would be a lie with a colour on it.
 */
function bucketOf(bill: BoardBill): Bucket {
  const { days } = describeDue(bill.dueDate)
  if (days === null) return 'later'
  if (days < 0) return 'overdue'
  return days <= 6 ? 'week' : 'later'
}

/** "Received 19 days ago" — the number people say out loud. Exact date in the tooltip. */
function receivedAgo(iso: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
  if (days === 0) return 'Received today'
  if (days === 1) return 'Received yesterday'
  return `Received ${days} days ago`
}

export function ApprovalsBoard({
  bills,
  canDecide,
  showCompany,
  showStatus,
  totalLabel,
}: {
  bills: BoardBill[]
  canDecide: boolean
  showCompany: boolean
  showStatus: boolean
  /** What this list is, for the one line of money above it. */
  totalLabel: string
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [asking, setAsking] = useState<'DENIED' | 'NEEDS_REVIEW' | null>(null)
  const [cursor, setCursor] = useState<number>(-1)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  /*
   * What the last action did, in words, until the next one replaces it.
   *
   * The approver's question was "I approved it — where does it go?", and until now the
   * answer was that the row vanished. A row leaving a list is the only feedback an
   * approval gave, and a thing disappearing is indistinguishable from a thing lost.
   */
  const [went, setWent] = useState<string | null>(null)
  const rows = useRef<Map<string, HTMLElement>>(new Map())

  const shown = bills
  const open = bills.find((b) => b.id === openId) ?? null

  if (openId && !bills.some((b) => b.id === openId)) setOpenId(null)

  /*
   * Keep the cursor inside the list.
   *
   * Approving a row removes it, and the cursor was left pointing past the end — so
   * `shown[cursor]` became undefined and every shortcut after that silently did nothing.
   * Which is the exact run this feature exists for: approve, approve, and then the third
   * key does nothing and you cannot tell why.
   *
   * Clamping here rather than adjusting on approve also gives the better behaviour for
   * free: the cursor stays on the same *position*, so the bill that slides up into it is
   * the one now focused.
   */
  if (cursor >= shown.length) setCursor(shown.length - 1)

  // The total, and only the total. What is overdue is said by the Overdue heading, on
  // top of the overdue bills — saying it twice is what the three cards were doing.
  const allTotal = bills.reduce((sum, b) => sum + b.amountValue, 0)

  const selectable = shown.filter((b) => b.status === 'PENDING')
  const chosen = selectable.filter((b) => selected.has(b.id))
  const chosenTotal = chosen.reduce((sum, b) => sum + b.amountValue, 0)

  /*
   * Declared with useCallback because the keyboard effect depends on it, and an
   * identity that changes every render would re-bind the listener on every keystroke.
   */
  const nextAfter = useCallback(
    (id: string) => {
      const from = shown.findIndex((b) => b.id === id)
      if (from === -1) return null
      return shown.slice(from + 1).find((b) => b.status === 'PENDING')?.id ?? null
    },
    [shown],
  )

  function decide(id: string, fn: () => Promise<{ ok: boolean; error?: string; went?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'That did not go through.')
      else setWent(res.went ?? null)
    })
  }

  /*
   * ---------------------------------------------------------------------------
   * Keyboard
   * ---------------------------------------------------------------------------
   *
   * The guard is the whole of it. A shortcut that fires while somebody is typing the
   * reason they are denying a bill will deny the next one instead, so anything with a
   * caret in it — input, textarea, select, contenteditable — hands the key back. Modifier
   * combinations are left alone too: cmd-R is the browser's, not ours.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }

      const key = e.key.toLowerCase()

      if (key === 'escape') {
        setOpenId(null)
        return
      }

      if (!shown.length) return

      if (key === 'j' || key === 'k') {
        e.preventDefault()
        const step = key === 'j' ? 1 : -1
        const next = Math.min(Math.max(cursor < 0 ? 0 : cursor + step, 0), shown.length - 1)
        setCursor(next)
        rows.current.get(shown[next].id)?.scrollIntoView({ block: 'nearest' })
        return
      }

      // Everything below acts on the open bill if there is one, otherwise the cursor.
      const target = open ?? (cursor >= 0 ? shown[cursor] : null)
      if (!target) return

      if (key === 'enter') {
        e.preventDefault()
        setAsking(null)
        setOpenId(target.id)
        return
      }

      if (!canDecide) return

      if (key === 'a') {
        e.preventDefault()
        if (target.status === 'APPROVED') return
        // The cursor is left alone: the row leaves, the next one slides into its place,
        // and the clamp above handles the end of the list. Moving it here as well was
        // how it ended up pointing past the end.
        if (open) setOpenId(nextAfter(target.id))
        decide(target.id, () => approveBill(target.id))
        return
      }

      if (key === 'r' || key === 'd') {
        e.preventDefault()
        // Both need a reason, so both open the panel with the box already asking.
        setAsking(key === 'd' ? 'DENIED' : 'NEEDS_REVIEW')
        setOpenId(target.id)
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, cursor, open, openId, canDecide, nextAfter])

  function runBulk() {
    setError(null)
    startTransition(async () => {
      const res = await approveSelected([...selected])
      if (!res.ok) setError(res.error ?? 'Could not approve those.')
      // The count is the truth of what moved, and it is not always what was ticked —
      // so it is said out loud rather than echoing the selection back.
      else setWent(`${res.count ?? 0} approved. ${res.went ?? ''}`.trim())
      setSelected(new Set())
      setConfirming(false)
    })
  }

  return (
    <>
      {/*
        ---- one line, where there were three cards -------------------------
        The cards said "Overdue $7,345.10 · 5 bills" in a box, and the section heading
        four inches below said "OVERDUE 5 bills $7,345.10" again, about the same five
        bills it was sitting on top of. Two readings of one number, and the one next to
        the bills is the one that helps. They doubled as bucket filters, which filtered a
        list to a group already visible as its own section.
      */}
      {bills.length > 0 && (
        <p className="px-1 text-[13px] text-muted">
          <span className="tabular font-bold text-navy-900">
            {formatMoney({ toString: () => String(allTotal) })}
          </span>{' '}
          {totalLabel}, across {bills.length} bill{bills.length === 1 ? '' : 's'}.
        </p>
      )}

      {error && (
        <p className="mt-2 rounded-lg bg-danger-100 px-3 py-2 text-[13px] text-danger-700">
          {error}
        </p>
      )}

      {went && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-ok-100 px-3 py-2 text-[13px] text-ok-700">
          <ArrowRight className="mt-0.5 size-4 flex-none" aria-hidden />
          <span className="min-w-0 flex-1 font-semibold">{went}</span>
          <button
            type="button"
            onClick={() => setWent(null)}
            className="flex-none text-[12px] font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {bills.length === 0 ? (
        <Empty />
      ) : (
        <div className="mt-3 space-y-5">
          {BUCKETS.map((bucket) => {
            const inBucket = shown.filter((b) => bucketOf(b) === bucket.key)
            // An empty section is a heading with nothing under it — noise that makes the
            // list look longer than the work in it.
            if (inBucket.length === 0) return null

            const subtotal = inBucket.reduce((sum, b) => sum + b.amountValue, 0)

            return (
              <section key={bucket.key}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2 px-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${bucket.tone}`}
                  >
                    {bucket.label}
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {inBucket.length} bill{inBucket.length === 1 ? '' : 's'}
                  </span>
                  <span className="tabular text-[12.5px] font-semibold text-navy-900">
                    {formatMoney({ toString: () => String(subtotal) })}
                  </span>
                </div>

                <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                  {inBucket.map((bill) => (
                    <Row
                      key={bill.id}
                      bill={bill}
                      canDecide={canDecide}
                      showCompany={showCompany}
                      showStatus={showStatus}
                      checked={selected.has(bill.id)}
                      active={openId === bill.id}
                      focused={cursor >= 0 && shown[cursor]?.id === bill.id}
                      register={(el) => {
                        if (el) rows.current.set(bill.id, el)
                        else rows.current.delete(bill.id)
                      }}
                      onToggle={() =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(bill.id)) next.delete(bill.id)
                          else next.add(bill.id)
                          return next
                        })
                      }
                      onOpen={(mode) => {
                        setAsking(mode ?? null)
                        setOpenId(bill.id)
                        setCursor(shown.findIndex((b) => b.id === bill.id))
                      }}
                      onApprove={() => decide(bill.id, () => approveBill(bill.id))}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {open && (
        <BillPanel
          bill={open}
          canDecide={canDecide}
          showCompany={showCompany}
          initialAsking={asking}
          onClose={() => {
            setOpenId(null)
            setAsking(null)
          }}
          onDecided={(said) => {
            setAsking(null)
            setWent(said ?? null)
            setOpenId(nextAfter(open.id))
          }}
        />
      )}

      {canDecide && chosen.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-navy-500 bg-navy-900 px-3.5 py-2.5 shadow-[0_8px_28px_rgba(18,40,74,0.3)]">
            {confirming ? (
              <>
                <span className="text-[13px] font-semibold text-white">
                  Approve {chosen.length} bill{chosen.length === 1 ? '' : 's'} totalling{' '}
                  <span className="tabular">
                    {formatMoney({ toString: () => String(chosenTotal) })}
                  </span>
                  ?
                </span>
                <button type="button" className={BTN.done} disabled={pending} onClick={runBulk}>
                  {pending ? 'Approving…' : 'Yes, approve'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[12.5px] font-medium text-navy-100/80 underline hover:text-white"
                >
                  Back
                </button>
              </>
            ) : (
              <>
                <span className="text-[13px] font-semibold text-white">
                  {chosen.length} selected ·{' '}
                  <span className="tabular">
                    {formatMoney({ toString: () => String(chosenTotal) })}
                  </span>
                </span>
                <button type="button" className={BTN.done} onClick={() => setConfirming(true)}>
                  <Check className="size-3.5" aria-hidden />
                  Approve {chosen.length} selected
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-[12.5px] font-medium text-navy-100/80 underline hover:text-white"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}


function Row({
  bill,
  canDecide,
  showCompany,
  showStatus,
  checked,
  active,
  focused,
  register,
  onToggle,
  onOpen,
  onApprove,
}: {
  bill: BoardBill
  canDecide: boolean
  showCompany: boolean
  showStatus: boolean
  checked: boolean
  active: boolean
  focused: boolean
  register: (el: HTMLElement | null) => void
  onToggle: () => void
  onOpen: (mode?: 'DENIED' | 'NEEDS_REVIEW') => void
  onApprove: () => void
}) {
  const due = describeDue(bill.dueDate)

  return (
    <li
      ref={register}
      className={`group border-b border-line-soft last:border-b-0 transition-colors ${
        active || focused ? 'bg-navy-50' : 'hover:bg-navy-50/50'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        /*
         * Stacked on a phone, one line from `sm` up.
         *
         * Requirement 4 wants every action visible on mobile, and five buttons plus the
         * amount is wider than a 375px row — so the vendor's `flex-1` collapsed to
         * nothing and the row showed a price and some icons belonging to nobody. The
         * name goes on its own line there instead.
         */
        className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
      >
        {/*
          Vendor leads; what you check after deciding to look sits under it.
          Capped, not just flexible. `flex-1` alone absorbed every spare pixel in the
          row — 531px of cell for a 200px name — which is what put a hand's width of
          nothing between the vendor and its own badges. Capping it keeps the group
          together, and since every cell caps at the same number the amounts still line
          up down the column.
        */}
        <span className="flex min-w-0 flex-1 items-start gap-2.5 sm:max-w-[420px]">
          {canDecide && (
            <input
              type="checkbox"
              checked={checked}
              disabled={bill.status !== 'PENDING'}
              onClick={(e) => e.stopPropagation()}
              onChange={onToggle}
              aria-label={`Select ${bill.vendorName ?? bill.title}`}
              className="mt-1 size-3.5 flex-none accent-navy-700 disabled:opacity-30"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold text-navy-900">
              {bill.vendorName ?? bill.title}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-muted">
              <span className="font-mono">{bill.invoiceNumber ?? 'no invoice no.'}</span>
              {' · '}
              {bill.categoryName ?? 'Uncategorised'}
            </span>
            {/*
              A bill he asked about sits in his list alongside the ones he has not looked
              at, so the question has to be readable from the row itself — and with the
              question, what he asked. He wanted this to run through with the owner on a
              Monday: a mark that says only "question" would send him into each bill one
              at a time to remember which question it was.
            */}
            {/* On the row as well as in the panel: a bulk approve never opens a panel,
                and the tick box is right here. */}
            {bill.duplicates && bill.duplicates.length > 0 && (
              <span className="mt-1 block">
                <DuplicateWarning matches={bill.duplicates} />
              </span>
            )}

            {bill.status === 'NEEDS_REVIEW' && (
              <span className="mt-1 flex items-start gap-1.5 text-[12px] text-amber-800">
                <HelpCircle className="mt-px size-3.5 flex-none" aria-hidden />
                <span className="min-w-0">
                  <span className="font-semibold">You asked:</span>{' '}
                  {bill.note?.trim() ? bill.note : 'waiting on an answer'}
                </span>
              </span>
            )}

            {/* And the reply, directly under the question it answers. */}
            {bill.answeredBy && (
              <span className="mt-1 flex items-start gap-1.5 text-[12px] text-ok-700">
                <Reply className="mt-px size-3.5 flex-none" aria-hidden />
                <span className="min-w-0">
                  <span className="font-semibold">{bill.answeredBy} answered:</span>{' '}
                  {bill.answerNote}
                </span>
              </span>
            )}
            {/* On a phone the badges have nowhere to sit beside the name, so they sit
                under it rather than being dropped. */}
            <span className="mt-1 flex items-center gap-2 sm:hidden">
              {showCompany && bill.companyCode && (
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold ${entityColor(
                    bill.companyCode,
                    bill.companyIndex,
                  )}`}
                >
                  {bill.companyCode}
                </span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] tabular ${DUE_TONE[due.tone]}`}
              >
                {due.text}
              </span>
            </span>
          </span>
        </span>

        {showCompany && bill.companyCode && (
          <span
            title={bill.companyName ?? bill.companyCode}
            className={`hidden w-fit flex-none cursor-help rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold sm:inline-block ${entityColor(
              bill.companyCode,
              bill.companyIndex,
            )}`}
          >
            {bill.companyCode}
          </span>
        )}

        <span className="hidden flex-none text-right md:block">
          <span
            title={due.exact}
            className={`inline-block cursor-help rounded-full px-2 py-0.5 text-[11.5px] tabular ${DUE_TONE[due.tone]}`}
          >
            {due.text}
          </span>
          <span
            title={formatDate(new Date(bill.receivedDate))}
            className="mt-0.5 block cursor-help text-[11px] text-subtle"
          >
            {receivedAgo(bill.receivedDate)}
          </span>
        </span>

        {/*
          Whose turn, not what status.
          "Approved" was the whole badge, and it answered a question nobody asks — the
          tab is already called Approved. What the approver wanted to know from the row
          was who has it now, which is the same sentence the screen said when he clicked.
        */}
        {showStatus && (
          <span
            title={STATUS_LABEL[bill.status]}
            className={`hidden w-fit flex-none rounded-full px-2 py-0.5 text-[11px] font-bold lg:inline-block ${TURN_TONE[bill.turn.tone]}`}
          >
            {bill.turn.label}
          </span>
        )}

        <span className="flex flex-none items-center justify-between gap-3 sm:contents">
        <span className="tabular flex-none text-left text-[16px] font-extrabold text-navy-900 sm:w-[104px] sm:text-right">
          {bill.amount ?? '—'}
        </span>

        {/*
          Approve stays; the rest appear on hover or when something inside takes focus.
          A row of six buttons repeated fourteen times is the loudest thing on the
          screen, and five of them are for the exception. Always visible on a phone,
          where there is no hover to reveal them with.
        */}
        {/*
          Three answers, written as words.

          There were six controls on this row — preview, download, history, ask, deny,
          approve — five of them icons that appeared on hover, and an approver looking at
          it said the screen was not clear to him. Downloading and the full history live
          in the panel the row already opens, so nothing is lost by taking them off a
          list whose job is to be decided quickly. What is left is what he came to do:
          approve it, ask about it, or refuse it.
        */}
        <span
          className="flex flex-none items-center gap-1.5 sm:ml-0"
          onClick={(e) => e.stopPropagation()}
        >
          {canDecide && bill.turn.tone !== 'done' && (
            <>
              <button
                type="button"
                onClick={() => onOpen('NEEDS_REVIEW')}
                className="rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-muted transition-colors hover:border-navy-500 hover:bg-navy-50 hover:text-navy-700"
              >
                Ask
              </button>
              <button
                type="button"
                onClick={() => onOpen('DENIED')}
                className="rounded-lg border border-danger-500 px-2.5 py-1 text-[12px] font-semibold text-danger-700 transition-colors hover:bg-danger-100"
              >
                Deny
              </button>
            </>
          )}

          {canDecide && bill.status !== 'APPROVED' && (
            <button
              type="button"
              onClick={onApprove}
              className="inline-flex items-center gap-1 rounded-lg bg-ok-700 px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-[#155538] active:bg-[#0f3f29]"
            >
              <Check className="size-3.5" aria-hidden />
              Approve
            </button>
          )}
        </span>
        </span>
      </div>
    </li>
  )
}



function Empty() {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-line bg-surface/60 px-6 py-14 text-center">
      <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-teal-100 text-teal-700">
        <Check className="size-6" strokeWidth={1.8} aria-hidden />
      </span>
      <h3 className="text-[15px] font-bold text-navy-900">No bills waiting for your approval.</h3>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
        When a bill is marked as needing payment, it appears here with the invoice attached.
      </p>
    </div>
  )
}

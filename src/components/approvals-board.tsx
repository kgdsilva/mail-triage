'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import {
  Ban,
  Check,
  CircleHelp,
  Clock,
  Download,
  FileText,
  History,
  Keyboard,
  Wallet,
} from 'lucide-react'
import { approveBill, approveSelected } from '@/server/actions/approvals'
import { BillPanel, STATUS_LABEL, STATUS_TONE, type PanelBill } from '@/components/bill-panel'
import { formatDate, formatMoney } from '@/components/badges'
import { DUE_TONE, describeDue } from '@/lib/due'
import { BTN, entityColor } from '@/lib/theme'

export type BoardBill = PanelBill & { amountValue: number }

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
}: {
  bills: BoardBill[]
  canDecide: boolean
  showCompany: boolean
  showStatus: boolean
}) {
  const [filter, setFilter] = useState<Bucket | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [asking, setAsking] = useState<'DENIED' | 'NEEDS_REVIEW' | null>(null)
  const [cursor, setCursor] = useState<number>(-1)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const rows = useRef<Map<string, HTMLElement>>(new Map())

  const shown = filter ? bills.filter((b) => bucketOf(b) === filter) : bills
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

  const totals = BUCKETS.map((b) => {
    const inBucket = bills.filter((x) => bucketOf(x) === b.key)
    return {
      ...b,
      count: inBucket.length,
      total: inBucket.reduce((sum, x) => sum + x.amountValue, 0),
    }
  })
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

  function decide(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'That did not go through.')
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
        if (openId) setOpenId(null)
        else if (filter) setFilter(null)
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
  }, [shown, cursor, open, openId, filter, canDecide, nextAfter])

  function runBulk() {
    setError(null)
    startTransition(async () => {
      const res = await approveSelected([...selected])
      if (!res.ok) setError(res.error ?? 'Could not approve those.')
      setSelected(new Set())
      setConfirming(false)
    })
  }

  return (
    <>
      {/* ---- the three figures ------------------------------------------- */}
      <div className="grid gap-2 sm:grid-cols-3">
        {totals.slice(0, 2).map((t) => (
          <Card
            key={t.key}
            label={t.label}
            count={t.count}
            total={t.total}
            tone={t.key === 'overdue' ? 'danger' : 'gold'}
            active={filter === t.key}
            onClick={() => setFilter((f) => (f === t.key ? null : t.key))}
          />
        ))}
        <Card
          label="All waiting"
          count={bills.length}
          total={allTotal}
          tone="plain"
          active={filter === null}
          onClick={() => setFilter(null)}
        />
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-danger-100 px-3 py-2 text-[13px] text-danger-700">
          {error}
        </p>
      )}

      {bills.length === 0 ? (
        <Empty />
      ) : shown.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
          Nothing in that group.{' '}
          <button onClick={() => setFilter(null)} className="font-semibold text-navy-700 underline">
            Show everything
          </button>
        </p>
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
          onDecided={() => {
            setAsking(null)
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

/** One of the three figures. A toggle, so pressing the active one clears the filter. */
function Card({
  label,
  count,
  total,
  tone,
  active,
  onClick,
}: {
  label: string
  count: number
  total: number
  tone: 'danger' | 'gold' | 'plain'
  active: boolean
  onClick: () => void
}) {
  const ring =
    tone === 'danger'
      ? 'border-danger-500/60 bg-danger-100/40'
      : tone === 'gold'
        ? 'border-gold-500/60 bg-gold-50'
        : 'border-line bg-surface'

  const ink =
    tone === 'danger' ? 'text-danger-700' : tone === 'gold' ? 'text-gold-800' : 'text-navy-900'

  const Icon = tone === 'danger' ? Clock : tone === 'gold' ? Clock : Wallet

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-4 py-3 text-left transition-colors ${ring} ${
        active ? 'ring-2 ring-navy-500' : 'hover:border-navy-500'
      } ${count === 0 ? 'opacity-55' : ''}`}
    >
      <span className={`flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide ${ink}`}>
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <span className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className={`display tabular text-[22px] font-extrabold tracking-tight ${ink}`}>
          {formatMoney({ toString: () => String(total) })}
        </span>
        <span className="text-[12.5px] text-muted">
          {count} bill{count === 1 ? '' : 's'}
        </span>
      </span>
    </button>
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

        {showStatus && (
          <span
            className={`hidden w-fit flex-none rounded-full px-2 py-0.5 text-[11px] font-bold lg:inline-block ${STATUS_TONE[bill.status]}`}
          >
            {STATUS_LABEL[bill.status]}
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
        <span
          className="flex flex-none items-center gap-1 sm:ml-0"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex items-center gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            <Icon label="Preview the invoice" icon={FileText} onClick={() => onOpen()} />
            <IconLink label="Download the invoice" href={`/api/files/${bill.id}?download=1`} icon={Download} />
            <IconLink label="Full history" href={`/history/${bill.id}`} icon={History} />
            {canDecide && (
              <>
                <Icon
                  label="Needs review — asks a question and sends it back"
                  icon={CircleHelp}
                  onClick={() => onOpen('NEEDS_REVIEW')}
                />
                <Icon
                  label="Deny — refuse it with a reason"
                  icon={Ban}
                  danger
                  onClick={() => onOpen('DENIED')}
                />
              </>
            )}
          </span>

          {canDecide && bill.status !== 'APPROVED' && (
            <button
              type="button"
              title="Approve this bill"
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

function Icon({
  label,
  icon: Glyph,
  onClick,
  danger,
}: {
  label: string
  icon: typeof Check
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid size-7 place-items-center rounded-lg border transition-colors ${
        danger
          ? 'border-danger-500 text-danger-700 hover:bg-danger-100'
          : 'border-line text-muted hover:border-navy-500 hover:bg-navy-50 hover:text-navy-700'
      }`}
    >
      <Glyph className="size-3.5" aria-hidden />
    </button>
  )
}

function IconLink({ label, href, icon: Glyph }: { label: string; href: string; icon: typeof Check }) {
  return (
    <a
      href={href}
      title={label}
      aria-label={label}
      className="grid size-7 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-navy-500 hover:bg-navy-50 hover:text-navy-700"
    >
      <Glyph className="size-3.5" aria-hidden />
    </a>
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

/** The shortcuts, where somebody might find them. */
export function ShortcutHint() {
  const keys: [string, string][] = [
    ['J / K', 'move between bills'],
    ['Enter', 'open the invoice'],
    ['A', 'approve'],
    ['R', 'needs review'],
    ['D', 'deny'],
    ['Esc', 'close'],
  ]

  return (
    <details className="group relative">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted transition-colors hover:border-navy-500 hover:text-navy-700 [&::-webkit-details-marker]:hidden">
        <Keyboard className="size-3.5" aria-hidden />
        Keyboard shortcuts
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-line bg-surface p-2.5 shadow-[0_8px_24px_rgba(18,40,74,0.18)]">
        <ul className="space-y-1">
          {keys.map(([key, what]) => (
            <li key={key} className="flex items-center justify-between gap-3 text-[12.5px]">
              <kbd className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] font-bold text-navy-900">
                {key}
              </kbd>
              <span className="text-muted">{what}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 border-t border-line-soft pt-2 text-[11.5px] text-subtle">
          They do nothing while you are typing a note or using the company filter.
        </p>
      </div>
    </details>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { Ban, Check, CircleHelp, Download, FileText, History } from 'lucide-react'
import { approveBill, approveSelected } from '@/server/actions/approvals'
import { formatDate, formatMoney } from '@/components/badges'
import { DUE_TONE, describeDue } from '@/lib/due'
import { BTN, entityColor } from '@/lib/theme'

export type ApprovalBill = {
  id: string
  title: string
  vendorName: string | null
  invoiceNumber: string | null
  /** Already formatted; the raw number travels separately for the selection total. */
  amount: string | null
  amountValue: number
  companyCode: string | null
  companyName: string | null
  companyIndex: number
  dueDate: string | null
  receivedDate: string
  categoryName: string | null
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'NEEDS_REVIEW'
  note: string | null
  decidedBy: string | null
  decidedAt: string | null
  hasFile: boolean
}

import { BillPanel, STATUS_LABEL, STATUS_TONE } from '@/components/bill-panel'

/**
 * The approver's list: one line per bill, and the invoice one click away.
 *
 * It was a stack of cards, which read well and fitted four bills on a laptop — so the
 * question "what is waiting on me" needed scrolling to answer, which is the one thing
 * this screen exists to make instant. Now it is a dense row and the detail moved into a
 * panel, where the PDF has room to actually be read.
 *
 * ---------------------------------------------------------------------------
 * Why the columns are data and not markup
 * ---------------------------------------------------------------------------
 *
 * The header and the rows used to be two separate grids with two separately maintained
 * templates, and they drifted: headings sat half a column off their values, and an empty
 * cell shifted everything after it. One array of column definitions now renders both, so
 * alignment is structural — a column cannot be in the header and missing from the row.
 *
 * The template is applied with `style` rather than a Tailwind class, deliberately:
 * Tailwind compiles by scanning source text, so a class built from a variable never
 * exists in the stylesheet. Inline is the honest way to do something genuinely dynamic.
 */

type Column = {
  key: string
  header: string
  /** A grid track: `28px`, `1.4fr`, `minmax(0,1fr)`. */
  width: string
  align?: 'right'
  /** Dropped on narrower screens; the side panel still shows it. */
  wide?: boolean
}

/**
 * The width below which the columns stop being readable.
 *
 * Under this the table scrolls sideways inside its own box rather than compressing —
 * a squeezed grid does not fail gracefully, it overlaps, and two numbers on top of each
 * other on a screen about money is worse than a scrollbar.
 */
const MIN_WIDTH = { narrow: 880, wide: 1200 }

function columnsFor({ canDecide, showStatus }: { canDecide: boolean; showStatus: boolean }) {
  const cols: Column[] = []
  if (canDecide) cols.push({ key: 'select', header: '', width: '26px' })
  cols.push(
    { key: 'vendor', header: 'Vendor', width: 'minmax(0,1.5fr)' },
    { key: 'invoice', header: 'Invoice no.', width: 'minmax(0,0.9fr)' },
    { key: 'amount', header: 'Amount', width: '104px', align: 'right' },
    { key: 'company', header: 'Company', width: '62px' },
    { key: 'due', header: 'Due', width: '132px' },
    { key: 'received', header: 'Received', width: '88px', wide: true },
    { key: 'category', header: 'Category', width: 'minmax(0,0.8fr)', wide: true },
  )
  // Hidden on the tab where every row says the same thing. A column whose every value is
  // identical is a column that costs width and tells you nothing.
  if (showStatus) cols.push({ key: 'status', header: 'Status', width: '124px' })
  cols.push({ key: 'actions', header: '', width: canDecide ? '198px' : '104px' })
  return cols
}

export function ApprovalsTable({
  bills,
  canDecide,
  showCompany,
  showStatus,
}: {
  bills: ApprovalBill[]
  /** False for an admin looking in, or an accountant: they read this list, not act on it. */
  canDecide: boolean
  showCompany: boolean
  showStatus: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const cols = columnsFor({ canDecide, showStatus })
  const narrow = cols.filter((c) => !c.wide)
  const selectable = bills.filter((b) => b.status === 'PENDING')
  const chosen = selectable.filter((b) => selected.has(b.id))
  const total = chosen.reduce((sum, b) => sum + b.amountValue, 0)
  const open = bills.find((b) => b.id === openId) ?? null

  /*
   * A bill that leaves the list — approved, sent back — must not leave a panel behind
   * describing something that is no longer there.
   *
   * Adjusted during render rather than in an effect, like the nav menu's close-on-
   * navigation: the panel has to be gone in the same paint as the row, and an effect
   * would show it for a frame over a list that no longer contains it.
   */
  if (openId && !bills.some((b) => b.id === openId)) setOpenId(null)

  /**
   * The bill to land on after deciding this one.
   *
   * Forward only, and only onto something still pending — which is the whole of Eric's
   * request: "check approved, approved, approved". Wrapping round to the top would
   * re-show bills already passed over, and stopping at the end is the signal that the
   * pile is finished.
   *
   * Computed from the list as it stands *now*, before the server sends back a list
   * without the decided row, so "next in the current sort order" means what it says.
   */
  function nextAfter(id: string) {
    const from = bills.findIndex((b) => b.id === id)
    if (from === -1) return null
    return bills.slice(from + 1).find((b) => b.status === 'PENDING')?.id ?? null
  }

  function runBulk() {
    setError(null)
    startTransition(async () => {
      const res = await approveSelected([...selected])
      if (!res.ok) setError(res.error ?? 'Could not approve those.')
      setSelected(new Set())
      setConfirming(false)
    })
  }

  if (bills.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-14 text-center">
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-teal-100 text-teal-700">
          <Check className="size-6" strokeWidth={1.8} aria-hidden />
        </span>
        <h3 className="text-[15px] font-bold text-navy-900">
          No bills waiting for your approval.
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
          When a bill is marked as needing payment, it appears here with the invoice
          attached.
        </p>
      </div>
    )
  }

  return (
    <>
      {error && (
        <p className="mb-2 rounded-lg bg-danger-100 px-3 py-2 text-[13px] text-danger-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        {/* One template, two consumers. See the note above. */}
        <Grid cols={cols} narrow={narrow} className="border-b border-line bg-canvas/60 px-3 py-1.5">
          {cols.map((col) =>
            col.key === 'select' ? (
              <span key={col.key}>
                <input
                  type="checkbox"
                  aria-label="Select all pending"
                  checked={chosen.length === selectable.length && selectable.length > 0}
                  disabled={selectable.length === 0}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(selectable.map((b) => b.id)) : new Set())
                  }
                  className="size-3.5 accent-navy-700 disabled:opacity-30"
                />
              </span>
            ) : (
              <span
                key={col.key}
                className={`truncate text-[10.5px] font-bold uppercase tracking-wide text-subtle ${
                  col.align === 'right' ? 'text-right' : ''
                } ${col.wide ? 'hidden xl:block' : ''}`}
              >
                {col.key === 'company' && !showCompany ? '' : col.header}
              </span>
            ),
          )}
        </Grid>

        <ul className="divide-y divide-line-soft">
          {bills.map((bill) => (
            <Row
              key={bill.id}
              bill={bill}
              cols={cols}
              narrow={narrow}
              canDecide={canDecide}
              showCompany={showCompany}
              showStatus={showStatus}
              checked={selected.has(bill.id)}
              active={openId === bill.id}
              onToggle={() =>
                setSelected((prev) => {
                  const next = new Set(prev)
                  if (next.has(bill.id)) next.delete(bill.id)
                  else next.add(bill.id)
                  return next
                })
              }
              onOpen={() => setOpenId(bill.id)}
            />
          ))}
        </ul>
      </div>

      {open && (
        <BillPanel
          bill={open}
          canDecide={canDecide}
          onClose={() => setOpenId(null)}
          onDecided={() => setOpenId(nextAfter(open.id))}
          showCompany={showCompany}
        />
      )}

      {/*
        The selection bar is fixed to the bottom of the screen rather than sitting above
        the list, because with ten or more rows the thing you are acting on and the button
        that acts scroll apart — and an "Approve selected" you have to scroll back up to
        find is one people stop using.
      */}
      {canDecide && chosen.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-navy-500 bg-navy-900 px-3.5 py-2.5 shadow-[0_8px_28px_rgba(18,40,74,0.3)]">
            {confirming ? (
              <>
                <span className="text-[13px] font-semibold text-white">
                  Approve {chosen.length} bill{chosen.length === 1 ? '' : 's'} totalling{' '}
                  <span className="tabular">{formatMoney({ toString: () => String(total) })}</span>?
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
                  <span className="tabular">{formatMoney({ toString: () => String(total) })}</span>
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

/** The shared grid. Two templates — with and without the wide-screen columns. */
function Grid({
  cols,
  narrow,
  className,
  children,
}: {
  cols: Column[]
  narrow: Column[]
  className?: string
  children: React.ReactNode
}) {
  return (
    <>
      <div
        className={`hidden items-center gap-x-3 xl:grid ${className ?? ''}`}
        style={{
          gridTemplateColumns: cols.map((c) => c.width).join(' '),
          minWidth: MIN_WIDTH.wide,
        }}
      >
        {children}
      </div>
      <div
        className={`grid items-center gap-x-3 xl:hidden ${className ?? ''}`}
        style={{
          gridTemplateColumns: narrow.map((c) => c.width).join(' '),
          minWidth: MIN_WIDTH.narrow,
        }}
      >
        {children}
      </div>
    </>
  )
}

function Row({
  bill,
  cols,
  narrow,
  canDecide,
  showCompany,
  showStatus,
  checked,
  active,
  onToggle,
  onOpen,
}: {
  bill: ApprovalBill
  cols: Column[]
  narrow: Column[]
  canDecide: boolean
  showCompany: boolean
  showStatus: boolean
  checked: boolean
  active: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const due = describeDue(bill.dueDate)

  const cells: Record<string, React.ReactNode> = {
    select: canDecide ? (
      <input
        type="checkbox"
        checked={checked}
        disabled={bill.status !== 'PENDING'}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
        aria-label={`Select ${bill.vendorName ?? bill.title}`}
        className="size-3.5 accent-navy-700 disabled:opacity-30"
      />
    ) : null,

    vendor: (
      <span className="truncate text-[13px] font-bold text-navy-900" title={bill.vendorName ?? bill.title}>
        {bill.vendorName ?? bill.title}
      </span>
    ),

    invoice: (
      <span className="truncate font-mono text-[12px] text-muted" title={bill.invoiceNumber ?? ''}>
        {bill.invoiceNumber ?? '—'}
      </span>
    ),

    amount: (
      <span className="tabular text-right text-[13px] font-bold text-navy-900">
        {bill.amount ?? '—'}
      </span>
    ),

    company:
      showCompany && bill.companyCode ? (
        <span
          // The code is what fits; the name is what people actually know.
          title={bill.companyName ?? bill.companyCode}
          className={`inline-block w-fit cursor-help rounded-full px-1.5 py-0.5 font-mono text-[10.5px] font-bold ${entityColor(
            bill.companyCode,
            bill.companyIndex,
          )}`}
        >
          {bill.companyCode}
        </span>
      ) : null,

    due: (
      <span
        title={due.exact}
        className={`inline-block w-fit cursor-help truncate rounded-full px-2 py-0.5 text-[11.5px] tabular ${DUE_TONE[due.tone]}`}
      >
        {due.text}
      </span>
    ),

    received: (
      <span className="tabular text-[12px] text-muted">
        {formatDate(new Date(bill.receivedDate))}
      </span>
    ),

    category: (
      <span className="truncate text-[12px] text-muted" title={bill.categoryName ?? ''}>
        {bill.categoryName ?? '—'}
      </span>
    ),

    status: showStatus ? (
      <span
        className={`inline-block w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[bill.status]}`}
      >
        {STATUS_LABEL[bill.status]}
      </span>
    ) : null,

    actions: (
      <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <IconButton label="Preview the invoice" onClick={onOpen} icon={FileText} />
        <IconLink label="Download the invoice" href={`/api/files/${bill.id}?download=1`} icon={Download} />
        <IconLink label="Full history" href={`/history/${bill.id}`} icon={History} />
        {canDecide && (
          <>
            <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
            <IconButton
              label="Needs review — asks a question and sends it back"
              onClick={onOpen}
              icon={CircleHelp}
            />
            {/* Red outline, so refusing never sits a plain-button width away from asking
                a question. Both send the bill back; only one of them is a no. */}
            <IconButton label="Deny — refuse it with a reason" onClick={onOpen} icon={Ban} danger />
            <ApproveButton id={bill.id} disabled={bill.status === 'APPROVED'} />
          </>
        )}
      </span>
    ),
  }

  /*
   * A `div`, not a `span`. An inline wrapper has no width of its own, so `min-w-0` and
   * `truncate` inside it resolve against nothing and the content spills over the next
   * column instead of being cut — which is exactly what the vendor name did to the
   * amount.
   */
  const body = (visible: Column[]) =>
    visible.map((c) => (
      <div key={c.key} className="min-w-0">
        {cells[c.key]}
      </div>
    ))

  return (
    <li>
      {/*
        The whole row opens the panel. The checkbox and the buttons stop the click, so
        the two gestures do not fight — and the row keeps a button's affordances for a
        keyboard, which a div with an onClick does not.
      */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className={`w-full text-left transition-colors ${
          active ? 'bg-navy-50' : 'hover:bg-navy-50/60'
        }`}
      >
        <div
          className="hidden items-center gap-x-3 px-3 py-2 xl:grid"
          style={{
            gridTemplateColumns: cols.map((c) => c.width).join(' '),
            minWidth: MIN_WIDTH.wide,
          }}
        >
          {body(cols)}
        </div>
        <div
          className="grid items-center gap-x-3 px-3 py-2 xl:hidden"
          style={{
            gridTemplateColumns: narrow.map((c) => c.width).join(' '),
            minWidth: MIN_WIDTH.narrow,
          }}
        >
          {body(narrow)}
        </div>
      </div>
    </li>
  )
}

/** Approve is the one action on the row that commits without opening anything. */
function ApproveButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (disabled) return null

  return (
    <button
      type="button"
      title={error ?? 'Approve this bill'}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await approveBill(id)
          if (!res.ok) setError(res.error ?? 'That did not go through.')
        })
      }
      className={`inline-flex items-center gap-1 rounded-lg bg-ok-700 px-2 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-[#155538] active:bg-[#0f3f29] disabled:opacity-50 ${
        error ? 'bg-danger-700' : ''
      }`}
    >
      <Check className="size-3.5" aria-hidden />
      {pending ? '…' : 'Approve'}
    </button>
  )
}

function IconButton({
  label,
  onClick,
  icon: Icon,
  danger,
}: {
  label: string
  onClick: () => void
  icon: typeof Check
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
          ? 'border-danger-500 text-danger-700 hover:bg-danger-100 active:bg-danger-100'
          : 'border-line text-muted hover:border-navy-500 hover:bg-navy-50 hover:text-navy-700 active:bg-navy-100'
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  )
}

function IconLink({
  label,
  href,
  icon: Icon,
}: {
  label: string
  href: string
  icon: typeof Check
}) {
  return (
    <a
      href={href}
      title={label}
      aria-label={label}
      className="grid size-7 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-navy-500 hover:bg-navy-50 hover:text-navy-700 active:bg-navy-100"
    >
      <Icon className="size-3.5" aria-hidden />
    </a>
  )
}

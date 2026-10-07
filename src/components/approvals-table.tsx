'use client'

import { useState, useTransition } from 'react'
import { Ban, Check, CircleHelp, Download, FileText, History } from 'lucide-react'
import {
  approveBill,
  approveSelected,
  denyBill,
  flagForReview,
} from '@/server/actions/approvals'
import { PdfFrame, PeekToggle } from '@/components/pdf-peek'
import { formatDate, formatMoney } from '@/components/badges'
import { BTN, URGENCY_TONE, entityColor, urgencyWithin } from '@/lib/theme'

export type ApprovalBill = {
  id: string
  title: string
  vendorName: string | null
  invoiceNumber: string | null
  /** Already formatted; the raw number travels separately for the selection total. */
  amount: string | null
  amountValue: number
  entityCode: string | null
  entityIndex: number
  dueDate: string | null
  receivedDate: string
  categoryName: string | null
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'NEEDS_REVIEW'
  note: string | null
  decidedBy: string | null
  decidedAt: string | null
  hasFile: boolean
}

const STATUS_LABEL: Record<ApprovalBill['status'], string> = {
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  NEEDS_REVIEW: 'Needs review',
}

const STATUS_TONE: Record<ApprovalBill['status'], string> = {
  PENDING: 'bg-navy-100 text-navy-900',
  APPROVED: 'bg-ok-100 text-ok-700',
  DENIED: 'bg-danger-100 text-danger-700',
  NEEDS_REVIEW: 'bg-gold-100 text-gold-800',
}

/**
 * The approver's list.
 *
 * One row per bill, laid out as a grid rather than a table: the same markup has to read
 * as columns on a desk and as a stacked card on a phone, and two sets of markup for one
 * list is two places for them to disagree. Labels appear only where the header row does
 * not — on a narrow screen each value says what it is.
 *
 * Approve is one click and has no dialogue. Deny and Needs review open a note, because a
 * refusal nobody explained is the thing the next person cannot act on, and it is the
 * whole reason the bill is going back.
 */
export function ApprovalsTable({
  bills,
  canDecide,
  showEntity,
}: {
  bills: ApprovalBill[]
  /** False for an admin looking in, or an accountant: they read this list, not act on it. */
  canDecide: boolean
  showEntity: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const selectable = bills.filter((b) => b.status === 'PENDING')
  const chosen = selectable.filter((b) => selected.has(b.id))
  const total = chosen.reduce((sum, b) => sum + b.amountValue, 0)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
    <div className="space-y-2">
      {canDecide && selectable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-muted">
            <input
              type="checkbox"
              checked={chosen.length === selectable.length && selectable.length > 0}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(selectable.map((b) => b.id)) : new Set())
              }
              className="size-4 accent-navy-700"
            />
            Select all pending ({selectable.length})
          </label>

          {chosen.length > 0 && !confirming && (
            <button type="button" className={`${BTN.done} ml-auto`} onClick={() => setConfirming(true)}>
              <Check className="size-3.5" aria-hidden />
              Approve selected ({chosen.length})
            </button>
          )}

          {/*
            The confirmation states the count and the money. Approving in bulk is the one
            action here that can be wrong at scale, and "Approve 9 bills" without the
            total is a number nobody can check against what they just read.
          */}
          {confirming && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-navy-900">
                Approve {chosen.length} bill{chosen.length === 1 ? '' : 's'} totalling{' '}
                <span className="tabular">{formatMoney({ toString: () => String(total) })}</span>?
              </span>
              <button type="button" className={BTN.done} disabled={pending} onClick={runBulk}>
                {pending ? 'Approving…' : 'Yes, approve'}
              </button>
              <button type="button" className={BTN.quiet} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-danger-100 px-3 py-2 text-[13px] text-danger-700">{error}</p>
      )}

      {/* The header exists only where there is room for columns. */}
      <div
        className={`hidden gap-3 px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-subtle md:grid ${
          canDecide ? 'md:grid-cols-[auto_1.6fr_1fr_1fr_auto_1fr_1fr_auto]' : 'md:grid-cols-[1.6fr_1fr_1fr_auto_1fr_1fr_auto]'
        }`}
      >
        {canDecide && <span />}
        <span>Vendor</span>
        <span>Invoice no.</span>
        <span className="text-right">Amount</span>
        <span>{showEntity ? 'Entity' : ''}</span>
        <span>Due</span>
        <span>Received</span>
        <span>Status</span>
      </div>

      <ul className="space-y-2">
        {bills.map((bill) => (
          <Row
            key={bill.id}
            bill={bill}
            canDecide={canDecide}
            showEntity={showEntity}
            checked={selected.has(bill.id)}
            onToggle={() => toggle(bill.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function Row({
  bill,
  canDecide,
  showEntity,
  checked,
  onToggle,
}: {
  bill: ApprovalBill
  canDecide: boolean
  showEntity: boolean
  checked: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState<'DENIED' | 'NEEDS_REVIEW' | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Three days, not the week the rest of the app uses: an approver is being asked
  // whether this is urgent today.
  const level = urgencyWithin(bill.dueDate, 3)

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'That did not go through.')
      else {
        setAsking(null)
        setNote('')
      }
    })
  }

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface">
      <div
        className={`grid gap-x-3 gap-y-1.5 px-3 py-3 md:items-center ${
          canDecide
            ? 'md:grid-cols-[auto_1.6fr_1fr_1fr_auto_1fr_1fr_auto]'
            : 'md:grid-cols-[1.6fr_1fr_1fr_auto_1fr_1fr_auto]'
        }`}
      >
        {canDecide && (
          <input
            type="checkbox"
            checked={checked}
            disabled={bill.status !== 'PENDING'}
            onChange={onToggle}
            aria-label={`Select ${bill.vendorName ?? bill.title}`}
            className="size-4 accent-navy-700 disabled:opacity-30"
          />
        )}

        <span className="min-w-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="truncate text-left text-[14px] font-bold text-navy-900 hover:underline"
          >
            {bill.vendorName ?? bill.title}
          </button>
          {bill.categoryName && (
            <span className="block text-[12px] text-muted">{bill.categoryName}</span>
          )}
        </span>

        <Cell label="Invoice no.">
          <span className="font-mono text-[12.5px]">{bill.invoiceNumber ?? '—'}</span>
        </Cell>

        <Cell label="Amount" align="right">
          <span className="tabular text-[14px] font-bold text-navy-900">{bill.amount ?? '—'}</span>
        </Cell>

        <Cell label="Entity">
          {showEntity && bill.entityCode ? (
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${entityColor(
                bill.entityCode,
                bill.entityIndex,
              )}`}
            >
              {bill.entityCode}
            </span>
          ) : null}
        </Cell>

        <Cell label="Due">
          {bill.dueDate ? (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular ${URGENCY_TONE[level]}`}
            >
              {level === 'overdue' ? 'Overdue ' : ''}
              {formatDate(new Date(`${bill.dueDate}T00:00:00Z`))}
            </span>
          ) : (
            <span className="text-[12.5px] text-subtle">No due date</span>
          )}
        </Cell>

        <Cell label="Received">
          <span className="tabular text-[12.5px] text-muted">
            {formatDate(new Date(bill.receivedDate))}
          </span>
        </Cell>

        <Cell label="Status">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-bold ${STATUS_TONE[bill.status]}`}
          >
            {STATUS_LABEL[bill.status]}
          </span>
        </Cell>
      </div>

      {/* The note is the point of a sent-back bill, so it is never behind a toggle. */}
      {bill.note && (
        <p className="border-t border-line-soft bg-gold-100/40 px-3 py-2 text-[12.5px] text-gold-800">
          <span className="font-bold">{STATUS_LABEL[bill.status]}</span>
          {bill.decidedBy ? ` by ${bill.decidedBy}` : ''}
          {bill.decidedAt ? ` on ${formatDate(new Date(bill.decidedAt))}` : ''} — {bill.note}
        </p>
      )}

      {bill.status === 'APPROVED' && bill.decidedBy && (
        <p className="border-t border-line-soft bg-ok-100/50 px-3 py-1.5 text-[12px] text-ok-700">
          Approved by {bill.decidedBy}
          {bill.decidedAt ? ` on ${formatDate(new Date(bill.decidedAt))}` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line-soft px-3 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className={BTN.quiet}>
          <FileText className="size-3.5" aria-hidden />
          {open ? 'Hide invoice' : 'Preview'}
        </button>
        <a
          href={`/api/files/${bill.id}?download=1`}
          className={BTN.quiet}
          aria-disabled={!bill.hasFile}
        >
          <Download className="size-3.5" aria-hidden />
          Download
        </a>
        <a href={`/history/${bill.id}`} className={BTN.quiet}>
          <History className="size-3.5" aria-hidden />
          History
        </a>

        {canDecide && (
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {bill.status !== 'APPROVED' && (
              <button
                type="button"
                className={BTN.done}
                disabled={pending}
                onClick={() => act(() => approveBill(bill.id))}
              >
                <Check className="size-3.5" aria-hidden />
                Approve
              </button>
            )}
            <button
              type="button"
              className={BTN.quiet}
              onClick={() => setAsking((v) => (v === 'NEEDS_REVIEW' ? null : 'NEEDS_REVIEW'))}
            >
              <CircleHelp className="size-3.5" aria-hidden />
              Needs review
            </button>
            <button
              type="button"
              className={BTN.danger}
              onClick={() => setAsking((v) => (v === 'DENIED' ? null : 'DENIED'))}
            >
              <Ban className="size-3.5" aria-hidden />
              Deny
            </button>
          </span>
        )}
      </div>

      {asking && (
        <div className="border-t border-line-soft bg-canvas px-3 py-2.5">
          <label className="block text-[12px] font-semibold text-muted">
            {asking === 'DENIED' ? 'Why are you denying this?' : 'What needs checking?'}
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                asking === 'DENIED' ? 'Duplicate of last month' : 'Is this the right entity?'
              }
              className="min-w-48 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-navy-500"
            />
            <button
              type="button"
              className={BTN.primary}
              disabled={pending || note.trim().length < 3}
              onClick={() =>
                act(() =>
                  asking === 'DENIED' ? denyBill(bill.id, note) : flagForReview(bill.id, note),
                )
              }
            >
              {pending ? 'Sending…' : 'Send back'}
            </button>
            <button type="button" className={BTN.quiet} onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
          <p className="mt-1 text-[11.5px] text-subtle">
            The note goes back with the bill and stays in its history.
          </p>
        </div>
      )}

      {error && <p className="px-3 pb-2 text-[12px] text-danger-700">{error}</p>}

      {open && (
        <div className="border-t border-line-soft p-3">
          <PdfFrame id={bill.id} title={bill.title} hasFile={bill.hasFile} />
        </div>
      )}
    </li>
  )
}

/** A value that labels itself on a phone and sits under a column heading on a desk. */
function Cell({
  label,
  children,
  align,
}: {
  label: string
  children: React.ReactNode
  align?: 'right'
}) {
  if (!children) return <span className="hidden md:block" />
  return (
    <span className={`flex items-center gap-2 md:block ${align === 'right' ? 'md:text-right' : ''}`}>
      <span className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-wide text-subtle md:hidden">
        {label}
      </span>
      {children}
    </span>
  )
}

export { PeekToggle }

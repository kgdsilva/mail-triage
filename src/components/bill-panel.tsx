'use client'

import { useEffect, useState, useTransition } from 'react'
import { Ban, Check, CircleHelp, Download, History, X } from 'lucide-react'
import { approveBill, denyBill, flagForReview } from '@/server/actions/approvals'
import { PdfFrame } from '@/components/pdf-peek'
import { formatDate } from '@/components/badges'
import { DUE_TONE, describeDue } from '@/lib/due'
import { BTN, entityColor } from '@/lib/theme'

export type PanelBill = {
  id: string
  title: string
  vendorName: string | null
  invoiceNumber: string | null
  amount: string | null
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

export const STATUS_LABEL: Record<PanelBill['status'], string> = {
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  NEEDS_REVIEW: 'Needs review',
}

export const STATUS_TONE: Record<PanelBill['status'], string> = {
  PENDING: 'bg-navy-100 text-navy-900',
  APPROVED: 'bg-ok-100 text-ok-700',
  DENIED: 'bg-danger-100 text-danger-700',
  NEEDS_REVIEW: 'bg-gold-100 text-gold-800',
}

/**
 * The bill, opened.
 *
 * The invoice gets the right-hand two thirds because reading it is the decision, and the
 * three answers sit at the top where the eye already is rather than below a document
 * somebody has just finished scrolling. Full screen on a phone: a 640px panel on a
 * 375px screen is a panel nobody can read.
 */
export function BillPanel({
  bill,
  canDecide,
  showCompany,
  onClose,
  onDecided,
  initialAsking,
}: {
  bill: PanelBill
  canDecide: boolean
  showCompany: boolean
  onClose: () => void
  /** Hands control back so the list can move to the next bill, or close. */
  onDecided: () => void
  /**
   * Open with the note already asking. The keyboard shortcuts for deny and needs
   * review land here: pressing D should put the cursor in the box, not make somebody
   * find the button they just asked for.
   */
  initialAsking?: 'DENIED' | 'NEEDS_REVIEW' | null
}) {
  const [asking, setAsking] = useState<'DENIED' | 'NEEDS_REVIEW' | null>(initialAsking ?? null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const due = describeDue(bill.dueDate)

  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        // A failure keeps the panel where it is. Advancing past a bill that did not
        // actually get decided is how one silently stays in the pile.
        setError(res.error ?? 'That did not go through.')
        return
      }
      setAsking(null)
      setNote('')
      onDecided()
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="hidden flex-1 bg-navy-900/25 md:block"
      />

      <aside className="flex w-full flex-col bg-surface shadow-[0_0_40px_rgba(18,40,74,0.25)] md:w-[clamp(540px,52vw,780px)]">
        <header className="border-b border-line px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {showCompany && bill.companyCode && (
                  <span
                    title={bill.companyName ?? bill.companyCode}
                    className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${entityColor(
                      bill.companyCode,
                      bill.companyIndex,
                    )}`}
                  >
                    {bill.companyCode}
                  </span>
                )}
                <h2 className="truncate text-[17px] font-bold tracking-tight text-navy-900">
                  {bill.vendorName ?? bill.title}
                </h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[bill.status]}`}
                >
                  {STATUS_LABEL[bill.status]}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                <span className="tabular text-[16px] font-extrabold text-navy-900">
                  {bill.amount ?? '—'}
                </span>
                <span title={due.exact} className={`cursor-help rounded-full px-2 py-0.5 ${DUE_TONE[due.tone]}`}>
                  {due.text}
                </span>
                <span>Invoice {bill.invoiceNumber ?? '—'}</span>
                <span>{bill.categoryName ?? 'Uncategorised'}</span>
                <span>Received {formatDate(new Date(bill.receivedDate))}</span>
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 flex-none place-items-center rounded-lg text-muted transition-colors hover:bg-navy-50 hover:text-navy-700"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {canDecide && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
                className={BTN.secondary}
                onClick={() => setAsking((v) => (v === 'NEEDS_REVIEW' ? null : 'NEEDS_REVIEW'))}
              >
                <CircleHelp className="size-3.5" aria-hidden />
                Needs review
              </button>
              <button
                type="button"
                onClick={() => setAsking((v) => (v === 'DENIED' ? null : 'DENIED'))}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-danger-500 bg-surface px-3.5 py-2 text-[13px] font-semibold text-danger-700 transition-colors hover:bg-danger-100 active:bg-danger-100"
              >
                <Ban className="size-3.5" aria-hidden />
                Deny
              </button>

              <a
                href={`/api/files/${bill.id}?download=1`}
                className={`${BTN.quiet} ml-auto`}
                title="Download the invoice"
              >
                <Download className="size-3.5" aria-hidden />
                Download
              </a>
              <a href={`/history/${bill.id}`} className={BTN.quiet} title="Full history">
                <History className="size-3.5" aria-hidden />
                History
              </a>
            </div>
          )}

          {/* The note is still required, and still the whole content of a refusal. */}
          {asking && (
            <div className="mt-3 rounded-xl border border-line bg-canvas p-2.5">
              <label className="block text-[12px] font-semibold text-muted">
                {asking === 'DENIED' ? 'Why are you denying this?' : 'What needs checking?'}
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <input
                  autoFocus
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    asking === 'DENIED' ? 'Duplicate of last month' : 'Is this the right company?'
                  }
                  className="min-w-48 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-navy-500"
                />
                <button
                  type="button"
                  className={BTN.primary}
                  disabled={pending || note.trim().length < 3}
                  onClick={() =>
                    act(() =>
                      asking === 'DENIED'
                        ? denyBill(bill.id, note)
                        : flagForReview(bill.id, note),
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

          {bill.note && (
            <p className="mt-3 rounded-lg bg-gold-100/60 px-3 py-2 text-[12.5px] text-gold-800">
              <span className="font-bold">
                {STATUS_LABEL[bill.status]}
                {bill.decidedBy ? ` by ${bill.decidedBy}` : ''}
                {bill.decidedAt ? ` on ${formatDate(new Date(bill.decidedAt))}` : ''}
              </span>{' '}
              — {bill.note}
            </p>
          )}

          {bill.status === 'APPROVED' && bill.decidedBy && (
            <p className="mt-3 rounded-lg bg-ok-100/60 px-3 py-1.5 text-[12px] text-ok-700">
              Approved by {bill.decidedBy}
              {bill.decidedAt ? ` on ${formatDate(new Date(bill.decidedAt))}` : ''}
            </p>
          )}

          {error && <p className="mt-2 text-[12px] text-danger-700">{error}</p>}
        </header>

        <div className="min-h-0 flex-1 bg-line-soft p-3">
          <PdfFrame id={bill.id} title={bill.title} hasFile={bill.hasFile} fill />
        </div>
      </aside>
    </div>
  )
}

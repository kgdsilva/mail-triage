'use client'

import { useRef, useState, useTransition } from 'react'
import { FileWarning, Paperclip, Receipt } from 'lucide-react'
import { attachReceipt } from '@/server/actions/payments'
import { prepareReceipt } from '@/lib/upload-receipt'
import { PeekToggle } from '@/components/pdf-peek'
import { BTN, entityAccent, entityColor } from '@/lib/theme'

export type PaidRow = {
  id: string
  entityCode: string | null
  entityIndex: number
  entityName: string | null
  payee: string
  amount: string
  paidOn: string
  method: string | null
  note: string | null
  recordedBy: string
  /** The bill this settled, when it started from one in the log. */
  documentName: string | null
  receiptFilename: string | null
  receiptIsPdf: boolean
  hasReceipt: boolean
}

/**
 * The history: what was paid, when, and what proves it.
 *
 * Grouped by month, because that is the unit this gets read in — reconciling a
 * statement, or answering "what went out in July". The receipt opens in the row like
 * every other document in the app rather than downloading.
 */
export function PaymentsList({ payments }: { payments: PaidRow[] }) {
  const months = new Map<string, PaidRow[]>()
  for (const p of payments) {
    const key = p.paidOn.slice(0, 7)
    if (!months.has(key)) months.set(key, [])
    months.get(key)!.push(p)
  }

  return (
    <div className="space-y-6">
      {[...months.entries()].map(([month, rows]) => {
        const total = rows.reduce((sum, r) => sum + Number(r.amount.replace(/,/g, '')), 0)
        return (
          <section key={month}>
            <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
              <h2 className="text-[14px] font-bold text-navy-900">{monthLabel(month)}</h2>
              <span className="rounded-full bg-line-soft px-2 py-0.5 text-[11px] font-bold text-muted">
                {rows.length}
              </span>
              <span className="tabular ml-auto text-[14px] font-bold text-navy-900">
                {money(total)}
              </span>
            </div>
            <div className="space-y-2">
              {rows.map((p) => (
                <PaymentRow key={p.id} payment={p} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function PaymentRow({ payment }: { payment: PaidRow }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${payment.entityCode ? entityAccent(payment.entityCode, payment.entityIndex) : 'bg-line'}`}
        aria-hidden
      />

      <div className="flex flex-wrap items-center gap-3 py-3 pl-5 pr-3">
        <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-ok-100 text-ok-700" aria-hidden>
          <Receipt className="size-4.5" strokeWidth={1.9} />
        </span>

        {payment.entityCode && (
          <span
            className={`flex-none rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider ${entityColor(payment.entityCode, payment.entityIndex)}`}
          >
            {payment.entityCode}
          </span>
        )}

        <span className="min-w-40 flex-1">
          <span className="block truncate text-[14.5px] font-bold text-navy-900">
            {payment.payee}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-subtle">
            <span className="tabular font-medium">{shortDate(payment.paidOn)}</span>
            {payment.method && <span>· {payment.method}</span>}
            {payment.documentName && <span className="truncate">· {payment.documentName}</span>}
            {payment.note && <span className="truncate">· {payment.note}</span>}
            <span>· recorded by {payment.recordedBy}</span>
          </span>
        </span>

        <span className="display tabular flex-none text-[19px] font-extrabold tracking-tight text-navy-900">
          ${payment.amount}
        </span>

        <span className="flex flex-none items-center gap-1.5">
          {payment.hasReceipt ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-ok-100 px-2 py-0.5 text-[11px] font-bold text-ok-700">
                <Paperclip className="size-3" aria-hidden />
                Receipt
              </span>
              <PeekToggle open={open} onToggle={() => setOpen((v) => !v)} />
            </>
          ) : (
            <MissingReceipt paymentId={payment.id} />
          )}
        </span>
      </div>

      {open && payment.hasReceipt && (
        <div className="border-t border-line-soft px-4 py-3.5">
          {/*
            A receipt is as often a phone photo as a PDF, and an image in an iframe is
            shown at its natural size in the corner — so images get an <img> and PDFs
            get the frame.
          */}
          {payment.receiptIsPdf ? (
            <div className="h-[34rem] overflow-hidden rounded-lg border border-line bg-line-soft">
              <iframe
                src={`/api/receipts/${payment.id}#view=FitH&navpanes=0`}
                title={payment.receiptFilename ?? 'Receipt'}
                className="h-full w-full"
              />
            </div>
          ) : (
            <div className="flex max-h-[34rem] justify-center overflow-auto rounded-lg border border-line bg-line-soft p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/receipts/${payment.id}`}
                alt={payment.receiptFilename ?? 'Receipt'}
                className="max-w-full object-contain"
              />
            </div>
          )}
          <p className="mt-2 text-right text-[12px] text-subtle">{payment.receiptFilename}</p>
        </div>
      )}
    </div>
  )
}

/**
 * A payment with nothing to show for it, and the way to fix that.
 *
 * Said out loud rather than left blank: a paid bill with no proof is the one row an
 * audit stops on, and the common reason is simply that the receipt arrived later.
 */
function MissingReceipt({ paymentId }: { paymentId: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function upload(file: File) {
    setError(null)
    startTransition(async () => {
      try {
        const prepared = await prepareReceipt(file)
        const fd = new FormData()
        if (!prepared) fd.set('receipt', file)
        await attachReceipt(paymentId, prepared, fd)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not attach that file.')
      }
    })
  }

  return (
    <span className="flex items-center gap-1.5">
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/tiff,image/heic"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
        }}
        className="hidden"
      />
      <span
        className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[11px] font-bold text-gold-800"
        title="Recorded as paid, but nothing is attached to prove it."
      >
        <FileWarning className="size-3" aria-hidden />
        No receipt
      </span>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        className={BTN.quiet}
      >
        <Paperclip className="size-3.5" aria-hidden />
        {pending ? 'Attaching…' : 'Attach'}
      </button>
      {error && <span className="text-[11px] font-semibold text-danger-700">{error}</span>}
    </span>
  )
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function shortDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))
}

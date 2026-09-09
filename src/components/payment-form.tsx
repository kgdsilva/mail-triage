'use client'

import { useRef, useState, useTransition } from 'react'
import { Check, Paperclip, X } from 'lucide-react'
import { recordPayment } from '@/server/actions/payments'
import { prepareReceipt } from '@/lib/upload-receipt'
import { BTN, INPUT, entityColor } from '@/lib/theme'

export type PaymentEntity = { id: string; code: string; legalName: string; sortOrder: number }

/**
 * Recording a payment — the same form whether it settles a bill on screen or enters one
 * that was paid outside the platform.
 *
 * One form for both because the fields are the same and only their source differs. From
 * a bill, the company and the amount are already known and are shown rather than asked;
 * entered by hand, they are the first two questions. Keeping them as one component is
 * what stops the two paths writing subtly different records.
 */
export function PaymentForm({
  entities,
  bill,
  onDone,
  onCancel,
}: {
  entities: PaymentEntity[]
  /** Present when settling a bill already in the system. */
  bill?: {
    documentId: string
    entityId: string | null
    entityCode: string | null
    entityIndex: number
    payee: string | null
    amount: string | null
  }
  onDone?: (message: string) => void
  onCancel?: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)

  const [entityId, setEntityId] = useState(bill?.entityId ?? '')
  const [payeeName, setPayeeName] = useState(bill?.payee ?? '')
  const [amount, setAmount] = useState(bill?.amount?.replace(/,/g, '') ?? '')
  const [paidOn, setPaidOn] = useState(today)
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        // The bytes go first, so a rejected upload never leaves a payment claiming a
        // receipt it does not have.
        const prepared = file ? await prepareReceipt(file) : null

        const fd = new FormData()
        if (file && !prepared) fd.set('receipt', file)

        const result = await recordPayment(
          {
            documentId: bill?.documentId ?? null,
            entityId,
            payeeName,
            amount,
            paidOn,
            method,
            note,
            receipt: prepared,
          },
          fd,
        )

        onDone?.(
          result.hasReceipt
            ? 'Payment recorded, with the receipt attached.'
            : 'Payment recorded. You can attach the receipt later.',
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record that payment.')
      }
    })
  }

  const chosen = entities.find((e) => e.id === entityId)

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Company that paid</Label>
          {bill?.entityCode ? (
            <span className="mt-1 flex items-center gap-2 py-2">
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider ${entityColor(bill.entityCode, bill.entityIndex)}`}
              >
                {bill.entityCode}
              </span>
              <span className="text-[13px] font-semibold text-navy-900">
                {entities.find((e) => e.id === bill.entityId)?.legalName ?? ''}
              </span>
            </span>
          ) : (
            <select
              required
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className={`mt-1 ${INPUT}`}
            >
              <option value="">Choose…</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} — {e.legalName}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className="block">
          <Label>Paid to</Label>
          <input
            value={payeeName}
            onChange={(e) => setPayeeName(e.target.value)}
            placeholder="Erie Insurance"
            className={`mt-1 ${INPUT}`}
          />
        </label>

        <label className="block">
          <Label>Amount</Label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-subtle">
              $
            </span>
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={`${INPUT} tabular pl-6`}
            />
          </div>
        </label>

        <label className="block">
          <Label>Date paid</Label>
          <input
            required
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className={`mt-1 ${INPUT}`}
          />
        </label>

        <label className="block">
          <Label>How it was paid</Label>
          <input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="Check 1043, ACH, card…"
            className={`mt-1 ${INPUT}`}
          />
        </label>

        <label className="block">
          <Label>Note</Label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            className={`mt-1 ${INPUT}`}
          />
        </label>
      </div>

      <div>
        <Label>Proof of payment</Label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/tiff,image/heic"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button type="button" onClick={() => fileInput.current?.click()} className={BTN.secondary}>
            <Paperclip className="size-3.5" aria-hidden />
            {file ? 'Choose another' : 'Attach a receipt'}
          </button>
          {file ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-100 px-2.5 py-1 text-[12px] font-semibold text-ok-700">
              {file.name}
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  if (fileInput.current) fileInput.current.value = ''
                }}
                aria-label="Remove the receipt"
                className="grid size-4 place-items-center rounded-full hover:bg-surface"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ) : (
            <span className="text-[12px] text-subtle">
              PDF or a photo. Can be added later if you do not have it yet.
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={BTN.done}>
          <Check className="size-3.5" aria-hidden />
          {pending ? 'Recording…' : 'Record the payment'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={BTN.quiet}>
            Cancel
          </button>
        )}
        {!bill && chosen && (
          <span className="text-[12px] text-subtle">
            Goes into {chosen.code}&rsquo;s history.
          </span>
        )}
      </div>

      {error && <p className="text-[12.5px] font-semibold text-danger-700">{error}</p>}
    </form>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-subtle">
      {children}
    </span>
  )
}

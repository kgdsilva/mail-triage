'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, Check } from 'lucide-react'
import { confirmRecurringPaid } from '@/server/actions/recurring'
import { BTN } from '@/lib/theme'

/**
 * This month's standing obligations, on the screen where the money is handled.
 *
 * Deliberately a line and not a tab. These are two or three rows a month, known a month
 * in advance, and a whole screen for them would be a screen nobody opens — which is the
 * same as not having built it. It sits above the queue because the question "did the
 * retainers go out" is answered by looking, not by navigating.
 *
 * A month that is paid stays on the line for the rest of that month rather than
 * vanishing. Disappearing on payment would make the line empty most of the time, and an
 * empty line reads as "nothing is set up" rather than "nothing is owed".
 */
export type Row = {
  id: string
  payeeName: string
  entityCode: string
  /** Already formatted: the server owns money formatting. */
  amount: string | null
  rawAmount: string
  period: string
  periodLabel: string
  dueLabel: string
  daysLate: number
  paid: { amount: string; paidOn: string; recordedBy: string } | null
}

export function RecurringLine({ rows, canSettle }: { rows: Row[]; canSettle: boolean }) {
  if (rows.length === 0) return null

  const owed = rows.filter((r) => r.paid === null)
  const late = owed.filter((r) => r.daysLate > 0)

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line-soft px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[13.5px] font-bold text-navy-900">
          <CalendarClock className="size-4 text-navy-500" aria-hidden />
          Paid by hand every month
        </h2>
        <span className="text-[12.5px] text-muted">
          {owed.length === 0
            ? 'all settled'
            : `${owed.length} to pay${late.length > 0 ? ` · ${late.length} late` : ''}`}
        </span>
      </div>

      <ul className="divide-y divide-line-soft">
        {rows.map((r) => (
          <RecurringRow key={`${r.id}:${r.period}`} row={r} canSettle={canSettle} />
        ))}
      </ul>
    </div>
  )
}

function RecurringRow({ row, canSettle }: { row: Row; canSettle: boolean }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(formData: FormData) {
    setError(null)
    start(async () => {
      const res = await confirmRecurringPaid(formData)
      if (res.ok) setOpen(false)
      else setError(res.error)
    })
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-full bg-line-soft px-2 py-0.5 text-[11px] font-bold text-muted">
          {row.entityCode}
        </span>
        <span className="text-[13.5px] font-semibold text-navy-900">{row.payeeName}</span>
        <span className="text-[12.5px] text-subtle">{row.periodLabel}</span>

        {row.paid ? (
          <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ok-700">
            <Check className="size-3.5" aria-hidden />
            {row.paid.amount} on {row.paid.paidOn}
            <span className="font-normal text-subtle">· {row.paid.recordedBy}</span>
          </span>
        ) : (
          <>
            {row.amount && (
              <span className="text-[13px] font-bold text-navy-900">{row.amount}</span>
            )}
            <span
              className={`text-[12.5px] font-semibold ${
                row.daysLate > 0 ? 'text-danger-700' : 'text-muted'
              }`}
            >
              {row.daysLate > 0
                ? `${row.daysLate} day${row.daysLate === 1 ? '' : 's'} late`
                : row.dueLabel}
            </span>
          </>
        )}

        {row.paid === null && canSettle && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`${BTN.secondary} ml-auto`}
          >
            {open ? 'Cancel' : 'Record payment'}
          </button>
        )}
      </div>

      {open && (
        <form action={submit} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="period" value={row.period} />
          <Field label="Amount">
            <input
              name="amount"
              defaultValue={row.rawAmount}
              inputMode="decimal"
              required
              className="w-28 rounded-lg border border-line bg-canvas px-2 py-1 text-[13px]"
            />
          </Field>
          <Field label="Paid on">
            <input
              type="date"
              name="paidOn"
              defaultValue={today}
              required
              className="rounded-lg border border-line bg-canvas px-2 py-1 text-[13px]"
            />
          </Field>
          <Field label="Check no. / ref">
            <input
              name="reference"
              className="w-32 rounded-lg border border-line bg-canvas px-2 py-1 text-[13px]"
            />
          </Field>
          <button type="submit" disabled={pending} className={BTN.primary}>
            {pending ? 'Recording…' : `Mark ${row.periodLabel} paid`}
          </button>
        </form>
      )}

      {error && <p className="mt-1.5 text-[12.5px] text-danger-700">{error}</p>}
    </li>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
        {label}
      </span>
      {children}
    </label>
  )
}

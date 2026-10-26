'use client'

import { useState, useTransition } from 'react'
import { endRecurringPayment, saveRecurringPayment } from '@/server/actions/recurring'
import { BTN } from '@/lib/theme'

/**
 * Setting up what is owed every month, next to what is taken automatically.
 *
 * The two live on one screen because they are the same question asked from opposite
 * ends — what recurring money does this office have — and because keeping them apart is
 * what made the confusion possible in the first place. Somebody reading "Autopay" and
 * finding the lawyers absent concludes the lawyers are not recurring, when the truth is
 * that nobody drafts their fee.
 */
export type Standing = {
  id: string
  payeeName: string
  entityCode: string
  amount: string | null
  dayOfMonth: number
  notes: string | null
  from: string
  endedOn: string | null
  /** How many months have been recorded as paid against it. */
  paidMonths: number
}

export function RecurringSettings({
  rules,
  vendors,
  entities,
  today,
}: {
  rules: Standing[]
  vendors: { id: string; name: string }[]
  entities: { id: string; code: string }[]
  today: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(formData: FormData) {
    setError(null)
    start(async () => {
      const res = await saveRecurringPayment(formData)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <div className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-muted">
          The mirror image of an autopay rule. Autopay says the vendor takes the money by
          itself, so the bill needs nobody. This says the money moves only when somebody
          moves it — and since no invoice arrives and nothing is scanned, nothing else in
          this system would ever mention it.
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
              <tr>
                <th className="px-4 py-3 font-semibold">Payee</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Due</th>
                <th className="px-4 py-3 font-semibold">Paid</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rules.map((r) => (
                <tr key={r.id} className={r.endedOn ? 'opacity-55' : undefined}>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-navy-900">{r.payeeName}</span>
                    {r.notes && <span className="block text-[11.5px] text-subtle">{r.notes}</span>}
                    {r.endedOn && (
                      <span className="block text-[11.5px] text-subtle">ended {r.endedOn}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">{r.entityCode}</td>
                  <td className="px-4 py-2.5 tabular">{r.amount ?? <span className="text-subtle">varies</span>}</td>
                  <td className="px-4 py-2.5 text-muted">{ordinal(r.dayOfMonth)}</td>
                  <td className="px-4 py-2.5 tabular text-muted">{r.paidMonths}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.endedOn === null && <EndButton id={r.id} name={r.payeeName} />}
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">
                    Nothing set up yet. The two lawyers on monthly retainer are what this is for.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-xs text-muted">
            Ending one keeps it, because the payments already recorded against it read
            their name from this row.
          </p>
        </div>
      </div>

      <form action={submit} className="h-fit space-y-3 rounded-lg border border-line bg-surface p-4">
        <p className="text-sm font-medium">Add a monthly payment</p>

        <input name="payeeName" placeholder="Who gets paid" required className={inputClass} />

        <select name="entityId" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Which company owes it
          </option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.code}
            </option>
          ))}
        </select>

        <select name="vendorId" className={inputClass} defaultValue="">
          <option value="">Link to a vendor (optional)</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>

        <input name="amount" placeholder="Usual amount (blank if it varies)" inputMode="decimal" className={inputClass} />

        <label className="block text-xs text-muted">
          Day of the month
          <input
            name="dayOfMonth"
            type="number"
            min={1}
            max={31}
            required
            defaultValue={1}
            className={`mt-1 ${inputClass}`}
          />
          <span className="mt-0.5 block text-[11px] text-subtle">
            29, 30 and 31 fall back to the last day in a short month rather than being skipped.
          </span>
        </label>

        <input name="method" placeholder="How it is paid (optional)" className={inputClass} />

        <label className="block text-xs text-muted">
          Owed from
          <input name="effectiveFrom" type="date" required defaultValue={today} className={`mt-1 ${inputClass}`} />
          <span className="mt-0.5 block text-[11px] text-subtle">
            Earlier months are never asked for, so backdating this is how you make the
            office chase a retainer it has been forgetting.
          </span>
        </label>

        <input name="notes" placeholder="Notes" className={inputClass} />

        <button disabled={pending} className={`w-full ${BTN.primary}`}>
          {pending ? 'Saving…' : 'Add it'}
        </button>

        {error && <p className="text-[12px] text-danger-700">{error}</p>}
      </form>
    </div>
  )
}

function EndButton({ id, name }: { id: string; name: string }) {
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!asking) {
    return (
      <button type="button" className={BTN.quiet} onClick={() => setAsking(true)}>
        End
      </button>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-[11.5px] text-muted">Stop asking for {name}?</span>
      <button
        type="button"
        disabled={pending}
        className={BTN.secondary}
        onClick={() =>
          start(async () => {
            const res = await endRecurringPayment(id)
            if (res.ok) setAsking(false)
            else setError(res.error)
          })
        }
      >
        {pending ? 'Ending…' : 'End it'}
      </button>
      <button type="button" className={BTN.quiet} onClick={() => setAsking(false)}>
        Keep
      </button>
      {error && <span className="block text-[11.5px] text-danger-700">{error}</span>}
    </span>
  )
}

function ordinal(n: number) {
  if (n > 3 && n < 21) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const inputClass =
  'w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-navy-500'

'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { Paperclip, Plus, X } from 'lucide-react'
import { addBill } from '@/server/actions/add-bill'
import { BTN } from '@/lib/theme'

/**
 * A bill that arrived by email, or as a web page, or any way that is not the post.
 *
 * Eric's ManyChat invoice is the case: a subscription cancelled, a billing page with no
 * download button, and no way at all to get it into the system — the approver and the
 * accountant could not upload, so their only route was to forward it to somebody else
 * and wait. This is the door for them.
 *
 * A file is required and the form says why. "I think we need a physical hard copy of it
 * because if I cancel the subscription you're not gonna have access to that link" is the
 * rule, and a screenshot satisfies it where a URL does not.
 */
export function AddBill({
  entities,
  categories,
}: {
  entities: { id: string; code: string; legalName: string }[]
  /** What the money was for. Optional, and the reason Eric asked for this field. */
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [chosen, setChosen] = useState<File[]>([])
  const form = useRef<HTMLFormElement>(null)

  const totalBytes = chosen.reduce((sum, f) => sum + f.size, 0)
  const tooBig = totalBytes > MAX_BYTES

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    setError(null)

    /*
     * Weighed here, before anything is sent.
     *
     * The server already refuses a batch over the limit with a sentence naming the
     * size — but that check can only run on a request that arrives, and the platform
     * caps a server action's whole body at 4.5 MB and rejects a larger one itself,
     * before our code is reached. So the one case most likely to happen — two phone
     * photographs of hotel receipts — was the one case nobody got an explanation for:
     * the request died in transit, the form sat there, and the person went away
     * believing the bill had been added.
     *
     * The browser knows the sizes the moment the files are picked. There is no reason
     * to spend a minute uploading something that cannot be accepted.
     */
    if (tooBig) {
      setError(
        `Those ${chosen.length} files come to ${mb(totalBytes)} together, and the limit is ${mb(MAX_BYTES)}. Add the invoice here and upload the rest from Upload, or photograph them at a lower resolution.`,
      )
      return
    }

    start(async () => {
      /*
       * A rejected request is still an answer.
       *
       * Without this, anything that failed outside the action's own logic — the body
       * refused, the network dropped, a deploy landing mid-submit — threw past the
       * form and left no trace on screen at all. Silence after pressing a button reads
       * as success to everybody, which is how a bill nobody recorded gets believed in.
       */
      let res
      try {
        res = await addBill(data)
      } catch {
        setError(
          'That did not reach the server, so nothing was added. Check the files are not too large together, then try again.',
        )
        return
      }

      if (!res.ok) {
        setError(res.error ?? 'That did not work.')
        return
      }
      form.current?.reset()
      setChosen([])
      // The server's own sentence, because only it knows whether anybody can clear it.
      setDone(res.went ?? 'Added, and it is now waiting on the approver.')
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BTN.secondary} onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden />
          Add a bill
        </button>
        {done && <span className="text-[12.5px] font-semibold text-ok-700">{done}</span>}
      </div>
    )
  }

  return (
    <form
      ref={form}
      onSubmit={submit}
      className="rounded-xl border border-navy-500 bg-navy-50 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-bold text-navy-900">Add a bill</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            For an invoice that did not come through the post — emailed to you, or a billing
            page. It goes straight to the approver.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1 text-muted hover:bg-navy-100"
          aria-label="Close"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Company">
          <select name="entityId" required className={INPUT} defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} — {e.legalName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="From">
          <input name="vendorName" required placeholder="ManyChat" className={INPUT} />
        </Field>

        <Field label="Amount">
          <input name="amount" required inputMode="decimal" placeholder="15.00" className={INPUT} />
        </Field>

        <Field label="Due date" hint="Leave blank if it does not say">
          <input name="dueDate" type="date" className={INPUT} />
        </Field>

        {/*
          What the money was for, set when the bill is added rather than guessed later.
          An expense reimbursement is the case this was asked for: it is not a vendor
          invoice and the person paying needs to see which it is before writing a cheque.
        */}
        <Field label="What it is for" hint="Optional — Reimbursement, Travel, Legal…">
          <select name="categoryId" className={INPUT} defaultValue="">
            <option value="">Not set</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3">
        <Field
          label="The invoice, or the receipts"
          hint="Several files are fine — one reimbursement from three receipts is one bill, one approval and one cheque. The first is the invoice; the rest are filed beside it. Never just a link: it dies with the account."
        >
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line bg-surface px-3 py-2.5 text-[13px] text-muted hover:border-navy-500">
            <Paperclip className="size-4 flex-none" aria-hidden />
            <input
              name="file"
              type="file"
              multiple
              required
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
              onChange={(e) => setChosen(Array.from(e.currentTarget.files ?? []))}
              className="min-w-0 flex-1 text-[12.5px] file:mr-3 file:rounded file:border-0 file:bg-navy-100 file:px-2 file:py-1 file:text-[12px] file:font-semibold file:text-navy-900"
            />
          </label>
          {/*
            What is actually about to be sent, counted and weighed. Somebody attaching
            three receipts to one cheque is making a claim about how many there are, and
            this is where that claim can still be checked for free.
          */}
          {chosen.length > 0 && (
            <p
              className={`mt-1 text-[11.5px] ${tooBig ? 'font-semibold text-danger-700' : 'text-subtle'}`}
            >
              {chosen.length === 1 ? '1 file' : `${chosen.length} files`} · {mb(totalBytes)}
              {tooBig ? ` — over the ${mb(MAX_BYTES)} limit, this will not send` : ''}
            </p>
          )}
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Note" hint="Optional — anything the approver or the payer should know">
          <input name="note" placeholder="Cancelled; this is the last one" className={INPUT} />
        </Field>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-100 px-3 py-2 text-[12.5px] text-danger-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={BTN.primary} disabled={pending || tooBig}>
          {pending ? 'Adding…' : 'Add and send for approval'}
        </button>
        <button type="button" className={BTN.quiet} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * The platform's ceiling on a server action's whole body is 4.5 MB, and it rejects a
 * larger request before any of our code runs. Four leaves room for the form's own
 * fields, and matches the number the server refuses on.
 */
const MAX_BYTES = 4 * 1024 * 1024

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const INPUT =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-navy-500'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-navy-900">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11.5px] text-subtle">{hint}</span>}
    </label>
  )
}

'use client'

import { useState } from 'react'
import { Archive, BadgeCheck, TriangleAlert, Wallet } from 'lucide-react'
import { decideQuickly } from '@/server/actions/documents'
import { PdfFrame, PeekToggle } from '@/components/pdf-peek'
import { PaymentForm, type PaymentEntity } from '@/components/payment-form'
import {
  BTN,
  URGENCY_BAR,
  URGENCY_TONE,
  documentTypeIcon,
  documentTypeTone,
  entityAccent,
  entityColor,
  urgency,
} from '@/lib/theme'

export type Bill = {
  id: string
  title: string
  vendorName: string | null
  typeLabel: string | null
  typeCode: string | null
  summaryNote: string | null
  amount: string | null
  dueDate: string | null
  entityId: string | null
  entityCode: string | null
  entityIndex: number
  assignee: string | null
  hasFile: boolean
}

/**
 * How soon a bill is due, as the only grouping on the screen.
 *
 * Paying is a time-ordered job: the question is never "which of these is a tax notice",
 * it is "what has to leave today". So the buckets are dates, and every other fact about
 * a bill rides along on its row.
 */
const BUCKETS = [
  { key: 'overdue' as const, label: 'Overdue', blurb: 'Past the date on the document.' },
  { key: 'soon' as const, label: 'Due within a week', blurb: 'The next seven days.' },
  { key: 'later' as const, label: 'Later', blurb: 'Dated, but not yet pressing.' },
  { key: 'none' as const, label: 'No date on the document', blurb: 'Nothing states a deadline.' },
]

export function BillsList({
  bills,
  canTriage,
  entities,
}: {
  bills: Bill[]
  canTriage: boolean
  /** Needed by the payment form, which asks which company the money came from. */
  entities: PaymentEntity[]
}) {
  return (
    <div className="space-y-7">
      {BUCKETS.map((bucket) => {
        const rows = bills.filter((b) => urgency(b.dueDate) === bucket.key)
        if (rows.length === 0) return null

        const total = rows.reduce(
          (sum, b) => sum + (b.amount ? Number(b.amount.replace(/,/g, '')) : 0),
          0,
        )

        return (
          <section key={bucket.key}>
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <span className={`h-4 w-1.5 rounded-full ${URGENCY_BAR[bucket.key]}`} aria-hidden />
              <h2 className="text-[14px] font-bold text-navy-900">{bucket.label}</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${URGENCY_TONE[bucket.key]}`}
              >
                {rows.length}
              </span>
              <span className="hidden text-[12.5px] text-subtle sm:inline">{bucket.blurb}</span>
              <span className="tabular ml-auto text-[14px] font-bold text-navy-900">
                {money(total)}
              </span>
            </div>

            <div className="space-y-2">
              {rows.map((bill) => (
                <BillRow
                  key={bill.id}
                  bill={bill}
                  canTriage={canTriage}
                  entities={entities}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function BillRow({
  bill,
  canTriage,
  entities,
}: {
  bill: Bill
  canTriage: boolean
  entities: PaymentEntity[]
}) {
  const [open, setOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const Icon = documentTypeIcon(bill.typeCode)
  const level = urgency(bill.dueDate)

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${bill.entityCode ? entityAccent(bill.entityCode, bill.entityIndex) : 'bg-line'}`}
        aria-hidden
      />

      <div className="flex flex-wrap items-center gap-3 py-3 pl-5 pr-3">
        <span
          className={`grid size-9 flex-none place-items-center rounded-[10px] ${documentTypeTone(bill.typeCode)}`}
          aria-hidden
        >
          <Icon className="size-4.5" strokeWidth={1.9} />
        </span>

        {bill.entityCode && (
          <span
            className={`flex-none rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider ${entityColor(bill.entityCode, bill.entityIndex)}`}
          >
            {bill.entityCode}
          </span>
        )}

        <span className="min-w-40 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="block max-w-full truncate text-left text-[14.5px] font-bold text-navy-900 hover:underline"
          >
            {bill.vendorName ?? bill.title}
          </button>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-subtle">
            {bill.typeLabel && <span className="font-medium">{bill.typeLabel}</span>}
            {bill.assignee && <span>· {bill.assignee}</span>}
            {bill.summaryNote && <span className="truncate">· {bill.summaryNote}</span>}
          </span>
        </span>

        <span className="flex flex-none flex-col items-end">
          <span className="display tabular text-[19px] font-extrabold tracking-tight text-navy-900">
            {bill.amount ? `$${bill.amount}` : <span className="text-subtle">—</span>}
          </span>
          {bill.dueDate && (
            <span
              className={`tabular mt-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${URGENCY_TONE[level]}`}
            >
              {level === 'overdue' ? 'was due ' : 'due '}
              {shortDate(bill.dueDate)}
            </span>
          )}
        </span>

        <span className="flex flex-none items-center gap-1.5">
          {/*
            "Mark paid" rather than "Done". Finishing a bill and recording that money
            left are the same act, and splitting them is how a paid bill ended up with
            no record of what was paid, when, or by whom.
          */}
          <button
            type="button"
            onClick={() => setPaying((v) => !v)}
            className={BTN.done}
            title="Record the payment and close this bill"
          >
            <Wallet className="size-3.5" aria-hidden />
            {paying ? 'Cancel' : 'Mark paid'}
          </button>

          {/*
            Archive and Spam only for the people who triage. They rewrite the decision
            on the document rather than closing a task, and the server refuses them for
            anyone else — offering a button that always errors is worse than not
            offering it.
          */}
          {canTriage && (
            <>
              <form action={decideQuickly.bind(null, bill.id, 'ARCHIVE')}>
                <button className={BTN.quiet} title="Nothing to pay — file it">
                  <Archive className="size-3.5" aria-hidden />
                  Archive
                </button>
              </form>
              <form action={decideQuickly.bind(null, bill.id, 'SPAM')}>
                <button
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-danger-500 hover:bg-danger-100 hover:text-danger-700"
                  title="A solicitation dressed up as a bill"
                >
                  <TriangleAlert className="size-3.5" aria-hidden />
                  Spam
                </button>
              </form>
            </>
          )}

          <PeekToggle open={open} onToggle={() => setOpen((v) => !v)} />
        </span>
      </div>

      {paying && (
        <div className="border-t border-line-soft bg-canvas px-4 py-3.5">
          <p className="mb-3 flex items-center gap-1.5 text-[12.5px] font-bold text-navy-900">
            <BadgeCheck className="size-4 text-ok-700" aria-hidden />
            Record this payment
          </p>
          <PaymentForm
            entities={entities}
            bill={{
              documentId: bill.id,
              entityId: bill.entityId,
              entityCode: bill.entityCode,
              entityIndex: bill.entityIndex,
              payee: bill.vendorName,
              amount: bill.amount,
            }}
            onCancel={() => setPaying(false)}
          />
        </div>
      )}

      {open && (
        <div className="border-t border-line-soft px-4 py-3.5">
          <PdfFrame id={bill.id} title={bill.title} hasFile={bill.hasFile} height="h-[34rem]" />
        </div>
      )}
    </div>
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

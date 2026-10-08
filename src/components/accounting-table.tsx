'use client'

import { useState } from 'react'
import { Download, FileText, History, ShieldCheck, Wallet } from 'lucide-react'
import { PaymentForm, type PaymentEntity } from '@/components/payment-form'
import { PdfFrame } from '@/components/pdf-peek'
import { formatDate } from '@/components/badges'
import { BTN, URGENCY_TONE, entityColor, urgencyWithin } from '@/lib/theme'

export type AccountingBill = {
  id: string
  title: string
  vendorName: string | null
  invoiceNumber: string | null
  amount: string | null
  /** Unformatted, for the payment form's prefill. */
  amountRaw: string | null
  entityId: string | null
  entityCode: string | null
  /** The legal name, for the tooltip on the code badge. */
  companyName: string | null
  entityIndex: number
  dueDate: string | null
  receivedDate: string
  categoryName: string | null
  approvedBy: string | null
  approvedAt: string | null
  hasFile: boolean
  /** Set on the Paid tab. */
  payment: { paidOn: string; amount: string; method: string | null; reference: string | null } | null
  /** Set on the Denied tab: who refused it, when, and the note they had to leave. */
  refusal: { by: string | null; at: string | null; note: string | null } | null
}

/**
 * The accountant's list: what may be paid, and what has been.
 *
 * Deliberately not the approver's table with a different button. The questions are
 * different — there, "should this be paid"; here, "has it been, and what did I send" —
 * so the row carries who approved it and when, which is the only reason the accountant
 * is allowed to act on it at all.
 */
export function AccountingTable({
  bills,
  mode,
  entities,
  canSettle,
}: {
  bills: AccountingBill[]
  mode: 'ready' | 'paid' | 'denied'
  entities: PaymentEntity[]
  canSettle: boolean
}) {
  if (bills.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-14 text-center">
        <h3 className="text-[15px] font-bold text-navy-900">
          {mode === 'ready'
            ? 'Nothing is approved and waiting to be paid.'
            : mode === 'denied'
              ? 'Nothing has been refused.'
              : 'Nothing paid yet.'}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
          {mode === 'ready'
            ? 'A bill appears here the moment its approver clears it.'
            : mode === 'denied'
              ? 'A bill an approver refuses appears here, with the reason they gave.'
              : 'Bills you mark as paid are kept here with their receipt.'}
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {bills.map((bill) => (
        <Row key={bill.id} bill={bill} mode={mode} entities={entities} canSettle={canSettle} />
      ))}
    </ul>
  )
}

function Row({
  bill,
  mode,
  entities,
  canSettle,
}: {
  bill: AccountingBill
  mode: 'ready' | 'paid' | 'denied'
  entities: PaymentEntity[]
  canSettle: boolean
}) {
  const [open, setOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const level = urgencyWithin(bill.dueDate, 3)

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid gap-x-3 gap-y-1.5 px-3 py-3 md:grid-cols-[1.6fr_1fr_auto_auto_1fr_1fr] md:items-center">
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

        <span className="flex items-center gap-2 md:block">
          <Tag>Invoice no.</Tag>
          <span className="font-mono text-[12.5px]">{bill.invoiceNumber ?? '—'}</span>
        </span>

        <span className="flex items-center gap-2 md:block md:text-right">
          <Tag>Amount</Tag>
          <span className="tabular text-[14px] font-bold text-navy-900">{bill.amount ?? '—'}</span>
        </span>

        <span className="flex items-center gap-2 md:block">
          <Tag>Company</Tag>
          {bill.entityCode && (
            <span
              // The code fits the column; the name is what people know it by.
              title={bill.companyName ?? bill.entityCode}
              className={`inline-block cursor-help rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${entityColor(
                bill.entityCode,
                bill.entityIndex,
              )}`}
            >
              {bill.entityCode}
            </span>
          )}
        </span>

        <span className="flex items-center gap-2 md:block">
          <Tag>{mode === 'paid' ? 'Paid' : 'Due'}</Tag>
          {mode === 'paid' && bill.payment ? (
            <span className="tabular text-[12.5px] text-muted">
              {formatDate(new Date(`${bill.payment.paidOn}T00:00:00Z`))}
            </span>
          ) : bill.dueDate ? (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular ${URGENCY_TONE[level]}`}
            >
              {level === 'overdue' ? 'Overdue ' : ''}
              {formatDate(new Date(`${bill.dueDate}T00:00:00Z`))}
            </span>
          ) : (
            <span className="text-[12.5px] text-subtle">No due date</span>
          )}
        </span>

        <span className="flex items-center gap-2 md:block">
          <Tag>{mode === 'paid' ? 'How' : 'Received'}</Tag>
          <span className="text-[12.5px] text-muted">
            {mode === 'paid' && bill.payment
              ? [bill.payment.method, bill.payment.reference].filter(Boolean).join(' · ') || '—'
              : formatDate(new Date(bill.receivedDate))}
          </span>
        </span>
      </div>

      {/*
        Who approved it, on every row. It is the accountant's authority to pay and the
        first thing anyone asks about afterwards, so it is not behind a panel.
      */}
      {bill.approvedBy && mode !== 'denied' && (
        <p className="flex items-center gap-1.5 border-t border-line-soft bg-ok-100/50 px-3 py-1.5 text-[12px] text-ok-700">
          <ShieldCheck className="size-3.5 flex-none" aria-hidden />
          Approved by {bill.approvedBy}
          {bill.approvedAt ? ` on ${formatDate(new Date(bill.approvedAt))}` : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line-soft px-3 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className={BTN.quiet}>
          <FileText className="size-3.5" aria-hidden />
          {open ? 'Hide invoice' : 'Preview'}
        </button>
        <a href={`/api/files/${bill.id}?download=1`} className={BTN.quiet}>
          <Download className="size-3.5" aria-hidden />
          Download
        </a>
        <a href={`/history/${bill.id}`} className={BTN.quiet}>
          <History className="size-3.5" aria-hidden />
          History
        </a>

        {/*
          Why not to pay it, in the approver's own words.
          A refusal without its reason is just an absence, and an absence is what this
          tab exists to replace: before it, a denied bill simply vanished from this
          screen and the person who pays could not tell a refusal from a bill that had
          never been decided.
        */}
        {mode === 'denied' && bill.refusal && (
          <p className="w-full rounded-lg bg-danger-100 px-3 py-2 text-[12.5px] text-danger-700">
            <span className="font-bold">Do not pay.</span>{' '}
            {bill.refusal.by ? `${bill.refusal.by} refused this` : 'Refused'}
            {bill.refusal.at ? ` on ${formatDate(new Date(bill.refusal.at))}` : ''}
            {bill.refusal.note ? `: ${bill.refusal.note}` : '.'}
          </p>
        )}

        {mode === 'ready' && canSettle && (
          <button
            type="button"
            onClick={() => setPaying((v) => !v)}
            className={`ml-auto ${paying ? BTN.secondary : BTN.done}`}
          >
            <Wallet className="size-3.5" aria-hidden />
            {paying ? 'Cancel' : 'Mark as paid'}
          </button>
        )}
      </div>

      {paying && (
        <div className="border-t border-line-soft p-3">
          <PaymentForm
            entities={entities}
            bill={{
              documentId: bill.id,
              entityId: bill.entityId,
              entityCode: bill.entityCode,
              entityIndex: bill.entityIndex,
              payee: bill.vendorName,
              amount: bill.amountRaw,
            }}
            onCancel={() => setPaying(false)}
          />
        </div>
      )}

      {open && (
        <div className="border-t border-line-soft p-3">
          <PdfFrame id={bill.id} title={bill.title} hasFile={bill.hasFile} />
        </div>
      )}
    </li>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-wide text-subtle md:hidden">
      {children}
    </span>
  )
}

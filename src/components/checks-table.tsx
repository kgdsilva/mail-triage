import { Banknote } from 'lucide-react'
import { EntityBadge, formatDate, formatMoney } from '@/components/badges'
import { PeekRow } from '@/components/pdf-peek'

/**
 * Money that arrived, listed for reconciling against the bank.
 *
 * Lifted out of its own screen so it can live as a tab in Accounting. It was in the
 * Money menu beside two other entries that led to slices of Accounting's own lists —
 * three ways into variations of one page — and incoming cheques are the accountant's
 * business anyway. Read-only, as it always was: these are archived on arrival, so there
 * is no decision to make here.
 */

const COLUMNS = 7

export type CheckRow = {
  id: string
  originalFilename: string
  finalFilename: string | null
  summaryNote: string | null
  amount: unknown
  documentDate: Date | null
  storageKey: string | null
  entity: { code: string | null; sortOrder: number } | null
  vendor: { name: string } | null
  batch: { label: string } | null
}

export function ChecksTable({ rows }: { rows: CheckRow[] }) {
  return (
    <div className="space-y-3">
  {rows.length === 0 ? (
    <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-16 text-center">
      <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-teal-100 text-teal-700">
        <Banknote className="size-6" strokeWidth={1.6} aria-hidden />
      </span>
      <h3 className="text-[15px] font-bold text-navy-900">No checks logged yet</h3>
      <p className="mt-1 text-[13px] text-muted">
        Documents classified as “Check (incoming)” appear here.
      </p>
    </div>
  ) : (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-line bg-navy-50/60 text-left text-[10.5px] uppercase tracking-[0.07em] text-navy-700">
          <tr>
            <th className="px-4 py-3 font-bold">Company</th>
            <th className="px-4 py-3 font-bold">Date</th>
            <th className="px-4 py-3 font-bold">From</th>
            <th className="px-4 py-3 font-bold">Document</th>
            <th className="px-4 py-3 font-bold">Batch</th>
            <th className="px-4 py-3 text-right font-bold">Amount</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((c) => (
            <PeekRow
              key={c.id}
              id={c.id}
              title={c.finalFilename ?? c.originalFilename}
              hasFile={Boolean(c.storageKey)}
              colSpan={COLUMNS}
            >
              <td className="whitespace-nowrap px-4 py-3">
                <EntityBadge code={c.entity?.code} index={c.entity?.sortOrder ?? 0} />
              </td>
              <td className="tabular whitespace-nowrap px-4 py-3 text-[12.5px] text-muted">
                {formatDate(c.documentDate) || <span className="text-subtle">—</span>}
              </td>
              <td className="px-4 py-3 text-[13px] font-medium">
                {c.vendor?.name ?? <span className="font-normal text-subtle">Not recorded</span>}
              </td>
              <td className="max-w-[300px] px-4 py-3">
                <span
                  className="block truncate font-mono text-[12px] text-navy-700"
                  title={c.finalFilename ?? c.originalFilename}
                >
                  {c.finalFilename ?? c.originalFilename}
                </span>
                {c.summaryNote && (
                  <span className="mt-0.5 block truncate text-[12px] text-subtle">
                    {c.summaryNote}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-subtle">
                {c.batch?.label ?? '—'}
              </td>
              <td className="tabular whitespace-nowrap px-4 py-3 text-right text-[14.5px] font-bold text-teal-700">
                {c.amount ? formatMoney(c.amount) : <span className="text-subtle">—</span>}
              </td>
            </PeekRow>
          ))}
        </tbody>
      </table>
    </div>
  )}
    </div>
  )
}

import { Banknote } from 'lucide-react'
import { prisma } from '@/server/db/client'
import { listChecks } from '@/server/documents'
import { canSeeWholeLog, requireWorker } from '@/server/session'
import { EntityBadge, formatDate, formatMoney } from '@/components/badges'
import { CompanyPicker } from '@/components/company-picker'
import { PeekRow } from '@/components/pdf-peek'

export const dynamic = 'force-dynamic'

/** Company, date, who it came from, the document, its batch, the amount, the chevron. */
const COLUMNS = 7

/**
 * Incoming third-party checks on their own, for reconciliation against the bank.
 *
 * Deliberately read-only: these are archived on arrival — logged and filed, never routed
 * to anyone — so there is no decision to make here. Money coming in is the one good
 * news on any of these screens, and it is the only teal in the app.
 */
export default async function ChecksPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>
}) {
  const session = await requireWorker()
  const { entity } = await searchParams

  // A member sees their own documents elsewhere; checks are a whole-log view.
  if (!canSeeWholeLog(session.role)) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-10 text-center text-sm text-muted">
        Incoming checks are visible to people who can see the whole log.
      </p>
    )
  }

  const [rows, entities] = await Promise.all([
    listChecks(session.companyGroupId, entity || null),
    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, legalName: true, sortOrder: true },
    }),
  ])

  const total = rows.reduce((sum, r) => sum + (r.amount ? Number(String(r.amount)) : 0), 0)

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[28px] font-extrabold text-navy-900">Checks received</h1>
        <p className="mt-1 text-[15px] text-muted">
          Incoming checks from title companies, closing agents and other third parties.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
        <CompanyPicker entities={entities} value={entity ?? null} />

        <span className="ml-auto inline-flex items-center gap-2.5 rounded-full bg-teal-100 px-3 py-1.5 text-teal-700">
          <Banknote className="size-4" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.07em]">
            {rows.length} check{rows.length === 1 ? '' : 's'}
          </span>
          <span className="display tabular text-[17px] font-extrabold tracking-tight">
            {formatMoney({ toString: () => String(total) })}
          </span>
        </span>
      </div>

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

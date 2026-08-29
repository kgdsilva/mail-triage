import Link from 'next/link'
import { Banknote, ExternalLink } from 'lucide-react'
import { prisma } from '@/server/db/client'
import { listChecks } from '@/server/documents'
import { canSeeWholeLog, requireSession } from '@/server/session'
import { EntityBadge, formatDate, formatMoney } from '@/components/badges'

export const dynamic = 'force-dynamic'

/**
 * Incoming third-party checks on their own, for reconciliation against the bank.
 *
 * Deliberately read-only for now. These are archived on arrival — logged and filed,
 * never routed to anyone — so there is no decision to make here. What action belongs on
 * this screen is still an open question; showing the money clearly comes first.
 */
export default async function ChecksPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>
}) {
  const session = await requireSession()
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
      select: { id: true, code: true },
    }),
  ])

  const total = rows.reduce((sum, r) => sum + (r.amount ? Number(String(r.amount)) : 0), 0)

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Checks received</h1>
        <p className="mt-1 text-[15px] text-muted">
          Incoming checks from title companies, closing agents and other third parties.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
        <span className="w-16 flex-none text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle">
          Company
        </span>
        <Tab href="/checks" active={!entity} label="All" />
        {entities.map((e) => (
          <Tab
            key={e.id}
            href={`/checks?entity=${e.id}`}
            active={entity === e.id}
            label={e.code}
          />
        ))}

        <span className="ml-auto flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-[0.07em] text-subtle">
            {rows.length} check{rows.length === 1 ? '' : 's'}
          </span>
          <span className="tabular text-[17px] font-semibold text-navy-900">
            {formatMoney({ toString: () => String(total) })}
          </span>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-16 text-center">
          <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-navy-50 text-navy-500">
            <Banknote className="size-6" strokeWidth={1.6} aria-hidden />
          </span>
          <h3 className="text-[14.5px] font-semibold text-navy-900">No checks logged yet</h3>
          <p className="mt-1 text-[13px] text-muted">
            Documents classified as “Check (incoming)” appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
              <tr>
                <th className="px-4 py-3 font-semibold">Company</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">From</th>
                <th className="px-4 py-3 font-semibold">Document</th>
                <th className="px-4 py-3 font-semibold">Batch</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-navy-50/60">
                  <td className="whitespace-nowrap px-4 py-3">
                    <EntityBadge code={c.entity?.code} index={c.entity?.sortOrder ?? 0} />
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-[12.5px] text-muted">
                    {formatDate(c.documentDate) || <span className="text-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    {c.vendor?.name ?? <span className="text-subtle">Not recorded</span>}
                  </td>
                  <td className="max-w-[300px] px-4 py-3">
                    <Link
                      href={`/classify/${c.id}`}
                      className="block truncate font-mono text-[12px] text-navy-700 hover:underline"
                      title={c.finalFilename ?? c.originalFilename}
                    >
                      {c.finalFilename ?? c.originalFilename}
                    </Link>
                    {c.summaryNote && (
                      <span className="mt-0.5 block truncate text-[12px] text-subtle">
                        {c.summaryNote}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-subtle">
                    {c.batch?.label ?? '—'}
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-right text-[14px] font-semibold text-navy-900">
                    {c.amount ? formatMoney(c.amount) : <span className="text-subtle">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {c.storageKey && (
                      <a
                        href={`/api/files/${c.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] text-muted transition-colors hover:text-navy-700"
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                        PDF
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
        active
          ? 'border-navy-700 bg-navy-700 text-white'
          : 'border-line text-muted hover:border-navy-500 hover:bg-navy-50 hover:text-navy-700'
      }`}
    >
      {label}
    </Link>
  )
}

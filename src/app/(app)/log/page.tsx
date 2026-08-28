import Link from 'next/link'
import { DispositionBadge, StatusText, formatDate, formatMoney } from '@/components/badges'
import { LogFilters } from '@/components/log-filters'
import { parseFilters } from '@/lib/filters'
import { prisma } from '@/server/db/client'
import { listDocuments } from '@/server/documents'
import { canSeeWholeLog, requireSession } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSession()
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === 'string') sp.set(k, v)
    else if (Array.isArray(v)) v.forEach((x) => sp.append(k, x))
  }

  const filters = parseFilters(sp)
  // A MEMBER works their own queue rather than browsing the group's mail. Applied
  // after parsing so no query string can widen it.
  const wholeLog = canSeeWholeLog(session.role)
  if (!wholeLog) filters.restrictToUserId = session.userId
  const [{ rows, total, page, pageCount }, entities, types] = await Promise.all([
    listDocuments(session.companyGroupId, filters),
    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true },
    }),
    prisma.documentType.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, label: true },
    }),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">{wholeLog ? 'Master log' : 'My documents'}</h1>
        <p className="text-xs text-neutral-500">
          {wholeLog
            ? 'Every document that has passed through the system. Nothing is ever deleted.'
            : 'Every document routed to you, open or resolved.'}
        </p>
      </div>

      <LogFilters
        entities={entities.map((e) => ({ id: e.id, label: e.code }))}
        types={types.map((t) => ({ id: t.id, label: t.label }))}
        total={total}
      />

      <div className="overflow-x-auto rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Document</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 font-medium">Decision</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {d.entity?.code ?? <span className="text-neutral-400">—</span>}
                  {d.entity?.isSegregated && (
                    <span className="ml-1 text-[10px] text-neutral-400">sep</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-600 dark:text-neutral-400">
                  {formatDate(d.documentDate)}
                </td>
                <td className="max-w-[320px] px-3 py-2">
                  <Link
                    href={`/classify/${d.id}`}
                    className="block truncate hover:underline"
                    title={d.finalFilename ?? d.originalFilename}
                  >
                    {d.finalFilename ?? d.originalFilename}
                  </Link>
                  {d.summaryNote && (
                    <span className="block truncate text-xs text-neutral-500">
                      {d.summaryNote}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {d.documentType?.label ?? <span className="text-neutral-400">—</span>}
                </td>
                <td className="max-w-[180px] truncate px-3 py-2 text-xs">
                  {d.vendor?.name ?? <span className="text-neutral-400">—</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {formatMoney(d.amount)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(d.dueDate)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <DispositionBadge value={d.disposition} />
                  {d.dispositionReason && (
                    <span className="ml-1 text-[10px] text-neutral-500">
                      {d.dispositionReason.toLowerCase().replace(/_/g, ' ')}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <StatusText value={d.status} />
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-16 text-center text-sm text-neutral-500">
                  No documents match these filters.{' '}
                  <Link href="/upload" className="underline">
                    Upload a batch
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            {page > 1 && <PageLink sp={sp} page={page - 1} label="Previous" />}
            {page < pageCount && <PageLink sp={sp} page={page + 1} label="Next" />}
          </div>
        </div>
      )}
    </div>
  )
}

function PageLink({ sp, page, label }: { sp: URLSearchParams; page: number; label: string }) {
  const next = new URLSearchParams(sp)
  next.set('page', String(page))
  return (
    <Link
      href={`/log?${next.toString()}`}
      className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      {label}
    </Link>
  )
}

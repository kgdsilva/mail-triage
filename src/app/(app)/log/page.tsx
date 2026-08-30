import Link from 'next/link'
import { Search, Trash2, Undo2 } from 'lucide-react'
import { DispositionBadge, DueBadge, EntityBadge, StatusBadge, formatDate, formatMoney } from '@/components/badges'
import { documentTypeIcon } from '@/lib/theme'
import { LogFilters } from '@/components/log-filters'
import { parseFilters } from '@/lib/filters'
import { prisma } from '@/server/db/client'
import { listDocuments } from '@/server/documents'
import { deleteDocument, restoreDocument } from '@/server/actions/documents'
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
  const showingDeleted = filters.showDeleted === true
  const [{ rows, total, page, pageCount }, entities, types] = await Promise.all([
    listDocuments(session.companyGroupId, filters),
    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, sortOrder: true },
    }),
    prisma.documentType.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, label: true, code: true },
    }),
  ])

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight text-navy-900">
          {wholeLog ? 'Master log' : 'My documents'}
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          {wholeLog
            ? 'Every document that has passed through the system. Nothing is ever deleted.'
            : 'Every document routed to you, open or resolved.'}
        </p>
      </header>

      {showingDeleted && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-gold-50 px-4 py-2.5 text-[13px] text-gold-800">
          <Trash2 className="size-4 flex-none" aria-hidden />
          <span>
            Showing documents removed from the log. Nothing here was destroyed — the
            record, the file and the full history are intact, and Restore puts one back.
          </span>
          <Link href="/log" className="ml-auto flex-none font-medium underline">
            Back to the log
          </Link>
        </div>
      )}

      <LogFilters
        entities={entities.map((e) => ({ id: e.id, label: e.code }))}
        types={types.map((t) => ({ id: t.id, label: t.label }))}
        total={total}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
            <tr>
              <th className="px-4 py-3 font-semibold">Entity</th>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Document</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Vendor</th>
              <th className="px-4 py-3 text-right font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Due</th>
              <th className="px-4 py-3 font-semibold">Decision</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((d) => (
              <tr key={d.id} className="transition-colors hover:bg-navy-50/60">
                <td className="whitespace-nowrap px-4 py-3">
                  <EntityBadge code={d.entity?.code} index={d.entity?.sortOrder ?? 0} />
                  {d.entity?.isSegregated && (
                    <span className="ml-1.5 text-[10px] text-subtle">separate</span>
                  )}
                </td>
                <td className="tabular whitespace-nowrap px-4 py-3 text-[12.5px] text-muted">
                  {formatDate(d.documentDate)}
                </td>
                <td className="max-w-[320px] px-4 py-3">
                  <Link
                    href={`/classify/${d.id}`}
                    className="block truncate font-mono text-[12px] text-navy-700 hover:underline"
                    title={d.finalFilename ?? d.originalFilename}
                  >
                    {d.finalFilename ?? d.originalFilename}
                  </Link>
                  {d.summaryNote && (
                    <span className="mt-0.5 block truncate text-[12px] text-subtle">
                      {d.summaryNote}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-muted">
                  {d.documentType ? (
                    <span className="inline-flex items-center gap-1.5">
                      {(() => {
                        const Icon = documentTypeIcon(d.documentType.code)
                        return <Icon className="size-3.5 text-subtle" strokeWidth={1.8} aria-hidden />
                      })()}
                      {d.documentType.label}
                    </span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="max-w-[180px] truncate px-4 py-3 text-[12.5px] text-muted">
                  {d.vendor?.name ?? <span className="text-subtle">—</span>}
                </td>
                <td className="tabular whitespace-nowrap px-4 py-3 text-right text-[13.5px] font-semibold text-navy-900">
                  {formatMoney(d.amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <DueBadge date={d.dueDate} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <DispositionBadge value={d.disposition} />
                  {d.dispositionReason && (
                    <span className="ml-1.5 text-[10px] text-subtle">
                      {d.dispositionReason.toLowerCase().replace(/_/g, ' ')}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge value={d.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {showingDeleted ? (
                    <form action={restoreDocument.bind(null, d.id)}>
                      <button className="inline-flex items-center gap-1 text-[12px] text-navy-700 transition-colors hover:underline">
                        <Undo2 className="size-3.5" aria-hidden />
                        Restore
                      </button>
                    </form>
                  ) : (
                    <form action={deleteDocument.bind(null, d.id)}>
                      <button
                        className="inline-flex items-center gap-1 text-[12px] text-subtle transition-colors hover:text-danger-700"
                        title="Remove from the log. The record and its history are kept, and this can be undone."
                        aria-label={`Remove ${d.finalFilename ?? d.originalFilename} from the log`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-20 text-center">
                  <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-navy-50 text-navy-500">
                    <Search className="size-5" strokeWidth={1.6} aria-hidden />
                  </span>
                  <span className="block text-[14.5px] font-semibold text-navy-900">
                    No documents match these filters
                  </span>
                  <span className="mt-1 block text-[13px] text-muted">
                    Clear a filter, or{' '}
                    <Link href="/upload" className="text-navy-700 underline">
                      upload a batch
                    </Link>
                    .
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-[12.5px] text-muted">
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
      className="rounded-lg border border-line bg-surface px-2.5 py-1.5 font-medium text-navy-700 transition-colors hover:border-navy-500 hover:bg-navy-50"
    >
      {label}
    </Link>
  )
}

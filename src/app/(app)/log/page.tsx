import Link from 'next/link'
import { ChevronRight, FileQuestion, Search, Trash2, Undo2 } from 'lucide-react'
import { DispositionBadge, DueBadge, EntityBadge, StatusBadge, formatDate, formatMoney } from '@/components/badges'
import { documentTypeIcon } from '@/lib/theme'
import { LogFilters } from '@/components/log-filters'
import { parseFilters } from '@/lib/filters'
import { prisma } from '@/server/db/client'
import { countByEntity, countByType, listDocuments } from '@/server/documents'
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

  /**
   * Which level of the drill-down to render.
   *
   * A search, or the removed-documents view, goes straight to the list: looking for a
   * filename makes no sense confined to one company, and a handful of removed rows is
   * not worth navigating into.
   */
  const searching = Boolean(filters.q?.trim())
  const entitySel = filters.entityIsNull ? 'none' : (filters.entityIds?.[0] ?? null)
  const typeSel = filters.typeIsNull ? 'none' : (filters.documentTypeIds?.[0] ?? null)

  const level: 1 | 2 | 3 =
    searching || showingDeleted ? 3 : entitySel && typeSel ? 3 : entitySel ? 2 : 1
  // Each level fetches only what it draws. The point of the drill-down is to stop
  // loading every document to show a screen that lists none of them.
  const byEntity = level === 1 ? await countByEntity(session.companyGroupId, filters) : null
  const byType =
    level === 2 ? await countByType(session.companyGroupId, entityIdFor(entitySel), filters) : null
  const listing = level === 3 ? await listDocuments(session.companyGroupId, filters) : null

  const [entities, types] = await Promise.all([
    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, legalName: true, sortOrder: true },
    }),
    prisma.documentType.findMany({
      where: { companyGroupId: session.companyGroupId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, label: true, code: true },
    }),
  ])

  const crumbEntity = entities.find((e) => e.id === entitySel)
  const crumbType = types.find((t) => t.id === typeSel)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-bold tracking-tight text-navy-900">
          {wholeLog ? 'Master log' : 'My documents'}
        </h1>
        <p className="text-[13px] text-muted">
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
        total={listing?.total ?? byEntity?.total ?? byType?.total ?? 0}
        level={level}
      />

      {/* Where you are, and every step back. */}
      {level > 1 && (
        <nav className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <Link href={hrefFor(sp, {})} className="text-navy-700 hover:underline">
            All companies
          </Link>
          <span className="text-subtle">/</span>
          {level === 2 ? (
            <span className="font-medium text-navy-900">
              {crumbEntity ? `${crumbEntity.code} · ${crumbEntity.legalName}` : 'No entity'}
            </span>
          ) : (
            <>
              {/* A search spans every company, so there is no entity step to show —
                  printing "No entity" there claimed the opposite of what was happening. */}
              {entitySel && (
                <>
                  <Link
                    href={hrefFor(sp, { entity: entitySel })}
                    className="text-navy-700 hover:underline"
                  >
                    {crumbEntity ? crumbEntity.code : 'No entity'}
                  </Link>
                  <span className="text-subtle">/</span>
                </>
              )}
              <span className="font-medium text-navy-900">
                {crumbType
                  ? crumbType.label
                  : showingDeleted
                    ? 'Removed'
                    : searching
                      ? 'Search results'
                      : 'Not typed yet'}
              </span>
            </>
          )}
        </nav>
      )}

      {/* ---- level 1: the companies ---------------------------------------- */}
      {level === 1 && byEntity && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {byEntity.entities.map((e) => (
            <Link
              key={e.id}
              href={hrefFor(sp, { entity: e.id })}
              className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(18,40,74,0.05)] transition-colors hover:border-navy-500 hover:bg-navy-50"
            >
              <EntityBadge code={e.code} index={e.sortOrder} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-navy-900">
                  {e.legalName}
                </span>
                <span className="text-[12.5px] text-muted">
                  {e.count} document{e.count === 1 ? '' : 's'}
                </span>
              </span>
              <ChevronRight className="size-4 flex-none text-subtle group-hover:text-navy-700" aria-hidden />
            </Link>
          ))}

          {byEntity.unassigned > 0 && (
            <Link
              href={hrefFor(sp, { entity: 'none' })}
              className="group flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 py-3.5 transition-colors hover:border-navy-500 hover:bg-navy-50"
            >
              <span className="rounded-full bg-line-soft px-2 py-0.5 text-[11px] font-medium text-muted">
                None
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-navy-900">
                  Entity not identified
                </span>
                <span className="text-[12.5px] text-muted">
                  {byEntity.unassigned} document{byEntity.unassigned === 1 ? '' : 's'}
                </span>
              </span>
              <ChevronRight className="size-4 flex-none text-subtle group-hover:text-navy-700" aria-hidden />
            </Link>
          )}

          {byEntity.entities.length === 0 && byEntity.unassigned === 0 && (
            <EmptyState label="Nothing in the log yet" />
          )}
        </div>
      )}

      {/* ---- level 2: the document types inside one company ---------------- */}
      {level === 2 && byType && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {byType.types.map((t) => {
            const Icon = documentTypeIcon(t.code)
            return (
              <Link
                key={t.id}
                href={hrefFor(sp, { entity: entitySel, type: t.id })}
                className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(18,40,74,0.05)] transition-colors hover:border-navy-500 hover:bg-navy-50"
              >
                <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-navy-50 text-navy-700">
                  <Icon className="size-4.5" strokeWidth={1.8} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-navy-900">
                    {t.label}
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {t.count} document{t.count === 1 ? '' : 's'}
                  </span>
                </span>
                <ChevronRight className="size-4 flex-none text-subtle group-hover:text-navy-700" aria-hidden />
              </Link>
            )
          })}

          {byType.untyped > 0 && (
            <Link
              href={hrefFor(sp, { entity: entitySel, type: 'none' })}
              className="group flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 py-3.5 transition-colors hover:border-navy-500 hover:bg-navy-50"
            >
              <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-line-soft text-muted">
                <FileQuestion className="size-4.5" strokeWidth={1.8} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-navy-900">Not typed yet</span>
                <span className="text-[12.5px] text-muted">
                  {byType.untyped} document{byType.untyped === 1 ? '' : 's'}
                </span>
              </span>
              <ChevronRight className="size-4 flex-none text-subtle group-hover:text-navy-700" aria-hidden />
            </Link>
          )}

          {byType.types.length === 0 && byType.untyped === 0 && (
            <EmptyState label="Nothing filed under this company" />
          )}
        </div>
      )}

      {/* ---- level 3: the documents themselves ----------------------------- */}
      {level === 3 && listing && (
        <>
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
                {listing.rows.map((d) => (
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

                {listing.rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-16 text-center">
                      <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-navy-50 text-navy-500">
                        <Search className="size-5" strokeWidth={1.6} aria-hidden />
                      </span>
                      <span className="block text-[14.5px] font-semibold text-navy-900">
                        No documents match
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

          {listing.pageCount > 1 && (
            <div className="flex items-center justify-between text-[12.5px] text-muted">
              <span>
                Page {listing.page} of {listing.pageCount}
              </span>
              <div className="flex gap-2">
                {listing.page > 1 && <PageLink sp={sp} page={listing.page - 1} label="Previous" />}
                {listing.page < listing.pageCount && (
                  <PageLink sp={sp} page={listing.page + 1} label="Next" />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="col-span-full rounded-xl border border-dashed border-line px-4 py-12 text-center text-[13px] text-muted">
      {label}
    </p>
  )
}

/**
 * A link that keeps the things that apply at every level — the search box, the
 * Main/Ops Perfection split, the decision and status filters — while replacing the two
 * that say where you are.
 */
function hrefFor(sp: URLSearchParams, at: { entity?: string | null; type?: string | null }) {
  const next = new URLSearchParams(sp)
  next.delete('entity')
  next.delete('type')
  next.delete('page')
  if (at.entity) next.set('entity', at.entity)
  if (at.type) next.set('type', at.type)
  const q = next.toString()
  return q ? `/log?${q}` : '/log'
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

/** `none` in the URL means "the ones with no entity", which as a filter is null. */
function entityIdFor(selection: string | null) {
  return selection === 'none' ? null : selection
}

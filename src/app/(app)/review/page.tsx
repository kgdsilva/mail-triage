import Link from 'next/link'
import { prisma } from '@/server/db/client'
import { countNotFiled, countUnreviewed, listForReview } from '@/server/documents'
import { requireTriage } from '@/server/session'
import { ReviewTable, type ReviewRow } from '@/components/review-table'
import { RunReader } from '@/components/run-reader'
import { AutoApplyToggle } from '@/components/auto-apply-toggle'
import { aiConfigured } from '@/server/ai/read-document'
import { autoApplyEnabled } from '@/server/ai/suggest'
import { Prisma } from '@/generated/prisma/client'

export const dynamic = 'force-dynamic'

/**
 * The batch sweep. A table rather than one card at a time, because the question here is
 * "what came in and what is it?" — which is answered faster seeing a whole entity's mail
 * at once than one document at a time.
 *
 * Classify remains the screen for filling a document in properly. This one only decides.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; entity?: string }>
}) {
  const session = await requireTriage()
  const { show, entity } = await searchParams
  const includeDecided = show === 'all'
  const notFiledOnly = show === 'notfiled'

  const [rows, entities] = await Promise.all([
    listForReview(session.companyGroupId, {
      includeDecided,
      notFiledOnly,
      entityId: entity || null,
    }),
    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, legalName: true },
    }),
  ])

  // Grouped by entity, which is how a batch is actually thought about — "what did CP
  // get this month". Documents whose entity guess failed group together at the end so
  // they are impossible to overlook.
  const byEntity = new Map<string, { entityId: string | null; code: string | null; name: string; index: number; rows: ReviewRow[] }>()
  for (const d of rows) {
    const key = d.entity?.id ?? 'none'
    if (!byEntity.has(key)) {
      byEntity.set(key, {
        entityId: d.entity?.id ?? null,
        code: d.entity?.code ?? null,
        name: d.entity?.legalName ?? 'Entity not identified',
        index: d.entity?.sortOrder ?? 0,
        rows: [],
      })
    }
    byEntity.get(key)!.rows.push(toRow(d))
  }
  const groups = [...byEntity.values()].sort((a, b) => {
    if (a.entityId === null) return 1
    if (b.entityId === null) return -1
    return a.index - b.index
  })

  // Both counts come from the same queries the nav badge uses, so the number on the tab
  // and the number over the menu can never tell different stories.
  const [pendingCount, notFiledCount] = await Promise.all([
    countUnreviewed(session.companyGroupId),
    countNotFiled(session.companyGroupId),
  ])

  const aiAvailable = aiConfigured()
  const autoApply = aiAvailable ? await autoApplyEnabled(session.companyGroupId) : false
  const unread = aiAvailable
    ? await prisma.document.count({
        where: {
          companyGroupId: session.companyGroupId,
          deletedAt: null,
          aiSuggestion: { equals: Prisma.DbNull },
          storageKey: { not: null },
        },
      })
    : 0

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[26px] font-bold tracking-tight text-navy-900">Review</h1>
        <p className="mt-1 text-[15px] text-muted">
          Everything waiting on a decision, grouped by company. Click a row to read it,
          then say what it is.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
        <span className="w-16 flex-none text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle">
          Show
        </span>
        <Tab
          href={buildHref({ entity })}
          active={!includeDecided && !notFiledOnly}
          label={`Needs a look (${pendingCount})`}
        />
        <Tab
          href={buildHref({ entity, show: 'notfiled' })}
          active={notFiledOnly}
          label={`Decided, not filed (${notFiledCount})`}
        />
        <Tab href={buildHref({ entity, show: 'all' })} active={includeDecided} label="All" />

        <span className="ml-4 w-16 flex-none text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle">
          Company
        </span>
        <Tab href={buildHref({ show })} active={!entity} label="All" />
        {entities.map((e) => (
          <Tab
            key={e.id}
            href={buildHref({ show, entity: e.id })}
            active={entity === e.id}
            label={e.code}
          />
        ))}
      </div>

      {aiAvailable && (
        <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
          <RunReader initialUnread={unread} />
          <p className="mt-1.5 text-[12px] text-subtle">
            Reading never starts on its own. Upload everything first, then run it once —
            this covers the whole backlog, so nothing is read twice or paid for twice.
          </p>
          <div className="mt-3 border-t border-line-soft pt-3">
            <AutoApplyToggle enabled={autoApply} />
          </div>
        </div>
      )}

      {notFiledOnly && (
        <p className="rounded-xl border border-line bg-gold-50 px-4 py-2.5 text-[13px] text-gold-800">
          These already have a decision but no final name or no folder, so they were never
          actually filed. Open one to finish it.
        </p>
      )}

      <ReviewTable groups={groups} showingDecided={includeDecided || notFiledOnly} />
    </div>
  )
}

function buildHref(params: { show?: string; entity?: string }) {
  const sp = new URLSearchParams()
  if (params.show) sp.set('show', params.show)
  if (params.entity) sp.set('entity', params.entity)
  const q = sp.toString()
  return q ? `/review?${q}` : '/review'
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

function toRow(d: Awaited<ReturnType<typeof listForReview>>[number]): ReviewRow {
  return {
    id: d.id,
    originalFilename: d.originalFilename,
    finalFilename: d.finalFilename,
    summaryNote: d.summaryNote,
    amount: d.amount == null ? null : String(d.amount),
    documentDate: d.documentDate ? d.documentDate.toISOString().slice(0, 10) : null,
    disposition: d.disposition,
    dispositionReason: d.dispositionReason,
    actionKind: d.actionKind,
    hasFile: Boolean(d.storageKey),
    // "Filed" means it has a final name and a home, which a quick decision never sets.
    isFiled: Boolean(d.storageFolderId && d.finalFilename),
    entityId: d.entity?.id ?? null,
    entityCode: d.entity?.code ?? null,
    entityName: d.entity?.legalName ?? null,
    entityIndex: d.entity?.sortOrder ?? 0,
    typeCode: d.documentType?.code ?? null,
    typeLabel: d.documentType?.label ?? null,
    vendorName: d.vendor?.name ?? null,
    batchLabel: d.batch?.label ?? null,
    ai: toAi(d.aiSuggestion),
  }
}

/**
 * A read that failed is stored as an error marker so it stops blocking the queue; it is
 * not a suggestion, so the row shows as unread rather than pretending to have one.
 */
function toAi(raw: unknown): ReviewRow['ai'] {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.disposition !== 'string' || typeof s.rationale !== 'string') return null
  return {
    disposition: s.disposition,
    dispositionReason: typeof s.dispositionReason === 'string' ? s.dispositionReason : null,
    rationale: s.rationale,
    confidence: typeof s.confidence === 'number' ? s.confidence : 0,
    decisionConfidence:
      typeof s.decisionConfidence === 'number' ? s.decisionConfidence : 0,
    ambiguous: s.ambiguous === true,
  }
}

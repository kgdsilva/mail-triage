import { notFound } from 'next/navigation'
import { prisma } from '@/server/db/client'
import { billHistory } from '@/server/approvals'
import { entityWhere, visibleEntityIds } from '@/server/scope'
import { canSearchArchive, requireSession } from '@/server/session'
import { BackButton } from '@/components/back'
import { formatDate, formatMoney } from '@/components/badges'
import { entityColor } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * One document's whole history, in the order it happened.
 *
 * A page rather than a panel inside each list, because every list wants it and the
 * answer is the same from all of them — and because it is a thing somebody links to in
 * an email that starts "why did we pay this?".
 *
 * Read-only by construction: `document_event` has a database trigger that refuses UPDATE
 * and DELETE, so there is no screen that could edit an entry and no administrator who
 * could. What a correction looks like here is another entry.
 */

/** What an event means, in the words somebody outside the app would use. */
const SAID: Record<string, string> = {
  uploaded: 'Received',
  imported: 'Imported from the historical log',
  classified: 'Classified',
  reclassified: 'Reclassified',
  routed: 'Handed off',
  status_changed: 'Status changed',
  'file-attached': 'Invoice attached',
  approved: 'Approved',
  denied: 'Denied',
  needs_review: 'Sent back for review',
  removed_from_log: 'Removed from the log',
  restored_to_log: 'Restored to the log',
}

const TONE: Record<string, string> = {
  approved: 'bg-ok-100 text-ok-700',
  denied: 'bg-danger-100 text-danger-700',
  needs_review: 'bg-gold-100 text-gold-800',
  uploaded: 'bg-navy-100 text-navy-900',
}

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  if (!canSearchArchive(session.role)) notFound()

  const { id } = await params
  const scope = await visibleEntityIds(session)

  const doc = await prisma.document.findFirst({
    where: {
      id,
      companyGroupId: session.companyGroupId,
      deletedAt: null,
      ...entityWhere(scope),
    },
    include: {
      entity: { select: { code: true, legalName: true, sortOrder: true } },
      vendor: { select: { name: true } },
      category: { select: { name: true } },
      documentType: { select: { label: true } },
      payments: { select: { paidOn: true, amount: true, method: true, reference: true } },
    },
  })
  if (!doc) notFound()

  const events = (await billHistory(session, id)) ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton fallbackHref="/log" label="Back" />

      <header className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          {doc.entity && (
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${entityColor(
                doc.entity.code,
                doc.entity.sortOrder,
              )}`}
            >
              {doc.entity.code}
            </span>
          )}
          <h1 className="text-[20px] font-bold tracking-tight text-navy-900">
            {doc.vendor?.name ?? doc.finalFilename ?? doc.originalFilename}
          </h1>
          {doc.amount !== null && (
            <span className="tabular ml-auto text-[20px] font-extrabold text-navy-900">
              {formatMoney(doc.amount)}
            </span>
          )}
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
          <Fact label="File">{doc.finalFilename ?? doc.originalFilename}</Fact>
          <Fact label="Invoice no.">{doc.invoiceNumber ?? '—'}</Fact>
          <Fact label="Category">{doc.category?.name ?? doc.documentType?.label ?? '—'}</Fact>
          <Fact label="Due">{doc.dueDate ? formatDate(doc.dueDate) : '—'}</Fact>
          <Fact label="Received">{formatDate(doc.createdAt)}</Fact>
          <Fact label="Approval">{doc.approvalStatus ?? '—'}</Fact>
        </dl>
      </header>

      <section>
        <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.09em] text-navy-900">
          History · {events.length}
        </h2>

        <ol className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="rounded-xl border border-line bg-surface px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${
                    TONE[e.action] ?? 'bg-line-soft text-muted'
                  }`}
                >
                  {SAID[e.action] ?? e.action}
                </span>
                <span className="text-[12.5px] font-semibold text-navy-900">
                  {e.actor?.name ?? e.actor?.email ?? 'The system'}
                </span>
                <span className="tabular ml-auto text-[12px] text-subtle">
                  {formatDate(e.createdAt)}{' '}
                  {e.createdAt.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'UTC',
                  })}
                </span>
              </div>

              {/* The note, where there is one — it is the whole content of a denial. */}
              {note(e.toValue) && (
                <p className="mt-1 text-[13px] text-ink">{note(e.toValue)}</p>
              )}
              <Details from={e.fromValue} to={e.toValue} />
            </li>
          ))}
        </ol>

        <p className="mt-3 text-[12px] text-subtle">
          History is append-only. The database refuses any attempt to change or remove an
          entry, including from an administrator — a correction is a new entry, never an
          edit.
        </p>
      </section>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  )
}

function note(value: unknown) {
  if (value && typeof value === 'object' && 'note' in value) {
    const n = (value as { note?: unknown }).note
    return typeof n === 'string' && n.trim() ? n : null
  }
  return null
}

/**
 * The raw before and after, folded away.
 *
 * Kept rather than prettified into prose for every possible key: this is the audit
 * record, and a summary that drops a field is worse than a field nobody reads.
 */
function Details({ from, to }: { from: unknown; to: unknown }) {
  const lines = [
    from ? `before: ${JSON.stringify(from)}` : null,
    to ? `after: ${JSON.stringify(to)}` : null,
  ].filter(Boolean) as string[]

  if (lines.length === 0) return null

  return (
    <details className="mt-1">
      <summary className="text-[11.5px] font-semibold text-muted">What changed</summary>
      <pre className="mt-1 overflow-x-auto rounded bg-canvas p-2 text-[11px] leading-relaxed text-muted">
        {lines.join('\n')}
      </pre>
    </details>
  )
}

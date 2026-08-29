'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Ban, Check, CircleDot, FileText, Pencil, Wallet } from 'lucide-react'
import { decideQuickly, refineArchiveReason } from '@/server/actions/documents'
import { EntityBadge, formatDate, formatMoney } from '@/components/badges'
import { documentTypeIcon } from '@/lib/theme'

export type ReviewRow = {
  id: string
  originalFilename: string
  finalFilename: string | null
  summaryNote: string | null
  amount: string | null
  documentDate: string | null
  disposition: 'UNREVIEWED' | 'ARCHIVE' | 'ACTION'
  dispositionReason: string | null
  actionKind: string | null
  hasFile: boolean
  isFiled: boolean
  entityId: string | null
  entityCode: string | null
  entityName: string | null
  entityIndex: number
  typeCode: string | null
  typeLabel: string | null
  vendorName: string | null
  batchLabel: string | null
}

const ARCHIVE_REASONS = [
  { value: 'FYI_STATEMENT', label: 'No action needed' },
  { value: 'AUTOPAY', label: 'On autopay' },
  { value: 'INCOMING_CHECK', label: 'Incoming check' },
  { value: 'SPAM_SOLICITATION', label: 'Spam' },
  { value: 'OTHER', label: 'Other' },
]

/**
 * The batch sweep: every undecided document in one table, grouped by entity, with the
 * PDF alongside so a decision never means leaving the screen.
 *
 * The three buttons answer "what is this?" and nothing else — they do not file the
 * document. A decided row therefore still says whether it has been filed, so a fast
 * pass through here cannot be mistaken for finished work.
 */
export function ReviewTable({
  groups,
  showingDecided,
}: {
  groups: { entityId: string | null; code: string | null; name: string; index: number; rows: ReviewRow[] }[]
  showingDecided: boolean
}) {
  const all = groups.flatMap((g) => g.rows)
  const [selectedId, setSelectedId] = useState<string | null>(all[0]?.id ?? null)
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const selected = all.find((r) => r.id === selectedId) ?? null

  function decide(row: ReviewRow, decision: 'PAY' | 'ARCHIVE' | 'SPAM') {
    setBusyId(row.id)
    startTransition(async () => {
      await decideQuickly(row.id, decision)
      setBusyId(null)
      // Move to the next still-undecided row so a sweep keeps its rhythm.
      const idx = all.findIndex((r) => r.id === row.id)
      const next = all.slice(idx + 1).find((r) => r.disposition === 'UNREVIEWED')
      if (next) setSelectedId(next.id)
    })
  }

  if (all.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-16 text-center">
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-ok-100 text-ok-700">
          <Check className="size-6" strokeWidth={1.8} aria-hidden />
        </span>
        <h3 className="text-[14.5px] font-semibold text-navy-900">Nothing left to look at</h3>
        <p className="mt-1 text-[13px] text-muted">
          {showingDecided
            ? 'No documents match this view.'
            : 'Every document has a decision. Switch to “All” to see what was decided.'}
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.entityId ?? 'none'}>
            <div className="mb-2 flex items-center gap-2">
              {group.code ? (
                <EntityBadge code={group.code} index={group.index} />
              ) : (
                <span className="rounded-full bg-line-soft px-2 py-0.5 text-[11px] font-medium text-muted">
                  No entity
                </span>
              )}
              <h2 className="text-[13px] font-semibold text-navy-900">{group.name}</h2>
              <span className="text-[12px] text-subtle">{group.rows.length}</span>
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line-soft">
                  {group.rows.map((row) => {
                    const Icon = documentTypeIcon(row.typeCode)
                    const active = row.id === selectedId
                    const busy = busyId === row.id && pending

                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedId(row.id)}
                        className={`cursor-pointer align-top transition-colors ${
                          active ? 'bg-navy-50' : 'hover:bg-navy-50/60'
                        } ${busy ? 'opacity-50' : ''}`}
                      >
                        <td className="w-1 p-0">
                          <span
                            className={`block h-full w-1 ${active ? 'bg-navy-700' : 'bg-transparent'}`}
                            aria-hidden
                          />
                        </td>

                        <td className="px-3 py-3">
                          <div className="flex items-start gap-2.5">
                            <Icon
                              className="mt-0.5 size-4 flex-none text-subtle"
                              strokeWidth={1.8}
                              aria-hidden
                            />
                            <div className="min-w-0">
                              <p className="truncate font-mono text-[12px] text-navy-700">
                                {row.finalFilename ?? row.originalFilename}
                              </p>
                              <p className="mt-0.5 truncate text-[12px] text-subtle">
                                {[row.vendorName, row.typeLabel, formatDate(parseDate(row.documentDate))]
                                  .filter(Boolean)
                                  .join(' · ') || row.batchLabel}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="tabular whitespace-nowrap px-3 py-3 text-right text-[13.5px] font-semibold text-navy-900">
                          {row.amount ? formatMoney({ toString: () => row.amount! }) : ''}
                        </td>

                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <QuickButton
                              label="Needs paying"
                              short="Pay"
                              icon={Wallet}
                              active={row.disposition === 'ACTION'}
                              onClick={() => decide(row, 'PAY')}
                              disabled={busy}
                              tone="navy"
                            />
                            <QuickButton
                              label="No payment needed"
                              short="Archive"
                              icon={FileText}
                              active={
                                row.disposition === 'ARCHIVE' &&
                                row.dispositionReason !== 'SPAM_SOLICITATION'
                              }
                              onClick={() => decide(row, 'ARCHIVE')}
                              disabled={busy}
                              tone="neutral"
                            />
                            <QuickButton
                              label="Solicitation disguised as a notice"
                              short="Spam"
                              icon={Ban}
                              active={row.dispositionReason === 'SPAM_SOLICITATION'}
                              onClick={() => decide(row, 'SPAM')}
                              disabled={busy}
                              tone="danger"
                            />
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
                            <ReviewMark row={row} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {/* Same viewer as the classify screen, same permission-scoped route. */}
      <div className="sticky top-6 h-[calc(100vh-140px)] min-h-[520px] overflow-hidden rounded-xl border border-line bg-line-soft">
        {selected?.hasFile ? (
          <iframe
            key={selected.id}
            src={`/api/files/${selected.id}#view=FitH`}
            title={selected.originalFilename}
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
            {selected ? 'No file attached to this record.' : 'Select a row to preview the document.'}
          </div>
        )}
      </div>
    </div>
  )
}

/** Says whether a document was decided, and whether it has actually been filed yet. */
function ReviewMark({ row }: { row: ReviewRow }) {
  if (row.disposition === 'UNREVIEWED') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
        <CircleDot className="size-3" aria-hidden />
        Not looked at yet
      </span>
    )
  }

  return (
    <>
      <span className="inline-flex items-center gap-1 rounded-full bg-ok-100 px-2 py-0.5 text-[11px] font-medium text-ok-700">
        <Check className="size-3" aria-hidden />
        Reviewed
      </span>

      {row.disposition === 'ARCHIVE' && (
        <form action={refineArchiveReason.bind(null, row.id)}>
          <select
            name="reason"
            defaultValue={row.dispositionReason ?? 'FYI_STATEMENT'}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="rounded-lg border border-line bg-surface px-1.5 py-0.5 text-[11px] text-muted outline-none focus:border-navy-500"
            aria-label="Why this was archived"
          >
            {ARCHIVE_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </form>
      )}

      {!row.isFiled && (
        <Link
          href={`/classify/${row.id}`}
          className="inline-flex items-center gap-1 text-[11px] text-gold-800 underline underline-offset-2"
          title="Decided, but no filename or folder yet"
        >
          <Pencil className="size-3" aria-hidden />
          Not filed
        </Link>
      )}
    </>
  )
}

function QuickButton({
  label,
  short,
  icon: Icon,
  active,
  onClick,
  disabled,
  tone,
}: {
  label: string
  short: string
  icon: typeof Wallet
  active: boolean
  onClick: () => void
  disabled: boolean
  tone: 'navy' | 'neutral' | 'danger'
}) {
  const activeTone = {
    navy: 'border-navy-700 bg-navy-700 text-white',
    neutral: 'border-navy-500 bg-navy-100 text-navy-900',
    danger: 'border-danger-700 bg-danger-100 text-danger-700',
  }[tone]

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
        active ? activeTone : 'border-line text-muted hover:border-navy-500 hover:bg-navy-50'
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
      {short}
    </button>
  )
}

function parseDate(iso: string | null) {
  return iso ? new Date(`${iso}T00:00:00Z`) : null
}

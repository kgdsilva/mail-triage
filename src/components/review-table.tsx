'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Ban, Check, CircleDot, FileText, Pencil, Sparkles, Wallet } from 'lucide-react'
import { decideQuickly, refineArchiveReason } from '@/server/actions/documents'
import { resolveEntity } from '@/server/actions/ai'
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
  /** What the reader proposed, when this document has been read. */
  ai: {
    disposition: string
    dispositionReason: string | null
    rationale: string
    confidence: number
    decisionConfidence: number
    ambiguous: boolean
    /** What the row must ask for before any of the three answers makes sense. */
    needs: 'entity' | null
  } | null
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
  entities,
}: {
  groups: { entityId: string | null; code: string | null; name: string; index: number; rows: ReviewRow[] }[]
  showingDecided: boolean
  /** Offered on rows where the reader could not tell whose document it is. */
  entities: { id: string; code: string; legalName: string }[]
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
      {/* One list, not one card per company. The company is a heading inside it — four
          bordered boxes chopped a short batch into pieces that read as separate screens. */}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
        {/* Fixed layout so a long line of reasoning cannot widen a column and push the
            buttons off the screen — the document column absorbs the slack. */}
        <table className="w-full table-fixed text-sm">
          {/* Widths declared here, not on the cells: with table-fixed the browser takes
              them from the first row, and that row is now a group heading spanning all
              four columns. */}
          <colgroup>
            <col className="w-1" />
            <col />
            <col className="w-28" />
            <col className="w-72" />
          </colgroup>
          {groups.map((group) => (
            <tbody key={group.entityId ?? 'none'} className="divide-y divide-line-soft">
              <tr>
                <td colSpan={4} className="border-t border-line bg-canvas/60 px-3 py-1.5 first:border-t-0">
                  <span className="flex items-baseline gap-2">
                    {group.code ? (
                      <EntityBadge code={group.code} index={group.index} />
                    ) : (
                      <span className="rounded-full bg-line-soft px-2 py-0.5 text-[11px] font-medium text-muted">
                        No entity
                      </span>
                    )}
                    <span className="text-[12.5px] font-semibold text-navy-900">{group.name}</span>
                    <span className="text-[11.5px] text-subtle">{group.rows.length}</span>
                  </span>
                </td>
              </tr>
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

                        <td className="px-3 py-2.5">
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
                              <ReasonLine row={row} />
                            </div>
                          </div>
                        </td>

                        <td className="tabular w-24 whitespace-nowrap px-2 py-2.5 text-right align-top text-[13.5px] font-semibold text-navy-900">
                          {row.amount ? formatMoney({ toString: () => row.amount! }) : ''}
                        </td>

                        <td className="w-72 px-3 py-2.5 align-top">
                          {row.ai?.needs === 'entity' ? (
                            <EntityResolver row={row} entities={entities} disabled={busy} />
                          ) : (
                          <div className="flex flex-nowrap items-center justify-end gap-1.5">
                            <QuickButton
                              label="Needs paying"
                              short="Pay"
                              icon={Wallet}
                              active={row.disposition === 'ACTION'}
                              proposed={proposedButton(row) === 'PAY'}
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
                              proposed={proposedButton(row) === 'ARCHIVE'}
                              onClick={() => decide(row, 'ARCHIVE')}
                              disabled={busy}
                              tone="neutral"
                            />
                            <QuickButton
                              label="Solicitation disguised as a notice"
                              short="Spam"
                              icon={Ban}
                              active={row.dispositionReason === 'SPAM_SOLICITATION'}
                              proposed={proposedButton(row) === 'SPAM'}
                              onClick={() => decide(row, 'SPAM')}
                              disabled={busy}
                              tone="danger"
                            />
                          </div>
                          )}

                          {row.ai?.needs !== 'entity' && (
                            <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
                              <StatusMarks row={row} />
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          ))}
        </table>
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

/**
 * What the reader concluded, under the document it is about.
 *
 * It lives here rather than beside the buttons because a sentence is not a control, and
 * because a table cell holding both a paragraph and three buttons stretches its column
 * until the buttons are pushed off the screen. Two lines, then it stops.
 */
function ReasonLine({ row }: { row: ReviewRow }) {
  if (row.disposition !== 'UNREVIEWED' || !row.ai) return null
  // Only when there is a question. On a clean read the highlighted button already says
  // what the reader thinks, and repeating it on every row is what made the screen busy.
  if (!row.ai.ambiguous) return null

  return (
    <p
      className="mt-1 line-clamp-2 rounded bg-gold-100 px-1.5 py-0.5 text-[11.5px] leading-relaxed text-gold-800"
      title={row.ai.rationale}
    >
      <Sparkles className="mr-1 inline size-3 -translate-y-px" aria-hidden />
      {row.ai.rationale}
    </p>
  )
}

/** The short marks that belong next to the buttons: read, decided, filed. */
function StatusMarks({ row }: { row: ReviewRow }) {
  if (row.disposition === 'UNREVIEWED') {
    if (!row.ai) {
      return (
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-subtle">
          <CircleDot className="size-3" aria-hidden />
          Not read yet
        </span>
      )
    }
    return (
      <span className="whitespace-nowrap text-[11px] text-subtle">
        {row.ai.ambiguous ? 'needs you' : `${Math.round(row.ai.decisionConfidence * 100)}%`}
      </span>
    )
  }

  return (
    <>
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-ok-100 px-2 py-0.5 text-[11px] font-medium text-ok-700">
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
          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-gold-800 underline underline-offset-2"
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
  proposed,
  onClick,
  disabled,
  tone,
}: {
  label: string
  short: string
  icon: typeof Wallet
  active: boolean
  /** The reader's proposal, on a row no human has decided yet. */
  proposed?: boolean
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
        active
          ? activeTone
          : proposed
            ? 'border-gold-500 bg-gold-50 text-gold-800'
            : 'border-line text-muted hover:border-navy-500 hover:bg-navy-50'
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

/**
 * Which quick button the reader proposed, if any.
 *
 * Nothing is proposed for a row the reader flagged. This screen offers three answers —
 * pay, archive, spam — and an escalated document is precisely one the reader could not
 * place among them. Mapping every action item onto "Pay" made a received cheque and a
 * personal insurance renewal both read as bills to pay, which is how a display detail
 * became a wrong recommendation.
 */
function proposedButton(row: ReviewRow): 'PAY' | 'ARCHIVE' | 'SPAM' | null {
  if (row.disposition !== 'UNREVIEWED' || !row.ai) return null
  if (row.ai.ambiguous) return null
  if (row.ai.dispositionReason === 'SPAM_SOLICITATION') return 'SPAM'
  if (row.ai.disposition === 'ARCHIVE') return 'ARCHIVE'
  // Only an action the filing rules could name a reason for. Without one there is no
  // basis for choosing between paying it and merely looking at it.
  if (row.ai.disposition === 'ACTION' && row.ai.dispositionReason) return 'PAY'
  return null
}

/**
 * The control that answers the reader's actual question.
 *
 * When it cannot tell whose document this is, naming the company is the only useful
 * next move — pay, archive and spam all presuppose the answer. Choosing one re-reads
 * the document with the gap closed, so the row returns with a real proposal rather than
 * leaving a second guess to make.
 */
function EntityResolver({
  row,
  entities,
  disabled,
}: {
  row: ReviewRow
  entities: { id: string; code: string; legalName: string }[]
  disabled: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="text-[11px] text-subtle">Whose is this?</span>
      <select
        defaultValue=""
        disabled={disabled || pending}
        onChange={(e) => {
          const value = e.target.value
          if (!value) return
          setError(null)
          startTransition(async () => {
            const res = await resolveEntity(row.id, value)
            if (!res.ok) setError(res.error ?? 'Could not save that.')
          })
        }}
        className="w-full rounded-lg border border-gold-500 bg-surface px-2 py-1.5 text-[12px] text-navy-900 outline-none focus:border-navy-500 disabled:opacity-50"
        aria-label="Which company this document belongs to"
      >
        <option value="">Choose a company…</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.code} · {e.legalName}
          </option>
        ))}
        <option value="NOT_OURS">Not company mail — archive it</option>
      </select>
      {error && <span className="text-[11px] text-danger-700">{error}</span>}
    </div>
  )
}

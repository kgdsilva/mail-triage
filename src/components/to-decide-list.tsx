'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Ban, Check, FileText, History, Share2 } from 'lucide-react'
import {
  markNeedsOtherAction,
  markNeedsPayment,
  markNotABill,
} from '@/server/actions/to-decide'
import { EntityBadge, formatMoney } from '@/components/badges'
import { PdfFrame } from '@/components/pdf-peek'
import { DUE_TONE, describeDue } from '@/lib/due'
import { BTN } from '@/lib/theme'

/**
 * "Is this a bill, and does it have to be paid?" — answered one document at a time.
 *
 * Three buttons, because there are three answers, and the screen says which is which
 * rather than making the reader infer it from a disposition name. Two of the three ask a
 * follow-up before they commit: a refusal needs a reason and a handoff needs a person,
 * and both are the part somebody reads back later.
 */

export type DecideRow = {
  id: string
  title: string
  vendorName: string | null
  amount: string | null
  /** ISO date or null — the deadline this is sorted by. */
  dueDate: string | null
  receivedDate: string
  entityCode: string | null
  companyName: string | null
  entityIndex: number
  typeLabel: string | null
  categoryName: string | null
  summary: string | null
  hasFile: boolean
  /** Set when somebody handed it over rather than the reader routing it. */
  handedBy: string | null
  handNote: string | null
}

const WHY = [
  { key: 'statement', label: 'Statement or FYI' },
  { key: 'spam', label: 'Solicitation' },
  { key: 'check', label: 'Cheque received' },
  { key: 'not-ours', label: 'Not company mail' },
  { key: 'other', label: 'Other' },
]

export function ToDecideList({
  rows,
  people,
}: {
  rows: DecideRow[]
  /** Who a document can be handed to. */
  people: { id: string; name: string }[]
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface/60 px-6 py-14 text-center">
        <h3 className="text-[15px] font-bold text-navy-900">Nothing waiting on a decision.</h3>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
          Bills and notices appear here as they are read, soonest deadline first.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <Row key={row.id} row={row} people={people} />
      ))}
    </ul>
  )
}

function Row({ row, people }: { row: DecideRow; people: { id: string; name: string }[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [asking, setAsking] = useState<'why' | 'who' | null>(null)
  const [note, setNote] = useState('')
  const [who, setWho] = useState(people[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const due = describeDue(row.dueDate)

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'That did not work.')
      else {
        setAsking(null)
        router.refresh()
      }
    })
  }

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {row.entityCode && (
              <EntityBadge code={row.entityCode} index={row.entityIndex} />
            )}
            <span className="text-[14px] font-bold text-navy-900">
              {row.vendorName ?? row.title}
            </span>
            {row.typeLabel && (
              <span className="rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                {row.typeLabel}
              </span>
            )}
          </div>

          {row.summary && (
            <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">{row.summary}</p>
          )}

          {/* Who handed it over, which is the first thing you want to know. */}
          {row.handedBy && (
            <p className="mt-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-[12.5px] text-navy-900">
              <span className="font-semibold">{row.handedBy} passed this to you</span>
              {row.handNote ? `: ${row.handNote}` : '.'}
            </p>
          )}
        </div>

        <div className="flex flex-none flex-col items-end gap-1">
          <span className="text-[15px] font-bold tabular-nums text-navy-900">
            {row.amount ? formatMoney(row.amount) : '—'}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11.5px] ${DUE_TONE[due.tone]}`}
            title={due.exact || undefined}
          >
            {due.text}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
        <button
          type="button"
          className={BTN.done}
          disabled={pending}
          onClick={() => act(() => markNeedsPayment(row.id))}
        >
          <Check className="size-3.5" aria-hidden />
          Needs payment
        </button>
        <button
          type="button"
          className={BTN.secondary}
          onClick={() => setAsking((v) => (v === 'why' ? null : 'why'))}
        >
          <Ban className="size-3.5" aria-hidden />
          Not a bill
        </button>
        <button
          type="button"
          className={BTN.secondary}
          onClick={() => setAsking((v) => (v === 'who' ? null : 'who'))}
        >
          <Share2 className="size-3.5" aria-hidden />
          Needs other action
        </button>

        {row.hasFile && (
          <button type="button" className={`${BTN.quiet} ml-auto`} onClick={() => setOpen((v) => !v)}>
            <FileText className="size-3.5" aria-hidden />
            {open ? 'Hide' : 'Preview'}
          </button>
        )}
        <Link href={`/history/${row.id}`} className={row.hasFile ? BTN.quiet : `${BTN.quiet} ml-auto`}>
          <History className="size-3.5" aria-hidden />
          History
        </Link>
      </div>

      {asking === 'why' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft bg-canvas px-3 py-2.5">
          <span className="text-[12px] font-semibold text-muted">Why is it not a bill?</span>
          {WHY.map((w) => (
            <button
              key={w.key}
              type="button"
              disabled={pending}
              className={BTN.quiet}
              onClick={() => act(() => markNotABill(row.id, w.key))}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}

      {asking === 'who' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft bg-canvas px-3 py-2.5">
          <select
            value={who}
            onChange={(e) => setWho(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px]"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What do they need to do?"
            className="min-w-48 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px]"
          />
          <button
            type="button"
            className={BTN.primary}
            disabled={pending || !who || note.trim().length < 3}
            onClick={() => act(() => markNeedsOtherAction(row.id, who, note))}
          >
            {pending ? 'Sending…' : 'Hand it over'}
          </button>
        </div>
      )}

      {error && (
        <p className="border-t border-line-soft bg-danger-100 px-3 py-2 text-[12.5px] text-danger-700">
          {error}
        </p>
      )}

      {open && row.hasFile && (
        <div className="border-t border-line-soft p-3">
          <PdfFrame id={row.id} title={row.vendorName ?? row.title} hasFile={row.hasFile} />
        </div>
      )}
    </li>
  )
}

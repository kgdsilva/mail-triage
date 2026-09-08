'use client'

import { useState } from 'react'
import { ArrowRightLeft, Check } from 'lucide-react'
import { handOffDocument, resolveDocument } from '@/server/actions/documents'
import { DueBadge } from '@/components/badges'
import { PdfFrame, PeekToggle } from '@/components/pdf-peek'
import {
  ACTION_KINDS,
  BTN,
  CARD,
  documentTypeIcon,
  documentTypeTone,
  entityAccent,
  entityColor,
} from '@/lib/theme'

export type CardDoc = {
  id: string
  title: string
  summaryNote: string | null
  amount: string | null
  dueDate: string | null
  actionKind: string | null
  entityCode: string | null
  entityIndex: number
  typeCode: string | null
  vendorName: string | null
  typeLabel: string | null
  /** A historical row can exist before its PDF is attached; an iframe would 404. */
  hasFile: boolean
}

/**
 * One item in someone's queue, with the two things they actually do with it: finish it,
 * or hand it to whoever does the next step. Money sits large on the right because it is
 * what the person paying is looking for.
 *
 * The company is the card's loudest signal — a coloured edge and a tag — because that
 * is the first question anyone asks of a piece of mail. What it wants from you is a
 * quiet pill beside it rather than a section heading: one person's queue mixes paying,
 * confirming and reading, and splitting it into three lists made a short queue look
 * like three chores.
 */
export function DocumentCard({
  doc,
  people,
}: {
  doc: CardDoc
  people: { id: string; label: string }[]
}) {
  const [handingOff, setHandingOff] = useState(false)
  const [open, setOpen] = useState(false)
  const Icon = documentTypeIcon(doc.typeCode)
  const ask = doc.actionKind ? ACTION_KINDS[doc.actionKind as keyof typeof ACTION_KINDS] : null

  return (
    <div className={`${CARD} relative overflow-hidden p-4 pl-5`}>
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${doc.entityCode ? entityAccent(doc.entityCode, doc.entityIndex) : 'bg-line'}`}
        aria-hidden
      />

      <div className="flex gap-3.5">
        <span
          className={`grid size-10 flex-none place-items-center rounded-[10px] ${documentTypeTone(doc.typeCode)}`}
          aria-hidden
        >
          <Icon className="size-5" strokeWidth={1.9} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {doc.entityCode && (
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider ${entityColor(doc.entityCode, doc.entityIndex)}`}
              >
                {doc.entityCode}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="truncate text-left text-[15px] font-bold text-navy-900 hover:underline"
            >
              {doc.vendorName ?? doc.title}
            </button>
            {ask && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2 py-0.5 text-[11px] font-semibold ${ask.tone}`}
              >
                <span className={`size-1.5 rounded-full ${ask.dot}`} aria-hidden />
                {ask.label}
              </span>
            )}
            {doc.typeLabel && (
              <span className="text-[12.5px] font-medium text-subtle">{doc.typeLabel}</span>
            )}
          </div>

          {doc.summaryNote && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{doc.summaryNote}</p>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <form action={resolveDocument.bind(null, doc.id)}>
              <button className={BTN.done}>
                <Check className="size-3.5" aria-hidden />
                Mark done
              </button>
            </form>
            <button type="button" onClick={() => setHandingOff((v) => !v)} className={BTN.secondary}>
              <ArrowRightLeft className="size-3.5" aria-hidden />
              {handingOff ? 'Cancel' : 'Hand off'}
            </button>
          </div>
        </div>

        <div className="flex flex-none items-start gap-2">
          <div className="flex flex-col items-end gap-1.5 text-right">
            {doc.amount && (
              <span className="display tabular text-[22px] font-extrabold tracking-tight text-navy-900">
                ${doc.amount}
              </span>
            )}
            {/* No due date is simply absent here — a dash would dangle under the amount. */}
            {doc.dueDate && <DueBadge date={doc.dueDate} />}
          </div>

          <PeekToggle open={open} onToggle={() => setOpen((v) => !v)} />
        </div>
      </div>

      {open && (
        <div className="mt-3.5 border-t border-line-soft pt-3.5">
          <PdfFrame id={doc.id} title={doc.title} hasFile={doc.hasFile} />
        </div>
      )}

      {handingOff && (
        <form
          action={handOffDocument.bind(null, doc.id)}
          className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3.5"
        >
          <span className="text-[12.5px] text-muted">To</span>
          <select name="toUserId" required className={SELECT}>
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-[12.5px] text-muted">to</span>
          <select name="actionKind" defaultValue="PAY" className={SELECT}>
            <option value="PAY">pay</option>
            <option value="CONFIRM">confirm</option>
            <option value="REVIEW">review</option>
          </select>
          <input
            name="note"
            placeholder="Note (optional)"
            className="min-w-32 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] outline-none transition-colors placeholder:text-subtle focus:border-navy-500"
          />
          <button className={BTN.secondary}>Send</button>
        </form>
      )}
    </div>
  )
}

const SELECT =
  'rounded-lg border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none transition-colors focus:border-navy-500'

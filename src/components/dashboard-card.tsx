'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRightLeft, Check, ExternalLink } from 'lucide-react'
import { handOffDocument, resolveDocument } from '@/server/actions/documents'
import { DueBadge } from '@/components/badges'
import { BTN, CARD, documentTypeIcon, documentTypeTone, entityColor } from '@/lib/theme'

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
}

/**
 * One item in someone's queue, with the two things they actually do with it: finish it,
 * or hand it to whoever does the next step. Money sits large on the right because it is
 * what the person paying is looking for.
 */
export function DocumentCard({
  doc,
  people,
}: {
  doc: CardDoc
  people: { id: string; label: string }[]
}) {
  const [handingOff, setHandingOff] = useState(false)
  const Icon = documentTypeIcon(doc.typeCode)

  return (
    <div className={`${CARD} p-4`}>
      <div className="flex gap-3.5">
        <span
          className={`grid size-10 flex-none place-items-center rounded-[10px] ${documentTypeTone(doc.typeCode)}`}
          aria-hidden
        >
          <Icon className="size-5" strokeWidth={1.8} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {doc.entityCode && (
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider ${entityColor(doc.entityIndex)}`}
              >
                {doc.entityCode}
              </span>
            )}
            <Link
              href={`/classify/${doc.id}`}
              className="truncate text-[14.5px] font-semibold text-navy-900 hover:underline"
            >
              {doc.vendorName ?? doc.title}
            </Link>
            {doc.typeLabel && <span className="text-[12.5px] text-subtle">{doc.typeLabel}</span>}
          </div>

          {doc.summaryNote && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{doc.summaryNote}</p>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <form action={resolveDocument.bind(null, doc.id)}>
              <button className={BTN.primary}>
                <Check className="size-3.5" aria-hidden />
                Mark done
              </button>
            </form>
            <button type="button" onClick={() => setHandingOff((v) => !v)} className={BTN.secondary}>
              <ArrowRightLeft className="size-3.5" aria-hidden />
              {handingOff ? 'Cancel' : 'Hand off'}
            </button>
            <Link href={`/classify/${doc.id}`} className={BTN.ghost}>
              <ExternalLink className="size-3.5" aria-hidden />
              Open
            </Link>
          </div>
        </div>

        <div className="flex flex-none flex-col items-end gap-1.5 text-right">
          {doc.amount && (
            <span className="tabular text-[21px] font-semibold tracking-tight text-navy-900">
              ${doc.amount}
            </span>
          )}
          {/* No due date is simply absent here — a dash would dangle under the amount. */}
          {doc.dueDate && <DueBadge date={doc.dueDate} />}
        </div>
      </div>

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

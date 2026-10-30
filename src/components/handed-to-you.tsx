'use client'

import { useState, useTransition } from 'react'
import { HelpCircle, Loader2 } from 'lucide-react'
import { answerHandover } from '@/server/actions/to-decide'

/**
 * Documents somebody handed to this person, and the box to answer them in.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the bills board
 * ---------------------------------------------------------------------------
 *
 * The approvals board is built around money running late: three buckets, overdue first,
 * each row leading with an amount. What arrives here is a notice nobody could place — no
 * amount, often no due date, and nothing late about it. Putting those through a board
 * that sorts by overdueness would file every one of them under "later" and lead each row
 * with a blank where the money goes.
 *
 * So this is a plain list, and the question is the first thing on the row, because the
 * question is the reason the row exists.
 */

export type Handover = {
  id: string
  title: string
  companyCode: string | null
  question: string | null
  receivedDate: string
}

export function HandedToYou({ items }: { items: Handover[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <p className="text-[14px] font-bold text-navy-900">Nothing waiting on your answer</p>
        <p className="mt-1 text-[12.5px] text-muted">
          When somebody hands you a document with a question, it appears here.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <HandoverRow key={item.id} item={item} />
      ))}
    </ul>
  )
}

function HandoverRow({ item }: { item: Handover }) {
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const send = () => {
    setError(null)
    start(async () => {
      const result = await answerHandover(item.id, answer)
      if (!result.ok) setError(result.error ?? 'That did not save.')
      else setAnswer('')
    })
  }

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 size-4 flex-none text-amber-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-navy-900">
            {item.question?.trim() || 'No question was written down.'}
          </p>
          <p className="mt-1 truncate text-[12px] text-muted">
            {item.companyCode ? `${item.companyCode} · ` : ''}
            {item.title}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={2}
          placeholder="Your answer — it stays on the document for whoever asked."
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] text-navy-900 placeholder:text-subtle focus:border-navy-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !answer.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-700 px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-navy-900 disabled:opacity-40"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Answer
        </button>
      </div>

      {error && <p className="mt-2 text-[12px] font-semibold text-red-700">{error}</p>}
    </li>
  )
}

'use client'

import Link from 'next/link'
import { useState } from 'react'
import { handOffDocument, resolveDocument } from '@/server/actions/documents'

export type CardDoc = {
  id: string
  title: string
  summaryNote: string | null
  amount: string | null
  dueDate: string | null
  actionKind: string | null
  entityCode: string | null
  vendorName: string | null
  typeLabel: string | null
}

/**
 * One item in someone's queue, with the two things they actually do with it: finish it,
 * or hand it to whoever does the next step. The handoff is what makes "confirm, then
 * someone else pays" work without the document sitting in two queues at once.
 */
export function DocumentCard({
  doc,
  people,
}: {
  doc: CardDoc
  people: { id: string; label: string }[]
}) {
  const [handingOff, setHandingOff] = useState(false)

  const overdue =
    doc.dueDate !== null && doc.dueDate < new Date().toISOString().slice(0, 10)

  return (
    <div className="rounded border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {doc.entityCode && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold dark:bg-neutral-800">
            {doc.entityCode}
          </span>
        )}
        <Link href={`/classify/${doc.id}`} className="text-sm font-medium hover:underline">
          {doc.vendorName ?? doc.title}
        </Link>
        {doc.typeLabel && <span className="text-xs text-neutral-500">{doc.typeLabel}</span>}

        <span className="ml-auto flex items-baseline gap-3">
          {doc.amount && <span className="text-sm tabular-nums">${doc.amount}</span>}
          {doc.dueDate && (
            <span
              className={`text-xs tabular-nums ${
                overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-neutral-500'
              }`}
            >
              {overdue ? 'overdue ' : 'due '}
              {doc.dueDate}
            </span>
          )}
        </span>
      </div>

      {doc.summaryNote && (
        <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-400">{doc.summaryNote}</p>
      )}

      <div className="mt-2.5 flex items-center gap-3 text-xs">
        <form action={resolveDocument.bind(null, doc.id)}>
          <button className="rounded bg-neutral-900 px-2.5 py-1 text-white dark:bg-neutral-100 dark:text-neutral-900">
            Mark done
          </button>
        </form>

        <button
          type="button"
          onClick={() => setHandingOff((v) => !v)}
          className="text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          {handingOff ? 'Cancel' : 'Hand off'}
        </button>

        <Link
          href={`/classify/${doc.id}`}
          className="text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Open
        </Link>
      </div>

      {handingOff && (
        <form
          action={handOffDocument.bind(null, doc.id)}
          className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-neutral-100 pt-2.5 dark:border-neutral-800"
        >
          <span className="text-xs text-neutral-500">To</span>
          <select name="toUserId" required className={selectClass}>
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-neutral-500">to</span>
          <select name="actionKind" defaultValue="PAY" className={selectClass}>
            <option value="PAY">pay</option>
            <option value="CONFIRM">confirm</option>
            <option value="REVIEW">review</option>
          </select>
          <input
            name="note"
            placeholder="Note (optional)"
            className="min-w-[8rem] flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
          />
          <button className="rounded border border-neutral-300 px-2.5 py-1 text-xs dark:border-neutral-700">
            Send
          </button>
        </form>
      )}
    </div>
  )
}

const selectClass =
  'rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-xs outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'

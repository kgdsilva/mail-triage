'use client'

import { useState, useTransition } from 'react'
import { setDocumentCategory } from '@/server/actions/category'

/**
 * The category, editable where it is read.
 *
 * A select rather than a link to a form, because the job this exists for is a backlog:
 * filter the log to Legal, see the ten that are not legal, fix them without leaving the
 * row. Opening a document to change one field is the difference between a job somebody
 * does and a job nobody does.
 *
 * It saves on change. There is one field and no draft worth keeping, and a category
 * sitting changed-but-unsaved in a list of ninety rows is worse than either state.
 */
export function CategoryCell({
  documentId,
  categoryId,
  categories,
}: {
  documentId: string
  categoryId: string | null
  categories: { id: string; name: string }[]
}) {
  const [value, setValue] = useState(categoryId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function change(next: string) {
    const previous = value
    setValue(next)
    setError(null)
    start(async () => {
      const res = await setDocumentCategory(documentId, next || null)
      if (!res.ok) {
        setValue(previous)
        setError(res.error)
      }
    })
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label="Spend category"
        onClick={(e) => e.stopPropagation()}
        className={`max-w-[160px] rounded-lg border px-1.5 py-1 text-[12px] outline-none focus:border-navy-500 ${
          value
            ? 'border-line bg-surface text-navy-900'
            : 'border-dashed border-line bg-transparent text-subtle'
        }`}
      >
        {/* "None" is an answer, not an empty field: a cheque received has no spend to
            categorise, and if that cannot be said the only way to say it is wrongly. */}
        <option value="">— none —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {pending && <span className="text-[10.5px] text-subtle">saving…</span>}
      {error && <span className="max-w-[160px] text-[10.5px] text-danger-700">{error}</span>}
    </span>
  )
}

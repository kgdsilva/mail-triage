'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'

type Option = { id: string; label: string }

/**
 * Filter state lives in the URL rather than component state, so any view can be
 * bookmarked or shared, and the CSV export can reuse the same query string verbatim.
 */
export function LogFilters({
  entities,
  types,
  total,
}: {
  entities: Option[]
  types: Option[]
  total: number
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState(sp.get('q') ?? '')

  function apply(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(sp)
    mutate(next)
    next.delete('page')
    startTransition(() => router.push(`/log?${next.toString()}`))
  }

  const selected = (key: string) =>
    new Set(sp.getAll(key).flatMap((v) => v.split(',')).filter(Boolean))

  function toggle(key: string, value: string) {
    apply((next) => {
      const set = selected(key)
      if (set.has(value)) set.delete(value)
      else set.add(value)
      next.delete(key)
      if (set.size) next.set(key, [...set].join(','))
    })
  }

  const view = sp.get('view') ?? 'main'
  const activeCount =
    selected('entity').size +
    selected('type').size +
    selected('status').size +
    selected('disposition').size +
    (sp.get('q') ? 1 : 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            apply((next) => (q ? next.set('q', q) : next.delete('q')))
          }}
          className="flex-1 min-w-[240px]"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search filenames, notes, vendors…"
            className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-300"
          />
        </form>

        {/* Segregated entities sit in their own tab. A display split, never a permission —
            "All" is always available to everyone. */}
        <div className="flex rounded border border-neutral-300 text-xs dark:border-neutral-700">
          {(['main', 'segregated', 'all'] as const).map((v) => (
            <button
              key={v}
              onClick={() => apply((next) => next.set('view', v))}
              className={`px-2.5 py-1.5 capitalize ${
                view === v
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-600 dark:text-neutral-300'
              }`}
            >
              {v === 'main' ? 'Main' : v === 'segregated' ? 'Ops Perfection' : 'All'}
            </button>
          ))}
        </div>

        <a
          href={`/api/export?${sp.toString()}`}
          className="rounded border border-neutral-300 px-2.5 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Export CSV
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <FilterGroup label="Entity" options={entities} selected={selected('entity')} onToggle={(v) => toggle('entity', v)} />
        <FilterGroup label="Type" options={types} selected={selected('type')} onToggle={(v) => toggle('type', v)} />
        <FilterGroup
          label="Decision"
          options={[
            { id: 'UNREVIEWED', label: 'Unreviewed' },
            { id: 'ACTION', label: 'Action' },
            { id: 'ARCHIVE', label: 'Archived' },
          ]}
          selected={selected('disposition')}
          onToggle={(v) => toggle('disposition', v)}
        />
        <FilterGroup
          label="Status"
          options={[
            { id: 'WAITING', label: 'Waiting' },
            { id: 'IN_PROGRESS', label: 'In progress' },
            { id: 'DONE', label: 'Done' },
          ]}
          selected={selected('status')}
          onToggle={(v) => toggle('status', v)}
        />

        {activeCount > 0 && (
          <button
            onClick={() => startTransition(() => router.push('/log'))}
            className="ml-1 text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Clear {activeCount}
          </button>
        )}

        <span className="ml-auto text-neutral-500">
          {pending
            ? 'Filtering…'
            : `${total.toLocaleString()} document${total === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  )
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: Option[]
  selected: Set<string>
  onToggle: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-neutral-500">{label}:</span>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onToggle(o.id)}
          className={`rounded border px-1.5 py-0.5 ${
            selected.has(o.id)
              ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
              : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

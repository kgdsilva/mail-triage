'use client'

import { Search } from 'lucide-react'
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
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search filenames, notes, vendors…"
              className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-subtle focus:border-navy-500"
            />
          </div>
        </form>

        {/* Segregated entities sit in their own tab. A display split, never a permission —
            "All" is always available to everyone. */}
        <div className="flex overflow-hidden rounded-lg border border-line bg-surface text-[13px]">
          {(['main', 'segregated', 'all'] as const).map((v) => (
            <button
              key={v}
              onClick={() => apply((next) => next.set('view', v))}
              className={`px-3 py-2 font-medium transition-colors ${
                view === v ? 'bg-navy-700 text-white' : 'text-muted hover:bg-navy-50'
              }`}
            >
              {v === 'main' ? 'Main' : v === 'segregated' ? 'Ops Perfection' : 'All'}
            </button>
          ))}
        </div>

        <a
          href={`/api/export?${sp.toString()}`}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-navy-700 transition-colors hover:border-navy-500 hover:bg-navy-50"
        >
          Export CSV
        </a>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-xs shadow-[0_1px_2px_rgba(18,40,74,0.05)]">
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

        <div className="mt-0.5 flex items-center gap-3 border-t border-line-soft pt-2.5">
          {activeCount > 0 && (
            <button
              onClick={() => startTransition(() => router.push('/log'))}
              className="font-medium text-navy-700 underline underline-offset-2"
            >
              Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
            </button>
          )}
          <span className="ml-auto tabular text-muted">
            {pending
              ? 'Filtering…'
              : `${total.toLocaleString()} document${total === 1 ? '' : 's'}`}
          </span>
        </div>
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 flex-none text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onToggle(o.id)}
          className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
            selected.has(o.id)
              ? 'border-navy-700 bg-navy-700 text-white'
              : 'border-line text-muted hover:border-navy-500 hover:bg-navy-50 hover:text-navy-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

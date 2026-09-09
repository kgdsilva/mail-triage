'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Whose items you are looking at.
 *
 * Three tabs rather than a dropdown, and each one carries its own count. The counts are
 * the whole reason this exists: "mine 4 · everyone 23" is the sentence a private queue
 * could never say, and it is what stops four items feeling like the whole picture.
 *
 * "Nobody yet" is a tab of its own because an action item routed to no one is the one
 * that goes missing on a shared board — everybody can see it, so everybody assumes
 * somebody else has it.
 */
export function BoardFilters({
  scope,
  counts,
  people,
  person,
  entity,
}: {
  scope: 'mine' | 'everyone' | 'unassigned'
  counts: { mine: number; everyone: number; unassigned: number }
  people: { id: string; label: string }[]
  person: string | null
  entity: string | null
}) {
  const router = useRouter()
  const params = useSearchParams()

  /** Keeps the company filter and drops the person filter when leaving "everyone". */
  function href(next: 'mine' | 'everyone' | 'unassigned') {
    const q = new URLSearchParams()
    if (next !== 'mine') q.set('who', next)
    if (entity) q.set('entity', entity)
    if (next === 'everyone' && person) q.set('person', person)
    const s = q.toString()
    return s ? `/?${s}` : '/'
  }

  function setPerson(value: string) {
    const q = new URLSearchParams(params.toString())
    q.set('who', 'everyone')
    if (value) q.set('person', value)
    else q.delete('person')
    router.push(`/?${q.toString()}`)
  }

  const tabs = [
    { key: 'mine' as const, label: 'Mine', count: counts.mine },
    { key: 'everyone' as const, label: 'Everyone', count: counts.everyone },
    { key: 'unassigned' as const, label: 'Nobody yet', count: counts.unassigned },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
        {tabs.map((tab) => {
          const active = scope === tab.key
          return (
            <Link
              key={tab.key}
              href={href(tab.key)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                active
                  ? 'bg-navy-700 text-white'
                  : 'text-muted hover:bg-navy-50 hover:text-navy-700 active:bg-navy-100'
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 text-[11px] font-bold tabular ${
                  active
                    ? 'bg-white/20 text-white'
                    : tab.key === 'unassigned' && tab.count > 0
                      ? 'bg-gold-100 text-gold-800'
                      : 'bg-line-soft text-muted'
                }`}
              >
                {tab.count}
              </span>
            </Link>
          )
        })}
      </div>

      {/* Only meaningful once you are looking at everybody's. */}
      {scope === 'everyone' && people.length > 1 && (
        <label className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-muted">Whose</span>
          <select
            value={person ?? ''}
            onChange={(e) => setPerson(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none transition-colors focus:border-navy-500"
          >
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Building2 } from 'lucide-react'
import { entityColor } from '@/lib/theme'

export type PickerEntity = { id: string; code: string; legalName: string; sortOrder: number }

/**
 * Filter a screen to one company.
 *
 * A dropdown rather than a row of tabs: five entities fit as tabs, and the next company
 * group onboarded may have fifteen. Every other query parameter survives the change, so
 * picking a company does not silently clear a search or reset a page.
 */
export function CompanyPicker({
  entities,
  value,
  label = 'Company',
}: {
  entities: PickerEntity[]
  value: string | null
  label?: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const selected = entities.find((e) => e.id === value)

  function choose(next: string) {
    const sp = new URLSearchParams(params)
    if (next) sp.set('entity', next)
    else sp.delete('entity')
    sp.delete('page')
    const q = sp.toString()
    startTransition(() => router.push(q ? `?${q}` : '?'))
  }

  return (
    <div className="flex items-center gap-2">
      <Building2 className="size-4 flex-none text-navy-500" aria-hidden />
      <label className="text-[11px] font-bold uppercase tracking-[0.07em] text-subtle">
        {label}
      </label>
      <select
        value={value ?? ''}
        onChange={(e) => choose(e.target.value)}
        aria-busy={pending}
        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] font-semibold text-navy-900 outline-none transition-colors focus:border-navy-500"
      >
        <option value="">All companies</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.code} — {e.legalName}
          </option>
        ))}
      </select>
      {/* The dropdown cannot carry the company's colour, so the tag beside it does. */}
      {selected && (
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider ${entityColor(selected.code, selected.sortOrder)}`}
        >
          {selected.code}
        </span>
      )}
    </div>
  )
}

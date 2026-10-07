'use client'

import { useState, useTransition } from 'react'
import { Building2 } from 'lucide-react'
import { setMemberEntityScope } from '@/server/actions/settings'

/**
 * Which companies this member approves for, or can see at all.
 *
 * Checkboxes rather than a multi-select, because the list is five long and the question
 * is answered by reading it. Saves on change: there is no draft state worth keeping, and
 * a scope sitting changed-but-unsaved is a permission nobody can reason about.
 *
 * "None ticked" is called out rather than left to look deliberate — for an approver it
 * means they will open the app to an empty screen, which is almost never what was meant.
 */
export function MemberEntities({
  membershipId,
  role,
  entities,
  selected,
}: {
  membershipId: string
  role: string
  entities: { id: string; code: string; legalName: string; isSegregated: boolean }[]
  selected: string[]
}) {
  const [chosen, setChosen] = useState<string[]>(selected)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Administrators see everything by definition; a scope on them would be a setting that
  // does nothing, which is worse than no setting.
  if (role === 'OWNER' || role === 'ADMIN') {
    return (
      <p className="text-[12px] text-subtle">
        Sees every company, including the separate ones. That is what the role is.
      </p>
    )
  }

  if (role === 'UPLOADER') {
    return (
      <p className="text-[12px] text-subtle">
        Uploads only, so there is nothing to scope — a scanner never opens a document.
      </p>
    )
  }

  function toggle(id: string) {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]
    setChosen(next)
    setError(null)
    startTransition(async () => {
      try {
        await setMemberEntityScope(membershipId, next)
      } catch (err) {
        setChosen(chosen)
        setError(err instanceof Error ? err.message : 'Could not save that.')
      }
    })
  }

  const assignable = entities.filter((e) => !e.isSegregated)

  return (
    <div>
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
        <Building2 className="size-3.5" aria-hidden />
        Companies {role === 'APPROVER' ? 'they approve' : 'they can see'}
        {pending && <span className="font-normal text-subtle">saving…</span>}
      </p>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {assignable.map((e) => {
          const on = chosen.includes(e.id)
          return (
            <label
              key={e.id}
              title={e.legalName}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                on
                  ? 'border-navy-500 bg-navy-100 text-navy-900'
                  : 'border-line bg-surface text-muted hover:border-navy-500'
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(e.id)}
                className="size-3.5 accent-navy-700"
              />
              {e.code}
            </label>
          )
        })}
      </div>

      {chosen.length === 0 ? (
        <p className="mt-1.5 text-[11.5px] font-semibold text-gold-800">
          {role === 'APPROVER'
            ? 'No companies assigned — this approver will see an empty list.'
            : 'No companies ticked, so this member can see every company except the separate ones.'}
        </p>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-subtle">
          {chosen.length} of {assignable.length}. The separate companies are never
          assignable — only administrators see those.
        </p>
      )}

      {error && <p className="mt-1 text-[12px] text-danger-700">{error}</p>}
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck } from 'lucide-react'
import { setAutoApply } from '@/server/actions/settings'

/**
 * Hands the reader the authority to file its own decisions.
 *
 * Off until someone turns it on, on purpose. Even on, it only acts where nothing was in
 * doubt; anything flagged still waits for a person, and everything it decides is
 * recorded and reversible.
 */
export function AutoApplyToggle({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled)
  const [pending, startTransition] = useTransition()

  return (
    <label
      className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted"
      title="Only where the entity and type are known, the filing rules named a reason, and nothing was flagged. Everything else still comes to you, and anything decided this way shows in All and can be changed."
    >
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked
          setOn(next)
          startTransition(async () => {
            await setAutoApply(next).catch(() => setOn(!next))
          })
        }}
      />
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <ShieldCheck className="size-3.5 text-navy-500" aria-hidden />
        File the clear ones automatically
      </span>
    </label>
  )
}

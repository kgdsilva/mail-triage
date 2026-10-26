'use client'

import { useState, useTransition } from 'react'
import { Sparkles, Wand2 } from 'lucide-react'
import { previewPlacements, runPlacements } from '@/server/actions/categorise-free'
import { BTN } from '@/lib/theme'

/**
 * Place what is already known, for nothing, before paying to read anything.
 *
 * This sits above the re-read button on purpose. The first pass cost about twelve
 * dollars and put nearly everything in "Other"; being offered a second paid pass right
 * after that is a reasonable thing to resent. More than half of it can be answered from
 * the filenames and vendor names already stored — `PADeptRevenue`, `TexasWorkforce`,
 * `CBE group` — and the free answer should be the one on top.
 */
export function PlacementPanel({
  initial,
}: {
  initial: { considered: number; placed: number; leftToRead: number; byCategory: [string, number][] }
}) {
  const [state, setState] = useState(initial)
  const [done, setDone] = useState<{ placed: number; leftToRead: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (state.considered === 0 && done === null) return null

  function apply() {
    setError(null)
    start(async () => {
      try {
        const res = await runPlacements()
        setDone({ placed: res.placed, leftToRead: res.leftToRead })
        setState(await previewPlacements())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That did not run.')
      }
    })
  }

  return (
    <div className="rounded-xl border border-ok-500 bg-ok-100 p-4">
      <h3 className="flex items-center gap-2 text-[14px] font-bold text-navy-900">
        <Wand2 className="size-4 text-ok-700" aria-hidden />
        Place what we already know — free
      </h3>

      {done ? (
        <p className="mt-1 text-[12.5px] text-navy-900">
          <span className="font-semibold">{done.placed} filed from what was already stored.</span>{' '}
          No document was read and nothing was spent.
          {done.leftToRead > 0
            ? ` ${done.leftToRead} could not be placed this way — those are the ones worth reading.`
            : ' Nothing is left to read.'}
        </p>
      ) : (
        <p className="mt-1 text-[12.5px] text-muted">
          The sender is usually in the filename: <span className="font-mono text-[11.5px]">PADeptRevenue</span>,{' '}
          <span className="font-mono text-[11.5px]">TexasWorkforce</span>,{' '}
          <span className="font-mono text-[11.5px]">CBE group</span>. Those were produced by a
          read that has already been paid for, so matching them costs nothing.{' '}
          <span className="font-semibold text-navy-900">
            {state.placed} of {state.considered}
          </span>{' '}
          can be filed this way, leaving {state.leftToRead} that genuinely need reading.
        </p>
      )}

      {state.byCategory.length > 0 && done === null && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {state.byCategory.map(([name, n]) => (
            <li
              key={name}
              className="rounded-full border border-ok-500 bg-surface px-2 py-0.5 text-[11.5px] font-semibold text-navy-900"
            >
              {name} <span className="font-normal text-muted">{n}</span>
            </li>
          ))}
        </ul>
      )}

      {state.placed > 0 && (
        <button type="button" className={`${BTN.primary} mt-3`} disabled={pending} onClick={apply}>
          <Sparkles className="size-3.5" aria-hidden />
          {pending ? 'Filing…' : `File ${state.placed} for free`}
        </button>
      )}

      <p className="mt-1.5 text-[11.5px] text-subtle">
        A rule only fires on an unmistakable sender and abstains otherwise. Each one records
        the pattern that matched, so a rule that gets something wrong can be found and undone
        by its pattern rather than one document at a time.
      </p>

      {error && <p className="mt-2 text-[12.5px] text-danger-700">{error}</p>}
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { Eraser, Wrench } from 'lucide-react'
import { previewRepairs, runRepairs } from '@/server/actions/categorise-free'
import { BTN } from '@/lib/theme'

/**
 * Undoing what the first pass got wrong, where the evidence says so.
 *
 * Separate from the free placement above because it is a different claim. That one fills
 * a blank; this one contradicts an answer already on screen — so it shows exactly which
 * answers, and what each would become, before anything moves. A tool that silently
 * rewrites existing categories is one nobody should press.
 */
export function RepairPanel({
  initial,
}: {
  initial: {
    toClear: number
    toMove: number
    byMove: [string, number][]
    examples: { was: string; to: string; filename: string }[]
  }
}) {
  const [state, setState] = useState(initial)
  const [done, setDone] = useState<{ cleared: number; moved: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (state.toClear === 0 && state.toMove === 0 && done === null) return null

  function apply() {
    setError(null)
    start(async () => {
      try {
        const res = await runRepairs()
        setDone({ cleared: res.cleared, moved: res.moved })
        setState(await previewRepairs())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That did not run.')
      }
    })
  }

  return (
    <div className="rounded-xl border border-gold-500 bg-gold-50 p-4">
      <h3 className="flex items-center gap-2 text-[14px] font-bold text-navy-900">
        <Wrench className="size-4 text-gold-800" aria-hidden />
        Fix what the first pass mislabelled — free
      </h3>

      {done ? (
        <p className="mt-1 text-[12.5px] text-navy-900">
          <span className="font-semibold">
            {done.cleared} cheques had their category removed and {done.moved} were corrected.
          </span>{' '}
          Nothing was read and nothing was spent.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] text-muted">
            The first pass had seven categories and official mail to file, and when none
            fitted it reached for the nearest word rather than for Other — an IRS notice
            under Utilities, Puerto Rico&rsquo;s labour department under Legal. Those are
            wrong answers wearing a right answer&rsquo;s clothes, which re-reading
            &ldquo;Other&rdquo; would never have found.
          </p>

          {state.toClear > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-navy-900">
              <Eraser className="mt-0.5 size-3.5 shrink-0 text-gold-800" aria-hidden />
              <span>
                <span className="font-semibold">{state.toClear} cheques</span> carry a spend
                category from that pass. A cheque received is money arriving, so the category
                comes off — it is making every total on this screen wrong.
              </span>
            </p>
          )}

          {state.byMove.length > 0 && (
            <>
              <p className="mt-2 text-[12.5px] font-semibold text-navy-900">
                {state.toMove} where the sender in the filename says otherwise:
              </p>
              <ul className="mt-1 space-y-0.5">
                {state.byMove.map(([move, n]) => (
                  <li key={move} className="text-[12px] text-muted">
                    <span className="tabular font-semibold text-navy-900">{n}</span> {move}
                  </li>
                ))}
              </ul>
              {state.examples.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 border-t border-gold-500/40 pt-1.5">
                  {state.examples.map((e) => (
                    <li key={e.filename} className="truncate font-mono text-[11px] text-subtle">
                      {e.filename} — {e.was} → {e.to}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {(state.toClear > 0 || state.toMove > 0) && (
        <button type="button" className={`${BTN.primary} mt-3`} disabled={pending} onClick={apply}>
          <Wrench className="size-3.5" aria-hidden />
          {pending ? 'Fixing…' : `Fix ${state.toClear + state.toMove}`}
        </button>
      )}

      <p className="mt-1.5 text-[11.5px] text-subtle">
        Only where a rule disagrees. The ones no rule can judge keep what they have — not
        because it is right, but because nothing here knows better, and replacing an
        unexamined answer with a guess is not an improvement. Every change records what it
        was and which pattern moved it.
      </p>

      {error && <p className="mt-2 text-[12.5px] text-danger-700">{error}</p>}
    </div>
  )
}

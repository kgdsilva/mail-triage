'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { FlaskConical, Play, Square } from 'lucide-react'
import { finishEvalRun, runEvalSlice, startEvalRun } from '@/server/actions/eval'
import { BTN } from '@/lib/theme'

/**
 * Starts and drives an evaluation run.
 *
 * The loop is here rather than on the server for the same reason the reader button's is:
 * a serverless function is killed after a few minutes and each document takes seconds.
 * Each pass asks for a few documents and reports what is left, so progress is visible,
 * interruptible, and resumable — stopping and clicking continue picks up exactly where
 * it was, because a slice is defined as "not yet recorded for this run".
 *
 * Every run spends money, so nothing starts without the figure on screen and a second
 * click. The full set stays disabled until a pilot has read something: there is no point
 * spending two dollars to find out the reader cannot reach the files.
 */
export function EvalRunner({
  pilotSize,
  fullSize,
  pilotEstimate,
  fullEstimate,
  pilotUnlocked,
  resumable,
}: {
  pilotSize: number
  fullSize: number
  pilotEstimate: string
  fullEstimate: string
  pilotUnlocked: boolean
  /** A run left part way, offered for continuing. */
  resumable: { id: string; label: string; done: number; total: number } | null
}) {
  const router = useRouter()
  const [asking, setAsking] = useState<'pilot' | 'full' | null>(null)
  const [running, setRunning] = useState(false)
  const [label, setLabel] = useState('')
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  // A ref, not state: the loop must see a stop that arrives mid-run, and state captured
  // when the loop started would never change under it.
  const stopRequested = useRef(false)

  async function drive(runId: string, expected: number, alreadyDone: number) {
    setRunning(true)
    setError(null)
    setTotal(expected)
    setDone(alreadyDone)
    setFailed(0)
    stopRequested.current = false
    setStopping(false)

    let processed = alreadyDone
    let failures = 0

    try {
      for (;;) {
        const res = await runEvalSlice(runId, 4)
        processed += res.processed + res.failed
        failures += res.failed
        setDone(processed)
        setFailed(failures)

        if (res.remaining === 0) break
        // Nothing moved and nothing failed: it is not draining, so stop rather than spin.
        if (res.processed === 0 && res.failed === 0) {
          setError(res.lastError ?? 'The run stopped making progress.')
          break
        }
        if (stopRequested.current) {
          await finishEvalRun(runId)
          break
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The run failed.')
    } finally {
      setRunning(false)
      setStopping(false)
      setAsking(null)
      router.refresh()
    }
  }

  async function start(scope: 'pilot' | 'full') {
    try {
      const { runId, total: expected } = await startEvalRun(scope, label)
      await drive(runId, expected, 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the run.')
      setAsking(null)
      setRunning(false)
    }
  }

  if (running) {
    const pct = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100))
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-navy-900">
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-navy-100 border-t-navy-700"
              aria-hidden
            />
            Reading… {done} of {total}
          </span>
          <span className="h-1.5 w-40 overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-navy-700 transition-all" style={{ width: `${pct}%` }} />
          </span>
          <button
            type="button"
            onClick={() => {
              stopRequested.current = true
              setStopping(true)
            }}
            disabled={stopping}
            className={BTN.secondary}
          >
            <Square className="size-3" aria-hidden />
            {stopping ? 'Finishing this batch…' : 'Stop'}
          </button>
          {failed > 0 && (
            <span className="text-[12.5px] font-semibold text-danger-700">
              {failed} could not be read
            </span>
          )}
        </div>
        <p className="mt-2 text-[12px] text-subtle">
          Safe to leave. Nothing is written to any document — only to the evaluation
          tables — and stopping keeps what has been read.
        </p>
        {error && <p className="mt-2 text-[12.5px] text-danger-700">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      {resumable && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gold-500 bg-gold-50 px-3 py-2.5">
          <span className="min-w-0 flex-1 text-[13px] text-navy-900">
            <span className="font-semibold">{resumable.label}</span> stopped at{' '}
            {resumable.done} of {resumable.total}.
          </span>
          <button
            type="button"
            className={BTN.primary}
            onClick={() => drive(resumable.id, resumable.total, resumable.done)}
          >
            <Play className="size-3.5" aria-hidden />
            Continue
          </button>
        </div>
      )}

      {asking === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN.primary} onClick={() => setAsking('pilot')}>
            <FlaskConical className="size-3.5" aria-hidden />
            Pilot of {pilotSize}
          </button>
          <button
            type="button"
            className={BTN.secondary}
            disabled={!pilotUnlocked}
            title={
              pilotUnlocked
                ? undefined
                : 'Run the pilot first — ten documents cost cents and prove the reader can reach the files.'
            }
            onClick={() => setAsking('full')}
          >
            <Play className="size-3.5" aria-hidden />
            Full set of {fullSize}
          </button>
          {!pilotUnlocked && (
            <span className="text-[12px] text-subtle">
              The full set unlocks once a pilot has read something.
            </span>
          )}
        </div>
      ) : (
        /*
         * The confirmation. The number is the point of it — a run cannot be measured
         * without spending, so the figure goes on screen before the second click and
         * never after.
         */
        <div className="space-y-3 rounded-lg border border-navy-500 bg-navy-50 p-3.5">
          <p className="text-[13.5px] font-bold text-navy-900">
            {asking === 'pilot'
              ? `Read ${pilotSize} documents — about ${pilotEstimate}`
              : `Read ${fullSize} documents — about ${fullEstimate}`}
          </p>
          <p className="text-[12.5px] text-muted">
            One model call per document, at Sonnet prices, estimated from a one-page scan —
            multi-page documents cost more. Nothing is written to any document.
          </p>
          <label className="block text-[12.5px] font-semibold text-navy-900">
            Label this run
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                asking === 'pilot' ? 'Pilot of 10' : 'Baseline, before the entity matcher'
              }
              className="mt-1 w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px] font-normal"
            />
            <span className="mt-1 block text-[11.5px] font-normal text-subtle">
              How you will tell this run from the next one, after something changes.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN.primary} onClick={() => start(asking)}>
              Start and spend {asking === 'pilot' ? pilotEstimate : fullEstimate}
            </button>
            <button type="button" className={BTN.secondary} onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[12.5px] text-danger-700">{error}</p>}
    </div>
  )
}

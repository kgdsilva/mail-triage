'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { RotateCcw, Sparkles, Square } from 'lucide-react'
import { analyzeUnread, retryUnreadable } from '@/server/actions/ai'
import { BTN } from '@/lib/theme'

/**
 * Reads every document that has not been read yet, on demand.
 *
 * The only way reading ever starts. Uploading used to trigger it per file, which spent
 * money the moment a file landed and gave no way to drop a hundred scans in and decide
 * afterwards. Now the whole backlog waits here until somebody asks for it.
 *
 * The loop lives here rather than on the server because a serverless function is killed
 * after a few minutes and a read takes several seconds. Each call takes a small slice
 * and reports what is left, so an import of hundreds gets through in many short requests
 * instead of one that times out — and progress stays visible and interruptible.
 */
export function RunReader({
  initialUnread,
  unreadable = 0,
  enabledHint = false,
}: {
  initialUnread: number
  /** Documents the reader has tried three times and given up on. */
  unreadable?: number
  /** Suppresses the "turn it on" nudge when it already is. */
  enabledHint?: boolean
}) {
  const router = useRouter()
  const [remaining, setRemaining] = useState(initialUnread)
  const [done, setDone] = useState(0)
  const [applied, setApplied] = useState(0)
  const [escalated, setEscalated] = useState(0)
  const [failed, setFailed] = useState(0)
  const [finished, setFinished] = useState(false)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A ref, not state: the loop has to see a stop request that arrives mid-run, and
  // state captured when the loop started would never change under it.
  const stopRequested = useRef(false)
  const [resetting, setResetting] = useState(false)

  /*
   * Re-sync the count when the server sends a new one.
   *
   * `remaining` has to be local because it changes many times during a run, between
   * renders the server knows nothing about. But seeding it from a prop once meant the
   * button kept the old number after anything else moved it — putting three documents
   * back with "Try again" left the button still offering two. Adjusting during render
   * rather than in an effect, which is what React recommends for exactly this.
   */
  const [syncedFrom, setSyncedFrom] = useState(initialUnread)
  if (syncedFrom !== initialUnread && !running) {
    setSyncedFrom(initialUnread)
    setRemaining(initialUnread)
  }

  const total = initialUnread

  async function retry() {
    setResetting(true)
    setError(null)
    try {
      await retryUnreadable()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset those documents.')
    } finally {
      setResetting(false)
    }
  }

  async function run() {
    setRunning(true)
    setStopping(false)
    setError(null)
    let processedHere = 0
    let appliedHere = 0
    let escalatedHere = 0
    let failedHere = 0
    setFinished(false)

    stopRequested.current = false

    try {
      for (;;) {
        const res = await analyzeUnread(4)
        processedHere += res.processed
        appliedHere += res.applied
        escalatedHere += res.escalated
        failedHere += res.failed
        setDone(processedHere)
        setApplied(appliedHere)
        setEscalated(escalatedHere)
        setFailed(failedHere)
        setRemaining(res.remaining)

        if (res.lastError && res.processed === 0) {
          setError(res.lastError)
          break
        }
        if (res.remaining === 0) break
        // Nothing moved and nothing failed: the queue is not draining, so stop rather
        // than spin.
        if (res.processed === 0 && res.failed === 0) break
        if (stopRequested.current) break
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reading failed.')
    } finally {
      setRunning(false)
      setStopping(false)
      setFinished(processedHere > 0 || failedHere > 0)
      router.refresh()
    }
  }

  if (total === 0 && done === 0) {
    return (
      <span className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
          <Sparkles className="size-3.5 text-navy-500" aria-hidden />
          Everything uploaded has been read.
        </span>
        <Unreadable count={unreadable} onRetry={retry} busy={resetting} />
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {!running ? (
        <button onClick={run} className={BTN.primary} disabled={remaining === 0}>
          <Sparkles className="size-3.5" aria-hidden />
          {remaining === 0
            ? 'All read'
            : `Read ${remaining} document${remaining === 1 ? '' : 's'} with AI`}
        </button>
      ) : (
        <>
          <span className="inline-flex items-center gap-2 text-[13px] text-navy-900">
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-navy-100 border-t-navy-700"
              aria-hidden
            />
            Reading… {done} of {total}
          </span>
          <button
            type="button"
            onClick={() => {
              stopRequested.current = true
              setStopping(true)
            }}
            className={BTN.secondary}
            disabled={stopping}
          >
            <Square className="size-3" aria-hidden />
            {stopping ? 'Finishing this batch…' : 'Stop'}
          </button>
        </>
      )}

      {total > 0 && running && (
        <span className="h-1.5 w-32 overflow-hidden rounded-full bg-line">
          <span
            className="block h-full bg-navy-700 transition-all"
            style={{ width: `${Math.min(100, Math.round(((done + failed) / total) * 100))}%` }}
          />
        </span>
      )}

      {finished && !running && (
        <span className="text-[12.5px] text-navy-900">
          Read {done} document{done === 1 ? '' : 's'}:{' '}
          {applied > 0 && (
            <>
              <strong className="font-semibold">{applied} decided automatically</strong>
              {' — visible in “All”, and reversible.'}{' '}
            </>
          )}
          {escalated > 0 && (
            <strong className="font-semibold text-gold-800">
              {escalated} need{escalated === 1 ? 's' : ''} your review.
            </strong>
          )}
          {applied === 0 && escalated > 0 && !enabledHint && (
            <span className="block text-[12px] text-subtle">
              Nothing was decided on its own — the switch on the right turns that on.
            </span>
          )}
        </span>
      )}

      {failed > 0 && (
        <span className="text-[12.5px] font-semibold text-danger-700">
          {failed} could not be read
        </span>
      )}
      {!running && <Unreadable count={unreadable} onRetry={retry} busy={resetting} />}
      {error && <span className="text-[12.5px] text-danger-700">{error}</span>}
    </div>
  )
}

/**
 * The documents the reader gave up on, and the way to put them back.
 *
 * These used to vanish: a failure was recorded as if it were an answer, so nothing
 * counted them and no screen mentioned them. Saying the number out loud is most of the
 * fix — the button is for the case where the failures were an outage rather than the
 * files.
 */
function Unreadable({
  count,
  onRetry,
  busy,
}: {
  count: number
  onRetry: () => void
  busy: boolean
}) {
  if (count === 0) return null

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-danger-100 py-1 pl-3 pr-1 text-[12px] font-semibold text-danger-700">
      {count} could not be read
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-semibold text-danger-700 transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        <RotateCcw className="size-3" aria-hidden />
        {busy ? 'Resetting…' : 'Try again'}
      </button>
    </span>
  )
}

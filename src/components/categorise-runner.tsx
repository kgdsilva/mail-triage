'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { Square, Tags } from 'lucide-react'
import { categoriseSlice } from '@/server/actions/categorise'
import { BTN } from '@/lib/theme'

/**
 * Fills in the categories by reading the documents, a few at a time.
 *
 * The loop is here rather than on the server for the usual reason: a read takes seconds
 * and a serverless function is killed after minutes. Stopping is immediate and losing
 * nothing — a slice is "has a file, has no category, not looked at yet", so whatever has
 * been written stays written and the next run continues from there.
 *
 * It costs money, so the figure is on screen before the first click and never after.
 */
export function CategoriseRunner({
  remaining,
  filled,
  noFile,
  estimate,
  mode = 'fill',
}: {
  remaining: number
  filled: number
  /** Documents with no file at all — nothing this can do for them. */
  noFile: number
  estimate: string
  /**
   * The second pass, over what the old list could not place.
   *
   * Same machinery, different queue and different words. The words matter: somebody who
   * has already paid for one pass needs to read why they are being asked to pay again,
   * on the screen, before the button — not be shown an identical panel that quietly
   * costs money a second time.
   */
  mode?: 'fill' | 'reread'
}) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [done, setDone] = useState(0)
  const [gotOne, setGotOne] = useState(0)
  const [none, setNone] = useState(0)
  const [failed, setFailed] = useState(0)
  const [spent, setSpent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const stop = useRef(false)

  const total = remaining

  async function run() {
    setRunning(true)
    setAsking(false)
    setError(null)
    stop.current = false
    setStopping(false)

    let seen = 0
    let hit = 0
    let miss = 0
    let bad = 0
    let input = 0
    let output = 0

    try {
      for (;;) {
        const res = await categoriseSlice(4, mode)
        seen += res.processed
        hit += res.filled
        miss += res.unmatched
        bad += res.failed
        input += res.inputTokens
        output += res.outputTokens
        setDone(seen)
        setGotOne(hit)
        setNone(miss)
        setFailed(bad)
        setSpent(input * (2 / 1_000_000) + output * (10 / 1_000_000))

        if (res.halted) {
          setError(
            `${res.lastError ?? 'Reading stopped.'} Nothing was held against these documents — press Read again once it is fixed.`,
          )
          break
        }
        if (res.remaining === 0) break
        /*
         * Nothing read in a whole slice: stop.
         *
         * A file that cannot be fetched counts as a failure rather than a halt — it may
         * be readable tomorrow, so it is deliberately left in the queue instead of being
         * retired. But that means a storage outage produces slice after slice of pure
         * failure with the remaining count never moving, and the loop would spin on it
         * forever. Four failures and no reads is not progress.
         */
        if (res.processed === 0) {
          setError(
            res.lastError
              ? `${res.lastError} — nothing in that batch could be read, so the run stopped. The documents are still in the queue.`
              : 'Nothing in that batch could be read, so the run stopped.',
          )
          break
        }
        if (stop.current) break
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The run failed.')
    } finally {
      setRunning(false)
      setStopping(false)
      router.refresh()
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
              stop.current = true
              setStopping(true)
            }}
            disabled={stopping}
            className={BTN.secondary}
          >
            <Square className="size-3" aria-hidden />
            {stopping ? 'Finishing this batch…' : 'Stop'}
          </button>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">
          {gotOne} categorised · {none} fitted none of the categories · {failed} could not be read ·
          about ${spent.toFixed(2)} so far
        </p>
        <p className="mt-1 text-[12px] text-subtle">
          Safe to leave or stop. Only the category is written — never the type, the decision or
          the assignee.
        </p>
        {error && <p className="mt-2 text-[12.5px] text-danger-700">{error}</p>}
      </div>
    )
  }

  if (remaining === 0) {
    if (mode === 'reread') {
      return done > 0 ? (
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-[13px] text-navy-900">
            <span className="font-semibold">Re-read finished.</span> {gotOne} were placed in one
            of the new categories, {none} still fit none of them, about ${spent.toFixed(2)}.
          </p>
        </div>
      ) : null
    }
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-[13px] text-navy-900">
          <span className="font-semibold">Every document with a file has been looked at.</span>{' '}
          {filled} carry a category.
          {noFile > 0 && ` ${noFile} have no file at all, so there is nothing to read for them.`}
        </p>
        {done > 0 && (
          <p className="mt-1 text-[12.5px] text-muted">
            This run: {gotOne} categorised, {none} fitted none of them, about ${spent.toFixed(2)}.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="flex items-center gap-2 text-[14px] font-bold text-navy-900">
        <Tags className="size-4 text-navy-500" aria-hidden />
        {mode === 'reread' ? 'Re-read the ones that fitted nothing' : 'Fill in the missing categories'}
      </h3>
      {mode === 'reread' ? (
        <p className="mt-1 text-[12.5px] text-muted">
          <span className="font-semibold text-navy-900">{remaining}</span> documents are filed
          under Other, or under nothing. That was the right answer to the wrong question: the
          list they were offered described a software company — Technology, Legal, Marketing,
          Office, Utilities — while this office receives tax notices, unemployment agencies,
          title companies and tolls. Now that those categories exist, these are worth asking
          again. Anything already filed under a real category is left alone, and so is anything
          a person has reclassified by hand.
        </p>
      ) : (
        <p className="mt-1 text-[12.5px] text-muted">
          <span className="font-semibold text-navy-900">{remaining}</span> documents have a file
          and no category. Reading them is the only way to get one: the category cannot be worked
          out from anything already stored — barely any document carries a vendor, and until
          recently the reader was not asked for a category at all.
          {filled > 0 && ` ${filled} already have one.`}
          {noFile > 0 && ` ${noFile} more have no file, so they cannot be read.`}
        </p>
      )}

      {!asking ? (
        <button type="button" className={`${BTN.primary} mt-3`} onClick={() => setAsking(true)}>
          <Tags className="size-3.5" aria-hidden />
          {mode === 'reread' ? 'Re-read' : 'Read'} {remaining} documents — about {estimate}
        </button>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg border border-navy-500 bg-navy-50 p-3">
          <p className="text-[13px] font-bold text-navy-900">
            Read {remaining} documents, about {estimate}
          </p>
          <p className="text-[12.5px] text-muted">
            One model call each. It writes <span className="font-semibold">only the category</span>{' '}
            — the type, the decision, who it is assigned to and the approval are all left exactly
            as they are, and a category somebody chose by hand is never replaced. Stopping part way
            keeps what has been done.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN.primary} onClick={run}>
              Start and spend {estimate}
            </button>
            <button type="button" className={BTN.quiet} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-[12.5px] text-danger-700">{error}</p>}
    </div>
  )
}

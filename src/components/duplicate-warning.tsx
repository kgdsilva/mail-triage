import Link from 'next/link'
import { CopyCheck } from 'lucide-react'
import type { NearMatch } from '@/server/near-duplicates'

/**
 * "You may already have this one."
 *
 * ---------------------------------------------------------------------------
 * Why it is a sentence and not a flag
 * ---------------------------------------------------------------------------
 *
 * A badge saying "duplicate?" asks the reader to go and find out, which is the work they
 * were already not doing. The whole value is in the three facts underneath it: which
 * document, how it differs, and what has already happened to that one — because "already
 * paid on 12 Sep" is a different afternoon from "in the log since Sep 10".
 *
 * It never hides a button. Two documents that look alike are sometimes two documents,
 * and this module cannot tell: a collection agency sends the same demand every month for
 * the same debt, and over this office's log that shape is indistinguishable from being
 * billed twice. So the reader is told, and the reader decides.
 *
 * Built out of spans rather than divs, with the layout put back by `block` and `flex`.
 * It has to sit inside a bill row, whose cells are spans all the way down, and a div
 * nested in a span is invalid markup that browsers reflow silently — the kind of thing
 * that looks fine until one layout somewhere collapses.
 */
export function DuplicateWarning({ matches }: { matches: NearMatch[] }) {
  if (matches.length === 0) return null

  // One of them having been paid is the thing that changes the colour, not how sure the
  // match is: a possible duplicate of a bill that has gone out needs the loud treatment
  // more than a certain duplicate of something nobody has touched.
  const spent = matches.some((m) => m.state.startsWith('already paid'))

  return (
    <span
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] ${
        spent ? 'bg-danger-100 text-danger-700' : 'bg-amber-100 text-amber-800'
      }`}
    >
      <CopyCheck className="mt-0.5 size-4 flex-none" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-bold">
          {spent ? 'You may have paid this already' : 'You may already have this one'}
        </span>
        {matches.slice(0, 3).map((m) => (
          <span key={m.id} className="mt-0.5 block min-w-0">
            Same company, vendor and amount as{' '}
            <Link href={`/history/${m.id}`} className="font-semibold underline">
              {m.title}
            </Link>
            {' — '}
            {m.why}; {m.state}.
          </span>
        ))}
        {matches.length > 3 && (
          <span className="mt-0.5 block font-medium">
            and {matches.length - 3} more like it.
          </span>
        )}
      </span>
    </span>
  )
}

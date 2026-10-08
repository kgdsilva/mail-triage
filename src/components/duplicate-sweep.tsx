import Link from 'next/link'
import { sweepDuplicates } from '@/server/actions/documents'

/**
 * The identical files already in the log, and the button that clears them.
 *
 * Uploads remove their own duplicates on the way in, so this only ever shows the backlog
 * — copies that arrived before that existed, or came in through the historical import.
 * Once it has been run it disappears.
 */
export function DuplicateSweep({ removable, heldBack }: { removable: number; heldBack: number }) {
  if (removable === 0 && heldBack === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gold-500 bg-gold-50 px-4 py-3">
      <p className="min-w-0 flex-1 text-[13px] text-navy-900">
        {removable > 0 && (
          <span className="font-semibold">
            {removable} document{removable === 1 ? '' : 's'} {removable === 1 ? 'is' : 'are'} the
            same file as another one here.{' '}
          </span>
        )}
        {/* Named, because "left alone" with no cause reads as a bug. */}
        {heldBack > 0 && (
          <span>
            {heldBack} more {heldBack === 1 ? 'needs' : 'need'} a person — paid, approved, or filed
            under a different company.{' '}
          </span>
        )}
        <Link href="/log?deleted=1" className="text-muted underline">
          Removed documents
        </Link>
      </p>
      {removable > 0 && (
        <form action={sweepDuplicates} className="flex-none">
          <button className="rounded-lg bg-navy-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-navy-900">
            Remove {removable}
          </button>
        </form>
      )}
    </div>
  )
}

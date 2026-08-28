import Link from 'next/link'
import { redirect } from 'next/navigation'
import { nextUnreviewed } from '@/server/documents'
import { requireTriage } from '@/server/session'

export const dynamic = 'force-dynamic'

/** Sends the operator straight to the next document awaiting a decision. */
export default async function ClassifyEntry() {
  const session = await requireTriage()
  const next = await nextUnreviewed(session.companyGroupId)

  if (next) redirect(`/classify/${next.id}`)

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-lg font-semibold">Queue is clear</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Every uploaded document has a decision recorded.
      </p>
      <div className="mt-6 flex justify-center gap-3 text-sm">
        <Link href="/upload" className="rounded bg-neutral-900 px-3 py-1.5 text-white dark:bg-neutral-100 dark:text-neutral-900">
          Upload a batch
        </Link>
        <Link href="/log" className="rounded border border-neutral-300 px-3 py-1.5 dark:border-neutral-700">
          Master log
        </Link>
      </div>
    </div>
  )
}

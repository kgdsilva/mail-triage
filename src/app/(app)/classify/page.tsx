import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCheck } from 'lucide-react'
import { nextUnreviewed } from '@/server/documents'
import { requireTriage } from '@/server/session'
import { BTN } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/** Sends the operator straight to the next document awaiting a decision. */
export default async function ClassifyEntry() {
  const session = await requireTriage()
  const next = await nextUnreviewed(session.companyGroupId)

  if (next) redirect(`/classify/${next.id}`)

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-ok-100 text-ok-700">
        <CheckCheck className="size-7" strokeWidth={1.6} aria-hidden />
      </span>
      <h1 className="text-[19px] font-bold tracking-tight text-navy-900">Queue is clear</h1>
      <p className="mt-1.5 text-[14px] text-muted">
        Every uploaded document has a decision recorded.
      </p>
      <div className="mt-7 flex justify-center gap-2.5">
        <Link href="/upload" className={BTN.primary}>
          Upload a batch
        </Link>
        <Link href="/log" className={BTN.secondary}>
          Master log
        </Link>
      </div>
    </div>
  )
}

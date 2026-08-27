import { saveVendor } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireSession } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function VendorsPage() {
  const session = await requireSession()
  const vendors = await prisma.vendor.findMany({
    where: { companyGroupId: session.companyGroupId },
    orderBy: [{ knownSpam: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { documents: true, autopayRules: true } } },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 font-medium">Flag</th>
              <th className="px-3 py-2 text-right font-medium">Autopay rules</th>
              <th className="px-3 py-2 text-right font-medium">Documents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {vendors.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2">{v.name}</td>
                <td className="px-3 py-2 text-xs">
                  {v.knownSpam ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-200">
                      solicitation
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">
                  {v._count.autopayRules}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">
                  {v._count.documents}
                </td>
              </tr>
            ))}
            {vendors.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-xs text-neutral-500">
                  No vendors yet — they are created as you classify.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
          Flagging a vendor as a solicitation makes every future document from them
          archive on sight — the labor-law poster mills and LLC “good standing” resellers.
        </p>
      </div>

      <form
        action={saveVendor}
        className="h-fit space-y-3 rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p className="text-sm font-medium">Add a vendor</p>
        <input name="name" placeholder="Vendor name" required className={inputClass} />
        <input name="notes" placeholder="Notes (optional)" className={inputClass} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="knownSpam" />
          Solicitation mill — always archive
        </label>
        <button className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Add vendor
        </button>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'

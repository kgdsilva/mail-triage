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
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
            <tr>
              <th className="px-4 py-3 font-semibold">Vendor</th>
              <th className="px-4 py-3 font-semibold">Flag</th>
              <th className="px-4 py-3 text-right font-semibold">Autopay rules</th>
              <th className="px-4 py-3 text-right font-semibold">Documents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {vendors.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-3">{v.name}</td>
                <td className="px-3 py-2 text-xs">
                  {v.knownSpam ? (
                    <span className="rounded-lg bg-red-100 px-1.5 py-0.5 text-danger-700">
                      solicitation
                    </span>
                  ) : (
                    <span className="text-subtle">—</span>
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
                <td colSpan={4} className="px-3 py-10 text-center text-xs text-muted">
                  No vendors yet — they are created as you classify.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          Flagging a vendor as a solicitation makes every future document from them
          archive on sight — the labor-law poster mills and LLC “good standing” resellers.
        </p>
      </div>

      <form
        action={saveVendor}
        className="h-fit space-y-3 rounded-lg border border-line bg-surface p-4"
      >
        <p className="text-sm font-medium">Add a vendor</p>
        <input name="name" placeholder="Vendor name" required className={inputClass} />
        <input name="notes" placeholder="Notes (optional)" className={inputClass} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="knownSpam" />
          Solicitation mill — always archive
        </label>
        <button className="w-full rounded-lg bg-navy-700 px-3 py-2 text-sm text-white">
          Add vendor
        </button>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-navy-500'

import { saveVendor } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireAdmin } from '@/server/session'
import { BTN } from '@/lib/theme'

export const dynamic = 'force-dynamic'

export default async function VendorsPage() {
  const session = await requireAdmin()
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
              <th className="px-4 py-3 font-semibold">Also known as</th>
              <th className="px-4 py-3 font-semibold">Flag</th>
              <th className="px-4 py-3 text-right font-semibold">Autopay rules</th>
              <th className="px-4 py-3 text-right font-semibold">Documents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {vendors.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-3">{v.name}</td>
                {/*
                  Editable in place, because the moment you need an alias is the moment
                  you see the wrong spelling arrive — not later, from a settings form
                  somewhere else.
                */}
                <td className="px-3 py-2">
                  <form action={saveVendor} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="name" value={v.name} />
                    <input type="hidden" name="notes" value={v.notes ?? ''} />
                    {v.knownSpam && <input type="hidden" name="knownSpam" value="on" />}
                    <input
                      name="aliases"
                      defaultValue={v.aliases.join(', ')}
                      placeholder="Other spellings, comma separated"
                      className={`${inputClass} text-xs`}
                    />
                    <button className={BTN.quiet}>Save</button>
                  </form>
                </td>
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
                <td colSpan={5} className="px-3 py-10 text-center text-xs text-muted">
                  No vendors yet — they are created as you classify.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          Flagging a vendor as a solicitation makes every future document from them
          archive on sight — the labor-law poster mills and LLC “good standing” resellers.
          <br />
          “Also known as” is how the spellings on a vendor’s own invoices — “Jump Cloud”,
          “JUMPCLOUD INC” — all resolve to this one record instead of becoming three
          suppliers. The reader no longer invents a vendor it cannot place; it leaves the
          name for you to confirm on Review.
        </p>
      </div>

      <form
        action={saveVendor}
        className="h-fit space-y-3 rounded-lg border border-line bg-surface p-4"
      >
        <p className="text-sm font-medium">Add a vendor</p>
        <input name="name" placeholder="Vendor name" required className={inputClass} />
        <input name="notes" placeholder="Notes (optional)" className={inputClass} />
        <textarea
          name="aliases"
          rows={2}
          placeholder="Also known as — one spelling per line"
          className={inputClass}
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="knownSpam" />
          Solicitation mill — always archive
        </label>
        <button className={`w-full ${BTN.primary}`}>Add vendor</button>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-navy-500'

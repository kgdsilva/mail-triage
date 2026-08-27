import { endAutopayRule, saveAutopayRule } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireSession } from '@/server/session'
import { formatDate } from '@/components/badges'

export const dynamic = 'force-dynamic'

export default async function AutopayPage() {
  const session = await requireSession()

  const [rules, vendors, entities] = await Promise.all([
    prisma.autopayRule.findMany({
      where: { companyGroupId: session.companyGroupId },
      orderBy: [{ effectiveTo: 'asc' }, { effectiveFrom: 'desc' }],
      include: {
        vendor: { select: { name: true } },
        entity: { select: { code: true } },
        confirmedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.vendor.findMany({
      where: { companyGroupId: session.companyGroupId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.entity.findMany({
      where: { companyGroupId: session.companyGroupId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true },
    }),
  ])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          These rules are what let a bill be archived without a human deciding. A rule
          covers one vendor at one entity — a vendor on autopay for CP but not for MM will
          still surface MM&rsquo;s bill for a decision.
        </div>

        <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
              <tr>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Acct</th>
                <th className="px-3 py-2 font-medium">In effect</th>
                <th className="px-3 py-2 font-medium">Confirmed by</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {rules.map((r) => {
                const ended = r.effectiveTo !== null && r.effectiveTo <= new Date()
                return (
                  <tr key={r.id} className={ended ? 'text-neutral-400' : ''}>
                    <td className="px-3 py-2">{r.vendor.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.entity.code}</td>
                    <td className="px-3 py-2 text-xs">{r.accountLast4 ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {formatDate(r.effectiveFrom)} →{' '}
                      {r.effectiveTo ? formatDate(r.effectiveTo) : 'open'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.confirmedBy.name ?? r.confirmedBy.email}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!ended && (
                        <form action={endAutopayRule.bind(null, r.id)}>
                          <button className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100">
                            End
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                )
              })}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-xs text-neutral-500">
                    No autopay rules yet. Until one exists, every bill goes to a human.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
            Ending a rule keeps it in the record rather than deleting it, so a document
            archived last year still shows why.
          </p>
        </div>
      </div>

      <form
        action={saveAutopayRule}
        className="h-fit space-y-3 rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p className="text-sm font-medium">Confirm autopay</p>
        <select name="vendorId" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Vendor
          </option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <select name="entityId" required className={inputClass} defaultValue="">
          <option value="" disabled>
            Entity
          </option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.code}
            </option>
          ))}
        </select>
        <input name="accountLast4" placeholder="Account last 4 (optional)" maxLength={4} className={inputClass} />
        <input name="paymentMethod" placeholder="Payment method (optional)" className={inputClass} />
        <label className="block text-xs text-neutral-600 dark:text-neutral-400">
          In effect from
          <input name="effectiveFrom" type="date" required defaultValue={today} className={`mt-1 ${inputClass}`} />
        </label>
        <input name="notes" placeholder="Notes" className={inputClass} />
        <button className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Confirm rule
        </button>
        <p className="text-[11px] text-neutral-500">
          Recorded against your name — this is the record of who vouched for it.
        </p>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'

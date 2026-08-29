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
        <div className="rounded-lg border border-amber-300 bg-gold-50 px-3 py-2 text-xs text-amber-900">
          These rules are what let a bill be archived without a human deciding. A rule
          covers one vendor at one entity — a vendor on autopay for CP but not for MM will
          still surface MM&rsquo;s bill for a decision.
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
              <tr>
                <th className="px-4 py-3 font-semibold">Vendor</th>
                <th className="px-4 py-3 font-semibold">Entity</th>
                <th className="px-4 py-3 font-semibold">Acct</th>
                <th className="px-4 py-3 font-semibold">In effect</th>
                <th className="px-4 py-3 font-semibold">Confirmed by</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rules.map((r) => {
                const ended = r.effectiveTo !== null && r.effectiveTo <= new Date()
                return (
                  <tr key={r.id} className={ended ? 'text-subtle' : ''}>
                    <td className="px-4 py-3">{r.vendor.name}</td>
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
                          <button className="text-xs text-muted underline hover:text-ink">
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
                  <td colSpan={6} className="px-3 py-10 text-center text-xs text-muted">
                    No autopay rules yet. Until one exists, every bill goes to a human.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-xs text-muted">
            Ending a rule keeps it in the record rather than deleting it, so a document
            archived last year still shows why.
          </p>
        </div>
      </div>

      <form
        action={saveAutopayRule}
        className="h-fit space-y-3 rounded-lg border border-line bg-surface p-4"
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
        <label className="block text-xs text-muted">
          In effect from
          <input name="effectiveFrom" type="date" required defaultValue={today} className={`mt-1 ${inputClass}`} />
        </label>
        <input name="notes" placeholder="Notes" className={inputClass} />
        <button className="w-full rounded-lg bg-navy-700 px-3 py-2 text-sm text-white">
          Confirm rule
        </button>
        <p className="text-[11px] text-muted">
          Recorded against your name — this is the record of who vouched for it.
        </p>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-navy-500'

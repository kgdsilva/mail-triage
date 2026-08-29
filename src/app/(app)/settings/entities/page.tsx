import { EntityBadge } from '@/components/badges'
import { saveEntity } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireSession } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function EntitiesPage() {
  const session = await requireSession()
  const entities = await prisma.entity.findMany({
    where: { companyGroupId: session.companyGroupId },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { documents: true } } },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
            <tr>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Legal name</th>
              <th className="px-4 py-3 font-semibold">View</th>
              <th className="px-4 py-3 text-right font-semibold">Documents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {entities.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3">
                  <EntityBadge code={e.code} index={e.sortOrder} />
                </td>
                <td className="px-4 py-3">{e.legalName}</td>
                <td className="px-3 py-2 text-xs">
                  {e.isSegregated ? (
                    <span className="rounded-lg bg-line-soft px-1.5 py-0.5">
                      separate tab
                    </span>
                  ) : (
                    <span className="text-subtle">with the group</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">
                  {e._count.documents}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          “Separate tab” is a display choice only — everyone can still see the entity and
          its documents.
        </p>
      </div>

      <form
        action={saveEntity}
        className="h-fit space-y-3 rounded-lg border border-line bg-surface p-4"
      >
        <p className="text-sm font-medium">Add an entity</p>
        <input name="code" placeholder="Code (e.g. CP)" required className={inputClass} />
        <input name="legalName" placeholder="Legal name" required className={inputClass} />
        <input name="sortOrder" type="number" placeholder="Sort order" defaultValue={60} className={inputClass} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="isSegregated" />
          Keep in its own tab
        </label>
        <button className="w-full rounded-lg bg-navy-700 px-3 py-2 text-sm text-white">
          Add entity
        </button>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-navy-500'

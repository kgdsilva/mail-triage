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
      <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Legal name</th>
              <th className="px-3 py-2 font-medium">View</th>
              <th className="px-3 py-2 text-right font-medium">Documents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {entities.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 font-mono text-xs font-semibold">{e.code}</td>
                <td className="px-3 py-2">{e.legalName}</td>
                <td className="px-3 py-2 text-xs">
                  {e.isSegregated ? (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
                      separate tab
                    </span>
                  ) : (
                    <span className="text-neutral-400">with the group</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs">
                  {e._count.documents}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
          “Separate tab” is a display choice only — everyone can still see the entity and
          its documents.
        </p>
      </div>

      <form
        action={saveEntity}
        className="h-fit space-y-3 rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p className="text-sm font-medium">Add an entity</p>
        <input name="code" placeholder="Code (e.g. CP)" required className={inputClass} />
        <input name="legalName" placeholder="Legal name" required className={inputClass} />
        <input name="sortOrder" type="number" placeholder="Sort order" defaultValue={60} className={inputClass} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="isSegregated" />
          Keep in its own tab
        </label>
        <button className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Add entity
        </button>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'

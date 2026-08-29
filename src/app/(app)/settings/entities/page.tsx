import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
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
    include: { _count: { select: { documents: true, aliases: true } } },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
            <tr>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Legal name</th>
              <th className="px-4 py-3 font-semibold">Aliases</th>
              <th className="px-4 py-3 font-semibold">View</th>
              <th className="px-4 py-3 text-right font-semibold">Documents</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {entities.map((e) => (
              <tr key={e.id} className="transition-colors hover:bg-navy-50/60">
                <td className="px-4 py-3">
                  <EntityBadge code={e.code} index={e.sortOrder} />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/settings/entities/${e.id}`}
                    className="font-medium text-navy-900 hover:underline"
                  >
                    {e.legalName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-xs">
                  {e._count.aliases > 0 ? (
                    <span className="text-muted">{e._count.aliases}</span>
                  ) : (
                    <Link
                      href={`/settings/entities/${e.id}`}
                      className="text-gold-800 underline underline-offset-2"
                      title="Without aliases, scans are matched on the legal name alone"
                    >
                      none yet
                    </Link>
                  )}
                </td>
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
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/settings/entities/${e.id}`}
                    className="inline-flex items-center gap-0.5 text-[12.5px] text-muted transition-colors hover:text-navy-700"
                  >
                    Edit
                    <ChevronRight className="size-3.5" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
          Open an entity to add the names it appears under on documents. Those aliases are
          what let an incoming scan be matched to it automatically.
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

import { CircleSlash, RotateCcw } from 'lucide-react'
import { saveCategory, toggleCategoryActive } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireAdmin } from '@/server/session'
import { BTN, INPUT } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * Spend categories: what the money was for.
 *
 * A different list from document types, which say what the paper was. "Bill" and
 * "Technology" are both true of the same invoice and answer different questions, and the
 * types are already wired into the filing rules — so overloading them would have made a
 * software invoice file itself as a kind of mail.
 */
export default async function CategoriesPage() {
  const session = await requireAdmin()
  const categories = await prisma.category.findMany({
    where: { companyGroupId: session.companyGroupId },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
    include: { _count: { select: { documents: true } } },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
            <tr>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Documents</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {categories.map((c) => (
              <tr key={c.id} className={c.isActive ? '' : 'opacity-55'}>
                <td className="px-4 py-3">
                  <form action={saveCategory} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="sortOrder" value={c.sortOrder} />
                    <input name="name" defaultValue={c.name} className={`${INPUT} max-w-56`} />
                    <button className={BTN.quiet}>Save</button>
                  </form>
                </td>
                <td className="px-4 py-3 tabular text-muted">{c._count.documents}</td>
                <td className="px-4 py-3 text-right">
                  {/* Deactivated, never deleted: the documents already filed against a
                      category have to keep resolving to it. */}
                  <form action={toggleCategoryActive.bind(null, c.id, !c.isActive)}>
                    <button className={BTN.quiet}>
                      {c.isActive ? (
                        <>
                          <CircleSlash className="size-3.5" aria-hidden />
                          Retire
                        </>
                      ) : (
                        <>
                          <RotateCcw className="size-3.5" aria-hidden />
                          Restore
                        </>
                      )}
                    </button>
                  </form>
                </td>
              </tr>
            ))}

            {categories.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-[13px] text-muted">
                  No categories yet. Add the first one on the right.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form
        action={saveCategory}
        className="space-y-3 self-start rounded-xl border border-line bg-surface p-4"
      >
        <h2 className="text-[15px] font-bold text-navy-900">Add a category</h2>
        <p className="text-[12.5px] text-muted">
          What the spend was for, not what the document was. These are what the archive
          filters by and what goes into a renamed file.
        </p>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
            Name
          </span>
          <input name="name" required placeholder="Technology" className={`mt-1 ${INPUT}`} />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
            Sort order
          </span>
          <input name="sortOrder" defaultValue={0} className={`mt-1 ${INPUT} tabular`} />
        </label>
        <button className={BTN.primary}>Add category</button>
      </form>
    </div>
  )
}

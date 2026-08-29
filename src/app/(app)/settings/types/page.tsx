import { saveDocumentType } from '@/server/actions/settings'
import { prisma } from '@/server/db/client'
import { requireSession } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function TypesPage() {
  const session = await requireSession()
  const types = await prisma.documentType.findMany({
    where: { companyGroupId: session.companyGroupId },
    orderBy: { sortOrder: 'asc' },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.07em] text-subtle">
            <tr>
              <th className="px-4 py-3 font-semibold">Label</th>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Pre-fills as</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {types.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3">{t.label}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted">{t.code}</td>
                <td className="px-3 py-2 text-xs">
                  {t.defaultAction === 'ACTION'
                    ? 'Always send for action'
                    : t.defaultAction === 'ARCHIVE'
                      ? 'Archive'
                      : 'Ask — depends on autopay'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          A pre-fill is only a suggestion; the operator confirms every document. Types
          that carry deadlines should stay on “always send for action”.
        </p>
      </div>

      <form
        action={saveDocumentType}
        className="h-fit space-y-3 rounded-lg border border-line bg-surface p-4"
      >
        <p className="text-sm font-medium">Add a type</p>
        <input name="label" placeholder="Label" required className={inputClass} />
        <input name="code" placeholder="CODE" required className={inputClass} />
        <select name="defaultAction" defaultValue="ASK" className={inputClass}>
          <option value="ASK">Ask — depends on autopay</option>
          <option value="ACTION">Always send for action</option>
          <option value="ARCHIVE">Archive</option>
        </select>
        <input name="sortOrder" type="number" defaultValue={100} className={inputClass} />
        <button className="w-full rounded-lg bg-navy-700 px-3 py-2 text-sm text-white">
          Add type
        </button>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-navy-500'

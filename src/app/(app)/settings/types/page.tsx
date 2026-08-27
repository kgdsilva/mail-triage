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
      <div className="overflow-hidden rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="px-3 py-2 font-medium">Label</th>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Pre-fills as</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {types.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2">{t.label}</td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">{t.code}</td>
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
        <p className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800">
          A pre-fill is only a suggestion; the operator confirms every document. Types
          that carry deadlines should stay on “always send for action”.
        </p>
      </div>

      <form
        action={saveDocumentType}
        className="h-fit space-y-3 rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
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
        <button className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Add type
        </button>
      </form>
    </div>
  )
}

const inputClass =
  'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300'

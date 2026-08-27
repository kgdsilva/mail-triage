import { prisma } from '@/server/db/client'

// Phase 0 smoke page: proves Next.js -> Prisma -> Postgres end to end and shows the
// seeded configuration. Replaced by the real dashboard in Phase 1.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const group = await prisma.companyGroup.findFirst({
    include: {
      entities: {
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { folders: true } } },
      },
      documentTypes: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { documents: true } },
    },
  })

  if (!group) {
    return (
      <main className="mx-auto max-w-2xl p-10 font-sans">
        <h1 className="text-xl font-semibold">No company group yet</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Run <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">npx tsx prisma/seed.ts</code>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl p-10 font-sans">
      <p className="text-xs uppercase tracking-widest text-neutral-500">Phase 0 · foundation</p>
      <h1 className="mt-1 text-2xl font-semibold">{group.name}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {group.timezone} · {group._count.documents} documents in the master log
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Entities</h2>
        <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
          {group.entities.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 py-2">
              <span className="w-14 font-mono text-sm font-semibold">{e.code}</span>
              <span className="flex-1 text-sm">{e.legalName}</span>
              {e.isSegregated && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  separate view
                </span>
              )}
              <span className="text-xs text-neutral-500">{e._count.folders} folders</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Document types
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {group.documentTypes.map((t) => (
            <li
              key={t.id}
              className="rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-800"
            >
              {t.label}
              <span className="ml-1.5 text-neutral-400">{t.defaultAction}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

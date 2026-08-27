import Link from 'next/link'
import { countUnreviewed } from '@/server/documents'
import { requireSession } from '@/server/session'
import { prisma } from '@/server/db/client'
import { NavLink } from '@/components/nav-link'

// Every page in this segment resolves the current user, so none of them can be
// prerendered — the build has no session to render against.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession()
  const [group, pending] = await Promise.all([
    prisma.companyGroup.findUnique({
      where: { id: session.companyGroupId },
      select: { name: true },
    }),
    countUnreviewed(session.companyGroupId),
  ])

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-5 py-3">
          <Link href="/log" className="text-sm font-semibold tracking-tight">
            Mail Triage
          </Link>
          <span className="hidden text-xs text-neutral-500 sm:inline">{group?.name}</span>

          <nav className="ml-auto flex items-center gap-1">
            <NavLink href="/classify" badge={pending || undefined}>
              Classify
            </NavLink>
            <NavLink href="/log">Master log</NavLink>
            <NavLink href="/upload">Upload</NavLink>
            <NavLink href="/settings">Settings</NavLink>
          </nav>

          <span className="ml-2 hidden text-xs text-neutral-500 md:inline">
            {session.userName}
          </span>
        </div>

        {session.isDevFallback && (
          <p className="bg-amber-50 px-5 py-1 text-center text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            No sign-in configured — running as the seeded operator. Wire Auth.js before
            anyone else gets a link.
          </p>
        )}
      </header>

      <main className="mx-auto max-w-[1600px] px-5 py-6">{children}</main>
    </div>
  )
}

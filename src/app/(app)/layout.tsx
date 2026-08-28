import Link from 'next/link'
import { signOut } from '@/auth'
import { countUnreviewed } from '@/server/documents'
import { canSeeWholeLog, isAdmin, requireSession } from '@/server/session'
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
    // Only meaningful for people who actually triage; skip the query otherwise.
    isAdmin(session.role) ? countUnreviewed(session.companyGroupId) : Promise.resolve(0),
  ])

  const triages = isAdmin(session.role)

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-5 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Mail Triage
          </Link>
          <span className="hidden text-xs text-neutral-500 sm:inline">{group?.name}</span>

          <nav className="ml-auto flex items-center gap-1">
            <NavLink href="/">My queue</NavLink>
            {triages && (
              <NavLink href="/classify" badge={pending || undefined}>
                Classify
              </NavLink>
            )}
            <NavLink href="/log">{canSeeWholeLog(session.role) ? 'Master log' : 'My documents'}</NavLink>
            {triages && <NavLink href="/upload">Upload</NavLink>}
            {isAdmin(session.role) && <NavLink href="/settings">Settings</NavLink>}
          </nav>

          <div className="ml-2 hidden items-center gap-2 md:flex">
            <span className="text-xs text-neutral-500" title={session.userEmail}>
              {session.userName}
            </span>
            <form
              action={async () => {
                'use server'
                await signOut({ redirectTo: '/signin' })
              }}
            >
              <button className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-5 py-6">{children}</main>
    </div>
  )
}

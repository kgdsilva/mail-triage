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
  const initials = session.userName
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1600px] items-center gap-7 px-6">
          <Link href="/" className="flex items-center gap-2.5 py-3.5">
            <span className="h-5 w-2 rounded-sm bg-gold-500" aria-hidden />
            <span className="text-[15px] font-bold tracking-tight text-navy-900">Mail Triage</span>
          </Link>
          <span className="hidden text-[12.5px] text-subtle sm:inline">{group?.name}</span>

          <nav className="ml-auto flex items-stretch gap-1">
            <NavLink href="/">My queue</NavLink>
            {triages && (
              <NavLink href="/review" badge={pending || undefined}>
                Review
              </NavLink>
            )}
            {triages && <NavLink href="/classify">Classify</NavLink>}
            {canSeeWholeLog(session.role) && <NavLink href="/checks">Checks</NavLink>}
            <NavLink href="/log">{canSeeWholeLog(session.role) ? 'Master log' : 'My documents'}</NavLink>
            {triages && <NavLink href="/upload">Upload</NavLink>}
            {isAdmin(session.role) && <NavLink href="/settings">Settings</NavLink>}
          </nav>

          <div className="ml-3 hidden items-center gap-2.5 md:flex">
            <span
              className="grid size-8 place-items-center rounded-full bg-navy-100 text-[11px] font-semibold text-navy-900"
              title={session.userEmail}
            >
              {initials}
            </span>
            <form
              action={async () => {
                'use server'
                await signOut({ redirectTo: '/signin' })
              }}
            >
              <button className="text-xs text-subtle transition-colors hover:text-navy-700">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-8">{children}</main>
    </div>
  )
}

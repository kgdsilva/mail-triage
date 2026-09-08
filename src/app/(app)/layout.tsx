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
      {/*
        The bar is navy rather than white. It is the company's colour, it separates
        "where am I in the app" from "what am I working on" at a glance, and it stops
        the whole screen reading as one continuous sheet of pale grey.
      */}
      <header className="bg-navy-900">
        <div className="mx-auto flex max-w-[1600px] items-center gap-7 px-6">
          <Link href="/" className="flex items-center gap-2.5 py-3.5">
            <span className="h-5 w-2 rounded-sm bg-gold-500" aria-hidden />
            <span className="text-[15px] font-extrabold tracking-tight text-white">
              Mail Triage
            </span>
          </Link>
          <span className="hidden text-[12.5px] font-medium text-navy-100/70 sm:inline">
            {group?.name}
          </span>

          <nav className="ml-auto flex items-stretch gap-0.5">
            <NavLink href="/" icon="queue">
              My queue
            </NavLink>
            <NavLink href="/bills" icon="bills">
              Bills
            </NavLink>
            {triages && (
              <NavLink href="/review" icon="review" badge={pending || undefined}>
                Review
              </NavLink>
            )}
            {canSeeWholeLog(session.role) && (
              <NavLink href="/checks" icon="checks">
                Checks
              </NavLink>
            )}
            <NavLink href="/log" icon="log">
              {canSeeWholeLog(session.role) ? 'Master log' : 'My documents'}
            </NavLink>
            {triages && (
              <NavLink href="/upload" icon="upload">
                Upload
              </NavLink>
            )}
            {isAdmin(session.role) && (
              <NavLink href="/settings" icon="settings">
                Settings
              </NavLink>
            )}
          </nav>

          <div className="ml-3 hidden items-center gap-2.5 md:flex">
            <span
              className="grid size-8 place-items-center rounded-full bg-gold-500 text-[11px] font-extrabold text-navy-900"
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
              <button className="text-xs font-medium text-navy-100/70 transition-colors hover:text-white">
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

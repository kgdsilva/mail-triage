import Link from 'next/link'
import { signOut } from '@/auth'
import { countUnreviewed } from '@/server/documents'
import { canSeeWholeLog, isAdmin, requireSession } from '@/server/session'
import { listWorkspaces } from '@/server/workspace'
import { NavMenu, type NavGroup } from '@/components/nav-menu'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'

// Every page in this segment resolves the current user, so none of them can be
// prerendered — the build has no session to render against.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession()
  const [workspaces, pending] = await Promise.all([
    listWorkspaces(session.userId),
    // Only meaningful for people who actually triage; skip the query otherwise.
    isAdmin(session.role) ? countUnreviewed(session.companyGroupId) : Promise.resolve(0),
  ])

  const triages = isAdmin(session.role)
  const wholeLog = canSeeWholeLog(session.role)

  /*
   * Two named menus and two plain links, rather than seven bare words in a row.
   *
   * The words did not explain themselves — "Bills", "Checks", "Review" and "Master log"
   * could all plausibly be where you go to find a document — and a flat tab bar has
   * nowhere to put the sentence that would say. Money is what moves, Mail is what
   * arrives; each item carries its own one-line explanation inside the menu.
   *
   * Filtered by role here, so a MEMBER's menu has no empty groups: a group holding one
   * item renders as a plain link instead of a dropdown with one choice.
   */
  const groups: NavGroup[] = [
    {
      label: 'My queue',
      items: [
        {
          href: '/',
          label: 'My queue',
          blurb: 'The documents routed to you, soonest due first.',
          icon: 'queue' as const,
        },
      ],
    },
    {
      label: 'Money',
      items: [
        {
          href: '/bills',
          label: 'Bills to pay',
          blurb: 'Everything open with money to send out, grouped by how soon it is due.',
          icon: 'bills' as const,
        },
        ...(wholeLog
          ? [
              {
                href: '/checks',
                label: 'Checks received',
                blurb: 'Money coming in from title companies and closing agents, for reconciling.',
                icon: 'checks' as const,
              },
            ]
          : []),
      ],
    },
    {
      label: 'Mail',
      items: [
        ...(triages
          ? [
              {
                href: '/upload',
                label: 'Upload a batch',
                blurb: 'Drop the day\u2019s scans in. Nothing is read or decided until you ask.',
                icon: 'upload' as const,
              },
              {
                href: '/review',
                label: 'Review',
                blurb: 'Decide what each new document is. One list, three buttons.',
                icon: 'review' as const,
                badge: pending || undefined,
              },
            ]
          : []),
        {
          href: '/log',
          label: wholeLog ? 'Master log' : 'My documents',
          blurb: wholeLog
            ? 'Every document that ever arrived, by company and type. Nothing is deleted.'
            : 'Every document routed to you, open or resolved.',
          icon: 'log' as const,
        },
      ],
    },
    ...(isAdmin(session.role)
      ? [
          {
            label: 'Settings',
            items: [
              {
                href: '/settings',
                label: 'Settings',
                blurb: 'Companies, document types, vendors, autopay and members.',
                icon: 'settings' as const,
              },
            ],
          },
        ]
      : []),
  ]
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
          <WorkspaceSwitcher
            workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))}
            activeId={session.companyGroupId}
          />

          <NavMenu groups={groups} />

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

import Link from 'next/link'
import { signOut } from '@/auth'
import { countUnreviewed } from '@/server/documents'
import { billCounts } from '@/server/approvals'
import { boardCounts } from '@/server/board'
import { countToDecide, toDecideWhere } from '@/server/to-decide'
import { handedToCount } from '@/server/approvals'
import {
  canApprove,
  canConfigure,
  canSearchArchive,
  canSeeWholeLog,
  canSettle,
  canTriagePayments,
  canTriage,
  canUpload,
  canWork,
  requireSession,
} from '@/server/session'
import { listWorkspaces } from '@/server/workspace'
import { NavMenu, type NavGroup } from '@/components/nav-menu'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import { ViewAsBanner, ViewAsMenu } from '@/components/view-as-menu'
import { FindBox } from '@/components/find-box'
import { viewableMembers } from '@/server/actions/view-as'
import { VIEW_AS_COOKIE } from '@/server/view-as'

// Every page in this segment resolves the current user, so none of them can be
// prerendered — the build has no session to render against.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession()
  const [workspaces, pending, pendingApprovals, mine, accounting] = await Promise.all([
    listWorkspaces(session.userId),
    // Only meaningful for people who actually triage; skip the query otherwise.
    canTriage(session.role) ? countUnreviewed(session.companyGroupId) : Promise.resolve(0),
    // A badge an approver can see is the whole reason they open the app.
    canApprove(session.role)
      ? billCounts(session).then((c) => c.pending)
      : Promise.resolve(0),
    /*
     * What is on this person's own name, for the one menu item that had no number.
     *
     * Bills to approve and New mail both carry a badge and the shared board did not,
     * so the people whose work arrives there — which is now going to include Danny and
     * Anna — had nothing in the app telling them anything had arrived at all. They
     * found out twice a day by email, or by remembering to look.
     *
     * `mine`, not the whole board: a badge that counts other people's work is a number
     * that never reaches zero, and a number that never reaches zero stops being read.
     */
    canWork(session.role)
      ? boardCounts(session.companyGroupId, session.userId).then((c) => c.mine)
      : Promise.resolve(0),
    /*
     * The accountant's menu had no number on it either, and he is the person this
     * office hands the most documents to: every open handover in the database is his.
     *
     * Two things, added: what is waiting on him to say whether it is a bill, and what
     * somebody has asked him by name. Not the bills already cleared for payment — those
     * are a queue he works through, not an arrival, and adding them would have made the
     * badge a number that is never zero.
     */
    /*
     * Only for the people who can act on that queue.
     *
     * canSettle is wider than it looks — owner, both administrators and every operator —
     * but the buttons on the tab it counts are gated by canTriagePayments, so for an
     * operator the badge was a number that is not theirs and that nothing they do will
     * ever reduce. That is the same mistake this file rejects one line above for the
     * shared board.
     */
    canTriagePayments(session.role)
      ? Promise.all([
          countToDecide(session),
          handedToCount(session, toDecideWhere(session.companyGroupId)),
        ]).then(([decide, handed]) => decide + handed)
      : Promise.resolve(0),
  ])

  /*
   * Only fetched for an administrator who is not already inside a view. Inside one the
   * session's role is the viewed person's, so this returns nothing anyway — but asking
   * at all would be a query per page load to be told what the banner already says.
   */
  const viewables = session.viewingAs ? [] : await viewableMembers()

  const triages = canTriage(session.role)
  const wholeLog = canSeeWholeLog(session.role)
  const works = canWork(session.role)
  const uploads = canUpload(session.role)
  const configures = canConfigure(session.role)
  const approves = canApprove(session.role)
  const settles = canSettle(session.role)
  // The scoped outside roles get the archive without the rest of the app around it.
  const archiveOnly = !works && canSearchArchive(session.role)

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
    /*
     * The approval pair comes first for the people whose whole job it is.
     *
     * An approver has one screen and an accountant has one screen, so for them the bar
     * is that screen plus the archive — the rest of the app is not hidden to be tidy,
     * it is genuinely not theirs.
     */
    ...(approves
      ? [
          {
            label: 'Bills to approve',
            items: [
              {
                href: '/approvals',
                label: 'Bills to approve',
                blurb: 'Invoices waiting on you. Open one, then approve or send it back.',
                icon: 'approvals' as const,
                badge: pendingApprovals || undefined,
              },
            ],
          },
        ]
      : []),
    ...(settles && !works
      ? [
          {
            label: 'Accounting',
            items: [
              {
                href: '/accounting',
                label: 'Accounting',
                blurb: 'Approved bills ready to pay, what is still waiting, and the history.',
                icon: 'accounting' as const,
                badge: accounting || undefined,
              },
            ],
          },
        ]
      : []),
    ...(archiveOnly
      ? [
          {
            label: 'Archive',
            items: [
              {
                href: '/log',
                label: 'Archive',
                blurb: 'Search every invoice you have access to, and download it.',
                icon: 'log' as const,
              },
            ],
          },
        ]
      : []),
    ...(works
      ? [
          {
            label: 'Needs a decision',
            items: [
              {
                href: '/',
                label: 'Needs a decision',
                blurb:
                  'The shared board: everything waiting on a person, by company. Yours first.',
                icon: 'queue' as const,
                badge: mine || undefined,
              },
            ],
          },
          /*
            One place for money, and it is Accounting.
            The Money menu held three entries that led to slices of Accounting's own
            lists — Bills to pay is its Ready to pay, Bills paid is its Paid — plus
            Accounting itself, which contained both. Three doors into one room, and the
            room was one of the doors. Those two screens still exist at their URLs so a
            saved link keeps working; they are no longer somewhere to get lost in.

            Cheques moved *into* Accounting as a tab rather than out of the bar: money
            arriving is the accountant's business, and it was only ever here because
            there was a Money menu to put it in.
          */
          {
            label: 'Accounting',
            items: [
              {
                href: '/accounting',
                label: 'Accounting',
                blurb:
                  'Is it a bill, what is cleared to pay, what is waiting, what is paid, and cheques in.',
                icon: 'accounting' as const,
                badge: accounting || undefined,
              },
            ],
          },
        ]
      : []),
    {
      label: 'Mail',
      items: [
        ...(uploads
          ? [
              {
                href: '/upload',
                label: 'Upload a batch',
                blurb: 'Drop the day\u2019s scans in. Nothing is read or decided until you ask.',
                icon: 'upload' as const,
              },
            ]
          : []),
        ...(triages
          ? [
              {
                href: '/review',
                label: 'New mail',
                blurb: 'What just arrived, waiting to be read and named. One list, three buttons.',
                icon: 'review' as const,
                badge: pending || undefined,
              },
              {
                href: '/import',
                label: 'Import the history',
                blurb: 'Bring in the months that were processed by hand, and their PDFs.',
                icon: 'import' as const,
              },
            ]
          : []),
        ...(works
          ? [
              {
                href: '/log',
                label: wholeLog ? 'Master log' : 'My documents',
                blurb: wholeLog
                  ? 'Every document that ever arrived, by company and type. Nothing is deleted.'
                  : 'Every document routed to you, open or resolved.',
                icon: 'log' as const,
              },
            ]
          : []),
      ],
    },
    ...(configures
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
        {/*
          No overflow here, ever. A dropdown in the bar is positioned below it, so any
          clipping box on this wrapper cuts the panel off — measured at 12% of it left
          visible, a 48px sliver that reads as a dead button. The bar cannot overflow
          horizontally anyway: the nav wraps instead of growing wider.
        */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-7 px-6">
          <Link href="/" className="flex flex-none items-center gap-2.5 py-3.5">
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

          {/*
            The way out of "it is not in this queue, so where is it?".
            Beside the queues rather than inside one of them, because the question is
            asked from whichever screen turned out to be the wrong one.
          */}
          {canSearchArchive(session.role) && (
            <div className="ml-auto mr-3">
              <FindBox />
            </div>
          )}

          <div className={`${canSearchArchive(session.role) ? '' : 'ml-auto '}hidden items-center gap-2.5 md:flex`}>
            <ViewAsMenu
              members={viewables}
              viewing={
                session.viewingAs
                  ? { name: session.userName, realName: session.viewingAs.realUserName }
                  : null
              }
            />
            <span
              className="grid size-8 place-items-center rounded-full bg-gold-500 text-[11px] font-extrabold text-navy-900"
              title={session.userEmail}
            >
              {initials}
            </span>
            <form
              action={async () => {
                'use server'
                // Leave any "view as" behind with the session it belonged to, so the
                // next person to sign in on this browser is not quietly inside one.
                const { cookies } = await import('next/headers')
                ;(await cookies()).delete(VIEW_AS_COOKIE)
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

      {session.viewingAs && (
        <ViewAsBanner
          name={session.userName}
          role={session.role}
          realName={session.viewingAs.realUserName}
        />
      )}

      <main className="mx-auto max-w-[1600px] px-6 py-8">{children}</main>

      {/*
        Which build is actually serving this page.
        A deploy either landed or it did not, and arguing about it from the symptoms
        costs more than the line it takes to say so. Admins only — it is a debugging
        aid, not product — and it links to the commit, so "is my fix live" is one
        glance instead of a conversation.
      */}
      {configures && <BuildStamp />}
    </div>
  )
}

const REPO = 'https://github.com/kgdsilva/mail-triage'

function BuildStamp() {
  // Vercel sets this at build time. Empty anywhere else, which is itself the answer.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
  const short = sha.slice(0, 7)
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? ''
  const env = process.env.VERCEL_ENV ?? 'local'

  return (
    <footer className="mx-auto max-w-[1600px] px-6 pb-6 text-[11px] text-subtle">
      {short ? (
        <a
          href={`${REPO}/commit/${sha}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono hover:underline"
          title="The commit this deployment was built from"
        >
          {env} · {branch || 'unknown branch'} · {short}
        </a>
      ) : (
        <span className="font-mono">local build — no deployment commit</span>
      )}
    </footer>
  )
}

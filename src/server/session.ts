import { cache } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/server/db/client'
import { resolveMembership } from '@/server/workspace'
import { viewingAsUserId } from '@/server/view-as'

/**
 * Who is acting, and in which company group.
 *
 * Signing in proves identity; membership grants access. Someone with a valid Google
 * session but no active membership is treated as signed out, so removing a person from
 * the group takes effect immediately rather than whenever their session happens to
 * expire.
 */

export type Session = {
  userId: string
  companyGroupId: string
  role: string
  /**
   * Entity ids this member is restricted to; empty means every entity in the group.
   *
   * Carried on the session rather than re-read per query, because it has to be applied
   * by every screen an approver can reach and a boundary that each caller has to
   * remember to fetch is a boundary that one of them will forget.
   */
  entityScope: string[]
  /**
   * Where this person lands after signing in, when the role's own answer is wrong for
   * them. Null means the role decides, which is right for almost everybody.
   */
  homePath: string | null
  /** The active workspace's name, for the switcher in the header. */
  companyGroupName: string
  userName: string
  userEmail: string
  userImage: string | null
  /**
   * Set when an administrator is looking at the app as this person rather than being
   * them. Everything on this session is the viewed person's — role, scope, name — which
   * is the point: the screens have to be built from their permissions, not filtered
   * afterwards. This says whose eyes are actually reading.
   *
   * It grants nothing. The database client refuses every write while it is set.
   */
  viewingAs?: { realUserId: string; realUserName: string }
}

/**
 * The person who actually signed in, before any "view as" is applied.
 *
 * Separate from `getSession` because the two answer different questions, and the
 * difference is the whole of this feature: the screens want the viewed person, while
 * deciding whether somebody may view at all wants the real one. Reading the viewed
 * session to authorise viewing would let the mode extend itself.
 */
export const getRealSession = cache(async (): Promise<Session | null> => {
  const authed = await auth()
  const userId = authed?.user?.id
  if (!userId) return null

  // Which workspace, not just which person. Membership is re-read on every request, so
  // a revoked one takes effect immediately and a cookie naming a workspace someone no
  // longer belongs to is simply ignored.
  const membership = await resolveMembership(userId)
  if (!membership) return null

  const real: Session = {
    userId: membership.userId,
    companyGroupId: membership.companyGroupId,
    role: membership.role,
    entityScope: membership.entityScope,
    homePath: membership.homePath,
    companyGroupName: membership.companyGroup.name,
    userName: membership.user.name ?? membership.user.email,
    userEmail: membership.user.email,
    userImage: membership.user.image,
  }

  /*
   * Looking through somebody else's eyes.
   *
   * Only an administrator, only within their own workspace, and only at somebody who is
   * an active member of it — the same three conditions that decide what that person can
   * see, so this cannot show more than they would see themselves.
   *
   * The returned session *is* theirs. Nothing downstream is told to behave differently,
   * because a screen that had to remember it was being previewed would eventually
   * forget, and the whole value of this is that what you see is what they get.
   */
  return real
})

/** Returns null when nobody is signed in, instead of redirecting. */
export const getSession = cache(async (): Promise<Session | null> => {
  const real = await getRealSession()
  if (!real) return null

  const asUserId = await viewingAsUserId()
  if (!asUserId || !canConfigure(real.role) || asUserId === real.userId) return real

  const target = await prisma.membership.findFirst({
    where: {
      userId: asUserId,
      companyGroupId: real.companyGroupId,
      isActive: true,
    },
    select: {
      userId: true,
      role: true,
      entityScope: true,
      homePath: true,
      user: { select: { name: true, email: true, image: true } },
    },
  })
  if (!target) return real

  return {
    ...real,
    userId: target.userId,
    role: target.role,
    entityScope: target.entityScope,
    homePath: target.homePath,
    userName: target.user.name ?? target.user.email,
    userEmail: target.user.email,
    userImage: target.user.image,
    viewingAs: { realUserId: real.userId, realUserName: real.userName },
  }
})

export const requireSession = cache(async (): Promise<Session> => {
  const session = await getSession()
  if (!session) redirect('/signin')
  return session
})

/*
 * Four questions, not one.
 *
 * These used to be two, and `isAdmin` answered both "can this person triage?" and "can
 * this person change configuration?" — which meant an OPERATOR, the role you give
 * somebody so they can upload and classify, also reached the autopay rules. Those rules
 * decide which bills are safe to archive without a human ever seeing them, so that was
 * the one permission not to hand out by accident.
 *
 * Every list is positive. A role added later gets nothing until it is named here, which
 * is the failure people want.
 */

/** Companies, document types, vendors, autopay, members. The dangerous screens. */
/**
 * Every role somebody can hold, in one place.
 *
 * It was in three places, and they drifted: the Members screen offered APPROVER and
 * ACCOUNTANT while the two actions that write a role validated against a list that
 * predated both. Picking either threw on the server, which in production surfaces as an
 * unexplained React error — so for as long as the approval workflow has existed, it has
 * been impossible to create an approver or an accountant. Nobody could have known from
 * the screen; it looked like a choice.
 *
 * Anything that accepts a role now reads this, and the Members screen is typed so that
 * forgetting to describe a new one fails the build rather than the click.
 */
export const ROLES = [
  'OWNER',
  'ADMIN',
  'OPERATOR',
  'MEMBER',
  'VIEWER',
  'UPLOADER',
  'APPROVER',
  'ACCOUNTANT',
] as const

export type Role = (typeof ROLES)[number]

const CONFIGURE_ROLES = ['OWNER', 'ADMIN'] as const

/** Uploading, reading with the AI, classifying, importing history. */
const TRIAGE_ROLES = ['OWNER', 'ADMIN', 'OPERATOR'] as const

/** Putting scans in. The scanner can do this and nothing else. */
const UPLOAD_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'UPLOADER'] as const

/**
 * Approving a bill. The approver's whole job, and an admin's by inheritance.
 *
 * An APPROVER has nothing else: no board, no triage, no configuration, and only the
 * companies named in their scope. The narrowness is what was asked for — "a place I can
 * go to see what needs to be paid" — and it is also what makes the approval mean
 * something, since somebody who could edit the document could change what they approved.
 */
/**
 * Exported, because "who can approve this?" is asked in two other places and both of
 * them were answering it with the single role APPROVER. An owner and an administrator
 * approve too — `canApprove` says so three lines below — so a company whose only
 * approvers were administrators was reported as having none, and every route into it
 * was refused on behalf of people who were standing right there.
 */
export const APPROVE_ROLES = ['OWNER', 'ADMIN', 'APPROVER'] as const

export function canApprove(role: string) {
  return (APPROVE_ROLES as readonly string[]).includes(role)
}

/**
 * Recording that money left: the accountant, and the people who already could.
 *
 * ACCOUNTANT is deliberately absent from canApprove. The person who clears a bill for
 * payment is never the person who settles it, which is the only control in this
 * workflow an audit actually cares about.
 */
/**
 * Deciding what is a bill — narrow on purpose.
 *
 * The accountant now owns every document that involves money: whether it has to be
 * paid, whether it is a bill at all, and who should handle it if it is not. That is
 * three actions over one kind of document, and it is emphatically *not* the triage
 * role: he does not reclassify entities, does not touch HR or operations, and does not
 * get the Review screen. Widening DECIDE_ROLES would have given him all of that in one
 * line, which is why this exists separately.
 *
 * Owner and administrator are here because they already hold everything; listing them
 * keeps the screen usable for whoever is covering.
 */
const PAYMENT_TRIAGE_ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT'] as const

/**
 * Putting a bill into the system by hand.
 *
 * Not every bill arrives as post that somebody scanned. A vendor emails an invoice to
 * the approver; a subscription renews and the receipt is a web page; the accountant is
 * sent a statement directly. Until now none of those had a way in: uploading belongs to
 * the people who process the post, so the approver and the accountant — the two whose
 * whole job is bills — could not add one. Their only route was to forward it to
 * somebody with an upload button and wait.
 *
 * Wider than UPLOAD_ROLES because it is a different act: this is not "process the day's
 * post", it is "here is one bill I already know about".
 */
const ADD_BILL_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'APPROVER', 'ACCOUNTANT'] as const

export function canAddBill(role: string) {
  return (ADD_BILL_ROLES as readonly string[]).includes(role)
}

export function canTriagePayments(role: string) {
  return (PAYMENT_TRIAGE_ROLES as readonly string[]).includes(role)
}

const SETTLE_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'ACCOUNTANT'] as const

export function canSettle(role: string) {
  return (SETTLE_ROLES as readonly string[]).includes(role)
}

/**
 * Reaching the archive at all — which is not the same as seeing all of it.
 *
 * The approver and the accountant both need to find an old invoice, so they are here;
 * what they can then see is cut down to their entities by visibleEntityIds. Those two
 * questions are separate on purpose: one is "may you open this screen", the other is
 * "whose documents are on it", and conflating them is how a scoped role ends up seeing
 * everything the moment somebody adds a page.
 */
const ARCHIVE_ROLES = [
  'OWNER',
  'ADMIN',
  'OPERATOR',
  'VIEWER',
  'MEMBER',
  'APPROVER',
  'ACCOUNTANT',
] as const

export function canSearchArchive(role: string) {
  return (ARCHIVE_ROLES as readonly string[]).includes(role)
}

/**
 * Acting on a document that is already on the board: finishing it, handing it on,
 * paying it, or saying it needed no action after all.
 *
 * VIEWER is excluded and everybody else is in, including MEMBER. That is deliberate and
 * it is the point of a shared board: an item only one person can touch is an item that
 * stops moving the week they are away, and nobody finds out.
 *
 * It is narrower than it looks. This is only the open action items — documents somebody
 * has already decided need a person. Deciding what an *unreviewed* document is stays
 * with triage, on the Review screen.
 */
const DECIDE_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER'] as const

export function canDecide(role: string) {
  return (DECIDE_ROLES as readonly string[]).includes(role)
}

/**
 * Doing the work: queues, bills, the log, documents. Everybody except the scanner.
 *
 * Named positively rather than as "not UPLOADER" so that the next narrow role added
 * also starts with no access to any of it.
 */
const WORK_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'VIEWER'] as const

export function canConfigure(role: string) {
  return (CONFIGURE_ROLES as readonly string[]).includes(role)
}

export function canTriage(role: string) {
  return (TRIAGE_ROLES as readonly string[]).includes(role)
}

export function canUpload(role: string) {
  return (UPLOAD_ROLES as readonly string[]).includes(role)
}

export function canWork(role: string) {
  return (WORK_ROLES as readonly string[]).includes(role)
}

/**
 * Who may browse the group-wide master log.
 *
 * MEMBER is the standard operational role and is deliberately excluded: they work the
 * documents routed to them and see those, rather than the whole group's mail. VIEWER is
 * included because read-only-across-everything is the entire point of that role.
 */
const FULL_LOG_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] as const

export function canSeeWholeLog(role: string) {
  return (FULL_LOG_ROLES as readonly string[]).includes(role)
}

/**
 * Triage work — uploading batches, reading, classifying, importing. A MEMBER receives
 * documents; they do not decide what arrives or how it is filed. Hiding the nav link is
 * not enough, so every such page and action calls this.
 */
export async function requireTriage(): Promise<Session> {
  const session = await requireSession()
  /*
   * Home, not the board.
   *
   * Sending a narrow role to `/` sends it somewhere it is also not allowed, which
   * redirects again — and a person watching two redirects go past does not read it as
   * "you may not do that", they read it as having been thrown out. The scanner reported
   * exactly that: "it disappeared and logged me out." `requireWorker` already sends
   * people to their own home for this reason; this one did not.
   */
  if (!canTriage(session.role)) redirect(homeOf(session))
  return session
}

/** Acting on an item that is already on the board. */
export async function requireBillAdder(): Promise<Session> {
  const session = await requireSession()
  if (!canAddBill(session.role)) redirect(homeOf(session))
  return session
}

/** The accountant's inbox, and nothing else. */
export async function requirePaymentTriage(): Promise<Session> {
  const session = await requireSession()
  if (!canTriagePayments(session.role)) redirect(homeOf(session))
  return session
}

export async function requireDecider(): Promise<Session> {
  const session = await requireSession()
  if (!canDecide(session.role)) redirect('/')
  return session
}

/** The approvals screen. */
export async function requireApprover(): Promise<Session> {
  const session = await requireSession()
  if (!canApprove(session.role)) redirect('/')
  return session
}

/** The accountant's screen. */
export async function requireSettler(): Promise<Session> {
  const session = await requireSession()
  if (!canSettle(session.role)) redirect('/')
  return session
}

/** Just the upload screen, which is all the scanner needs. */
export async function requireUpload(): Promise<Session> {
  const session = await requireSession()
  if (!canUpload(session.role)) redirect('/')
  return session
}

/**
 * Any screen that shows a document, a queue or a total.
 *
 * The scanner is sent to the one screen she does have, rather than to a dead end: her
 * landing page, every stray link and any old bookmark all end up at Upload.
 */
export async function requireWorker(): Promise<Session> {
  const session = await requireSession()
  if (canWork(session.role)) return session

  // Each narrow role has exactly one home. Sending them to a dead end, or to a screen
  // that redirects again, is how a person decides the tool is not for them.
  redirect(homeOf(session))
}

/** Where a role's own work lives, and where every stray link should land. */
/**
 * Where somebody lands, by role.
 *
 * `homeOf` is what callers should use: it lets a person's own setting win, and falls
 * back to this. Kept separate because the fallback is a property of the role and is
 * needed on its own — the Members screen shows it as the default beside the override.
 */
export function homeFor(role: string) {
  if (role === 'UPLOADER') return '/upload'
  if (role === 'APPROVER') return '/approvals'
  if (role === 'ACCOUNTANT') return '/accounting'
  return '/'
}

/**
 * Every screen a person can be sent home to.
 *
 * A closed list, because the value is written by an administrator and then handed to
 * `redirect`: anything not on it is ignored and the role decides instead. An override
 * pointing at a screen the person cannot open would recreate the bounce this whole
 * change is meant to remove, so the Members screen only offers the ones their role can
 * actually reach — and this list is the second guard behind that.
 */
export const HOME_CHOICES = [
  { path: '/', label: 'Needs a decision', allowed: canWork },
  { path: '/approvals', label: 'Bills to approve', allowed: canApprove },
  { path: '/accounting', label: 'Accounting', allowed: canSettle },
  { path: '/upload', label: 'Upload a batch', allowed: canUpload },
  { path: '/health', label: 'Health', allowed: canConfigure },
  { path: '/log', label: 'Master log', allowed: canSearchArchive },
] as const

/** Where this person lands: their own choice where they have a usable one, else the role's. */
export function homeOf(session: Pick<Session, 'role' | 'homePath'>) {
  const chosen = HOME_CHOICES.find((c) => c.path === session.homePath)
  return chosen && chosen.allowed(session.role) ? chosen.path : homeFor(session.role)
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession()
  if (!canConfigure(session.role)) redirect('/')
  return session
}

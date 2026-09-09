import { cache } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/server/db/client'
import { resolveMembership } from '@/server/workspace'

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
  /** The active workspace's name, for the switcher in the header. */
  companyGroupName: string
  userName: string
  userEmail: string
  userImage: string | null
}

/** Returns null when nobody is signed in, instead of redirecting. */
export const getSession = cache(async (): Promise<Session | null> => {
  const authed = await auth()
  const userId = authed?.user?.id
  if (!userId) return null

  // Which workspace, not just which person. Membership is re-read on every request, so
  // a revoked one takes effect immediately and a cookie naming a workspace someone no
  // longer belongs to is simply ignored.
  const membership = await resolveMembership(userId)
  if (!membership) return null

  return {
    userId: membership.userId,
    companyGroupId: membership.companyGroupId,
    role: membership.role,
    companyGroupName: membership.companyGroup.name,
    userName: membership.user.name ?? membership.user.email,
    userEmail: membership.user.email,
    userImage: membership.user.image,
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
const CONFIGURE_ROLES = ['OWNER', 'ADMIN'] as const

/** Uploading, reading with the AI, classifying, importing history. */
const TRIAGE_ROLES = ['OWNER', 'ADMIN', 'OPERATOR'] as const

/** Putting scans in. The scanner can do this and nothing else. */
const UPLOAD_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'UPLOADER'] as const

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
  if (!canTriage(session.role)) redirect('/')
  return session
}

/** Acting on an item that is already on the board. */
export async function requireDecider(): Promise<Session> {
  const session = await requireSession()
  if (!canDecide(session.role)) redirect('/')
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
  if (!canWork(session.role)) redirect('/upload')
  return session
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession()
  if (!canConfigure(session.role)) redirect('/')
  return session
}

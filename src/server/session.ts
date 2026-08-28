import { cache } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/server/db/client'

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
  userName: string
  userEmail: string
  userImage: string | null
}

/** Returns null when nobody is signed in, instead of redirecting. */
export const getSession = cache(async (): Promise<Session | null> => {
  const authed = await auth()
  const userId = authed?.user?.id
  if (!userId) return null

  const membership = await prisma.membership.findFirst({
    where: { userId, isActive: true },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!membership) return null

  return {
    userId: membership.userId,
    companyGroupId: membership.companyGroupId,
    role: membership.role,
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

/** Roles that may change configuration. */
export const ADMIN_ROLES = ['OWNER', 'ADMIN', 'OPERATOR'] as const

export function isAdmin(role: string) {
  return (ADMIN_ROLES as readonly string[]).includes(role)
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
 * Triage work — uploading batches and classifying — belongs to the roles that oversee
 * the whole log. A MEMBER receives documents; they do not decide what arrives or how it
 * is filed. Hiding the nav link is not enough, so every such page and action calls this.
 */
export async function requireTriage(): Promise<Session> {
  const session = await requireSession()
  if (!isAdmin(session.role)) redirect('/')
  return session
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession()
  if (!isAdmin(session.role)) redirect('/log')
  return session
}

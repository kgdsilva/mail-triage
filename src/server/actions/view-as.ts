'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/server/db/client'
import { VIEW_AS_COOKIE } from '@/server/view-as'
import { canConfigure, getRealSession, homeFor } from '@/server/session'

/**
 * Entering and leaving somebody else's view.
 *
 * Both write a cookie and nothing else, which is deliberate: the database client refuses
 * every write while the cookie is set, so an action that had to record anything would be
 * an action that cannot turn the mode off again.
 */

/** Who an administrator may look at: everybody active in their own workspace but them. */
export async function viewableMembers() {
  const real = await getRealSession()
  if (!real || !canConfigure(real.role)) return []

  const memberships = await prisma.membership.findMany({
    where: {
      companyGroupId: real.companyGroupId,
      isActive: true,
      userId: { not: real.userId },
    },
    orderBy: { createdAt: 'asc' },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
  })

  return memberships.map((m) => ({
    id: m.user.id,
    name: m.user.name?.trim() || m.user.email,
    role: m.role,
  }))
}

export async function viewAs(
  userId: string,
): Promise<{ ok: boolean; error?: string; href?: string }> {
  // The real session, never the viewed one — otherwise somebody who had been put into a
  // view could hop from it to another, and the administrator check would be answered by
  // whoever they were currently pretending to be.
  const real = await getRealSession()
  if (!real || !canConfigure(real.role)) {
    return { ok: false, error: 'Only an administrator can do that.' }
  }
  if (userId === real.userId) return { ok: false, error: 'That is already you.' }

  const target = await prisma.membership.findFirst({
    where: { userId, companyGroupId: real.companyGroupId, isActive: true },
    select: { userId: true, role: true },
  })
  if (!target) return { ok: false, error: 'That person is not an active member here.' }

  const jar = await cookies()
  jar.set(VIEW_AS_COOKIE, target.userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // No maxAge: it ends with the browser session. A preview left on for a week is a
    // person wondering for a week why none of their buttons work.
  })

  revalidatePath('/', 'layout')

  /*
   * Where that person starts their day, which the caller navigates to.
   *
   * Not a nicety. Staying put means landing on a screen the viewed role cannot open —
   * an approver has no board — and the redirect that normally handles that does not
   * reach the browser when the render was triggered by an action rather than by a
   * navigation. The screen came back blank, which looks exactly like a broken feature.
   */
  return { ok: true, href: homeFor(target.role) }
}

export async function stopViewingAs(): Promise<{ ok: true }> {
  const jar = await cookies()
  jar.delete(VIEW_AS_COOKIE)
  revalidatePath('/', 'layout')
  return { ok: true }
}

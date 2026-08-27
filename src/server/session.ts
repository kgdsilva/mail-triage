import { cache } from 'react'
import { prisma } from '@/server/db/client'

/**
 * Who is acting, and in which company group.
 *
 * Phase 1 has no sign-in yet: Kauê is the only operator, testing against real historical
 * documents. Rather than scatter that assumption through the app, it is isolated here —
 * every page and action resolves the actor through `requireSession()`, so wiring Auth.js
 * in Phase 2 means changing this file and nothing else.
 *
 * The dev fallback refuses to run in production, so shipping without finishing auth
 * fails loudly instead of silently exposing the log.
 */

export type Session = {
  userId: string
  companyGroupId: string
  role: string
  userName: string
  /** True while running on the Phase 1 fallback rather than a real sign-in. */
  isDevFallback: boolean
}

export const requireSession = cache(async (): Promise<Session> => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'No authentication configured. Wire Auth.js in src/server/session.ts before deploying.',
    )
  }

  const membership = await prisma.membership.findFirst({
    where: { isActive: true },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  })

  if (!membership) {
    throw new Error('No membership found — run `npm run db:seed`.')
  }

  return {
    userId: membership.userId,
    companyGroupId: membership.companyGroupId,
    role: membership.role,
    userName: membership.user.name ?? membership.user.email,
    isDevFallback: true,
  }
})

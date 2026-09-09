'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/server/db/client'
import { requireSession } from '@/server/session'
import { WORKSPACE_COOKIE } from '@/server/workspace'

/**
 * Switches which workspace the browser is looking at.
 *
 * Membership is checked here and again on every request that reads the cookie. Checking
 * twice is not redundant: this stops a bad id being written, and the read-side check
 * stops one that was written before a membership was revoked.
 *
 * Redirects to the dashboard rather than staying put. The current URL usually names
 * something that only exists in the workspace being left — an entity, a document, a
 * filtered log — and landing on a page that says "not found" is a worse answer than
 * landing at the top of the workspace you asked for.
 */
export async function switchWorkspace(companyGroupId: string) {
  const session = await requireSession()

  const membership = await prisma.membership.findFirst({
    where: { userId: session.userId, companyGroupId, isActive: true },
    select: { id: true },
  })
  if (!membership) throw new Error('No access to that workspace')

  const jar = await cookies()
  jar.set(WORKSPACE_COOKIE, companyGroupId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  redirect('/')
}

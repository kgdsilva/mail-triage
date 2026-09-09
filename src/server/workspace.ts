import { cookies } from 'next/headers'
import { prisma } from '@/server/db/client'

/**
 * Which workspace someone is looking at.
 *
 * A workspace is a `CompanyGroup` — the tenant boundary the schema has had from the
 * start. Megan's companies and Megan's personal items share nothing: separate entities,
 * separate document types, separate folder trees, separate logs. That is the point.
 * They are not two views of one pile, and a document can never drift between them.
 *
 * The choice lives in a cookie rather than on the user record, because it is a per-
 * browser preference and not a fact about the person — and because it is therefore
 * untrusted input. `resolveWorkspace` only honours it when an active membership backs
 * it up, so editing the cookie by hand buys nothing.
 */
export const WORKSPACE_COOKIE = 'workspace'

export type Workspace = {
  id: string
  name: string
  slug: string
  role: string
}

/** Every workspace this person may act in, oldest membership first. */
export async function listWorkspaces(userId: string): Promise<Workspace[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId, isActive: true },
    include: { companyGroup: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  })

  return memberships.map((m) => ({
    id: m.companyGroup.id,
    name: m.companyGroup.name,
    slug: m.companyGroup.slug,
    role: m.role,
  }))
}

/**
 * The membership to act under: the one named by the cookie when it is real, otherwise
 * the oldest.
 *
 * Falling back rather than failing matters — a cookie can name a workspace someone was
 * just removed from, and being shown their remaining workspace is better than being
 * treated as signed out.
 */
export async function resolveMembership(userId: string) {
  const jar = await cookies()
  const wanted = jar.get(WORKSPACE_COOKIE)?.value

  if (wanted) {
    const chosen = await prisma.membership.findFirst({
      where: { userId, isActive: true, companyGroupId: wanted },
      include: { user: true, companyGroup: { select: { name: true } } },
    })
    if (chosen) return chosen
  }

  return prisma.membership.findFirst({
    where: { userId, isActive: true },
    include: { user: true, companyGroup: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

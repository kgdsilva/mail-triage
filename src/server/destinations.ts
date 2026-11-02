import { prisma } from '@/server/db/client'
import { configuredReturnRole, returnChain } from '@/server/returns'

/**
 * Who the next person actually is, by name.
 *
 * `returnTo` answers the same question with an id, because an id is what the database
 * column takes. A screen needs the name, and asking for one does not justify a second
 * copy of the fallback chain — so this reads the chain from `returns` and only differs
 * in what it selects.
 */

const SETTLE_CHAIN = ['ACCOUNTANT', 'OWNER', 'ADMIN', 'OPERATOR', 'MEMBER'] as const

const display = (u: { name: string | null; email: string } | null) =>
  u ? (u.name?.trim() || u.email) : null

/**
 * Who pays here.
 *
 * The accountant first, then whoever else is allowed to settle — matching SETTLE_ROLES,
 * because a name this returns has to be a person who can actually reach the button. An
 * office with no accountant gets null and the caller says "accounting" instead, which is
 * true and vague rather than false and specific.
 */
export async function settlerName(companyGroupId: string): Promise<string | null> {
  for (const role of SETTLE_CHAIN) {
    const member = await prisma.membership.findFirst({
      where: { companyGroupId, role, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { name: true, email: true } } },
    })
    if (member) return display(member.user)
  }
  return null
}

/** Who a refused bill lands on, by name — the same chain `returnTo` assigns it to. */
export async function returneeName(companyGroupId: string): Promise<string | null> {
  const group = await prisma.companyGroup.findUnique({
    where: { id: companyGroupId },
    select: { settings: true },
  })

  for (const role of returnChain(configuredReturnRole(group?.settings))) {
    const member = await prisma.membership.findFirst({
      where: { companyGroupId, role, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: { name: true, email: true } } },
    })
    if (member) return display(member.user)
  }
  return null
}

/** One person's name for a sentence, when all the caller has is their id. */
export async function nameOf(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  })
  return display(user)
}

/**
 * Who approves, per company, in one query.
 *
 * `approversFor` answers this for a single company and is the right shape before a
 * write — it is asked once, and refusing is the point. A list of thirty rows asking it
 * per row is thirty round trips for five answers, so the whole table is read once and
 * indexed here.
 */
export async function approverIndex(companyGroupId: string) {
  const memberships = await prisma.membership.findMany({
    where: { companyGroupId, isActive: true, role: 'APPROVER' },
    orderBy: { createdAt: 'asc' },
    select: { entityScope: true, user: { select: { name: true, email: true } } },
  })

  return (entityId: string | null): string | null => {
    if (!entityId) return null
    const names = memberships
      // An empty scope means every company, the same rule approversFor applies.
      .filter((m) => m.entityScope.length === 0 || m.entityScope.includes(entityId))
      .map((m) => display(m.user))
      .filter((n): n is string => Boolean(n))

    return names.length ? names.join(' and ') : null
  }
}

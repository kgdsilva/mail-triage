import { prisma } from '@/server/db/client'
import { configuredReturnRole, returnChain } from '@/server/returns'
import { APPROVE_ROLES } from '@/server/session'

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
export async function settler(
  companyGroupId: string,
): Promise<{ userId: string; name: string } | null> {
  for (const role of SETTLE_CHAIN) {
    const member = await prisma.membership.findFirst({
      where: { companyGroupId, role, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, user: { select: { name: true, email: true } } },
    })
    if (member) {
      const name = display(member.user)
      if (name) return { userId: member.userId, name }
    }
  }
  return null
}

/**
 * The same person, when only the name is wanted.
 *
 * The id comes back too because "is this me?" has to be asked of the person, not of
 * their display name — two people called Danny would otherwise be the same person to
 * any screen that compared the words.
 */
export async function settlerName(companyGroupId: string): Promise<string | null> {
  return (await settler(companyGroupId))?.name ?? null
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
    // Everybody who can approve, not everybody who holds the approver role: an owner
    // and an administrator can clear a bill, and asking only for APPROVER reported a
    // company as having nobody while three people who could were signed in.
    where: { companyGroupId, isActive: true, role: { in: [...APPROVE_ROLES] } },
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

    /*
     * "or", not "and": any one of them can clear the bill, and "Eric and Eric Demo"
     * reads as both signatures being needed. Approval here is single-signature by
     * design — two names are two routes to the same yes.
     */
    return names.length ? names.join(' or ') : null
  }
}

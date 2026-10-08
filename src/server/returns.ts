import { prisma } from '@/server/db/client'

/**
 * Where a refused bill goes back to.
 *
 * To a role, never to a name. Whoever runs the post changes, goes away and hands the job
 * on; a bill addressed to a role keeps arriving, and one addressed to a person stops the
 * week they are out.
 *
 * **Which** role is a per-company question, which is why it is a setting rather than a
 * constant: the titles mean different things in different businesses. Here the owner is
 * the person who actually reads the post and the admin role belongs to somebody else, so
 * OWNER is the default — and a company where that is not true sets it in
 * Settings → Workflow rather than editing code.
 *
 * Its own module, not the server action file: `'use server'` modules may only export
 * async functions, so a shared constant or a plain helper cannot live there. Which is
 * also why the policy reads better here — the action decides *that* a bill is refused,
 * this decides *where* it lands.
 */

export type ReturnRole = 'OWNER' | 'ADMIN' | 'OPERATOR'

/**
 * The default, and the order to fall back through: most likely to be reading the post
 * first. The first entry is what an unconfigured company gets.
 */
export const RETURN_ROLES: ReturnRole[] = ['OWNER', 'ADMIN', 'OPERATOR']

export const DEFAULT_RETURN_ROLE: ReturnRole = RETURN_ROLES[0]

/** The configured role first, then the rest. Pure, so it can be checked without a database. */
export function returnChain(configured: string | undefined): ReturnRole[] {
  const first = RETURN_ROLES.find((r) => r === configured)
  return first ? [first, ...RETURN_ROLES.filter((r) => r !== first)] : RETURN_ROLES
}

/** What a company has chosen, or the default when it has not chosen. */
export function configuredReturnRole(settings: unknown): ReturnRole {
  const value = (settings as { returnedBillsRole?: string } | null)?.returnedBillsRole
  return RETURN_ROLES.find((r) => r === value) ?? DEFAULT_RETURN_ROLE
}

/**
 * The person a refused bill is assigned to right now.
 *
 * The fallback chain matters as much as the setting. If nobody holds the configured role
 * the bill tries the next one rather than failing, and if nobody holds any of them it is
 * returned **unassigned** — which still shows up, on the board's "Nobody yet" tab. A
 * refused bill addressed to a person who does not exist is indistinguishable from one
 * that went nowhere.
 */
export async function returnTo(companyGroupId: string): Promise<string | null> {
  const group = await prisma.companyGroup.findUnique({
    where: { id: companyGroupId },
    select: { settings: true },
  })

  for (const role of returnChain(configuredReturnRole(group?.settings))) {
    const member = await prisma.membership.findFirst({
      where: { companyGroupId, role, isActive: true },
      // The longest-standing holder of the role, so the choice is the same every time
      // rather than depending on query order.
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    })
    if (member) return member.userId
  }

  return null
}

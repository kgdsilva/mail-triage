import { prisma } from '@/server/db/client'
import { canConfigure, type Session } from '@/server/session'

/**
 * Whose documents a person may see.
 *
 * Resolved to a concrete list of entity ids rather than expressed as a set of conditions
 * each caller assembles. Two reasons, and the second is the important one.
 *
 * A list is trivially correct: every query becomes `entityId: { in: ids }`, which cannot
 * accidentally widen the way a composed `OR` can, and a document with no entity at all
 * is excluded without anybody having to remember that case — which is right, because
 * unidentified mail is triage's problem and not an approver's.
 *
 * And it keeps two rules in one place. An approver sees the companies named in their
 * membership scope; everybody who is not an administrator is additionally blind to a
 * segregated entity, which is how OP stays admin-only without the word "OP" appearing
 * anywhere in the code. Spread across the screens, those two rules would be seven
 * chances to forget one.
 *
 * Returns `null` for "every entity, no restriction" — the administrators. Callers treat
 * null as "add no filter", so the common case costs nothing.
 */
export async function visibleEntityIds(session: Session): Promise<string[] | null> {
  if (canConfigure(session.role)) return null

  const entities = await prisma.entity.findMany({
    where: {
      companyGroupId: session.companyGroupId,
      // Segregated means "its own view" for an administrator and "not yours" for
      // everybody else. The brief's rule — OP is never exposed outside admins — is this
      // line, and it holds for any company marked that way later.
      isSegregated: false,
      ...(session.entityScope.length > 0 ? { id: { in: session.entityScope } } : {}),
    },
    select: { id: true },
  })

  return entities.map((e) => e.id)
}

/**
 * The same thing as a Prisma fragment, for spreading into a `where`.
 *
 * `{}` for an administrator and `{ entityId: { in: [...] } }` for everybody else,
 * including the empty list — an approver with no companies assigned sees nothing, which
 * is the safe reading of "not configured yet".
 */
export function entityWhere(ids: string[] | null) {
  return ids === null ? {} : { entityId: { in: ids } }
}

/** The companies to offer in a picker: the ones this person can actually open. */
export async function visibleEntities(session: Session) {
  const ids = await visibleEntityIds(session)

  return prisma.entity.findMany({
    where: {
      companyGroupId: session.companyGroupId,
      isActive: true,
      ...(ids === null ? {} : { id: { in: ids } }),
    },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, code: true, legalName: true, sortOrder: true },
  })
}

/**
 * Narrows a company chosen in a query string to one this person may actually see.
 *
 * Applied after parsing and never before: a filter is a convenience, a scope is a
 * boundary, and the only way to keep them from being confused is for the boundary to
 * have the last word.
 */
export function narrowEntityChoice(chosen: string | null | undefined, ids: string[] | null) {
  if (!chosen) return null
  if (ids === null) return chosen
  return ids.includes(chosen) ? chosen : null
}

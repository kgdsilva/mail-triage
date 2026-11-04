import { cookies } from 'next/headers'

/**
 * An administrator looking at the app through somebody else's eyes.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * Every role here sees a different application — an approver has one screen, the
 * accountant has another, the office has the board — and until now the only way to know
 * what any of them actually looked like was to be told. "I'm just trusting you about
 * Danny's view and Eric's view" is a fair complaint and a dangerous position to be in
 * the week two new people are added.
 *
 * ---------------------------------------------------------------------------
 * Why it is read-only, and how that is enforced
 * ---------------------------------------------------------------------------
 *
 * Because an approval is a claim about a person. The one control this workflow has is
 * that the name on a decision is the name of whoever made it, and an administrator who
 * could approve while wearing somebody else's face would end that — not by being abused,
 * but by making every approval arguable afterwards.
 *
 * So it is not enforced by remembering to check in each action. It is enforced in the
 * database client: while this cookie is set, every write Prisma is asked to perform is
 * refused. A screen or an action added next year is covered without knowing this exists,
 * which is the only kind of guard worth having for something like this.
 */

export const VIEW_AS_COOKIE = 'mt_view_as'

/** Who the viewer has asked to be, if anybody. Null outside a request. */
export async function viewingAsUserId(): Promise<string | null> {
  try {
    const jar = await cookies()
    return jar.get(VIEW_AS_COOKIE)?.value?.trim() || null
  } catch {
    // No request to read — a script, or a build. Nobody is viewing as anybody.
    return null
  }
}

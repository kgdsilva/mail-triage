import { redirect } from 'next/navigation'
import { homeOf, requireSession } from '@/server/session'

export const dynamic = 'force-dynamic'

/**
 * Where signing in lands, so that it can send each person to their own screen.
 *
 * Sign-in used to point at `/`, and `/` is the shared board. For the narrow roles that
 * was corrected on arrival — the board bounces an approver on to Approvals — but for an
 * administrator it was not, because an administrator may open the board, so nothing
 * objected. One of the two administrators here runs the office and wants it; the other
 * owns the companies and wants to be told only when something is broken.
 *
 * A route rather than a rule on `/` itself: a rule there would mean nobody whose home is
 * elsewhere could ever open the board on purpose, and the board is still in their menu.
 * This page exists only to be redirected away from.
 */
export default async function HomePage() {
  const session = await requireSession()
  redirect(homeOf(session))
}

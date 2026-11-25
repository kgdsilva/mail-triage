import { NextResponse, type NextRequest } from 'next/server'

/**
 * Everything happens on one host, because sign-in cannot survive two.
 *
 * ---------------------------------------------------------------------------
 * What was wrong
 * ---------------------------------------------------------------------------
 *
 * This app answers on two production hosts: the custom domain and the Vercel one. Auth.js
 * is pinned to the custom domain by AUTH_URL, which is correct — but it means the Vercel
 * host advertises the *other* host's callback:
 *
 *   https://mail-triage-xi.vercel.app/api/auth/providers
 *     → callbackUrl: https://triage.mycolabhq.com/api/auth/callback/google
 *
 * So a Google sign-in begun on the Vercel host sets its state and PKCE cookies on that
 * origin, Google returns the browser to the custom domain, and the callback looks for
 * cookies that were never set there. It fails the state check and redirects to
 * /signin?error=OAuthCallback — which was not in the message table, so the screen said
 * "Sign-in failed. Try again." and nothing else.
 *
 * It looked intermittent because it is: it depends entirely on which of the two URLs the
 * person happens to have open. Whoever bookmarked the Vercel one could never sign in
 * with Google, and whoever used the custom domain never saw a problem — which is also
 * why it survived so long.
 *
 * ---------------------------------------------------------------------------
 * Why a redirect rather than a second AUTH_URL
 * ---------------------------------------------------------------------------
 *
 * There can only be one AUTH_URL, and OAuth redirect URIs are registered per exact URL
 * with Google. Making both hosts work would mean registering both and letting sessions
 * exist on two origins — two sets of cookies, two places to sign out of. One canonical
 * host is simpler and is what every link in the app already assumes.
 *
 * The redirect is permanent and keeps the path and query, so an old bookmark lands
 * exactly where it was aiming.
 */

/** Taken from AUTH_URL so the canonical host cannot drift from the one Auth.js uses. */
function canonicalHost(): string | null {
  const configured = process.env.AUTH_URL?.trim()
  if (!configured) return null
  try {
    const { hostname, protocol } = new URL(configured)
    // Only in production, and never for a local address: a developer running on
    // localhost must not be redirected anywhere.
    if (protocol !== 'https:') return null
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return null
    return hostname
  } catch {
    return null
  }
}

export function middleware(request: NextRequest) {
  const host = canonicalHost()
  if (!host) return NextResponse.next()

  const current = request.nextUrl.hostname
  if (current === host) return NextResponse.next()

  /*
   * A Vercel preview deployment has its own hostname by design and its own database; it
   * must not be sent to production. Previews are *.vercel.app too, so the environment is
   * what distinguishes them, not the name.
   */
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return NextResponse.next()
  }

  const target = new URL(request.nextUrl)
  target.hostname = host
  target.protocol = 'https:'
  target.port = ''
  return NextResponse.redirect(target, 308)
}

export const config = {
  /*
   * Everything except Next's own assets. The auth routes are deliberately included:
   * reaching one of them on the wrong host is the failure this exists to prevent, and a
   * redirect there is harmless because the flow has not begun yet.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

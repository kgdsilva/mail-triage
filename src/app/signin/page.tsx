import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { getSession } from '@/server/session'
import { BTN } from '@/lib/theme'

export const dynamic = 'force-dynamic'

/**
 * Every failure Auth.js can hand this page, named.
 *
 * Four codes were listed and everything else fell through to "Sign-in failed. Try
 * again." — which is what people were reporting, because the code they were actually
 * getting was OAuthCallback and it was not one of the four. A message that says only
 * "it failed" sends the person back to press the same button again, and then to message
 * somebody; it is the reason this looked like a mystery for weeks rather than a setting.
 *
 * None of these leak anything: Auth.js has already decided to refuse, and the person is
 * being told which of their own circumstances to change.
 */
const MESSAGES: Record<string, string> = {
  'not-invited':
    'That account is not a member of this workspace. Ask an admin to add your email, then try again.',
  /*
   * One sentence for an unknown email, a wrong password and a revoked membership, and
   * deliberately so: `authorize` returns the same null for all three precisely so this
   * page cannot be used to find out which addresses have accounts. Naming the cause here
   * would undo that, and the people it would help are the ones an admin can tell
   * directly.
   */
  'bad-credentials': 'Wrong email or password.',
  OAuthAccountNotLinked: 'That email is already registered through a different sign-in method.',
  AccessDenied: 'Sign-in was refused for that account.',
  // The state or PKCE cookie did not come back with the browser. Nearly always because
  // the flow started on one address and Google returned it to another.
  OAuthCallback:
    'Google sent you back and this could not match the request. Open triage.mycolabhq.com directly and try again — a bookmark to the old address does this.',
  OAuthCallbackError:
    'Google sent you back and this could not match the request. Open triage.mycolabhq.com directly and try again.',
  OAuthSignin: 'Google could not be reached. Try again in a moment.',
  Callback: 'Something went wrong finishing the sign-in. Try again.',
  Configuration:
    'Sign-in is misconfigured on the server. This one is not yours to fix — tell an admin.',
  Verification: 'That sign-in link has already been used, or has expired.',
  SessionRequired: 'Sign in to open that page.',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await getSession()) redirect('/')
  const { error } = await searchParams

  const inputClass =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none transition-colors placeholder:text-subtle focus:border-navy-500'

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 shadow-[0_1px_3px_rgba(18,40,74,0.07)]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="h-6 w-2.5 rounded-sm bg-gold-500" aria-hidden />
          <h1 className="text-[19px] font-bold tracking-tight text-navy-900">Mail Triage</h1>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-danger-100 px-3 py-2 text-xs text-danger-700">
            {MESSAGES[error] ?? 'Sign-in failed. Try again.'}
          </p>
        )}

        <form
          action={async (formData: FormData) => {
            'use server'
            try {
              await signIn('credentials', {
                email: String(formData.get('email') ?? ''),
                password: String(formData.get('password') ?? ''),
                redirectTo: '/home',
              })
            } catch (err) {
              // next-auth signals a successful redirect by throwing, so only a real
              // AuthError means the credentials were rejected.
              if (err instanceof AuthError) redirect('/signin?error=bad-credentials')
              throw err
            }
          }}
          className="mt-6 space-y-3"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-xs text-muted">
              Email
            </label>
            <input id="email" name="email" type="email" required autoComplete="username" className={inputClass} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs text-muted">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          <button className={`w-full py-2.5 text-sm ${BTN.primary}`}>Sign in</button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-subtle">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/home' })
          }}
        >
          <button className={`w-full py-2.5 text-sm ${BTN.secondary}`}>
            Continue with Google
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-subtle">
          Accounts are created by an admin. There is no self-signup.
        </p>
      </div>
    </main>
  )
}

import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { getSession } from '@/server/session'

export const dynamic = 'force-dynamic'

const MESSAGES: Record<string, string> = {
  'not-invited':
    'That account is not a member of this workspace. Ask an admin to add your email, then try again.',
  'bad-credentials': 'Wrong email or password.',
  OAuthAccountNotLinked: 'That email is already registered through a different sign-in method.',
  AccessDenied: 'Sign-in was refused for that account.',
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
                redirectTo: '/',
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
          <button className="w-full rounded-lg bg-navy-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-900">
            Sign in
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-subtle">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/' })
          }}
        >
          <button className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-navy-700 transition-colors hover:border-navy-500 hover:bg-navy-50">
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

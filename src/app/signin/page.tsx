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
    'w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950'

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded border border-neutral-200 bg-white p-8 dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-center text-lg font-semibold">Mail Triage</h1>

        {error && (
          <p className="mt-4 rounded bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
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
            <label htmlFor="email" className="mb-1 block text-xs text-neutral-500">
              Email
            </label>
            <input id="email" name="email" type="email" required autoComplete="username" className={inputClass} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs text-neutral-500">
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
          <button className="w-full rounded bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
            Sign in
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-neutral-400">
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          or
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>

        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/' })
          }}
        >
          <button className="w-full rounded border border-neutral-300 px-4 py-2.5 text-sm font-medium dark:border-neutral-700">
            Continue with Google
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-400">
          Accounts are created by an admin. There is no self-signup.
        </p>
      </div>
    </main>
  )
}

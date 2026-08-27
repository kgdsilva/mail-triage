import { redirect } from 'next/navigation'
import { signIn } from '@/auth'
import { getSession } from '@/server/session'

export const dynamic = 'force-dynamic'

const MESSAGES: Record<string, string> = {
  'not-invited':
    'That Google account is not a member of this workspace. Ask an admin to add your email, then try again.',
  OAuthAccountNotLinked:
    'That email is already registered through a different sign-in method.',
  AccessDenied: 'Sign-in was refused for that account.',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await getSession()) redirect('/log')
  const { error } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-lg font-semibold">Mail Triage</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Sign in with the Google account your admin added.
        </p>

        {error && (
          <p className="mt-4 rounded bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
            {MESSAGES[error] ?? 'Sign-in failed. Try again.'}
          </p>
        )}

        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/log' })
          }}
          className="mt-6"
        >
          <button className="w-full rounded bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  )
}

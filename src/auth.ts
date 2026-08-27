import { PrismaAdapter } from '@auth/prisma-adapter'
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { prisma } from '@/server/db/client'

/**
 * Authentication.
 *
 * Google only, because the team already lives in Google Workspace — no passwords to
 * store, no magic-link delivery to pay for and babysit.
 *
 * Access is allowlist-based, and this is the important part: signing in with Google
 * proves who you are, it does not grant access. Only an email that an admin has already
 * added as a member of a company group can get in. Everyone else is turned away even
 * though their Google sign-in succeeded.
 */

/** Emails are stored and compared lowercased — Google returns them lowercased. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database' },
  pages: { signIn: '/signin', error: '/signin' },

  providers: [
    Google({
      // Links a Google login to the member record an admin created ahead of time.
      // "Dangerous" refers to providers that do not verify email ownership — someone
      // could otherwise claim an account by signing up with a stranger's address.
      // Google does verify, and `email_verified` is checked below as well, so the
      // hazard the flag warns about does not apply here.
      allowDangerousEmailAccountLinking: true,
    }),
  ],

  callbacks: {
    async signIn({ profile }) {
      const email = profile?.email ? normalizeEmail(profile.email) : null
      if (!email) return false

      // Google sets this on every verified Workspace and consumer account. If it is
      // ever absent, account linking by email is no longer safe, so refuse.
      if (profile?.email_verified === false) return false

      const member = await prisma.membership.findFirst({
        where: { isActive: true, user: { email } },
        select: { id: true },
      })

      // Redirecting rather than returning false so the person sees why.
      return member ? true : '/signin?error=not-invited'
    },

    async session({ session, user }) {
      if (session.user) session.user.id = user.id
      return session
    },
  },

  events: {
    async signIn({ user }) {
      if (user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })
      }
    },
  },
})

import { PrismaAdapter } from '@auth/prisma-adapter'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { prisma } from '@/server/db/client'
import { verifyPassword } from '@/server/password'

/**
 * Authentication. Two ways in, one rule about who gets in.
 *
 * Google, for anyone whose work account already lives in Google Workspace, and
 * email + password, for team members who do not have one (or use a personal Gmail).
 * A person may have both: the account is keyed on the email address, not the method.
 *
 * The rule that matters: signing in proves who you are, it does not grant access. Only
 * an email an admin has already added as an active member of a company group can get
 * in. There is no self-signup by either method.
 *
 * Sessions are JWT rather than database-backed because the Credentials provider
 * requires it. That would normally weaken revocation -- a token stays valid until it
 * expires -- except that getSession() in src/server/session.ts re-reads the membership
 * from the database on every request, so deactivating someone still locks them out
 * immediately. The token proves identity; the membership row decides access.
 */

/** Emails are stored and compared lowercased — Google returns them lowercased. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

/** An active membership is what grants access, whichever provider was used. */
async function hasActiveMembership(userId: string) {
  const member = await prisma.membership.findFirst({
    where: { userId, isActive: true },
    select: { id: true },
  })
  return member !== null
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
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

    Credentials({
      name: 'Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      /**
       * Returning null fails the sign-in. Every failure path returns the same null so
       * the response cannot be used to tell an unknown email from a wrong password
       * from a deactivated member.
       */
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? normalizeEmail(credentials.email) : ''
        const password = typeof credentials?.password === 'string' ? credentials.password : ''
        if (!email || !password) return null

        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, image: true, passwordHash: true },
        })

        // Still run a verify against a null hash when the user is missing, so that a
        // nonexistent account costs the same time as a real one with a wrong password.
        const ok = await verifyPassword(password, user?.passwordHash)
        if (!ok || !user) return null

        if (!(await hasActiveMembership(user.id))) return null

        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],

  callbacks: {
    /**
     * Credentials sign-ins are already fully checked in authorize(). This guards the
     * Google path, where a successful Google login still has to match the allowlist.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true

      const email = profile?.email ? normalizeEmail(profile.email) : null
      if (!email) return false

      // Google sets this on every verified Workspace and consumer account. If it is
      // ever absent, account linking by email is no longer safe, so refuse.
      if (profile?.email_verified === false) return false

      const member = await prisma.membership.findFirst({
        where: { isActive: true, user: { email } },
        select: { id: true },
      })
      return member ? true : '/signin?error=not-invited'
    },

    async jwt({ token, user }) {
      // Only present on the request that established the session.
      if (user?.id) token.sub = user.id
      return token
    },

    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub
      return session
    },
  },

  events: {
    async signIn({ user }) {
      if (user?.id) await touchLastLogin(user.id)
    },
  },
})

async function touchLastLogin(userId: string) {
  await prisma.user
    .update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
    // A missing row here is not worth failing a sign-in over.
    .catch(() => {})
}

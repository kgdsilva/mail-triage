import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

// Prisma 7 takes the connection through a driver adapter rather than a URL in the
// schema. The global cache keeps Next.js dev hot-reloads from opening a new pool
// on every recompile.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * Operations that change something. Everything else is a read.
 *
 * Listed rather than inferred from the name, because `upsert` and `createMany` do not
 * share a prefix with `create`, and a guard that works by guessing at names is a guard
 * that lets the next operation through.
 */
const WRITES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'executeRaw',
  '$executeRaw',
  '$executeRawUnsafe',
])

/**
 * Identity, which is not this application's data.
 *
 * NextAuth writes these when somebody signs in or links an account, and those have to
 * keep working while an administrator is viewing as somebody else — otherwise the way
 * out of the mode is broken by the mode. No action in this codebase writes them.
 */
const AUTH_MODELS = new Set(['User', 'Account', 'Session', 'VerificationToken'])

export class ReadOnlyWhileViewingAs extends Error {
  constructor() {
    super(
      'Nothing can be changed while you are viewing the app as somebody else. ' +
        'Leave that view first — a decision has to carry the name of the person who made it.',
    )
    this.name = 'ReadOnlyWhileViewingAs'
  }
}

function createClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env')
  }

  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

  /*
   * The read-only guard for "view as".
   *
   * Here rather than in the server actions, and that is the whole point: there are
   * dozens of actions and there will be more, and a rule that every one of them has to
   * remember is a rule that one of them will not. An administrator wearing somebody
   * else's face must not be able to approve a bill in their name — not because anybody
   * would, but because it would make every approval in the system arguable afterwards.
   *
   * It fails closed in the only direction that matters. A cookie set by somebody who is
   * not an administrator does not grant them anything — `getSession` ignores it — but it
   * still stops their writes, which is a harmless way to be wrong.
   */
  const guarded = base.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (WRITES.has(operation) && !(model && AUTH_MODELS.has(model))) {
          const { viewingAsUserId } = await import('@/server/view-as')
          if (await viewingAsUserId()) throw new ReadOnlyWhileViewingAs()
        }
        return query(args)
      },
    },
  })

  /*
   * Typed as the plain client on purpose.
   *
   * `$extends` returns a structurally different type, and a dozen helpers in this
   * codebase take a `Prisma.TransactionClient` — which the extended client no longer
   * satisfies, so the whole repository stops compiling over a change that adds no API
   * at all. The extension only intercepts; every method and signature is the same one
   * that was there before, so the original type is the honest description of it.
   */
  return guarded as unknown as PrismaClient
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

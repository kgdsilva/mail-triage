import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

// Prisma 7 takes the connection through a driver adapter rather than a URL in the
// schema. The global cache keeps Next.js dev hot-reloads from opening a new pool
// on every recompile.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env')
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

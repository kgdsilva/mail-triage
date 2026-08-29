import 'dotenv/config'
import path from 'node:path'
import { defineConfig, env } from 'prisma/config'

// Prisma 7 no longer reads the datasource URL from schema.prisma, and no longer
// auto-loads .env — hence the dotenv import above.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'npx tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations need a direct connection: Neon's pooler does not hold the advisory
    // lock the migration engine takes. The app itself uses the pooled DATABASE_URL,
    // which is what belongs in a serverless runtime.
    url: process.env.DIRECT_URL || env('DATABASE_URL'),
  },
})

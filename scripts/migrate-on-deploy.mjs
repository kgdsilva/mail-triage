#!/usr/bin/env node
//
// Runs `prisma migrate deploy`, but only where that is the right thing to do.
//
// The build command migrates the database, which is correct for production — a
// deployment should never land on a schema its code does not expect. On a *preview* it
// is a trap: Vercel environment variables apply to every environment unless they are
// scoped to one, so a preview build whose DATABASE_URL is still production's will
// cheerfully migrate production. Pushing a branch is not supposed to be able to do
// that, and "we were careful" is not a mechanism.
//
// So a preview has to say so out loud. Point it at its own database — a Neon branch —
// and set ALLOW_PREVIEW_MIGRATIONS=1 on the Preview environment. Without that the build
// fails with the reason, which is the outcome you want: a preview that does not exist is
// recoverable in a way a migrated production database is not.
//
// Local builds are unaffected: VERCEL_ENV is only set on Vercel.

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved rather than assumed on PATH. `npm run` puts node_modules/.bin there and
// running the file directly does not, which made this work from the build and fail from
// a terminal — the worst way round for a script whose whole job is to be checked.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const local = path.join(root, 'node_modules', '.bin', 'prisma')
const prisma = existsSync(local) ? JSON.stringify(local) : 'prisma'

const env = process.env.VERCEL_ENV ?? 'local'
const allowed = process.env.ALLOW_PREVIEW_MIGRATIONS === '1'

if (env === 'preview' && !allowed) {
  console.error(
    [
      '',
      'Refusing to run migrations on a preview build.',
      '',
      'This build would run `prisma migrate deploy` against whatever DATABASE_URL and',
      'DIRECT_URL this environment has — and on Vercel those apply to every environment',
      'unless they are scoped to one. If they are still production’s, the migration',
      'lands on production, and an added enum value cannot be taken back out.',
      '',
      'To build this preview:',
      '  1. Create a Neon branch from production (Neon console → Branches → New branch).',
      '  2. In Vercel → Settings → Environment Variables, add DATABASE_URL (the pooled',
      '     string) and DIRECT_URL (the unpooled one) for the Preview environment only.',
      '  3. Add ALLOW_PREVIEW_MIGRATIONS=1, also Preview only.',
      '  4. Redeploy.',
      '',
      'Production deployments are unaffected and still migrate as before.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

if (env === 'preview') {
  console.log('Preview build: migrating, ALLOW_PREVIEW_MIGRATIONS is set.')
}

execSync(`${prisma} migrate deploy`, { stdio: 'inherit', cwd: root })

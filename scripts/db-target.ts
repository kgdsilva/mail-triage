/**
 * Which database am I about to touch, and is that the one I meant?
 *
 * Every destructive or schema-changing script goes through this first. It reads env
 * files and nothing else — it never opens a connection — so it is safe to run when you
 * are not sure what is configured, which is exactly when you want to run it.
 *
 * ---------------------------------------------------------------------------
 * The trap it exists to close
 * ---------------------------------------------------------------------------
 *
 * This project loads environment variables two different ways, and they disagree.
 *
 *   The Prisma CLI and the scripts  `import 'dotenv/config'`, which loads **.env only**.
 *   The application                Next.js, which also loads **.env.local**, at a
 *                                  higher precedence than .env.
 *
 * Next's documented order (node_modules/next/dist/docs/01-app/02-guides/
 * environment-variables.md, "Environment Variable Load Order") is: process.env, then
 * .env.$(NODE_ENV).local, then .env.local, then .env.$(NODE_ENV), then .env — stopping
 * at the first hit. dotenv reads .env and does not override anything already set.
 *
 * So putting a connection string in `.env.local` points the *app* at it and leaves every
 * migration and every seed pointed at whatever `.env` says. The app and its schema end
 * up in different databases, and nothing announces it: the app works, the migration
 * "succeeds", and the two drift apart until something fails for a reason that makes no
 * sense. This refuses to run when those two resolutions differ.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname ?? '.', '..')

/** A value, and which file it actually came from. */
export type Resolved = {
  key: string
  value: string | null
  source: string
}

/**
 * Parses a `.env` file the way dotenv does, well enough for a connection string:
 * `KEY=value`, optional quotes, `#` comments, blank lines.
 */
function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(file)) return out

  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    const quoted = /^(['"])([\s\S]*)\1$/.exec(value)
    if (quoted) value = quoted[2]
    out[key] = value
  }
  return out
}

/**
 * The files each loader consults, highest precedence first.
 *
 * `process.env` is first in both, because an inline `DATABASE_URL=... npm run ...` wins
 * over every file and is the one case where the two loaders genuinely agree.
 */
function chainFor(mode: 'cli' | 'app'): string[] {
  if (mode === 'cli') return ['.env']

  const nodeEnv = process.env.NODE_ENV ?? 'development'
  return nodeEnv === 'test'
    ? [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env']
    : [`.env.${nodeEnv}.local`, '.env.local', `.env.${nodeEnv}`, '.env']
}

export function resolve(key: string, mode: 'cli' | 'app'): Resolved {
  // Set in the real environment: wins for both loaders, and dotenv will not overwrite it.
  if (process.env[key]) return { key, value: process.env[key]!, source: 'process.env' }

  for (const file of chainFor(mode)) {
    const parsed = parseEnvFile(path.join(ROOT, file))
    if (parsed[key]) return { key, value: parsed[key], source: file }
  }

  return { key, value: null, source: '(unset)' }
}

export type Target = {
  host: string
  database: string
  /** The whole string with the password replaced, safe to print or paste. */
  masked: string
}

export function describe(url: string | null): Target | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const masked = url.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:••••••@')
    return {
      host: parsed.host,
      database: parsed.pathname.replace(/^\//, '') || '(default)',
      masked,
    }
  } catch {
    return { host: '(unparseable)', database: '(unparseable)', masked: '(unparseable URL)' }
  }
}

/**
 * Neon gives the pooled and the direct endpoint different hostnames for the same
 * database — `ep-x-pooler.region.aws.neon.tech` and `ep-x.region.aws.neon.tech`. They
 * are the same place, so comparisons and the production list ignore the marker. Setting
 * PRODUCTION_DB_HOST to either string therefore covers both.
 */
function normalizeHost(host: string) {
  return host.toLowerCase().replace(/^([^.]*?)-pooler\./, '$1.')
}

const LOCAL = ['localhost', '127.0.0.1', '::1', '[::1]']

export type Kind = 'local' | 'production' | 'remote'

export function classify(host: string): Kind {
  const bare = normalizeHost(host).replace(/:\d+$/, '')
  if (LOCAL.includes(bare) || bare.endsWith('.localhost') || bare.endsWith('.test')) {
    return 'local'
  }

  return productionHosts().includes(bare) ? 'production' : 'remote'
}

/**
 * The hosts that are production, read the same way the connection strings are.
 *
 * Through the file chain, not from `process.env` alone — which is what this did at
 * first, and it meant setting PRODUCTION_DB_HOST in `.env` had no effect whatsoever.
 * The failure was in the safe direction, since an unrecognised host is treated as
 * production and refused either way, but it also made the production branch of this
 * logic unreachable outside a test that passed the variable inline. A guard that cannot
 * read its own configuration is a guard that is only pretending to check.
 */
export function productionHosts(): string[] {
  const single = resolve('PRODUCTION_DB_HOST', 'cli').value
  const many = resolve('PRODUCTION_DB_HOSTS', 'cli').value

  return [single, ...(many ?? '').split(',')]
    .map((h) => h?.trim())
    .filter((h): h is string => Boolean(h))
    .map((h) => normalizeHost(h).replace(/:\d+$/, ''))
}

/** How the flag can be given. The env var survives npm's argument handling; both work. */
function allowed() {
  return process.env.ALLOW_PRODUCTION_DB === '1' || process.argv.includes('--allow-production')
}

export type Verdict = { ok: boolean; kind: Kind | null; reason?: string }

/**
 * Prints what is about to be touched and decides whether to allow it.
 *
 * Printing happens unconditionally and before the decision, because the thing that
 * actually prevents the accident is seeing the host — a guard that only speaks up when
 * it objects teaches you to ignore the silence.
 */
export function checkTarget(action: string): Verdict {
  const cli = resolve('DATABASE_URL', 'cli')
  const app = resolve('DATABASE_URL', 'app')
  const direct = resolve('DIRECT_URL', 'cli')

  const cliTarget = describe(cli.value)
  const appTarget = describe(app.value)
  const directTarget = describe(direct.value)

  console.log('')
  console.log(`  About to ${action}.`)
  console.log('')
  console.log(`  Scripts and migrations (dotenv → .env only)`)
  console.log(`    DATABASE_URL  ${cliTarget?.host ?? '(unset)'}  db=${cliTarget?.database ?? '-'}`)
  console.log(`                  from ${cli.source}`)
  if (direct.value) {
    console.log(`    DIRECT_URL    ${directTarget?.host}  db=${directTarget?.database}`)
    console.log(`                  from ${direct.source}  — this is what migrations use`)
  } else {
    console.log(`    DIRECT_URL    (unset) — migrations fall back to DATABASE_URL`)
  }
  console.log('')
  console.log(`  The application (Next.js → .env.local wins over .env)`)
  console.log(`    DATABASE_URL  ${appTarget?.host ?? '(unset)'}  db=${appTarget?.database ?? '-'}`)
  console.log(`                  from ${app.source}`)
  console.log('')

  if (!cli.value) {
    return { ok: false, kind: null, reason: 'DATABASE_URL is not set in .env, so there is nothing to act on.' }
  }

  // --- the two loaders must agree -------------------------------------------
  if (
    appTarget &&
    cliTarget &&
    (normalizeHost(appTarget.host) !== normalizeHost(cliTarget.host) ||
      appTarget.database !== cliTarget.database)
  ) {
    return {
      ok: false,
      kind: null,
      reason:
        `The app and the scripts would use different databases.\n\n` +
        `    the app        ${appTarget.host} / ${appTarget.database}  (from ${app.source})\n` +
        `    the scripts    ${cliTarget.host} / ${cliTarget.database}  (from ${cli.source})\n\n` +
        `  Next.js reads .env.local and dotenv does not, so a connection string there\n` +
        `  moves the app and leaves every migration and seed behind. Put it in .env\n` +
        `  instead, or set it in both — but not only in .env.local.`,
    }
  }

  // --- the pooled and direct strings must be the same database ---------------
  if (
    directTarget &&
    cliTarget &&
    (normalizeHost(directTarget.host) !== normalizeHost(cliTarget.host) ||
      directTarget.database !== cliTarget.database)
  ) {
    return {
      ok: false,
      kind: null,
      reason:
        `DATABASE_URL and DIRECT_URL are different databases.\n\n` +
        `    DATABASE_URL  ${cliTarget.host} / ${cliTarget.database}\n` +
        `    DIRECT_URL    ${directTarget.host} / ${directTarget.database}\n\n` +
        `  Migrations use DIRECT_URL and the app uses DATABASE_URL, so the schema would\n` +
        `  be changed in one database and read from another. Neon's pooled and direct\n` +
        `  hostnames differ only by "-pooler"; anything more than that is a mistake.`,
    }
  }

  const kind = classify(directTarget?.host ?? cliTarget!.host)

  const known = productionHosts()
  console.log(
    known.length > 0
      ? `  Production is ${known.join(', ')} — this host is ${
          kind === 'production' ? 'THAT ONE' : 'not it'
        }.`
      : '  No production host is configured, so every remote host counts as production.',
  )
  console.log('')

  if (kind === 'local') {
    console.log('  Local database. Going ahead.')
    console.log('')
    return { ok: true, kind }
  }

  if (allowed()) {
    console.log(`  ${kind === 'production' ? 'PRODUCTION' : 'Remote'} database, and the flag is set. Going ahead.`)
    console.log('')
    return { ok: true, kind }
  }

  if (kind === 'production') {
    return {
      ok: false,
      kind,
      reason:
        `That host is named in PRODUCTION_DB_HOST.\n\n` +
        `  Refusing. If you really mean it:\n` +
        `    ALLOW_PRODUCTION_DB=1 npm run <script>`,
    }
  }

  // Remote and not recognised. Treated as production until told otherwise, because the
  // failure modes are not symmetrical: refusing a Neon branch costs one flag, and
  // seeding or purging production costs a day.
  const named = productionHosts().length > 0
  return {
    ok: false,
    kind,
    reason: named
      ? `This is a remote database that is not the one named in PRODUCTION_DB_HOST.\n\n` +
        `  It is probably the Neon branch you meant. Confirm it is, then:\n` +
        `    ALLOW_PRODUCTION_DB=1 npm run <script>`
      : `This is a remote database and nothing tells me which host is production.\n\n` +
        `  Set PRODUCTION_DB_HOST in .env to your production host — once — and this\n` +
        `  will be able to tell a Neon branch from the real thing by itself. Until then\n` +
        `  every remote host is treated as production.\n\n` +
        `  To go ahead anyway:\n` +
        `    ALLOW_PRODUCTION_DB=1 npm run <script>`,
  }
}

/** Prints, decides, and exits non-zero on a refusal. For use at the top of a script. */
export function requireSafeTarget(action: string) {
  const verdict = checkTarget(action)
  if (verdict.ok) return

  console.error(`  REFUSED: ${verdict.reason}`)
  console.error('')
  process.exit(1)
}

// Usable as a command of its own, so it can be run to answer "what is configured right
// now" without running anything else.
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const action = process.argv.find((a) => a.startsWith('--action='))?.slice('--action='.length)
  requireSafeTarget(action ?? 'touch the database')
}

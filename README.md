# Mail Triage & Action Tracking Platform

Replaces a manual mail-triage workflow (spreadsheets + Google Drive + Box + Apps
Scripts) with a real multi-user web app. Scanned physical mail is classified by legal
entity, filtered so only items needing a human decision reach a queue, renamed, filed,
and recorded in a permanent master log.

Built for the CoLAB Lending Franchise group, architected to onboard unrelated company
groups later with different entity codes and folder structures.

## Status

**Phase 0 (foundation) — complete.** Schema, migration, seed and a smoke page proving
Next.js → Prisma → Postgres. No auth, no upload, no classification UI yet.

Roadmap: Phase 1 master log · 1.5 historical import · 2 role queues · 3 Drive/Box sync
· 4 AI-assisted classification · 5 pattern detection.

## Stack

Next.js 15 (App Router, TypeScript) · PostgreSQL 16 · Prisma 7 · Auth.js · Tailwind.
Object storage is S3-compatible (Cloudflare R2 in production, local disk in dev).

**The platform is the source of truth for documents, not Box.** Box is an optional
outbound mirror for external stakeholders (accountant, insurance broker) in Phase 3.

## Local setup

Requires Node 20+ and PostgreSQL 16.

Clone somewhere outside iCloud-synced folders — see Environment gotchas below.

```bash
brew install node@24 postgresql@16
brew services start postgresql@16
createdb mail_triage

npm install
cp .env.example .env          # then fill in DATABASE_URL and AUTH_SECRET
npx prisma migrate deploy
npx prisma generate
npx tsx prisma/seed.ts
npm run dev
```

## The two invariants

Everything else in this codebase is negotiable. These two are not:

**1. `disposition` is not `status`.** `disposition` answers *archive or send for
action?*. `status` answers *is the human done with it?*. An archived incoming check is
still logged and filed — it just never enters a queue. Collapsing these into one field
is the mistake that bites in month three.

**2. Archiving always states a reason.** `dispositionReason` is required whenever
`disposition = ARCHIVE`, enforced by a database CHECK constraint rather than
application code, because it is the one rule that must never bend. It is what makes
"why wasn't I shown this?" answerable months later.

## The action filter

The core business rule, proven over months of manual operation. After reading a
document, it is either archived or sent for action.

Archive: confirmed autopay for that vendor **and** entity · incoming third-party checks
· solicitations disguised as official notices (labor-law poster mills, LLC "good
standing" resellers — they self-disclose in fine print) · statements and FYI notices.

Send for action: any government notice bearing a deadline, however small the amount ·
manual invoices not on the autopay list · anything carrying penalty, collections,
legal, or cancellation risk.

**Ambiguity always resolves to action, never to silent archive.** A vendor on autopay
for one entity but not the one on the document is ambiguous, and surfaces to a human.

## Schema notes

- Multi-tenancy is `companyGroupId` on every scoped table, single database.
- Entity codes, document types and folder trees are **data, not enums** — a new company
  group brings its own.
- `Entity.isSegregated` is view-level separation only, never a permission. Everyone can
  still see the entity; it just sits in its own tab.
- `Document.storageKey` is nullable so a historical log row can exist before its PDF is
  attached (Phase 1.5 import).
- Nothing in the master log is hard-deleted — `deletedAt` only.
- `prisma/sql/invariants.sql` holds the CHECK constraints, the generated full-text
  column and the partial indexes. Prisma cannot express these, so if the initial
  migration is ever recreated they must be re-appended:
  `cat prisma/sql/invariants.sql >> prisma/migrations/<ts>_init/migration.sql`

## Environment gotchas

**Do not put this project under `~/Documents` or `~/Desktop` on a Mac with iCloud
Drive's "Desktop & Documents" sync enabled.** iCloud evicts `node_modules` files to the
cloud as *dataless* stubs, so every `require` blocks waiting on a download and some
reads fail outright with `ECANCELED`. Symptom: `next build` hangs forever without
printing a single line, main thread parked in `uv_sem_wait`; `npm install` and
`tsc --noEmit` take many minutes or never finish. Moving the project to `~/Developer`
took `npm install` from minutes to 9 seconds and `next build` to 3.2 seconds.

To check a directory: `xattr -p com.apple.file-provider-domain-id .` — if that
attribute exists, the folder is synced. `find node_modules -flags +dataless` lists
evicted files.

Node is pinned to the LTS line (`.nvmrc`, `engines`). Node 26 is *current*, released
after Next 16's support matrix.

`next.config` is `.mjs` rather than `.ts`, which avoids Next's TypeScript config
loader. Not required — it was changed while chasing the hang above — but harmless.

npm 11 blocks package install scripts by default. Prisma needs its engine:
`npm install-scripts approve @prisma/engines prisma`.

## Prisma 7 gotchas

The connection URL lives in `prisma.config.ts`, not `schema.prisma`, and `.env` is no
longer auto-loaded (hence `import 'dotenv/config'`). `PrismaClient` takes a driver
adapter — see `src/server/db/client.ts`. The CLI is pinned to exactly 7.10.0 because
`prisma@latest` currently resolves to an 8.0 release candidate.

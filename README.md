# Mail Triage & Action Tracking Platform

Replaces a manual mail-triage workflow (spreadsheets + Google Drive + Box + Apps
Scripts) with a real multi-user web app. Scanned physical mail is classified by legal
entity, filtered so only items needing a human decision reach a queue, renamed, filed,
and recorded in a permanent master log.

Built for the CoLAB Lending Franchise group, architected to onboard unrelated company
groups later with different entity codes and folder structures.

## Status

**Phase 1 complete.** Batch upload into our own storage, a keyboard-driven classify
screen with an in-app PDF viewer and live action-filter suggestions, the master log with
filter/search/CSV export, and admin for entities, document types, vendors and autopay
rules.

**Authentication is wired** (Google via Auth.js v5). It needs a Google OAuth client
before anyone can sign in — see "Google sign-in" below.

Roadmap: 1.5 historical import · 2 role-scoped queues · 3 Drive/Box sync · 4 AI-assisted
classification · 5 pattern detection.

## Google sign-in

Access is **allowlist-based**. Signing in with Google proves identity; it does not grant
access. Only an email an admin has added under Settings > Members can get in — everyone
else is turned away even though their Google login succeeded. Revoking a member takes
effect on their next request, not when their session expires.

Set up a client in Google Cloud Console (APIs & Services > Credentials > OAuth client ID,
type "Web application") with these **Authorized redirect URIs**:

| Environment | Redirect URI |
|---|---|
| Local | `http://localhost:3000/api/auth/callback/google` |
| Production | `https://<your-domain>/api/auth/callback/google` |

Then fill `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env`. The variable names are not
arbitrary — Auth.js v5 discovers the provider by them.

## Migrations

Prisma cannot represent the CHECK constraints, the generated `search_vector` column, the
partial index or the trigram indexes in `prisma/sql/invariants.sql`. It therefore reads
them as drift and **generates `DROP INDEX` statements for them on every migration diff**.

So: always generate with `--create-only`, read the SQL, and delete any statement touching
those objects before applying.

```bash
npx prisma migrate dev --name your_change --create-only
$EDITOR prisma/migrations/*_your_change/migration.sql   # remove drift statements
npx prisma migrate deploy
npm run db:repair                                        # re-create anything lost
```

`npm run db:repair` is idempotent and safe to run at any time.

## Screens

- `/upload` — drop a batch. Filenames are parsed for an entity hint and a date, and a
  content hash links re-uploads of the same scan to the original instead of silently
  duplicating it.
- `/classify` — the queue. PDF on the left, form on the right, ⌘↵ to save and advance.
  The action filter's suggestion appears with its reasoning; ambiguous cases are
  highlighted and always default to action.
- `/log` — the master log. Filters live in the URL, so any view is a shareable link and
  the CSV export reuses the same query string.
- `/settings` — entities, document types, vendors, autopay rules.

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

## AI-assisted reading

Set `ANTHROPIC_API_KEY` and uploads are read automatically; leave it blank and the
feature is simply off, with classification fully manual. There is no OCR step — Claude
reads scanned PDFs natively.

**The model reads; it does not decide.** It reports what the page says — addressee,
type, sender, amount, dates — and two judgements that cannot be made from the database:
whether this is a solicitation dressed as a notice, and whether it states a deadline or
risk. Whether a bill is on autopay stays with `src/server/action-filter.ts`, because
that is a lookup against the company's own records, evaluated on the document's date
rather than today, and it has to be exact rather than inferred.

Three rules govern how the two are combined (`mergeVerdict` in `src/server/ai/suggest.ts`):

- A stated deadline or risk **overrides** any suggestion to archive, however confident
  the autopay lookup was. Missing one of those is the failure this platform exists to
  prevent, and its cost is a penalty rather than the amount printed on the page.
- A solicitation is archived **only** when the model can quote the disclaimer that
  proves it. Thinking something looks like spam is not enough to bury it.
- Anything the model could not classify goes to a human, flagged ambiguous.

Nothing commits. Every field arrives on the classify screen pre-filled and editable, and
a decision is never pre-filled once a human has made one. Reads are cached on the
document, so opening a record repeatedly costs nothing after the first time.

Uploads kick a read off in the background via `after()`, so the suggestion is usually
waiting by the time someone opens the document; when it is not, the classify screen
offers to read on demand rather than showing a blank form.

## Review vs Classify

Two screens over the same data, for two different moments — not two ways to do one job.

**Review** (`/review`) is the batch sweep: a table grouped by entity with the PDF
alongside, and three one-click decisions (needs paying / no payment needed / spam). It
answers "what came in and what is it?" across a whole batch.

**Classify** (`/classify`) is the full form for one document: vendor, amount, dates,
folder, final filename, routing.

They share everything that matters. The quick buttons call `quickDecide()`, which runs
the same `assertDecisionCoherent()` invariants as the classify form and writes the same
audit event (tagged `via: "quick-review"`). The PDF viewer is the same permission-scoped
`/api/files/[id]` route.

The distinction the UI has to keep honest: a quick decision decides a document, it does
not **file** it — no final filename, no folder. So a decided row shows "✓ Reviewed" and,
when it still lacks a home, a "Not filed" link through to the classify form. Reviewed
never gets to mean finished.

A quick archive applies `FYI_STATEMENT` ("seen, nothing to do") rather than `OTHER`,
and the row then offers a reason dropdown so it can be sharpened to autopay or incoming
check in one click. Defaulting everything to OTHER would technically satisfy the
archive-needs-a-reason constraint while making it useless six months later.

## Checks

`/checks` lists incoming third-party checks on their own, with a per-entity filter and a
running total for reconciliation. Deliberately read-only: these are archived on arrival
and never enter a queue, and what action belongs here is still an open question.

## Visual language

The company's own navy `#1B3A6B` and gold `#C9922B`, so the app matches the documents
and decks the team already sees. Everything else derives from those two rather than
coming from a generic palette. Tokens live in `src/app/globals.css`; shared component
shapes in `src/lib/theme.ts`.

Light only, deliberately — navy on white is the brand, and a dark theme would be a
second design to keep in step.

Colour carries meaning and nothing else:

- **Entity badges** are coloured by the entity's position, not by hardcoding CP or MMT.
  Entity codes belong to a company group, and the next group onboarded has different
  ones; assigning from an 8-slot palette by `sortOrder` means any group gets colours.
- **Status** — gold for waiting, navy for in progress, green for done, grey for
  archived. Waiting reuses the brand gold on purpose: "needs attention" and the accent
  colour are the same idea, so they reinforce instead of competing.
- **Overdue** is the one thing allowed to interrupt: a red pill with a clock, not just
  red text.
- Icons (lucide-react) are keyed on the document type's `code` with a generic fallback,
  because types are editable per company group.

Type is Inter throughout, with JetBrains Mono only where alignment carries meaning —
filenames and entity codes. Money and dates use tabular figures so columns line up.

## Roles, and what they are not

Access roles say what a person may **see and change**: OWNER, ADMIN, OPERATOR, MEMBER,
VIEWER. They deliberately say nothing about who handles which document.

There is no permanent "payer" and no permanent "confirmer". In practice whoever pays or
confirms varies document by document — the same colleague may confirm one item and pay
the next — so that lives on the document as `actionKind` (PAY / CONFIRM / REVIEW), set
during classification. The dashboard groups a person's items by it, which is why one
person can legitimately appear in more than one group at once.

Handing work on is a reassignment, not a second assignment: one assignee and one action
at a time. When a confirmer is satisfied they hand the document on as PAY, and the step
they finished stays in `DocumentEvent`. That keeps every dashboard honest — it shows
only what is genuinely someone's right now.

## Signing in

Two methods, one allowlist. Google for anyone with a Workspace account, and email +
password for those without one. A person can have both; the email is the identity.
Passwords are admin-set in Settings → Members — there is no self-signup, no reset email,
and no self-service change.

Sessions are JWT because the Credentials provider requires it. That would normally
weaken revocation, except `getSession()` re-reads the membership on every request, so
deactivating someone locks them out immediately. The token proves identity; the
membership row decides access.

Password hashing is scrypt from Node's standard library (`src/server/password.ts`) —
memory-hard, and no security-critical dependency in the supply chain.

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

## Deploying

Vercel (app) + Neon (Postgres) + Cloudflare R2 (files).

The build runs `prisma generate && prisma migrate deploy && next build`. Generate is not
optional: `src/generated` is gitignored, so without it Vercel compiles against a client
that does not exist. Migrate deploy runs there so a deployment never lands on a schema
its code does not expect.

**Two connection strings, and getting them backwards is a real bug.** `DATABASE_URL` is
Neon's *pooled* string (host contains `-pooler`) and is what the running app uses — a
serverless runtime opens many short-lived connections and will exhaust a direct
connection. `DIRECT_URL` is the *unpooled* string, used only by migrations, because the
migration engine takes an advisory lock the pooler will not hold.

Required environment variables in Vercel: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`,
`AUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `BOOTSTRAP_OWNER_EMAIL`,
`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

**R2 needs a CORS rule.** Files above 4.5 MB never travel through a server action —
Vercel rejects the request body at the platform edge on every plan — so the browser PUTs
them straight to R2 with a signed URL. That is a cross-origin request, and without a
CORS policy on the bucket the browser blocks it before it leaves. In the bucket's
Settings → CORS Policy:

```json
[{ "AllowedOrigins": ["https://YOUR-APP.vercel.app"],
   "AllowedMethods": ["PUT"],
   "AllowedHeaders": ["content-type"],
   "MaxAgeSeconds": 3600 }]
```

The R2 bucket must stay private. Files are served by `/api/files/[id]`, which checks
membership and assignment before returning a byte; a public bucket would route around
that entirely.

Google OAuth needs the production origin and `/api/auth/callback/google` redirect added
to the existing client — added, not replacing localhost.

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

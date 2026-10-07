# Backup, restore, and what was actually verified

Eric asked whether the database is encrypted and backed up every night. This is the
answer, split into what was **verified from the code** and what still has to be read off
an account dashboard — because "verify, do not assume" cuts both ways, and the parts I
cannot see from here are marked as such rather than guessed.

Last verified: 7 October 2026, against commit on branch `approvals-workflow`.

---

## 1. Verified: the PDFs are not in Postgres

Checked, not assumed:

- **No binary column exists anywhere in the schema.** `grep` for `Bytes` / `bytea` over
  `prisma/schema.prisma` returns nothing. A document row stores `storage_key`,
  `storage_bucket`, `mime_type`, `byte_size` and `sha256` — a pointer and some metadata.
- **Production files go to Cloudflare R2** over the S3 API (`S3_ENDPOINT`, `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `src/server/storage.ts`). With those
  unset — local development — files are written to `.storage/` on disk instead.
- **Object keys are random and say nothing.** `buildKey` is
  `<companyGroupId>/<uuid>.<ext>`; the original filename is deliberately not part of the
  key, because keys end up in logs and URLs more readily than database columns do.

This matters for backup planning: **the database and the bucket are two separate things
to back up, and a restore needs both.** A database restored without its bucket is a
complete index of documents that cannot be opened.

## 2. Verified: no secrets in the repository or the logs

- `.env` and `.env*.local` are in `.gitignore`; `git ls-files` shows no `.env` tracked.
  Only `.env.example`, which contains variable names and explanations, no values.
- A scan of every tracked file for key-shaped strings — `sk-ant-`, `AKIA`, PEM private
  key headers, and Postgres URLs containing credentials — returns nothing.
- No `console.log` or `console.error` in `src/server` or `src/app` emits a storage key,
  a connection string or a credential.
- Storage credentials are read through `s3Env()`, which trims and rejects values
  containing characters that cannot go in an HTTP header — so a mis-pasted key fails
  with a sentence naming the variable instead of a 403 deep inside the AWS signer.

**One historical caveat, stated because it changes the risk calculus:** this project has
already rotated a leaked Neon connection string and a leaked Anthropic key once, both
pasted into a chat window. The repository is clean; the habit is the exposure. Treat any
credential that has ever been pasted anywhere as burned and rotate it.

## 3. NOT verified from here: Neon's retention and encryption at rest

I cannot see the Neon account from this environment, and the answer depends on the plan,
so I am not going to state it from memory. **Someone with dashboard access needs to read
these four things off it and write them in below:**

| What to find | Where |
|---|---|
| Plan name | Neon console → Settings → Billing |
| History retention window (how far back point-in-time restore reaches) | Project → Settings → Storage / History retention |
| Whether encryption at rest is in force, and the key management | Neon's security documentation for the plan, or the Trust Center |
| Whether a separate automated logical backup exists | Nowhere — see section 4; by default it does not |

> **Fill in:** plan = ______, retention = ______ days, encryption at rest = ______,
> verified by ______ on ______.

Two things worth knowing while reading that page. Neon's point-in-time restore is a
property of the **branch**, not an exported file — it is excellent for "undo the last
hour" and it is not an off-site backup, because it lives in the same account as the
thing it protects. And a retention window is not a backup schedule: if the window is
seven days, a problem discovered on day eight is not recoverable from it.

## 4. NOT DONE: the independent nightly backup

The brief asks for a nightly backup of Postgres and the R2 bucket to a separate location,
30 days of retention, an email to KG on failure, and restore steps.

**The restore steps are below and the script is written. Nothing is scheduled, and
nothing has been run against a real bucket**, because it needs three things I do not
have: a destination account and its credentials, a scheduler (a GitHub Actions cron or a
small always-on host), and a mail sender. It is listed in the final report as outstanding
rather than quietly half-finished.

**Do not treat this as working until somebody completes the drill in section 6.** An
untested backup is worse than no backup, because it is the same risk plus confidence.

### What it needs

| Variable | What it is |
|---|---|
| `DATABASE_URL` | the production Neon connection string, read-only role is enough |
| `BACKUP_S3_ENDPOINT` / `BACKUP_S3_BUCKET` | the destination, in a **different account** from the R2 bucket being copied |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | its credentials, write-only if the provider allows it |
| `S3_*` | the existing production R2 variables, to read from |
| `BACKUP_ALERT_EMAIL` | where a failure goes |

A different account is the point, not a detail. A backup in the same account as the
original is protected against disk failure and against nothing else — not a mistaken
delete, not a compromised key, not an account suspension.

### The script

`scripts/backup.sh` in this repository. It does three things and refuses to report
success unless all three worked:

1. `pg_dump --format=custom` of the whole database to a timestamped file.
2. A sync of the document bucket to the destination.
3. A delete of anything in the destination older than 30 days.

## 5. Restore, from nothing

In the order that actually works. **The database alone is not a restore.**

1. **Make a new Neon branch or project.** Never restore over the live one; a restore that
   fails halfway has then taken out the thing you were trying to recover.
2. **Load the dump:**
   `pg_restore --clean --if-exists --no-owner -d "$NEW_DATABASE_URL" backup-YYYY-MM-DD.dump`
3. **Re-apply the hand-written invariants** that Prisma's schema cannot express — the
   generated `search_vector` column, the GIN and trigram indexes, the CHECK constraints
   and the append-only trigger on `document_event`:
   `psql "$NEW_DATABASE_URL" -f prisma/sql/invariants.sql`
   Then `npm run db:repair` for the indexes. Skip this and the app runs with no search
   and no audit protection, which is the kind of restore that looks fine for a month.
4. **Restore the bucket** into a bucket with the same name, or set `S3_BUCKET` to the new
   one. Document rows store the bucket name, so a different name without that variable
   change gives you records whose files 404.
5. **Point a deployment at both** and sign in. Check in this order: a document opens
   (bucket + database agree), the master log search returns something (step 3 worked),
   and a bill's history page lists its events (the trigger and the events survived).

## 6. The drill — until this is done, section 4 is a plan and not a backup

Once, on a Neon branch, with a stopwatch:

- [ ] Run the backup script by hand. Confirm a dump file and the bucket objects arrive in
      the destination account.
- [ ] Restore into a fresh Neon branch following section 5 exactly, reading only this
      document.
- [ ] Open a document, run a search, open a history page.
- [ ] Write down how long it took and what was missing from these instructions. The
      second number is the useful one.
- [ ] Break it on purpose: revoke the destination credential and confirm the failure
      email arrives. A backup job that fails silently is the normal way this goes wrong.

## 7. What is protected against what

| Failure | Covered by |
|---|---|
| Somebody deletes a document in the app | Nothing to recover — removal is a soft delete and the row, file and history stay intact |
| Somebody edits history | The `document_event` append-only trigger refuses it |
| A bad migration or a bulk mistake | Neon point-in-time restore, within the retention window |
| The Neon project or account is lost | **Only** the nightly dump in section 4 — which is why it is the gap that matters |
| The R2 bucket or account is lost | **Only** the bucket sync in section 4 |
| A leaked credential | Rotation. Section 2's caveat applies |

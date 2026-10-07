#!/usr/bin/env bash
#
# Nightly backup: the Postgres database and the document bucket, to a destination in a
# different account. Keeps 30 days.
#
# NOT YET SCHEDULED AND NOT YET TESTED against a real destination — see docs/BACKUP.md,
# section 4. Run the drill in section 6 before trusting it.
#
# Exits non-zero on any failure, and says which step failed, because the normal way a
# backup goes wrong is silently.

set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
: "${BACKUP_S3_BUCKET:?set BACKUP_S3_BUCKET}"
: "${BACKUP_S3_ENDPOINT:?set BACKUP_S3_ENDPOINT}"
: "${S3_BUCKET:?set S3_BUCKET — the live document bucket to copy}"
: "${S3_ENDPOINT:?set S3_ENDPOINT}"

STAMP="$(date -u +%Y-%m-%d)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() {
  echo "BACKUP FAILED at: $1" >&2
  if [ -n "${BACKUP_ALERT_EMAIL:-}" ] && command -v mail >/dev/null 2>&1; then
    printf 'Mail Triage backup failed on %s at step: %s\n' "$STAMP" "$1" |
      mail -s "Mail Triage backup FAILED ($STAMP)" "$BACKUP_ALERT_EMAIL"
  fi
  exit 1
}

# --- 1. the database -------------------------------------------------------
# Custom format rather than plain SQL: it restores with pg_restore, which can skip the
# objects a restore should not try to recreate, and it compresses.
echo "==> dumping the database"
pg_dump --format=custom --no-owner --no-acl \
  --file "$WORK/mail-triage-$STAMP.dump" "$DATABASE_URL" || fail "pg_dump"

# --- 2. to the destination -------------------------------------------------
# A different account from the one holding the originals. Same-account copies survive a
# disk failure and nothing else.
echo "==> uploading the dump"
AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  aws s3 cp "$WORK/mail-triage-$STAMP.dump" \
  "s3://$BACKUP_S3_BUCKET/postgres/mail-triage-$STAMP.dump" \
  --endpoint-url "$BACKUP_S3_ENDPOINT" || fail "uploading the dump"

# --- 3. the documents ------------------------------------------------------
# The database without the files is an index of documents nobody can open.
echo "==> syncing the document bucket"
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  aws s3 sync "s3://$S3_BUCKET" "$WORK/documents" \
  --endpoint-url "$S3_ENDPOINT" || fail "reading the document bucket"

AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  aws s3 sync "$WORK/documents" "s3://$BACKUP_S3_BUCKET/documents" \
  --endpoint-url "$BACKUP_S3_ENDPOINT" || fail "writing the document copy"

# --- 4. retention ----------------------------------------------------------
# Thirty days. Deleting only dumps, never the document copy: a document that was removed
# upstream is exactly the thing a backup is for.
echo "==> pruning dumps older than 30 days"
CUTOFF="$(date -u -d '30 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-30d +%Y-%m-%d)"
AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  aws s3 ls "s3://$BACKUP_S3_BUCKET/postgres/" --endpoint-url "$BACKUP_S3_ENDPOINT" |
  awk '{print $4}' | while read -r key; do
    [ -z "$key" ] && continue
    day="$(printf '%s' "$key" | sed -n 's/.*-\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)\.dump/\1/p')"
    [ -z "$day" ] && continue
    if [ "$day" \< "$CUTOFF" ]; then
      AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
        aws s3 rm "s3://$BACKUP_S3_BUCKET/postgres/$key" --endpoint-url "$BACKUP_S3_ENDPOINT"
    fi
  done

echo "Backup complete: $STAMP"

#!/usr/bin/env bash
# backup.sh — dump the qa-infinity Postgres database
#
# Usage:
#   ./backup.sh                  # dump to ./backups/ (default)
#   BACKUP_DIR=/opt/backups ./backup.sh
#   ./backup.sh --restore backups/qa_infinity_2026-08-06_17-00.sql.gz
#
# Schedule (run once on each server to set up daily backups at 2am):
#   (crontab -l 2>/dev/null; echo "0 2 * * * /home/$(whoami)/qa-infinity/backup.sh >> /home/$(whoami)/qa-infinity/backups/backup.log 2>&1") | crontab -

set -euo pipefail

PROJECT_NAME="qa-infinity"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"   # delete backups older than this

POSTGRES_USER="${POSTGRES_USER:-qauser}"
POSTGRES_DB="${POSTGRES_DB:-qa_infinity}"

# Load .env if present (picks up POSTGRES_USER, POSTGRES_DB, POSTGRES_PASSWORD)
ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/.env"
if [ -f "$ENV_FILE" ]; then
  set -a; source "$ENV_FILE"; set +a
fi

# ── Restore mode ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--restore" ]; then
  FILE="${2:?Usage: $0 --restore <backup-file.sql.gz>}"
  echo "⚠  Restoring from: $FILE"
  echo "   This will OVERWRITE the current database. Ctrl+C within 5s to abort."
  sleep 5
  if [[ "$FILE" == *.gz ]]; then
    gunzip -c "$FILE" | sudo docker compose -p "$PROJECT_NAME" exec -T qa-postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  else
    sudo docker compose -p "$PROJECT_NAME" exec -T qa-postgres \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$FILE"
  fi
  echo "✅ Restore complete"
  exit 0
fi

# ── Backup mode ───────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
OUT="$BACKUP_DIR/qa_infinity_${TIMESTAMP}.sql.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup → $OUT"

sudo docker compose -p "$PROJECT_NAME" exec -T qa-postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-password \
  | gzip > "$OUT"

SIZE=$(du -sh "$OUT" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Backup complete — $SIZE"

# ── Prune old backups ─────────────────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "qa_infinity_*.sql.gz" -mtime "+${KEEP_DAYS}" -print -delete | wc -l)
[ "$DELETED" -gt 0 ] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🗑  Pruned $DELETED backup(s) older than ${KEEP_DAYS} days"

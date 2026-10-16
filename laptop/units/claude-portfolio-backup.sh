#!/usr/bin/env bash
# Installed as /usr/local/bin/claude-portfolio-backup and run nightly by
# claude-portfolio-backup.timer, as root. Packs the memo, run history, activity log,
# device list, the on/off switch and a consistent copy of the congressional database,
# checks the archive, then uploads it. Layout under backups/ in the bucket:
#   rolling/daily-DD.tar.gz   every run, overwritten monthly (old versions expire after 14 days)
#   monthly/YYYY-MM.tar.gz    the first run of each month, never overwritten
set -euo pipefail
set -a
. /etc/claude-portfolio/claude-portfolio.env
. /etc/claude-portfolio/aws.env
set +a

data=$PORTFOLIO_DATA_DIR
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/snap"
chown claude-portfolio:claude-portfolio "$work" "$work/snap"

# SQLite's backup API, as the owner, so the copy is consistent even mid-write.
if [ -f "$CONGRESSIONAL_DATA_DIR/congressional.db" ]; then
  runuser -u claude-portfolio -- python3 - "$CONGRESSIONAL_DATA_DIR/congressional.db" "$work/snap/congressional.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
dst.close(); src.close()
sys.exit(0 if ok == "ok" else f"integrity_check: {ok}")
PY
fi
for f in memo.json activity.jsonl devices.json active congressional.json congressional/poll_state.json; do
  if [ -e "$data/$f" ]; then install -D -m 0640 "$data/$f" "$work/snap/$f"; fi
done
if [ -d "$data/runs" ]; then cp -a "$data/runs" "$work/snap/runs"; fi

tar -C "$work/snap" -czf "$work/backup.tar.gz" .
tar -tzf "$work/backup.tar.gz" >/dev/null

up() { aws s3 cp --only-show-errors "$work/backup.tar.gz" "s3://$PORTFOLIO_BACKUP_BUCKET/backups/$1"; }
up "rolling/daily-$(date -u +%d).tar.gz"
month="monthly/$(date -u +%Y-%m).tar.gz"
if ! aws s3api head-object --bucket "$PORTFOLIO_BACKUP_BUCKET" --key "backups/$month" >/dev/null 2>&1; then
  up "$month"
fi
echo "backup uploaded"

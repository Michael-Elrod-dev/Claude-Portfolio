#!/usr/bin/env bash
# Ships the bot, the API and the congressional runner to the laptop. From Git Bash:
#   bash laptop/deploy.sh
# Runs every test suite here first, packs the three packages, copies them over and
# hands off to install.sh on the box, which installs, tests again and only then
# switches releases. The target (user@host) comes from PORTFOLIO_HOST or laptop/.host.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
HOST=${PORTFOLIO_HOST:-$(tr -d '\r\n' < "$here/.host" 2>/dev/null || true)}
[ -n "$HOST" ] || { echo "Set PORTFOLIO_HOST or write user@host to laptop/.host" >&2; exit 1; }

(cd "$root/data-gatherers" && npm test --silent)
(cd "$root/api" && npm test --silent)
(cd "$root/congressional" && uv run -q pytest -q)

rev=$(git -C "$root" rev-parse --short HEAD)
git -C "$root" diff --quiet HEAD -- data-gatherers api congressional laptop || rev="$rev-dirty"
stamp="$(date -u +%Y%m%d-%H%M%S)-$rev"

stage=$(mktemp -d)
trap 'rm -rf "$stage" "$stage.tgz"' EXIT
tar -C "$root" -cf - \
  --exclude=node_modules --exclude=.env --exclude=data --exclude=.venv \
  --exclude=__pycache__ --exclude=.pytest_cache --exclude=.ruff_cache \
  data-gatherers api congressional/pyproject.toml congressional/uv.lock \
  congressional/src congressional/tests laptop/units laptop/install.sh \
  | tar -C "$stage" -xf -
tar czf "$stage.tgz" -C "$stage" .

scp -q "$stage.tgz" "$HOST:/tmp/claude-portfolio-$stamp.tgz"
tr -d '\r' < "$here/install.sh" | ssh "$HOST" "sudo bash -s -- $stamp"
echo "deployed $stamp"

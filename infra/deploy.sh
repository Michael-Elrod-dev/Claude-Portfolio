#!/usr/bin/env bash
# infra/deploy.sh — Package and deploy the Lambda function.
#
# Run from the repo root (or anywhere — the script finds its own location).
# Zips the data-gatherers/ directory (production deps only) and uploads it
# to the claude-portfolio-trader Lambda function.
#
# Usage:
#   bash infra/deploy.sh            # deploy only
#   bash infra/deploy.sh --live     # deploy + set EXECUTOR_LIVE=true
#   bash infra/deploy.sh --dry-run  # deploy + set EXECUTOR_LIVE=false (default)

set -euo pipefail

REGION="us-east-1"
FUNCTION_NAME="claude-portfolio-trader"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
SRC_DIR="${REPO_ROOT}/data-gatherers"
BUILD_DIR="${REPO_ROOT}/.build"
ZIP_PATH="${BUILD_DIR}/lambda.zip"

# Parse flags
EXECUTOR_LIVE="false"
for arg in "$@"; do
  case "$arg" in
    --live)     EXECUTOR_LIVE="true"  ;;
    --dry-run)  EXECUTOR_LIVE="false" ;;
  esac
done

echo "=== Claude Portfolio Trader — Deploy ==="
echo "Source: ${SRC_DIR}"
echo "EXECUTOR_LIVE: ${EXECUTOR_LIVE}"
echo

# ── 1. Install production dependencies ────────────────────────────────────
echo "▸ Installing production dependencies..."
(cd "${SRC_DIR}" && npm install --omit=dev --silent)
echo "  Done."

# ── 2. Build the zip ──────────────────────────────────────────────────────
echo "▸ Building deployment zip..."
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

# Files/dirs to include — everything in data-gatherers except dev clutter.
EXCLUDES=(
  ".env"
  ".env.*"
  "*.test.js"
  "run-*.js"       # CLI runners aren't needed on Lambda
  ".eslintrc*"
  "eslint.config*"
)

EXCLUDE_ARGS=()
for PAT in "${EXCLUDES[@]}"; do
  EXCLUDE_ARGS+=("--exclude=${PAT}")
done

(cd "${SRC_DIR}" && zip -qr "${ZIP_PATH}" . \
  "${EXCLUDE_ARGS[@]}" \
  --exclude="*.git*" \
  --exclude="node_modules/.bin/*" \
  --exclude="node_modules/eslint*" \
  --exclude="node_modules/@humanwhocodes*" \
  --exclude="node_modules/@eslint*" \
  --exclude="node_modules/@eslint-community*" \
)

ZIP_SIZE=$(du -sh "${ZIP_PATH}" | cut -f1)
echo "  Zip size: ${ZIP_SIZE} — ${ZIP_PATH}"

# ── 3. Upload to Lambda ───────────────────────────────────────────────────
echo "▸ Uploading to Lambda..."
aws lambda update-function-code \
  --function-name "${FUNCTION_NAME}" \
  --zip-file "fileb://${ZIP_PATH}" \
  --region "${REGION}" \
  --query '{CodeSize: CodeSize, LastModified: LastModified}' \
  --output table

# Wait for the update to propagate before updating config.
echo "▸ Waiting for code update to complete..."
aws lambda wait function-updated \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}"

# ── 4. Update EXECUTOR_LIVE env var ──────────────────────────────────────
echo "▸ Updating environment (EXECUTOR_LIVE=${EXECUTOR_LIVE})..."

# Fetch current environment so we don't accidentally wipe other vars.
CURRENT_ENV=$(aws lambda get-function-configuration \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --query Environment.Variables \
  --output json)

# Merge EXECUTOR_LIVE into the existing env.
NEW_ENV=$(echo "${CURRENT_ENV}" | python3 -c "
import json, sys
env = json.load(sys.stdin)
env['EXECUTOR_LIVE'] = '${EXECUTOR_LIVE}'
# Emit as the CLI's key=value,key=value format
print(','.join(f'{k}={v}' for k, v in env.items()))
")

aws lambda update-function-configuration \
  --function-name "${FUNCTION_NAME}" \
  --environment "Variables={${NEW_ENV}}" \
  --region "${REGION}" \
  --query '{LastModified: LastModified}' \
  --output table

# ── Done ──────────────────────────────────────────────────────────────────
echo
echo "=== Deploy complete ==="
if [ "${EXECUTOR_LIVE}" = "true" ]; then
  echo "  ⚠️  EXECUTOR_LIVE=true — real orders will be submitted!"
else
  echo "  DRY RUN mode — no real orders will be submitted."
  echo "  To go live: bash infra/deploy.sh --live"
fi
echo
echo "Test a manual run:  bash infra/invoke-manual.sh"
echo "Enable schedule:    bash infra/toggle.sh on"

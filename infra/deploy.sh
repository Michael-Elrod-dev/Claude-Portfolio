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

# We use a small Python helper instead of the `zip` CLI so the deploy works
# on Windows / Git Bash environments that don't ship zip by default. The
# helper applies the same exclude rules that the old shell `zip --exclude`
# invocations used (dev clutter, ESLint packages, .git, etc.).
PYTHON_BIN="$(command -v python3 || command -v python)"
if [ -z "${PYTHON_BIN}" ]; then
  echo "✗ Could not find python3/python on PATH — install Python or zip." >&2
  exit 1
fi

"${PYTHON_BIN}" "${SCRIPT_DIR}/zip-lambda.py" "${SRC_DIR}" "${ZIP_PATH}"

ZIP_SIZE=$(du -sh "${ZIP_PATH}" | cut -f1)
echo "  Zip size: ${ZIP_SIZE} — ${ZIP_PATH}"

# ── 3. Upload to Lambda ───────────────────────────────────────────────────
echo "▸ Uploading to Lambda..."

# When running under Git Bash / MSYS on Windows, the AWS CLI is a native
# Windows binary that doesn't understand POSIX paths like /e/Code/...
# Convert the zip path to a Windows path so the file: URI works.
if command -v cygpath > /dev/null 2>&1; then
  ZIP_PATH_FOR_AWS="$(cygpath -w "${ZIP_PATH}")"
else
  ZIP_PATH_FOR_AWS="${ZIP_PATH}"
fi

aws lambda update-function-code \
  --function-name "${FUNCTION_NAME}" \
  --zip-file "fileb://${ZIP_PATH_FOR_AWS}" \
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
NEW_ENV=$(echo "${CURRENT_ENV}" | "${PYTHON_BIN}" -c "
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

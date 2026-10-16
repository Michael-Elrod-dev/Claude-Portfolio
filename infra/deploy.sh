#!/usr/bin/env bash
# infra/deploy.sh — Package and deploy the Lambda function.
#
# Run from the repo root (or anywhere — the script finds its own location).
# Zips the data-gatherers/ directory (production deps only) and uploads it
# to the claude-portfolio-trader Lambda function.
#
# Usage:
#   bash infra/deploy.sh            # package + upload
#
# There are no mode flags. The pipeline has no dry-run: every run that gets
# past SSM claude-portfolio-active places real orders. To stop trading, use
# `bash infra/toggle.sh off` — not a deploy flag.

set -euo pipefail

REGION="us-east-1"
FUNCTION_NAME="claude-portfolio-trader"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
SRC_DIR="${REPO_ROOT}/data-gatherers"
BUILD_DIR="${REPO_ROOT}/.build"
ZIP_PATH="${BUILD_DIR}/lambda.zip"

# Refuse any argument rather than ignore it — a flag like `--dry-run` must
# not look like it worked.
if [ "$#" -gt 0 ]; then
  echo "✗ deploy.sh takes no arguments (got: $*)." >&2
  echo "  Every run trades for real. Use 'bash infra/toggle.sh off' to stop runs." >&2
  exit 1
fi

echo "=== Claude Portfolio Trader — Deploy ==="
echo "Source: ${SRC_DIR}"
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
# helper applies the exclude rules (dev clutter, ESLint packages, .git,
# etc.).
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

# ── Done ──────────────────────────────────────────────────────────────────
echo
echo "=== Deploy complete ==="
echo "  ⚠️  This build places REAL orders on every run. There is no dry-run."
echo
echo "Test a manual run:  bash infra/invoke-manual.sh"
echo "Enable schedule:    bash infra/toggle.sh on"

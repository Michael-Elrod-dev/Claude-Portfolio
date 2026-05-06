#!/usr/bin/env bash
# infra/deploy-api.sh — Package and deploy the API Lambda.
#
# Usage:
#   bash infra/deploy-api.sh

set -euo pipefail

REGION="us-east-1"
FUNCTION_NAME="claude-portfolio-api"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
SRC_DIR="${REPO_ROOT}/api"
BUILD_DIR="${REPO_ROOT}/.build"
ZIP_PATH="${BUILD_DIR}/api.zip"

echo "=== Claude Portfolio API — Deploy ==="
echo "Source: ${SRC_DIR}"
echo

# ── 1. Install production dependencies ────────────────────────────────────
echo "▸ Installing production dependencies..."
(cd "${SRC_DIR}" && npm install --omit=dev --silent)
echo "  Done."

# ── 2. Build the zip ──────────────────────────────────────────────────────
echo "▸ Building deployment zip..."
mkdir -p "${BUILD_DIR}"
rm -f "${ZIP_PATH}"

PYTHON_BIN="$(command -v python3 || command -v python)"
if [ -z "${PYTHON_BIN}" ]; then
  echo "✗ python3/python not found on PATH." >&2
  exit 1
fi

"${PYTHON_BIN}" "${SCRIPT_DIR}/zip-lambda.py" "${SRC_DIR}" "${ZIP_PATH}"

ZIP_SIZE=$(du -sh "${ZIP_PATH}" | cut -f1)
echo "  Zip size: ${ZIP_SIZE} — ${ZIP_PATH}"

# ── 3. Upload to Lambda ───────────────────────────────────────────────────
if command -v cygpath > /dev/null 2>&1; then
  ZIP_PATH_FOR_AWS="$(cygpath -w "${ZIP_PATH}")"
else
  ZIP_PATH_FOR_AWS="${ZIP_PATH}"
fi

echo "▸ Uploading to Lambda..."
aws lambda update-function-code \
  --function-name "${FUNCTION_NAME}" \
  --zip-file "fileb://${ZIP_PATH_FOR_AWS}" \
  --region "${REGION}" \
  --query '{CodeSize: CodeSize, LastModified: LastModified}' \
  --output table

echo "▸ Waiting for code update to complete..."
aws lambda wait function-updated \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}"

# ── Done ──────────────────────────────────────────────────────────────────
URL=$(aws lambda get-function-url-config \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --query FunctionUrl \
  --output text 2>/dev/null || echo "(function URL not configured — run setup-api.sh)")

echo
echo "=== API deploy complete ==="
echo "Function URL: ${URL}"
echo
echo "Smoke test:"
echo "  curl -s ${URL}health   # should return {\"status\":\"ok\"}"

#!/usr/bin/env bash
# infra/setup-api.sh — One-time setup for the HTTP API Lambda.
#
# Idempotent: re-running it is safe.
#
# What it creates:
#   1. Secrets Manager  claude-portfolio/api-bearer-token  (random 48-byte hex)
#   2. IAM role         claude-portfolio-api-role
#   3. IAM policy       claude-portfolio-api-policy
#   4. Lambda function  claude-portfolio-api  (placeholder — deploy-api.sh uploads code)
#   5. Lambda Function URL on the API Lambda (auth-type NONE; bearer token
#      is checked inside the Lambda)
#
# After setup:
#   1. Deploy the code:  bash infra/deploy-api.sh
#   2. Hit the URL:      curl -H "Authorization: Bearer $TOKEN" $URL/health
#
# The bearer token is printed once at the end. You can also retrieve it any
# time from the AWS console or via:
#   aws secretsmanager get-secret-value \
#     --secret-id claude-portfolio/api-bearer-token \
#     --query SecretString --output text

set -euo pipefail

REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
FUNCTION_NAME="claude-portfolio-api"
ROLE_NAME="claude-portfolio-api-role"
POLICY_NAME="claude-portfolio-api-policy"
BEARER_SECRET="claude-portfolio/api-bearer-token"
S3_BUCKET="claude-portfolio-${ACCOUNT_ID}"
SECRET_NAME="claude-portfolio/api-keys"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Claude Portfolio API — Infrastructure Setup ==="
echo "Account: ${ACCOUNT_ID}  Region: ${REGION}"
echo

# ── 1. Bearer-token secret ───────────────────────────────────────────────
echo "▸ Ensuring bearer-token secret ${BEARER_SECRET}..."
if aws secretsmanager describe-secret --secret-id "${BEARER_SECRET}" --region "${REGION}" \
     > /dev/null 2>&1; then
  echo "  Secret already exists — leaving value unchanged."
else
  TOKEN=$(python -c "import secrets; print(secrets.token_hex(48))")
  aws secretsmanager create-secret \
    --name "${BEARER_SECRET}" \
    --description "Bearer token for the Claude Portfolio HTTP API (Android app)" \
    --secret-string "${TOKEN}" \
    --region "${REGION}" \
    > /dev/null
  echo "  Secret created."
fi

# ── 2. IAM trust policy ──────────────────────────────────────────────────
echo "▸ Creating IAM role ${ROLE_NAME}..."
TRUST_POLICY=$(cat <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF
)

ROLE_ARN=$(aws iam create-role \
  --role-name "${ROLE_NAME}" \
  --assume-role-policy-document "${TRUST_POLICY}" \
  --query Role.Arn \
  --output text 2>/dev/null) \
|| ROLE_ARN=$(aws iam get-role --role-name "${ROLE_NAME}" --query Role.Arn --output text)

echo "  Role ARN: ${ROLE_ARN}"

aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
  2>/dev/null || true

# ── 3. Custom IAM policy ─────────────────────────────────────────────────
echo "▸ Publishing IAM policy ${POLICY_NAME}..."

POLICY_DOC=$(sed "s/369382711663/${ACCOUNT_ID}/g" "${SCRIPT_DIR}/api-policy.json")

POLICY_ARN=$(aws iam create-policy \
  --policy-name "${POLICY_NAME}" \
  --policy-document "${POLICY_DOC}" \
  --query Policy.Arn \
  --output text 2>/dev/null) \
|| POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn "${POLICY_ARN}" \
  2>/dev/null || true

# Always publish a fresh default version so re-runs apply changes.
EXISTING_VERSIONS=$(aws iam list-policy-versions \
  --policy-arn "${POLICY_ARN}" \
  --query 'length(Versions)' \
  --output text 2>/dev/null || echo 0)
if [ "${EXISTING_VERSIONS}" -ge 5 ]; then
  OLDEST_NON_DEFAULT=$(aws iam list-policy-versions \
    --policy-arn "${POLICY_ARN}" \
    --query 'Versions[?IsDefaultVersion==`false`] | sort_by(@, &CreateDate) | [0].VersionId' \
    --output text)
  aws iam delete-policy-version \
    --policy-arn "${POLICY_ARN}" \
    --version-id "${OLDEST_NON_DEFAULT}" \
    > /dev/null
fi
aws iam create-policy-version \
  --policy-arn "${POLICY_ARN}" \
  --policy-document "${POLICY_DOC}" \
  --set-as-default \
  > /dev/null 2>&1 \
  && echo "  Policy updated to latest api-policy.json." \
  || true

echo "  Policy ARN: ${POLICY_ARN}"

# ── 4. Lambda function (placeholder zip; deploy-api.sh uploads the real one)
echo "▸ Creating Lambda function ${FUNCTION_NAME}..."

# Give IAM a moment to propagate before Lambda tries to assume the role.
sleep 10

if aws lambda get-function --function-name "${FUNCTION_NAME}" --region "${REGION}" \
     > /dev/null 2>&1; then
  echo "  Lambda function already exists — skipping create."
else
  TMPDIR=$(mktemp -d)
  echo 'exports.handler = async () => ({ statusCode: 200, body: "{\"status\":\"placeholder\"}" });' \
    > "${TMPDIR}/handler.js"

  # Use Python to zip since `zip` isn't always installed (Windows Git Bash).
  PYTHON_BIN="$(command -v python3 || command -v python)"
  "${PYTHON_BIN}" -c "
import os, sys, zipfile
src = sys.argv[1]; dst = sys.argv[2]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(src, 'handler.js'), 'handler.js')
" "${TMPDIR}" "${TMPDIR}/placeholder.zip"

  # Convert the zip path for the Windows AWS CLI if running under MSYS/Cygwin.
  if command -v cygpath > /dev/null 2>&1; then
    ZIP_PATH_FOR_AWS="$(cygpath -w "${TMPDIR}/placeholder.zip")"
  else
    ZIP_PATH_FOR_AWS="${TMPDIR}/placeholder.zip"
  fi

  aws lambda create-function \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs22.x \
    --role "${ROLE_ARN}" \
    --handler "handler.handler" \
    --zip-file "fileb://${ZIP_PATH_FOR_AWS}" \
    --timeout 30 \
    --memory-size 512 \
    --environment "Variables={MEMO_S3_BUCKET=${S3_BUCKET},MEMO_S3_KEY=memo.json,SECRET_NAME=${SECRET_NAME},BEARER_SECRET_NAME=${BEARER_SECRET},PIPELINE_FUNCTION_NAME=claude-portfolio-trader}" \
    --region "${REGION}" \
    > /dev/null

  rm -rf "${TMPDIR}"
  echo "  Lambda function created (placeholder code)."
fi

# ── 5. API Gateway HTTP API ──────────────────────────────────────────────
# We use an API Gateway HTTP API rather than a Lambda Function URL because
# Function URLs require an account-level public-access setting that AWS
# blocks by default on many accounts as of 2024+. API Gateway is also fine
# for personal use at this volume (well under the 1M-req free tier).
API_NAME="claude-portfolio-api"

echo "▸ Ensuring API Gateway HTTP API ${API_NAME}..."

API_ID=$(aws apigatewayv2 get-apis \
  --region "${REGION}" \
  --query "Items[?Name=='${API_NAME}'].ApiId | [0]" \
  --output text 2>/dev/null)

if [ -z "${API_ID}" ] || [ "${API_ID}" = "None" ]; then
  API_ID=$(aws apigatewayv2 create-api \
    --name "${API_NAME}" \
    --protocol-type HTTP \
    --target "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}" \
    --region "${REGION}" \
    --query ApiId \
    --output text)
  echo "  API created: ${API_ID}"
else
  echo "  API already exists: ${API_ID}"
fi

# Lambda must allow API Gateway to invoke it.
aws lambda add-permission \
  --function-name "${FUNCTION_NAME}" \
  --statement-id "APIGatewayInvoke" \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*/*" \
  --region "${REGION}" \
  2>/dev/null || true

URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com"
echo "  API URL: ${URL}"

# ── Done ─────────────────────────────────────────────────────────────────
echo
echo "=== API setup complete ==="
echo
echo "API URL:          ${URL}"
echo "Bearer secret:    ${BEARER_SECRET}"
echo
echo "Reveal the bearer token (paste into the Android app on first launch):"
echo "  aws secretsmanager get-secret-value --secret-id ${BEARER_SECRET} --query SecretString --output text"
echo
echo "Next: bash infra/deploy-api.sh"

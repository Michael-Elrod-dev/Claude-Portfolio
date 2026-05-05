#!/usr/bin/env bash
# infra/setup.sh — One-time AWS infrastructure setup for Claude Portfolio Trader.
#
# Run this once from the repo root. It is idempotent: re-running it is safe
# (create commands use --no-fail-on-existing or check before creating).
#
# Prerequisites:
#   aws CLI configured with a profile that has IAM + Lambda + EventBridge +
#   Secrets Manager + SSM permissions.
#
# Usage:
#   bash infra/setup.sh
#
# What it creates:
#   1. IAM role          claude-portfolio-lambda-role
#   2. IAM policy        claude-portfolio-lambda-policy (S3 + SecretsManager + SSM)
#   3. Secrets Manager   claude-portfolio/api-keys  (you fill in the values)
#   4. SSM parameter     /claude-portfolio/active = "false"  (bot starts paused)
#   5. Lambda function   claude-portfolio-trader
#   6. EventBridge rule  claude-portfolio-monday    (Mon 13:00 UTC / 9 AM ET, DISABLED)
#   7. EventBridge rule  claude-portfolio-thursday  (Thu 13:00 UTC / 9 AM ET, DISABLED)
#
# After setup:
#   1. Fill in your API keys:  bash infra/secrets-update.sh
#   2. Deploy the code:        bash infra/deploy.sh
#   3. Enable the bot:         bash infra/toggle.sh on

set -euo pipefail

REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
FUNCTION_NAME="claude-portfolio-trader"
ROLE_NAME="claude-portfolio-lambda-role"
POLICY_NAME="claude-portfolio-lambda-policy"
S3_BUCKET="claude-portfolio-${ACCOUNT_ID}"
SECRET_NAME="claude-portfolio/api-keys"
ACTIVE_PARAM="claude-portfolio-active"

echo "=== Claude Portfolio Trader — Infrastructure Setup ==="
echo "Account: ${ACCOUNT_ID}  Region: ${REGION}"
echo

# ── 1. IAM trust policy ────────────────────────────────────────────────────
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
|| ROLE_ARN=$(aws iam get-role \
  --role-name "${ROLE_NAME}" \
  --query Role.Arn \
  --output text)

echo "  Role ARN: ${ROLE_ARN}"

# Attach managed execution policy (CloudWatch Logs)
aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
  2>/dev/null || true

# ── 2. Custom IAM policy (S3 + Secrets Manager + SSM) ─────────────────────
echo "▸ Creating IAM policy ${POLICY_NAME}..."

# Substitute the actual account ID into the policy document.
POLICY_DOC=$(sed "s/369382711663/${ACCOUNT_ID}/g; s/claude-portfolio-369382711663/claude-portfolio-${ACCOUNT_ID}/g" \
  "$(dirname "$0")/policy.json")

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

echo "  Policy ARN: ${POLICY_ARN}"

# ── 3. Secrets Manager ─────────────────────────────────────────────────────
echo "▸ Creating secret ${SECRET_NAME}..."

SECRET_VALUE=$(cat <<'EOF'
{
  "ANTHROPIC_API_KEY": "REPLACE_ME",
  "ALPACA_KEY_ID":     "REPLACE_ME",
  "ALPACA_SECRET_KEY": "REPLACE_ME",
  "FINNHUB_API_KEY":   "REPLACE_ME"
}
EOF
)

aws secretsmanager create-secret \
  --name "${SECRET_NAME}" \
  --description "API keys for Claude Portfolio Trader" \
  --secret-string "${SECRET_VALUE}" \
  --region "${REGION}" \
  2>/dev/null && echo "  Secret created." \
|| echo "  Secret already exists — skipping create. Run infra/secrets-update.sh to set values."

# ── 4. SSM Parameter (active flag) ────────────────────────────────────────
echo "▸ Creating SSM parameter ${ACTIVE_PARAM} = false..."

aws ssm put-parameter \
  --name "${ACTIVE_PARAM}" \
  --value "false" \
  --type String \
  --region "${REGION}" \
  2>/dev/null || \
aws ssm put-parameter \
  --name "${ACTIVE_PARAM}" \
  --value "false" \
  --type String \
  --overwrite \
  --region "${REGION}" \
  > /dev/null

echo "  Bot starts INACTIVE. Run 'bash infra/toggle.sh on' after deploy."

# ── 5. Lambda function (placeholder — deploy.sh uploads the real zip) ─────
echo "▸ Creating Lambda function ${FUNCTION_NAME}..."

# Give IAM a moment to propagate before Lambda tries to assume the role.
sleep 10

# Create a minimal placeholder zip (Lambda requires a zip to create the function).
TMPDIR=$(mktemp -d)
echo 'exports.handler = async () => ({ statusCode: 200, body: "placeholder" });' \
  > "${TMPDIR}/index.js"
(cd "${TMPDIR}" && zip -q placeholder.zip index.js)

aws lambda create-function \
  --function-name "${FUNCTION_NAME}" \
  --runtime nodejs22.x \
  --role "${ROLE_ARN}" \
  --handler "lambda/handler.handler" \
  --zip-file "fileb://${TMPDIR}/placeholder.zip" \
  --timeout 900 \
  --memory-size 512 \
  --environment "Variables={MEMO_S3_BUCKET=${S3_BUCKET},MEMO_S3_KEY=memo.json,EXECUTOR_LIVE=false,SECRET_NAME=${SECRET_NAME}}" \
  --region "${REGION}" \
  2>/dev/null && echo "  Lambda function created." \
|| echo "  Lambda function already exists — skipping create. Run infra/deploy.sh to update code."

rm -rf "${TMPDIR}"

FUNCTION_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}"

# ── 6 & 7. EventBridge rules ───────────────────────────────────────────────
echo "▸ Creating EventBridge rules (both start DISABLED)..."

create_rule() {
  local NAME="$1"
  local SCHEDULE="$2"

  aws events put-rule \
    --name "${NAME}" \
    --schedule-expression "${SCHEDULE}" \
    --state DISABLED \
    --description "Claude Portfolio Trader — ${NAME}" \
    --region "${REGION}" \
    --query RuleArn \
    --output text

  # Wire the rule to the Lambda function.
  aws events put-targets \
    --rule "${NAME}" \
    --targets "Id=lambda,Arn=${FUNCTION_ARN}" \
    --region "${REGION}" \
    > /dev/null

  # Grant EventBridge permission to invoke the function.
  aws lambda add-permission \
    --function-name "${FUNCTION_NAME}" \
    --statement-id "allow-eventbridge-${NAME}" \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${NAME}" \
    --region "${REGION}" \
    2>/dev/null || true
}

# Monday 13:00 UTC = 9 AM ET — places orders into Monday's opening session
create_rule "claude-portfolio-monday"    "cron(0 13 ? * MON *)"

# Thursday 13:00 UTC = 9 AM ET — catches mid-week earnings/news
create_rule "claude-portfolio-thursday"  "cron(0 13 ? * THU *)"

echo "  Rules created and wired to Lambda."

# ── Done ───────────────────────────────────────────────────────────────────
echo
echo "=== Setup complete ==="
echo
echo "Next steps:"
echo "  1. Add your API keys:    bash infra/secrets-update.sh"
echo "  2. Deploy the code:      bash infra/deploy.sh"
echo "  3. Enable the bot:       bash infra/toggle.sh on"
echo "  4. Test a manual run:    bash infra/invoke-manual.sh"
echo
echo "To enable the schedule after testing, the EventBridge rules are DISABLED."
echo "Run 'aws events enable-rule --name claude-portfolio-sunday ...' to turn them on,"
echo "or use the toggle script which handles both rules at once."

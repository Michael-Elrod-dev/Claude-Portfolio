#!/usr/bin/env bash
# infra/invoke-manual.sh — Manually trigger one pipeline run.
#
# Invokes the Lambda function asynchronously (fire-and-forget) since the
# pipeline can take 3–8 minutes and the AWS CLI synchronous timeout is 60s.
# After invoking, it polls CloudWatch logs until the run finishes.
#
# Usage:
#   bash infra/invoke-manual.sh           # respects the active flag
#   bash infra/invoke-manual.sh --force   # bypasses active flag (runs even when bot is off)
#   bash infra/invoke-manual.sh --status  # just show recent log output without invoking

set -euo pipefail

REGION="us-east-1"
FUNCTION_NAME="claude-portfolio-trader"
LOG_GROUP="/aws/lambda/${FUNCTION_NAME}"

FORCE=false
STATUS_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --force)  FORCE=true  ;;
    --status) STATUS_ONLY=true ;;
  esac
done

tail_latest_logs() {
  local STREAM
  STREAM=$(aws logs describe-log-streams \
    --log-group-name "${LOG_GROUP}" \
    --order-by LastEventTime \
    --descending \
    --limit 1 \
    --region "${REGION}" \
    --query 'logStreams[0].logStreamName' \
    --output text 2>/dev/null)

  if [ -z "${STREAM}" ] || [ "${STREAM}" = "None" ]; then
    echo "  (no log streams found yet)"
    return
  fi

  echo "Log stream: ${STREAM}"
  echo ""
  aws logs get-log-events \
    --log-group-name "${LOG_GROUP}" \
    --log-stream-name "${STREAM}" \
    --region "${REGION}" \
    --query 'events[*].message' \
    --output text 2>/dev/null \
  | grep -v "^START RequestId\|^END RequestId\|^REPORT RequestId" \
  || echo "  (no log events yet)"
}

if [ "${STATUS_ONLY}" = "true" ]; then
  echo "=== Recent log output ==="
  tail_latest_logs
  exit 0
fi

if [ "${FORCE}" = "true" ]; then
  PAYLOAD='{"force":true}'
  echo "=== Manual run (force=true — bypassing active flag) ==="
else
  PAYLOAD='{}'
  echo "=== Manual run (respects active flag) ==="
  echo "  Tip: use --force to bypass the active flag when the bot is off."
fi

echo "  Function: ${FUNCTION_NAME}  Region: ${REGION}"
echo "  The run is async — pipeline takes 3–8 minutes."
echo "  Watch CloudWatch at: https://console.aws.amazon.com/cloudwatch/home?region=${REGION}#logsV2:log-groups/log-group/\$252Faws\$252Flambda\$252F${FUNCTION_NAME}"
echo ""

aws lambda invoke \
  --function-name "${FUNCTION_NAME}" \
  --payload "${PAYLOAD}" \
  --cli-binary-format raw-in-base64-out \
  --invocation-type Event \
  --region "${REGION}" \
  /dev/null \
  --output json \
  --query StatusCode 2>&1 | grep -q "202" && echo "✓ Invoked (202 Accepted)." || echo "⚠ Unexpected response — check AWS console."

echo ""
echo "Poll logs in ~2 minutes with:"
echo "  bash infra/invoke-manual.sh --status"

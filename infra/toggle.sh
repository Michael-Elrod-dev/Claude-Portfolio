#!/usr/bin/env bash
# infra/toggle.sh — Enable or disable the Claude Portfolio Trader.
#
# This is the main "switch" for the bot. It controls two things:
#   1. The SSM parameter /claude-portfolio/active — the Lambda reads this on
#      every invocation. If false, the function exits immediately without
#      running the pipeline. A manual invoke with { "force": true } bypasses
#      this check (see invoke-manual.sh).
#
#   2. The EventBridge rules — disabling them prevents the Lambda from being
#      called on schedule at all. This is the outer kill switch; SSM is the
#      inner one that still allows force-invokes.
#
# Usage:
#   bash infra/toggle.sh on     — activate (SSM=true  + enable EventBridge rules)
#   bash infra/toggle.sh off    — pause    (SSM=false + disable EventBridge rules)
#   bash infra/toggle.sh status — show current state

set -euo pipefail

REGION="us-east-1"
ACTIVE_PARAM="claude-portfolio-active"
RULES=("claude-portfolio-monday" "claude-portfolio-thursday")

ACTION="${1:-status}"

show_status() {
  echo "=== Claude Portfolio Trader — Status ==="

  SSM_VAL=$(aws ssm get-parameter \
    --name "${ACTIVE_PARAM}" \
    --region "${REGION}" \
    --query Parameter.Value \
    --output text 2>/dev/null || echo "NOT SET")
  echo "  SSM active flag:  ${SSM_VAL}"

  for RULE in "${RULES[@]}"; do
    STATE=$(aws events describe-rule \
      --name "${RULE}" \
      --region "${REGION}" \
      --query State \
      --output text 2>/dev/null || echo "NOT FOUND")
    echo "  EventBridge ${RULE}: ${STATE}"
  done
}

case "${ACTION}" in
  on)
    echo "▸ Activating bot..."

    aws ssm put-parameter \
      --name "${ACTIVE_PARAM}" \
      --value "true" \
      --type String \
      --overwrite \
      --region "${REGION}" > /dev/null
    echo "  SSM /claude-portfolio/active = true"

    for RULE in "${RULES[@]}"; do
      aws events enable-rule \
        --name "${RULE}" \
        --region "${REGION}"
      echo "  EventBridge rule enabled: ${RULE}"
    done

    echo
    echo "✓ Bot is ON. Scheduled runs: Monday + Thursday at 13:00 UTC (9 AM ET)."
    echo "  To run immediately: bash infra/invoke-manual.sh"
    ;;

  off)
    echo "▸ Deactivating bot..."

    aws ssm put-parameter \
      --name "${ACTIVE_PARAM}" \
      --value "false" \
      --type String \
      --overwrite \
      --region "${REGION}" > /dev/null
    echo "  SSM /claude-portfolio/active = false"

    for RULE in "${RULES[@]}"; do
      aws events disable-rule \
        --name "${RULE}" \
        --region "${REGION}"
      echo "  EventBridge rule disabled: ${RULE}"
    done

    echo
    echo "✓ Bot is OFF. No scheduled runs will occur."
    echo "  To force a one-off run anyway: bash infra/invoke-manual.sh --force"
    ;;

  status)
    show_status
    ;;

  *)
    echo "Usage: bash infra/toggle.sh [on|off|status]"
    exit 1
    ;;
esac

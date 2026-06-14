#!/usr/bin/env bash
# infra/secrets-update.sh — Store your API keys in Secrets Manager.
#
# Run this after setup.sh. The keys are prompted interactively so they
# never appear in your shell history.
#
# Usage:
#   bash infra/secrets-update.sh

set -euo pipefail

REGION="us-east-1"
SECRET_NAME="claude-portfolio/api-keys"

echo "=== Update API keys in Secrets Manager ==="
echo "Secret: ${SECRET_NAME}  Region: ${REGION}"
echo "Leave a field blank to keep the existing value."
echo

read -rsp "ANTHROPIC_API_KEY:    " ANTHROPIC_API_KEY;    echo
read -rsp "ALPACA_KEY_ID:        " ALPACA_KEY_ID;        echo
read -rsp "ALPACA_SECRET_KEY:    " ALPACA_SECRET_KEY;    echo
read -rsp "FINNHUB_API_KEY:      " FINNHUB_API_KEY;      echo
read -rsp "TRADE_PARSER_API_KEY: " TRADE_PARSER_API_KEY; echo

# Fetch the current secret so we can preserve any blank fields.
CURRENT=$(aws secretsmanager get-secret-value \
  --secret-id "${SECRET_NAME}" \
  --region "${REGION}" \
  --query SecretString \
  --output text 2>/dev/null || echo '{}')

# Merge: use new value if provided, else keep existing.
get_or_keep() {
  local NEW="$1"
  local KEY="$2"
  if [ -n "${NEW}" ]; then
    echo "${NEW}"
  else
    echo "${CURRENT}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('${KEY}',''))"
  fi
}

NEW_SECRET=$(python3 -c "
import json, sys
current = json.loads('''${CURRENT}''')
updates = {
  'ANTHROPIC_API_KEY': '''${ANTHROPIC_API_KEY}''' or current.get('ANTHROPIC_API_KEY',''),
  'ALPACA_KEY_ID':     '''${ALPACA_KEY_ID}'''     or current.get('ALPACA_KEY_ID',''),
  'ALPACA_SECRET_KEY': '''${ALPACA_SECRET_KEY}''' or current.get('ALPACA_SECRET_KEY',''),
  'FINNHUB_API_KEY':   '''${FINNHUB_API_KEY}'''   or current.get('FINNHUB_API_KEY',''),
  'TRADE_PARSER_API_KEY': '''${TRADE_PARSER_API_KEY}''' or current.get('TRADE_PARSER_API_KEY',''),
}
print(json.dumps(updates))
")

aws secretsmanager put-secret-value \
  --secret-id "${SECRET_NAME}" \
  --secret-string "${NEW_SECRET}" \
  --region "${REGION}" \
  > /dev/null

echo
echo "✓ Keys stored in Secrets Manager: ${SECRET_NAME}"
echo "  Lambda will pick them up on the next cold start."

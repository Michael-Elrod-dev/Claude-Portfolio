#!/usr/bin/env bash
# Installed as /usr/local/bin/claude-portfolio-congressional and run by
# claude-portfolio-congressional.service as the claude-portfolio user.
# One cycle: poll the House and Senate for new filings, retry scanned filings with
# Claude OCR (on whenever ANTHROPIC_API_KEY is set), rebuild the member stats, then
# write the 14-day snapshot the bot reads before its next run.
set -euo pipefail

bin=/opt/claude-portfolio/current/congressional/.venv/bin/congressional
dir=${CONGRESSIONAL_DATA_DIR:?}
out=${PORTFOLIO_DATA_DIR:?}/congressional.json
year=$(date -u +%Y)

"$bin" poll --data-dir "$dir"
"$bin" house parse-ptrs "$year" --data-dir "$dir" --retry-scanned
"$bin" senate parse-ptrs "$year" --data-dir "$dir" --retry-paper
"$bin" rebuild-read-model --data-dir "$dir"
"$bin" export --data-dir "$dir" --window-days 14 --out "$out"

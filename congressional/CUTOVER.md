# Cutover: Trade-Parser workflow → this repo

Temporary runbook. Delete this file once the cutover is done.

**State before cutover.** `congressional/` and
`.github/workflows/congressional-export.yml` are in place with
`EXPORT_TARGET: staging`: manual runs only, writing
`congressional.staging.json`, no OCR, no seed writes. The IAM role
`claude-portfolio-congressional-export` (trust: this repo's `main` only) can
read the seed and write the staging key — nothing else. The bot still reads
`congressional.json`, produced by Trade-Parser's workflow.

**When.** After the old workflow's Monday export has *finished* (it starts
late — 13:00–17:00 UTC — so check the run, don't assume), and before
Wednesday 23:17 UTC, the new schedule's first slot. Doing it Tue/Wed means
Monday's bot run, the first on Opus 5.5 + the refusal fallback, is not also
the first on a new data feed.

## 1. Refresh the seed from the old pipeline's warm DB

The old repo's Actions cache holds the only up-to-date, already-OCR'd
database. A cold start from the July 2026 seed would stamp ~3 months of
filings as first-seen-today and flood the bot's window (2,069 trades instead
of ~770). So export that DB once:

- Grant the old role `trade-parser-congressional-export` `s3:PutObject` on
  `congressional-seed.db` (add it to its `s3-congressional-snapshot` policy).
- In the Trade-Parser repo, add a final step to `congressional-export.yml`:
  `aws s3 cp data/trade_parser.db s3://<bucket>/congressional-seed.db`
  (working directory `backend`), then dispatch it once from the Actions tab.
- Confirm the new seed: `filings` max `filing_date` is within a few days of
  today, and website tables are present but empty.
- Drop the website tables from the seed and re-upload — they are dead
  weight in a public-repo cache: `admin_jobs admin_settings ai_briefs
  alert_events alert_rules api_keys api_usage audit_log email_suppressions
  email_verifications entity_news password_resets stripe_events
  trade_ai_notes users market_data issuer_profile poll_health global_stats
  issuer_stats`, then `VACUUM`.

## 2. Switch this repo's workflow to production

- IAM: replace the new role's `s3-congressional` policy with
  `s3:PutObject` on `congressional.json` **and** `congressional-seed.db`, and
  `s3:GetObject` on `congressional-seed.db`. Drop the staging key.
- `congressional-export.yml`: `EXPORT_TARGET: production`, and uncomment the
  `schedule` block (`17 23 * * 0,3`).
- Disable the old workflow: `gh workflow disable "Congressional export" -R
  Michael-Elrod-dev/Trade-Parser`.
- Dispatch the new workflow once. It cold-starts (production has no cache
  yet) from the fresh seed, so expect a small ingest delta, no OCR this run.
- Verify the new `congressional.json` against the last old snapshot: similar
  trade count in the 14-day window (not thousands), newest `published` dates
  recent, ~1,200 politicians, `exportedAt` from this run.

## 3. Bot cleanup (needs a trader deploy)

- `bash infra/deploy.sh` — ships `secretsLoader.js` without the
  `TRADE_PARSER_API_KEY` requirement. Verify the deployed bundle.
- Only after that deploy: remove `TRADE_PARSER_API_KEY` from the
  `claude-portfolio/api-keys` secret. (Before it, the deployed code would
  refuse to start without it.)

## 4. Retire Trade-Parser

- Delete the old IAM role `trade-parser-congressional-export`.
- Delete `congressional.staging.json` from the bucket and the staging DB
  cache entries (`gh cache list` / `gh cache delete` on the
  `congressional-db-staging-` prefix).
- Archive the GitHub repo `Michael-Elrod-dev/Trade-Parser` (Settings → Archive).
  This also strands its `ANTHROPIC_API_KEY` secret; revoke that key in the
  Anthropic console if it is not the bot's key.
- Delete this file.

## Account-level cleanup (your logins)

- **Cloudflare:** turn off auto-renew for congress-trades.com.
- **Railway:** cancel the Hobby plan (≈$5/mo even with no services).
- **Stripe:** the account is in live mode with no site — deactivate the
  products or close it.
- **UptimeRobot:** delete the `/healthz` monitor (the site is gone).
- **Resend, Sentry, Google OAuth client, the empty "Congress Trades" Vercel
  team:** remove when convenient; none of them bill.

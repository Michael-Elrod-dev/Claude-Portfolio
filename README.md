# Claude-Portfolio

A bi-weekly automated trading system that runs on AWS Lambda, gathers
market data from several sources, asks Claude (via the Anthropic API) for
trade recommendations, executes them on an Alpaca brokerage account,
and reports results to an Android companion app via FCM push notification.

The core design principle is **"humans control the inputs, Claude controls
the decisions"** — we do not shape what Claude buys, only what data it sees.

> **History:** this began as a paper-trading research project run in parallel
> to a separate Pelosi-Mirror real-money strategy. That experiment concluded
> in June 2026; Claude was then given control of the (formerly Pelosi) live
> brokerage account, which it now trades. The pipeline points at the live
> account (`paper: false`); `paper: true` survives only in the local
> `run-*.js` dev harnesses, which hit a paper account for safe testing.

The system has three deployable units:

| Unit | What it is | Where it runs |
|---|---|---|
| **Pipeline** (`data-gatherers/`) | The trading bot itself: briefing → analysis → memo → executor | AWS Lambda `claude-portfolio-trader`, fired by EventBridge Mon + Thu @ 13:00 UTC |
| **HTTP API** (`api/`) | Read-only views over Alpaca + DynamoDB + S3 + SSM, plus a few writes | AWS Lambda `claude-portfolio-api` behind API Gateway HTTP API |
| **Android app** (`android/`) | Personal-use companion: portfolio, last run, memo, history, settings, push | Side-loaded Kotlin/Compose app on the user's phone |

---

## Architecture

```
EventBridge (Mon + Thu @ 13:00 UTC)
        │
        ▼
   Pipeline Lambda  ──►  Briefing assembler
        │                  Alpaca · earnings · congressional · memo (S3)
        │
        ▼
   Analyst (Claude API + web search)  ──►  trade recommendations JSON
        │                                  + memo update
        ▼
   MemoUpdater (Claude, no tools)  ──►  new memo, written to S3
        │
        ▼
   Executor  ──►  Alpaca paper account
                  (dry-run by default; live mode opt-in via SSM flag)
        │
        ▼
   ──┬──  DynamoDB  claude-portfolio-runs       (run record, 30d TTL)
     ├──  DynamoDB  claude-portfolio-activity   (event log, 30d TTL)
     ├──  S3        memo.json                   (overwritten each run)
     └──  FCM       run_complete · queued · briefing_error · run_failed
                          │
                          ▼
                    Android app  ◄──  HTTP API Lambda
                                       /portfolio · /memo · /runs · /flags · ...
```

Three components, three lambdas: pipeline, HTTP API, FCM publisher
(embedded in the pipeline lambda). Each has natural checkpoints between
phases.

### What is programmatic vs. what Claude does at runtime

The data layer follows a simple rule: **scripts handle the facts, Claude
handles the prose.** Canonical structured data is fetched programmatically
so it's exact, auditable, and doesn't drift week-to-week. Qualitative
context (news, sentiment, macro commentary) is left to Claude's web search
tool, where its synthesis ability adds the most value.

| Data | Method | Why |
|---|---|---|
| Portfolio (positions, cash, orders) | Alpaca SDK | Source of truth |
| Earnings calendar | Finnhub free API | Canonical dates — guardrail |
| Congressional trades | trade-parser API | Free signal source |
| News on held + watched tickers | Claude web search at runtime | Synthesis is the value-add |
| Macro / market commentary | Claude web search at runtime | Same |
| Deeper research on candidates | Claude web search at runtime | Same |
| Past reasoning + watchlist | S3 memo | Persistent state |

---

## Project layout

```
data-gatherers/                     ← Pipeline lambda code
├── sources/
│   ├── DataSource.js              ← abstract base class, fetch() contract
│   ├── AlpacaSource.js            ← portfolio + recent orders
│   ├── EarningsSource.js          ← upcoming earnings dates
│   ├── CongressionalSource.js     ← trade-parser API client
│   ├── MemoSource.js              ← persistent memo reader
│   ├── memoBackendFactory.js      ← picks S3 or local based on env
│   ├── backends/
│   │   ├── LocalFileBackend.js    ← memo backend for development
│   │   └── S3Backend.js           ← memo backend for production
├── briefing/
│   └── BriefingAssembler.js       ← orchestrates all sources → one JSON
├── analyst/
│   ├── Analyst.js                 ← trade-recommendations Claude call
│   ├── MemoUpdater.js             ← memo-rewrite Claude call
│   └── parseResponse.js           ← shared: extract JSON from final text block
├── prompts/
│   ├── analystSystemPrompt.js     ← Analyst system prompt (cached)
│   ├── buildAnalystUserPrompt.js  ← Analyst user prompt builder
│   ├── memoUpdaterSystemPrompt.js ← MemoUpdater system prompt (cached)
│   └── buildMemoUpdaterUserPrompt.js ← MemoUpdater user prompt builder
├── executor/
│   ├── Executor.js                ← submits recommendations to Alpaca
│   └── sizingResolver.js          ← amount → qty/notional (pure logic)
├── lambda/
│   ├── handler.js                 ← entry point — wraps the full pipeline in try/catch
│   ├── secretsLoader.js           ← Secrets Manager + SSM active-flag reader
│   ├── liveFlag.js                ← reads SSM /claude-portfolio-live (env fallback)
│   ├── runArchiver.js             ← writes one row per run to claude-portfolio-runs
│   ├── activityLogger.js          ← appends events to claude-portfolio-activity
│   ├── fcmPublisher.js            ← lazy-loads firebase-admin, sends pushes
│   └── emailer.js                 ← legacy SES notifier (currently disabled)
├── fixtures/
│   └── test-recommendations.json  ← edge-case fixture for executor tests
├── run-*.js                       ← npm-script test harnesses
├── .env / .env.example            ← gitignored — local secrets only
└── package.json

api/                                ← HTTP API lambda code
├── handler.js                     ← regex router, bearer-token auth
├── auth.js                        ← constant-time comparison vs Secrets Manager
├── respond.js                     ← JSON response helpers
├── routes/
│   ├── portfolio.js               ← GET /portfolio (Alpaca + memo enrichment)
│   ├── memo.js                    ← GET /memo
│   ├── runs.js                    ← GET /runs/latest, /runs/{date}, /runs?limit=N
│   ├── briefing.js                ← GET /briefing/latest
│   ├── activity.js                ← GET /activity
│   ├── flags.js                   ← GET/PUT /flags/active and /flags/live
│   ├── devices.js                 ← POST /devices (FCM token registration)
│   └── runForce.js                ← POST /run/force
├── services/
│   ├── alpaca.js                  ← Alpaca client + portfolio enrichment
│   ├── ddb.js                     ← shared Dynamo doc client
│   ├── ssm.js                     ← SSM read/write helpers
│   ├── secrets.js                 ← API-keys secret reader
│   └── s3memo.js                  ← S3 memo reader
└── package.json

android/                            ← Kotlin/Compose companion app
├── build.gradle.kts                  root Gradle (Compose, Kotlin, Firebase plugins)
├── app/
│   ├── build.gradle.kts            ← app module deps + conditional google-services
│   ├── google-services.json        ← Firebase Android config (committed; not secret)
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/claudeportfolio/app/
│       │   ├── MainActivity.kt              ← edge-to-edge, FCM token registration,
│       │   │                                    notification permission, deep-link handler
│       │   ├── PortfolioApp.kt              ← Application — registers notification channel
│       │   ├── data/
│       │   │   ├── api/
│       │   │   │   ├── PortfolioApi.kt       ← suspend interface, MockApi + RetrofitApi
│       │   │   │   ├── MockApi.kt            ← in-memory data for dev/first-launch
│       │   │   │   ├── PortfolioService.kt   ← Retrofit + envelope types
│       │   │   │   ├── ApiFactory.kt         ← per-(baseUrl, token) Retrofit builder
│       │   │   │   └── RetrofitApi.kt
│       │   │   ├── config/ConfigStore.kt    ← DataStore — base URL + bearer token
│       │   │   └── model/Models.kt          ← @Serializable wire types
│       │   ├── push/
│       │   │   ├── PushService.kt            ← FirebaseMessagingService → notifications
│       │   │   ├── NotificationChannels.kt   ← idempotent channel setup
│       │   │   └── PushConstants.kt          ← channel id, intent extras
│       │   └── ui/
│       │       ├── RootScreen.kt             ← NavController + tab routing
│       │       ├── LocalApi.kt               ← API + IsLive + RefreshTick CompositionLocals
│       │       ├── UiState.kt                ← Loading/Ready/Error + rememberLoadable
│       │       ├── theme/                    ← Color, Type, Theme
│       │       ├── components/               ← AppBar, BottomNav, NavIcons, Skeleton
│       │       ├── format/Format.kt          ← USD / pct / date formatters
│       │       └── screens/                  ← 5 tabs + RunDetail
│       └── res/                              ← icons, strings, themes, font_certs
└── README.md                       ← Android-specific build instructions

infra/                              ← AWS provisioning + deploy scripts
├── setup.sh                       ← one-time: IAM, Lambda, EventBridge, Dynamo, SSM, S3
├── setup-api.sh                   ← one-time: API IAM + Lambda + API Gateway + bearer secret
├── deploy.sh                      ← packages and uploads pipeline lambda code
├── deploy-api.sh                  ← packages and uploads API lambda code
├── invoke-manual.sh               ← fire a forced pipeline run (--force)
├── toggle.sh                      ← on/off/status — SSM active flag + EventBridge rules
├── secrets-update.sh              ← interactive secret editor for claude-portfolio/api-keys
├── fetch-memo.py                  ← grab the memo from S3 to look at locally
├── zip-lambda.py                  ← cross-platform zip helper used by deploy scripts
├── policy.json                    ← IAM policy for the pipeline lambda
└── api-policy.json                ← IAM policy for the API lambda

README.md                           ← (this file)
```

Every data source extends `DataSource` and exposes a single `fetch()`
method returning a structured JSON snapshot. The runners are thin test
harnesses; `BriefingAssembler` orchestrates them in production.

---

## Setup

The system has three deployable units — pipeline, API, Android. These
instructions cover provisioning a fresh AWS account end-to-end. If you're
just running the pipeline locally for development, only step 1 matters.

### Prerequisites

- AWS CLI (v2) configured with a profile that has IAM + Lambda +
  EventBridge + Secrets Manager + SSM + DynamoDB + S3 + APIGatewayV2 perms
- Python 3 (for the cross-platform zip helper used by `infra/deploy*.sh`)
- Node 22 (matches the Lambda runtime)
- Android Studio (any 2024.x stable — Iguana through Ladybug)
- Alpaca **paper** account: get keys at
  [app.alpaca.markets](https://app.alpaca.markets)
- Finnhub free key: [finnhub.io](https://finnhub.io)
- Anthropic API key: [console.anthropic.com](https://console.anthropic.com)

### 1. Pipeline (data-gatherers)

```bash
cd data-gatherers
npm install
cp .env.example .env  # fill in ALPACA_*, FINNHUB_API_KEY, ANTHROPIC_API_KEY, TRADE_PARSER_API_KEY

# sanity-check each source
npm run alpaca
npm run earnings
npm run congressional
```

### 2. AWS pipeline infra

From the repo root:

```bash
bash infra/setup.sh           # creates IAM role/policy, S3, Secrets Manager
                              # placeholder, SSM flags, Dynamo tables (runs +
                              # activity + devices), Lambda function (placeholder
                              # code), EventBridge rules (DISABLED)

bash infra/secrets-update.sh  # interactive — paste your Anthropic, Alpaca,
                              # and Finnhub keys into Secrets Manager

bash infra/deploy.sh          # uploads the real lambda code

bash infra/toggle.sh on       # enables SSM active flag + EventBridge rules
                              # (Mon + Thu @ 13:00 UTC)
```

### 3. HTTP API

```bash
bash infra/setup-api.sh       # creates API Lambda role/policy, Lambda
                              # function, API Gateway HTTP API, generates
                              # bearer token in Secrets Manager

bash infra/deploy-api.sh      # uploads the API code

# print the URL + bearer token (you'll paste both into the Android app):
echo "API URL: $(aws lambda get-function-url-config \
  --function-name claude-portfolio-api --query FunctionUrl --output text)"
aws secretsmanager get-secret-value \
  --secret-id claude-portfolio/api-bearer-token \
  --query SecretString --output text
```

### 4. Firebase + FCM (manual web steps)

1. https://console.firebase.google.com → create project (or reuse one)
2. **Add app → Android**, package name `com.claudeportfolio.app`
3. Download `google-services.json` → drop into `android/app/`
4. **Project Settings → Service accounts → Generate new private key** →
   save the JSON somewhere safe (don't commit it)
5. Upload that key to Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name claude-portfolio/fcm-sa \
     --secret-string file:///path/to/your-key.json \
     --region us-east-1
   ```
6. Redeploy: `bash infra/deploy.sh` (so `firebase-admin` is in the lambda zip)

### 5. Android app

1. Open `android/` in Android Studio → **Sync Now**
2. **Run ▶** with your phone connected (USB debugging on)
3. On first launch grant the **POST_NOTIFICATIONS** permission
4. Open **Settings → Connection**, paste:
   - Base URL: from step 3 output
   - Bearer token: from step 3 output
5. Tap **Connect** — status pill at the top flips to green "Live · paper acct"

To verify the full loop end-to-end:

```bash
bash infra/invoke-manual.sh --force  # ~4 min later your phone gets a push
```

---

## Components

### AlpacaSource (`sources/AlpacaSource.js`)

Pulls account state, open positions, and recent order history from Alpaca.
Uses the official `@alpacahq/alpaca-trade-api` SDK against the paper-trading
endpoint.

**Output shape:**
```
{
  asOf: ISO timestamp,
  account: { portfolioValue, cash, buyingPower, equity, lastEquity, dayPl, dayPlPct },
  positions: { count, totalCostBasis, totalMarketValue, totalUnrealizedPl, ..., holdings: [...] },
  recentOrders: { windowDays, count, orders: [...] }
}
```

**Notes / considerations:**
- Alpaca is the **source of truth** for trades and cash. The memo is *never*
  trusted for these facts — even if Claude misremembers, Alpaca corrects it.
- Fractional-share orders return `qty: 0` in the raw API (because they were
  placed by dollar amount, not share count). The normalizer falls back to
  `notional` so the field isn't misleadingly zero.
- Equity = cash + market value of positions. The numbers reconcile, which
  is how we know there's no hidden bucket of money missing from the snapshot.

### EarningsSource (`sources/EarningsSource.js`)

Pulls upcoming earnings dates for a configurable list of symbols from
Finnhub's free `/calendar/earnings` endpoint.

**Role:** purely a **guardrail**, not a signal. The briefing should let
Claude see when held or watched tickers are about to report, so it can avoid
initiating new positions into a binary event.

**Output shape:**
```
{
  windowDays, from, to,
  events: [{ symbol, date, time, epsEstimate, revenueEstimate, quarter, year }]
}
```

**Notes / considerations:**
- Symbol-agnostic by design — accepts any list. In the assembler this will
  be `(held positions) ∪ (watchlist from S3 memo)`.
- `time` field translates Finnhub's `bmo`/`amc`/`dmh` codes into
  `before_open`/`after_close`/`during_hours`.
- Missing estimates pass through as `null`, never zero or "TBD". Claude
  reads `null` as "unknown" cleanly; placeholders would mislead it.
- Finnhub free tier: 60 calls/min, more than enough for a weekly cron with
  ~10 symbols.

### CongressionalSource (`sources/CongressionalSource.js`)

Pulls recently disclosed congressional stock trades from the trade-parser
API (`https://trade-parser-production.up.railway.app`). Requires an API key
sent as the `X-API-Key` header (env: `TRADE_PARSER_API_KEY`).

> Previously this scraped Capitol Trades' embedded Next.js RSC payload. That
> broke when the page structure changed, so it now consumes a dedicated API
> (a separate project) that parses the same disclosures and serves clean JSON.

**Role:** the actual **signal source** for this project. The pattern of
who is trading what, when, and at what size is the closest thing to a real
edge in this whole pipeline.

**Output shape:**
```
{
  windowDays, minSizeRank, fetchedAt, count,
  trades: [{ ticker, txType, txDate, filedDate, owner,
             sizeLabel, sizeExact, sizeRank, price,
             politician, party, chamber, state }]
}
```

**Notes / considerations:**
- **Lookback is on `filedDate`, not `txDate`.** Under the STOCK Act, members
  have up to 45 days to disclose. A 7-day filter on transaction date misses
  almost everything. Filing date answers the right question: "what trades
  have become public since the last weekly run?" The API's `since` param
  filters on the *traded* date, so we don't use it — instead we page through
  `sort=published&dir=desc` and stop once we cross the filing-date cutoff.
- **Size is a bucket, not an exact value.** The API reports trade size as a
  ranked bucket (`sizeRank` 1 = $1K–15K, 2 = $15K–50K, …) rather than a
  dollar figure. Default `minSizeRank = 2` reproduces the old `$15k` floor
  by excluding the smallest bucket — roughly the STOCK Act reporting floor,
  below which members aren't required to disclose anyway.
- **Politician join.** Trades carry only a `politicianId` (e.g. `S-peters`).
  We fetch `/v1/politicians` once per run and index by id to resolve the
  name, party, and chamber.
- **Pagination.** We walk pages of 96 newest-filed-first until the cutoff,
  capped at `MAX_PAGES` as a safety stop. A 7-day filing window is a small
  slice of the full history, so this terminates quickly.
- **Duplicate trades are real, not bugs.** When a member sells the same
  stock several times in one day, each transaction is disclosed separately.
  We pass them through faithfully — Claude can decide how to weight them.

### MemoSource (`sources/MemoSource.js`)

Reads the persistent memo that Claude maintains across runs. The memo is
Claude's working memory: open theses, closed theses, a watchlist, and
free-form observations.

**Output shape:**
```
{
  source: backend description,
  firstRun: boolean,
  memo: {
    lastUpdated, openTheses, closedTheses, watchlist, generalObservations
  }
}
```

**Notes / considerations:**
- **Pluggable backend.** The reader doesn't know about S3 or local files —
  it takes a `backend` object exposing `read()`, `write()`, and
  `describe()`. Both `LocalFileBackend` and `S3Backend` implement that
  contract, so swapping environments doesn't change `MemoSource` itself.
  The runners pick a backend via `memoBackendFromEnv()` (S3 when
  `MEMO_S3_BUCKET` is set, local otherwise).
- **First-run handling.** When the memo file doesn't exist, `read()`
  returns `null` and the source returns an empty-default memo with
  `firstRun: true`. The Analyst can use that flag to skip "what happened
  since last week" reasoning on the very first execution.
- **Schema is structured, not free-form prose.** Free-form narrative drifts
  and gradually becomes a wall of text that's hard to audit. Sections like
  `openTheses` / `closedTheses` / `watchlist` keep state inspectable and
  let the memo updater prompt operate cleanly on each section.
- **Graceful degradation on bad JSON.** Throws a clear error rather than
  silently returning the empty default — a corrupted memo should fail
  loudly so we notice.
- **`memo.json` is gitignored.** It contains Claude's evolving research
  notes and isn't meant to be source-controlled. In production this lives
  in S3.
- **The watchlist lives in the memo, not in any config file.** This is
  deliberate: per the project's core principle, the human controls the
  inputs but never the decisions. If Claude wants to track AMD, that's its
  call, recorded in its own memory.

### BriefingAssembler (`briefing/BriefingAssembler.js`)

Orchestrates all four sources into the single JSON briefing handed to
Claude. This is where the "humans control the inputs" principle is
materialized: every fact Claude sees flows through here in a stable shape
every week.

**Output shape:**
```
{
  generatedAt, completedAt,
  portfolio:     { ...alpaca },
  memo:          { ...memo },
  congressional: { ...congressional },
  earnings:      { ...earnings },
  symbolsCovered: [...],
  errors: []
}
```

**Notes / considerations:**
- **Two-phase execution.** Phase 1 fetches Alpaca, memo, and congressional
  in parallel. Phase 2 fetches earnings, which depends on the symbol list
  derived from phase 1. Total runtime is dominated by the slowest phase 1
  source (typically the trade-parser API at ~400ms).
- **Tiered failure handling.** Alpaca is critical — if we don't know the
  portfolio we can't decide anything, so failures abort the whole run.
  All other sources are soft: failures are caught, logged in `errors[]`,
  and the corresponding field becomes `null`. Claude can read `errors[]`
  and weight its decisions accordingly. The briefing always completes if
  Alpaca succeeds.
- **Symbol resolution for earnings.** The set of tickers we ask about is
  `(held positions) ∪ (memo watchlist) ∪ (congressional tickers from the
  past week)`. Including congressional tickers means Claude gets earnings
  context for any ticker it might evaluate this week, not just ones it
  already owns or watches.
- **Briefing size.** Currently ~17k characters / ~4k tokens with 6
  positions, 11 congressional trades, 3 watchlist symbols, and a populated
  memo. Comfortably under any context limit. If this grows past ~20k
  tokens we'd want to start trimming low-value fields rather than expand
  blindly.
- **EarningsSource's `symbols` argument moved from constructor to fetch().**
  Stable config (apiKey, windowDays) lives on the instance; data only
  known at assembly time (the symbol list) is passed at call time. This
  keeps the source reusable across runs without mutation.

### Analyst (`analyst/Analyst.js`)

Calls the Anthropic API with the assembled briefing and returns Claude's
trade recommendations. This is the brain of the pipeline.

**Output shape:**
```
{
  recommendations: {
    asOf, summary,
    recommendations: [{ action, ticker, amount, rationale, confidence, linkedThesis }],
    noActionsReason
  },
  meta: { model, stopReason, webSearchesUsed, usage: {...} }
}
```

**Configuration choices and why:**

| Choice | Value | Rationale |
|---|---|---|
| Model | `claude-opus-4-8` | Most capable model for agentic / long-horizon work |
| Thinking | `{type: "adaptive"}` | Required on Opus 4.8 — `budget_tokens` is removed and would 400 |
| Effort | `xhigh` | Recommended setting on 4.8 for coding/agentic workloads |
| Max tokens | 32,000 | Comfortable headroom for thinking + multi-search reasoning + final output |
| Web search | `web_search_20260209`, `max_uses: 15` | Caps catastrophic loops while leaving room for genuine research |
| Streaming | Yes (`stream()` + `finalMessage()`) | Required since `max_tokens > 16k` would risk SDK HTTP timeouts |
| Prompt cache | System prompt as ephemeral text block | System prompt is stable across runs, so weekly runs only pay full price for the user prompt + tool definitions |

**Notes / considerations:**

- **System / user prompt split.** The stable identity, hard rules, process,
  and output schema all live in the system prompt — that's what gets
  cached. The volatile per-run briefing JSON is the user prompt. This
  isn't just convention: the Anthropic prompt cache is a strict prefix
  match, so anything stable in the system prompt costs ~0.1× on read
  versus full price on a cache miss.
- **Why no `output_config.format` (yet).** Anthropic's structured-outputs
  feature is documented as incompatible with citations, and the web
  search tool produces citations by default. Rather than ship a config
  that might 400 in production, we instruct strict JSON in the system
  prompt and parse the last text block of the response. If we ever see
  a malformed JSON response in practice, we can revisit. In Claude we
  trust, but verify.
- **Why parse the LAST text block.** When web search runs, the response
  contains interleaved text, `server_tool_use`, and
  `web_search_tool_result` blocks. Mid-conversation text is reasoning
  between searches, not the final answer. The model's final JSON output
  is always the last text block — `parseResponse.js` walks from the end.
- **Markdown fence fallback.** Even with explicit instructions not to
  wrap output in markdown, models occasionally do. The parser strips
  ```` ```json ... ``` ```` fences before parsing as a defensive measure.
- **Token budgets per run.** Empty briefing + cached system prompt is
  ~5k input tokens. With a fully populated briefing and 15 web searches
  pulling in news content, expect 50k–200k input tokens and 5k–30k
  output tokens per run. At Opus 4.8 list pricing (~$5/M input, $25/M
  output), that's roughly $0.50–$2.00 per weekly run — well below the
  ~$10/year estimate from prior planning, but worth tracking once we
  have real telemetry.
- **The hard structural rules in the system prompt are guardrails, not
  guidance.** The four rules (US equities only, 30% position cap, no new
  positions inside the earnings window, no penny stocks) prevent
  catastrophic outcomes without telling Claude *what* to buy. Adding
  rules about *what* to recommend would violate the project's autonomy
  principle.

### S3Backend (`sources/backends/S3Backend.js`)

Production backend for `MemoSource`. Implements the same `{ read(),
write(), describe() }` contract as `LocalFileBackend`, so swapping is
seamless.

**Setup (already done):**
- Bucket: `claude-portfolio-${AWS_ACCOUNT_ID}` in `us-east-1`
- Public access fully blocked (all four ACL/policy flags set)
- No versioning yet (intentional — adds complexity without immediate
  value; revisit if we want memo history)

**Notes / considerations:**
- **Credentials come from the standard AWS SDK chain** (env vars, shared
  credentials file, IAM role). No keys live in code or `.env`. Locally,
  this resolves to your `aws configure` profile; on Lambda, it'll be the
  Lambda execution role.
- **`read()` returns null when the key doesn't exist.** Other errors
  (permission denied, network) propagate as-is — those should fail loudly
  so we notice misconfigurations.
- **`write()` always sets `ContentType: application/json`.** The only
  consumer today is the memo. If we ever store non-JSON, take a content
  type argument.
- **Round-trip verified** locally against the real bucket: write a string,
  read it back, contents match exactly.

### Backend factory (`sources/memoBackendFactory.js`)

Tiny helper that every memo-touching runner uses to pick a backend:

```
MEMO_S3_BUCKET set    → S3Backend (production)
otherwise             → LocalFileBackend (development)
```

Centralizing this means every runner — `run-memo`, `run-briefing`,
`run-analyst`, `run-memo-updater`, and the eventual Lambda handler — makes
the same decision the same way. Switching environments is a single env
var flip, not a code change.

### MemoUpdater (`analyst/MemoUpdater.js`)

The second Claude call in each weekly run. Takes the prior memo, this
week's briefing, and the analyst's recommendations, and produces the new
memo that gets written back to S3 (or the local file in development).

**Output shape:**
```
{
  memo: { lastUpdated, openTheses, closedTheses, watchlist, generalObservations },
  meta: { model, stopReason, usage: {...} }
}
```

**Notes / considerations:**

- **Why a second Claude call.** Mixing analysis ("what should I trade")
  and bookkeeping ("how should I update my notes") in one prompt produces
  muddled output — the model gets pulled between two different cognitive
  tasks. Splitting them keeps each prompt focused. The MemoUpdater's
  system prompt is explicit that it is NOT the analyst and does not
  generate or second-guess trade decisions.
- **No web search.** The MemoUpdater is a pure transformation over known
  inputs (prior memo + briefing + recommendations). No external research
  is needed, which makes the call faster and cheaper than the Analyst's.
- **Lower max_tokens (8k).** Memo output is bounded by the schema, not
  open-ended. We don't need 32k of headroom.
- **`effort: "high"`** rather than `xhigh`. Bookkeeping is not deep
  agentic reasoning — `high` is the better cost/quality balance for a
  schema-bounded transformation.
- **Output schema must match what `MemoSource` reads back.** If you
  change the memo schema in `memoUpdaterSystemPrompt.js`, also update
  `MemoSource._normalize()`. The contract is: MemoUpdater writes,
  MemoSource reads, both must agree on shape.
- **`closedTheses` is bounded to 10 entries** in the system prompt — the
  memo is memory, not an audit log. Trade history lives in Alpaca, the
  source of truth.
- **Shared parser.** Both Analyst and MemoUpdater use
  `parseResponse.js::extractJsonFromMessage` to pull JSON from the final
  text block of the Claude response. Same logic, different schemas.

### Executor (`executor/Executor.js`)

Takes the Analyst's recommendations object and submits the corresponding
orders to Alpaca, with safety rails. The component that actually places
trades — and therefore the one with the most defensive defaults.

**Output shape:**
```
{
  asOf, dryRun, runDate,
  summary: { total, executed, queued, skipped, failed, dryRun },
  results: [{ recommendation, sizing, status, orderId, reason }]
}
```

**Status values:**

| Status | When | Order placed? |
|---|---|---|
| `dry_run` | Mode is dry-run (default) | No |
| `executed` | Live mode + auto-execute confidence | Yes |
| `queued_for_review` | Confidence not in `autoExecute` set | No |
| `skipped` | Pre-flight check failed (no position, sub-minimum, etc.) | No |
| `failed` | Alpaca API rejected the submission | No (or partial) |

**Notes / considerations:**

- **Two independent switches — don't conflate them.** (1) `paper: false`
  in the pipeline + API lambdas selects the **live brokerage account** (real
  money) via the `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` secret; this is a code
  constant, not a runtime flag, because the system never trades a paper
  account in production. (2) `EXECUTOR_LIVE` / SSM `claude-portfolio-live`
  is the **dry-run vs. place-orders** rail: when false the executor logs the
  orders it would place without sending them. Dry-run is the safe default
  and the env-var requirement is intentional friction.
- **Confidence gates auto-execution.** By default only `confidence: high`
  recommendations are auto-submitted; `medium` and `low` come back with
  status `queued_for_review` so a human can decide. Configurable via
  the `autoExecute` constructor option.
- **Sells run before buys** so cash is freed before being deployed.
  Same pattern as the Pelosi-Mirror executor.
- **Idempotency via deterministic `client_order_id`.** Each order's ID
  is `cp-YYYYMMDD-TICKER-action`. If the cron fires twice or someone
  re-runs the script the same day, Alpaca rejects the duplicate rather
  than placing a second order.
- **Pre-flight validation.** The Executor checks: amount > 0, percent
  ≤ 100, sufficient position for sells, notional ≥ $1 (Alpaca minimum),
  portfolio equity > 0 for percent-of-portfolio sizing.
- **Trust boundary with the Analyst.** The four hard rules (US equities
  only, 30% position cap, no earnings-week buys, no penny stocks) live
  in the Analyst's system prompt and are NOT re-validated here.
  Re-validating would require fetching quotes and the earnings calendar
  again. The system prompt is the contract; if we ever observe a
  violation we add validation here.
- **`percent` semantics differ between buy and sell.** On a buy, percent
  is of total portfolio equity (deploy this much cash). On a sell,
  percent is of the current position's market value (trim by this much).
  This is more intuitive and prevents oversells. The Analyst's system
  prompt is updated to match.
- **Telemetry on every result** includes the original recommendation,
  resolved sizing, status, reason, and (if executed) Alpaca order ID.
  This is the audit trail.
- **The fixture (`fixtures/test-recommendations.json`) covers six cases**
  — full sell, partial sell, ticker-not-held, dollar buy, low-confidence
  buy, and below-minimum. Useful for sanity-checking changes to the
  sizing resolver or status logic without spending Claude tokens.

### Sizing resolver (`executor/sizingResolver.js`)

Pure function — no API calls, no side effects — that converts the
Analyst's `amount: { type, value }` into either `{ kind: "qty", value }`
or `{ kind: "notional", value }`. Lives in its own file so it can be
unit-tested in isolation. Returns `{ kind: "error", message }` for
sizing impossibilities (no position to sell, percent > 100, etc.) and
the Executor turns those into `skipped` results.

---

## Cross-cutting considerations (parked for later)

These don't belong to any one component but will need to be addressed
before deployment.

- **API key rotation** — the Alpaca, Finnhub, and trade-parser keys are
  currently in `.env`. For Lambda, move to AWS Secrets Manager. Never put
  them in environment variables on the Lambda itself.
- **Guardrails vs. guidance.** The "humans control inputs, Claude controls
  decisions" principle rules out telling Claude *what* to buy. It does not
  rule out telling Claude *what not to do* (e.g., don't put 80% of the
  account in one stock, don't trade options). Worth a deliberate
  conversation when we get to the system prompt.
- **Secrets hygiene.** Paper trading keys have been pasted in chat during
  development; rotate them before connecting this to anything that matters.
- **Observability.** When this runs unattended, we need logs we can read
  later to understand why Claude made each call. The briefing JSON is the
  audit trail; persist each week's briefing to S3 alongside the memo.

---

## Build status

### Pipeline
- [x] AlpacaSource — portfolio, cash, recent orders
- [x] EarningsSource — earnings calendar guardrail
- [x] CongressionalSource — trade-parser API
- [x] MemoSource — pluggable backend (local file + S3)
- [x] BriefingAssembler — orchestrates all sources into one JSON
- [x] Analyst — Anthropic API call, web search, JSON parsing
- [x] MemoUpdater — second Claude call, rewrites memo post-decision
- [x] S3Backend for MemoSource — round-trip verified
- [x] Executor — places orders on Alpaca; dry-run default, idempotent
- [x] Lambda packaging + deployment (`infra/setup.sh` + `infra/deploy.sh`)
- [x] EventBridge cron + Secrets Manager (no keys in env vars)
- [x] SSM flags (`active`, `live`) + `toggle.sh` switch
- [x] DynamoDB run archive + activity log (30-day TTL on both)
- [x] Live execution enabled — Mon + Thu @ 13:00 UTC, real paper trades

### HTTP API
- [x] All 13 endpoints (portfolio, memo, runs/*, briefing/latest, activity, flags/*, devices, run/force)
- [x] Bearer-token auth — token stored in Secrets Manager, constant-time compare
- [x] API Gateway HTTP API + Lambda (`api/` package)
- [x] Provisioned via `infra/setup-api.sh` + deployed via `infra/deploy-api.sh`

### Android app
- [x] Compose + Material 3, dark-only, custom AppBar + BottomNav
- [x] All five screens — Portfolio, Last run, Memo, History, Settings — plus Run detail
- [x] Mock data + real API toggle via DataStore-backed config
- [x] Loading skeletons (shimmer-animated `Line2` rectangles)
- [x] Pull-to-refresh on Portfolio, Last run, History
- [x] FCM push notifications with deep-link handling
- [x] Runtime POST_NOTIFICATIONS permission request
- [x] Pixel-faithful match to the handoff's "Quiet" artboard

### Out of scope (deliberate)
- ~~Hilt DI~~ — `staticCompositionLocalOf` is enough at this app size
- ~~Room offline cache~~ — refetch on tab change is fine for a weekly app
- ~~WorkManager periodic refresh~~ — FCM push covers it
- ~~Release APK signing~~ — debug build sideloads fine for personal use
- ~~Pelosi-Mirror integration~~ — separate project, separate codebase

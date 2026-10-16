# Claude-Portfolio

A bi-weekly automated trading system that runs on AWS Lambda, gathers
market data from several sources, asks Claude (via the Anthropic API) for
trade recommendations, executes them on an Alpaca brokerage account,
and reports results to an Android companion app via FCM push notification.

The core design principle is **"humans control the inputs, Claude controls
the decisions"** — we do not shape what Claude buys, only what data it sees.

It trades a single real-money Alpaca account. There is no paper account,
no account switching and no dry-run mode.

The system has four deployable units:

| Unit | What it is | Where it runs |
|---|---|---|
| **Pipeline** (`data-gatherers/`) | The trading bot itself: briefing → analysis → memo → executor | AWS Lambda `claude-portfolio-trader`, fired by EventBridge Mon + Thu @ 13:00 UTC |
| **HTTP API** (`api/`) | Read-only views over Alpaca + DynamoDB + S3 + SSM, plus a few writes | AWS Lambda `claude-portfolio-api` behind API Gateway HTTP API |
| **Android app** (`android/`) | Personal-use companion: portfolio, last run, memo, history, settings, push | Side-loaded Kotlin/Compose app on the user's phone |
| **Congressional export** (`congressional/`) | House + Senate disclosure ingest → the `congressional.json` snapshot the pipeline reads | GitHub Actions, `.github/workflows/congressional-export.yml` |

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
   Executor  ──►  Alpaca live account
                  (always real orders — no dry-run)
        │
        ▼
   ──┬──  DynamoDB  claude-portfolio-runs       (run record, 30d TTL)
     ├──  DynamoDB  claude-portfolio-activity   (event log, 30d TTL)
     ├──  S3        memo.json                   (overwritten each run)
     └──  FCM       run_complete · briefing_error · run_failed
                          │
                          ▼
                    Android app  ◄──  HTTP API Lambda
                                       /portfolio · /memo · /runs · /flags · ...
```

Two Lambdas: the pipeline (which also sends the FCM pushes) and the HTTP
API. The congressional snapshot is produced separately by a GitHub Actions
workflow the evening before each run.

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
| Congressional trades | S3 snapshot from `congressional/` (House + Senate disclosures) | Free signal source |
| News on held + watched tickers | Claude web search at runtime | Synthesis is the value-add |
| Macro / market commentary | Claude web search at runtime | Same |
| Deeper research on candidates | Claude web search at runtime | Same |
| Past reasoning + watchlist | S3 memo | Persistent state |

---

## Project layout

```
data-gatherers/                     ← Pipeline lambda code
├── alpacaClient.js                ← the one Alpaca client factory (live endpoint pinned)
├── sources/
│   ├── DataSource.js              ← abstract base class, fetch() contract
│   ├── AlpacaSource.js            ← portfolio + recent orders
│   ├── EarningsSource.js          ← upcoming earnings dates
│   ├── CongressionalSource.js     ← reads the congressional/ S3 snapshot
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
│   ├── claudeRequest.js           ← shared streaming request + refusal fallback
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
│   ├── runArchiver.js             ← writes one row per run to claude-portfolio-runs
│   ├── activityLogger.js          ← appends events to claude-portfolio-activity
│   └── fcmPublisher.js            ← lazy-loads firebase-admin, sends pushes
├── **/*.test.js                   ← node:test suites (`npm test`)
├── run-*.js                       ← npm-script harnesses for running one stage by hand
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
│   ├── flags.js                   ← GET/PUT /flags/active
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
│   ├── google-services.json        ← Firebase Android config (gitignored)
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/claudeportfolio/app/
│       │   ├── MainActivity.kt              ← edge-to-edge, FCM token registration,
│       │   │                                    notification permission, deep-link handler
│       │   ├── PortfolioApp.kt              ← Application — registers notification channel
│       │   ├── data/
│       │   │   ├── api/
│       │   │   │   ├── PortfolioApi.kt       ← suspend interface the screens call
│       │   │   │   ├── NotConnectedApi.kt    ← stand-in until a base URL + token are saved
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
│       │       ├── theme/                    ← Kiln tokens: Color, Type, Dimens, Theme
│       │       ├── components/               ← AppBar, BottomNav, Kiln, NavIcons, Skeleton
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

congressional/                      ← Python (uv) disclosure pipeline — see congressional/README.md
.github/workflows/
└── congressional-export.yml       ← runs the congressional pipeline, uploads the snapshot

README.md                           ← (this file)
```

Every data source extends `DataSource` and exposes a single `fetch()`
method returning a structured JSON snapshot. The `run-*.js` scripts are
thin harnesses; `BriefingAssembler` orchestrates the sources in production.

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
- Alpaca **live brokerage** account and its `AK…` keys: 
  [app.alpaca.markets](https://app.alpaca.markets). There is no paper
  fallback — every key this system accepts trades real money.
- Finnhub free key: [finnhub.io](https://finnhub.io)
- Anthropic API key: [console.anthropic.com](https://console.anthropic.com)

### 1. Pipeline (data-gatherers)

```bash
cd data-gatherers
npm install
cp .env.example .env  # fill in ALPACA_*, FINNHUB_API_KEY, ANTHROPIC_API_KEY

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

# setup-api.sh prints the API Gateway URL; reveal the bearer token with:
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
5. Tap **Connect** — status pill at the top flips to green "Live"

To verify the full loop end-to-end:

```bash
bash infra/invoke-manual.sh --force  # ~4 min later your phone gets a push
```

---

## Components

### AlpacaSource (`sources/AlpacaSource.js`)

Pulls account state, open positions, and recent order history from Alpaca.
Uses the official `@alpacahq/alpaca-trade-api` SDK against the live
endpoint. Every client is built by `data-gatherers/alpacaClient.js`, which
pins `baseUrl` to `https://api.alpaca.markets` so neither a missing `paper`
flag nor a stray `APCA_API_BASE_URL` can repoint it.

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

Reads recently disclosed congressional stock trades from
`congressional.json` in the project's S3 bucket. That snapshot is written by
the pipeline in [`congressional/`](congressional/README.md) — a scheduled
GitHub Actions workflow that ingests House and Senate trade disclosures into
a cached SQLite database and exports the last 14 days of filings plus the
member directory. No API key is involved.

**Role:** the actual **signal source** for this project. The pattern of
who is trading what, when, and at what size is the closest thing to a real
edge in this whole pipeline.

**Output shape:**
```
{
  windowDays, minSizeRank, snapshotAt, fetchedAt, count,
  trades: [{ ticker, txType, txDate, filedDate, owner,
             sizeLabel, sizeExact, sizeRank, price,
             politician, party, chamber, state }]
}
```

**Notes / considerations:**
- **Lookback is on `filedDate`, not `txDate`.** Under the STOCK Act, members
  have up to 45 days to disclose. A 7-day filter on transaction date misses
  almost everything. Filing date answers the right question: "what trades
  have become public since the last run?" The snapshot carries ~14 days of
  filings; the source keeps the last 7.
- **Size is a bucket, not an exact value.** Trade size is a ranked bucket
  (`sizeRank` 1 = $1K–15K, 2 = $15K–50K, …) rather than a dollar figure.
  Default `minSizeRank = 2` excludes the smallest bucket.
- **Politician join.** Trades carry only a `politicianId` (e.g. `S-peters`);
  the snapshot's member directory resolves name, party, chamber and state.
- **Staleness is an error.** A snapshot older than 8 days throws, which lands
  in `briefing.errors` and reaches the phone as a `briefing_error` push —
  usually the export workflow failing, or GitHub disabling its cron after 60
  idle days.
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
  source.
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
- **EarningsSource takes `symbols` at `fetch()` time.** Stable config
  (apiKey, windowDays) lives on the instance; the symbol list is only
  known at assembly time, so it is passed per call.

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
| Model | `claude-opus-5-5` | Most capable model for agentic / long-horizon work; cheaper than Opus 5 ($4/$20 per MTok vs $5/$25) |
| Thinking | `{type: "adaptive"}` | Opus 5.5's default when omitted — `disabled` and `budget_tokens` both 400 at every effort level |
| Effort | `xhigh` | Must stay explicit: Opus 5.5 defaults to `medium`, a level below Opus 5's `high`, so omitting it silently shallows the reasoning |
| Max tokens | 64,000 | A ceiling, not a spend. ~20k observed output, so the headroom is free and stops a long run truncating mid-JSON |
| Web search | `web_search_20260209`, `max_uses: 15` | Deliberately not raised. Observed usage is 10–13 and exhausting the budget silently ends the research, but searches cost ~28s each and the binding constraint is the 900s Lambda timeout (an AWS hard ceiling). 20 searches projects to ~810s of a 900s window; more headroom needs the Analyst split into its own invocation |
| Streaming | Yes (`stream()` + `finalMessage()`) | Required since `max_tokens > 16k` would risk SDK HTTP timeouts |
| Refusal fallback | `fallbacks: [{model: "claude-opus-5"}]`, beta `server-side-fallback-2026-06-01` | If a safety classifier declines, the API re-runs the request on Opus 5 in the same call. Applies to the MemoUpdater too. If the whole chain declines, the run stops before the executor with a `RefusalError` — no orders. The serving model and a `fellBack` flag are archived in `analystMeta` (see `analyst/claudeRequest.js`) |
| Prompt cache | System prompt as ephemeral text block | System prompt is stable across runs, so weekly runs only pay full price for the user prompt + tool definitions |

**Notes / considerations:**

- **System / user prompt split.** The stable identity, hard rules, process,
  and output schema all live in the system prompt — that's what gets
  cached. The volatile per-run briefing JSON is the user prompt. This
  isn't just convention: the Anthropic prompt cache is a strict prefix
  match, so anything stable in the system prompt costs ~0.1× on read
  versus full price on a cache miss.
- **Why no `output_config.format`.** Structured outputs are documented as
  incompatible with citations, and the web search tool produces citations
  by default. The system prompt asks for strict JSON instead and the
  parser reads the last text block of the response.
- **Why parse the LAST text block.** When web search runs, the response
  contains interleaved text, `server_tool_use`, and
  `web_search_tool_result` blocks. Mid-conversation text is reasoning
  between searches, not the final answer. The model's final JSON output
  is always the last text block — `parseResponse.js` walks from the end.
- **Markdown fence fallback.** Even with explicit instructions not to
  wrap output in markdown, models occasionally do. The parser strips
  ```` ```json ... ``` ```` fences before parsing as a defensive measure.
- **Cost per run.** Measured over 9 runs (2026-09-17 → 2026-10-15) at
  Opus 5 prices: Analyst ~$0.46, MemoUpdater ~$0.35, web search ~$0.12
  (10–13 calls at $10/1k) — **~$0.93/run, ~$100/year**. Opus 5.5's lower
  prices take roughly 20% off the token share. On a ~$132 account this
  exceeds the returns, so the variable worth optimizing is decision
  quality, not cost.
- **The hard structural rules in the system prompt are guardrails, not
  guidance.** The four rules (US equities only, 30% position cap, no new
  positions inside the earnings window, no penny stocks) prevent
  catastrophic outcomes without telling Claude *what* to buy. Adding
  rules about *what* to recommend would violate the project's autonomy
  principle.

### S3Backend (`sources/backends/S3Backend.js`)

Production backend for `MemoSource`, also used by `CongressionalSource` to
read the snapshot. Implements the same `{ read(), write(), describe() }`
contract as `LocalFileBackend`.

**Bucket:**
- `claude-portfolio-${AWS_ACCOUNT_ID}` in `us-east-1`
- Public access fully blocked (all four ACL/policy flags set)
- No versioning — the memo is overwritten each run

**Notes / considerations:**
- **Credentials come from the standard AWS SDK chain** (env vars, shared
  credentials file, IAM role). No keys live in code or `.env`. Locally,
  this resolves to your `aws configure` profile; on Lambda, the execution
  role.
- **`read()` returns null when the key doesn't exist.** Other errors
  (permission denied, network) propagate as-is — those should fail loudly
  so we notice misconfigurations.
- **`write()` always sets `ContentType: application/json`.** Everything it
  stores is JSON.

### Backend factory (`sources/memoBackendFactory.js`)

Tiny helper that every memo-touching runner uses to pick a backend:

```
MEMO_S3_BUCKET set    → S3Backend (production)
otherwise             → LocalFileBackend (development)
```

Centralizing this means every runner — `run-memo`, `run-briefing`,
`run-analyst`, and the Lambda handler — makes the same decision the same
way. Switching environments is a single env
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
- **Lower max_tokens (32k) than the Analyst's 64k.** Memo output is
  bounded by the schema, not open-ended; it runs 9–13k, so 32k is
  headroom rather than spend.
- **`effort: "high"`** rather than `xhigh`. Bookkeeping is not deep
  agentic reasoning — `high` is the better cost/quality balance for a
  schema-bounded transformation. Keep it explicit; Opus 5.5 would
  otherwise default to `medium`.
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
  asOf, runDate,
  summary: { total, executed, skipped, failed, alreadySubmitted },
  results: [{ recommendation, sizing, status, orderId, reason }]
}
```

**Status values:**

| Status | When | Order placed? |
|---|---|---|
| `executed` | Submitted to Alpaca | Yes |
| `skipped` | Pre-flight check failed (no position, sub-minimum, etc.) | No |
| `failed` | Alpaca API rejected the submission | No (or partial) |

**Notes / considerations:**

- **There is exactly one switch, and it is not a dry-run.** The executor
  always submits real orders to the live brokerage account named by the
  `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY` secret. The only gate is SSM
  `claude-portfolio-active`, checked at the top of every invocation, plus
  the two EventBridge rules — `bash infra/toggle.sh off` sets all three.
  A deploy cannot arm or disarm trading.
- **Every recommendation is submitted, whatever its confidence.**
  Confidence is recorded with the result as Claude's stated conviction;
  the executor does not gate on it.
- **Sells run before buys** so cash is freed before being deployed. The
  executor waits for the sells to settle and refreshes the account before
  placing buys.
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
  prompt describes the same semantics.
- **Telemetry on every result** includes the original recommendation,
  resolved sizing, status, reason, and (if executed) Alpaca order ID.
  This is the audit trail.
- **Tests.** `Executor.test.js` and `sizingResolver.test.js` run against a
  fake Alpaca client, so the sizing and status logic can be changed without
  touching the brokerage or spending Claude tokens (`npm test`).

### Sizing resolver (`executor/sizingResolver.js`)

Pure function — no API calls, no side effects — that converts the
Analyst's `amount: { type, value }` into either `{ kind: "qty", value }`
or `{ kind: "notional", value }`. Lives in its own file so it can be
unit-tested in isolation. Returns `{ kind: "error", message }` for
sizing impossibilities (no position to sell, percent > 100, etc.) and
the Executor turns those into `skipped` results.

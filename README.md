# Claude-Portfolio

A weekly automated trading system that runs on AWS Lambda, gathers market data
from several sources, asks Claude (via the Anthropic API) for trade
recommendations, and executes them on an Alpaca paper trading account.

This is a **paper-trading research project**, run in parallel to the separate
Pelosi-Mirror system that handles real money. The core design principle is
**"humans control the inputs, Claude controls the decisions"** — we do not
shape what Claude buys, only what data it sees.

---

## Architecture

```
EventBridge (Sun evening cron)
        │
        ▼
   Data Gatherer ──► assembles structured JSON briefing
        │
        ▼
   Analyst (Claude API + web search) ──► trade recommendations JSON
        │                                + memo update
        ▼
   Executor ──► places orders on Alpaca
        │
        ▼
   S3: persistent memo (Claude's running theses & watchlist)
```

Components are split into separate Lambdas so there are natural
checkpoints between gathering, analysis, and execution.

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
| Congressional trades | Capitol Trades scrape | Free signal source |
| News on held + watched tickers | Claude web search at runtime | Synthesis is the value-add |
| Macro / market commentary | Claude web search at runtime | Same |
| Deeper research on candidates | Claude web search at runtime | Same |
| Past reasoning + watchlist | S3 memo | Persistent state |

---

## Project layout

```
data-gatherers/
├── sources/
│   ├── DataSource.js              ← abstract base class, fetch() contract
│   ├── AlpacaSource.js            ← portfolio + recent orders
│   ├── EarningsSource.js          ← upcoming earnings dates
│   ├── CongressionalSource.js     ← Capitol Trades scraper
│   ├── MemoSource.js              ← persistent memo reader
│   ├── memoBackendFactory.js      ← picks S3 or local based on env
│   ├── backends/
│   │   ├── LocalFileBackend.js    ← memo backend for development
│   │   └── S3Backend.js           ← memo backend for production
│   └── utils/
│       └── rscScanner.js          ← Next.js RSC payload parser
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
├── fixtures/
│   └── test-recommendations.json  ← edge-case fixture for executor tests
├── run-alpaca.js                  ← npm run alpaca
├── run-earnings.js                ← npm run earnings
├── run-congressional.js           ← npm run congressional
├── run-memo.js                    ← npm run memo
├── run-briefing.js                ← npm run briefing
├── run-analyst.js                 ← npm run analyst
├── run-memo-updater.js            ← npm run memo-updater (full pipeline)
├── run-executor.js                ← npm run executor (dry-run by default)
├── .env / .env.example
└── package.json
```

Every data source extends `DataSource` and exposes a single `fetch()`
method returning a structured JSON snapshot. The runners are thin test
harnesses; the briefing assembler (not yet built) will instantiate all
the sources and `Promise.all()` their fetches together.

---

## Setup

1. `cd data-gatherers && npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` — paper trading keys from
     [app.alpaca.markets](https://app.alpaca.markets)
   - `FINNHUB_API_KEY` — free tier key from [finnhub.io](https://finnhub.io)
3. Test each source: `npm run alpaca`, `npm run earnings`,
   `npm run congressional`

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

Pulls recently disclosed congressional stock trades from Capitol Trades
(no public API — we scrape the embedded RSC payload from the page HTML).

**Role:** the actual **signal source** for this project. The pattern of
who is trading what, when, and at what size is the closest thing to a real
edge in this whole pipeline.

**Output shape:**
```
{
  windowDays, minValue, fetchedAt, count,
  trades: [{ ticker, txType, value, txDate, filedDate, politician, party, chamber }]
}
```

**Notes / considerations:**
- **Lookback is on `filedDate`, not `txDate`.** Under the STOCK Act, members
  have up to 45 days to disclose. A 7-day filter on transaction date misses
  almost everything. Filing date answers the right question: "what trades
  have become public since the last weekly run?"
- Default `minValue = $15k` matches the STOCK Act reporting floor. Below
  that, members aren't required to disclose at all, so anything below is
  noise we'd rather not have.
- **Page cap of 96 trades.** Capitol Trades' first page returns ~96 rows.
  In a quiet week that's plenty; in a busy disclosure week we could miss
  older filings. Heuristic for detecting cap: if the oldest filing in the
  response is younger than the lookback window, we're truncated and should
  paginate. Not implemented yet — flag.
- **AWS Lambda IP blocking.** Capitol Trades sometimes returns 403 from AWS
  IP ranges (the Pelosi-Mirror project hit this). When we deploy, options
  are: residential proxy, GitHub Actions runner, or moving the scrape to a
  small EC2 instance. Will revisit at deploy time.
- **Duplicate trades are real, not bugs.** When a member sells the same
  stock several times in one day, each transaction is disclosed separately.
  We pass them through faithfully — Claude can decide how to weight them.
- The parser exploits Capitol Trades' Next.js App Router serialization:
  trade JSON is embedded inside `__next_f.push([N, "..."])` script tags,
  double-encoded (JSON inside JSON-string). The `rscScanner.js` utility
  walks brace depth manually because `JSON.parse` can't operate at offsets.

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
  source (typically Capitol Trades at ~400ms).
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
| Model | `claude-opus-4-7` | Best-in-class for agentic / long-horizon work |
| Thinking | `{type: "adaptive"}` | Required on Opus 4.7 — `budget_tokens` is removed and would 400 |
| Effort | `xhigh` | Recommended setting on 4.7 for coding/agentic workloads |
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
  output tokens per run. At Opus 4.7 list pricing (~$5/M input, $25/M
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
- Bucket: `claude-portfolio-369382711663` in `us-east-1`
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

- **Dry run is the default. Live trading requires explicit opt-in via
  `EXECUTOR_LIVE=true` in the environment.** No CLI flag — the env-var
  requirement is intentional friction. Even live, all orders go to the
  paper account configured by `ALPACA_KEY_ID`/`ALPACA_SECRET_KEY`.
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

- **Lambda IP blocking** — see CongressionalSource notes.
- **API key rotation** — the Alpaca and Finnhub keys are currently in
  `.env`. For Lambda, move to AWS Secrets Manager. Never put them in
  environment variables on the Lambda itself.
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

- [x] AlpacaSource — portfolio, cash, recent orders
- [x] EarningsSource — earnings calendar guardrail
- [x] CongressionalSource — Capitol Trades scrape
- [x] MemoSource — pluggable backend, local file shipped, S3 deferred
- [x] BriefingAssembler — orchestrates all sources into one JSON
- [x] Analyst — Anthropic API call, web search, JSON parsing
- [x] MemoUpdater — second Claude call, rewrites memo post-decision
- [x] S3Backend for MemoSource — bucket created and round-trip verified
- [x] Memo write-back — `run-memo-updater` writes new memo through the
      same backend `MemoSource` reads
- [x] Executor — places orders on Alpaca; dry-run default, idempotent
      via deterministic client_order_id, confidence-gated auto-execution
- [ ] Live execution test — one tiny real order to verify the path
      end-to-end on the paper account
- [ ] Queue-for-review surface — where `queued_for_review` results live
      between weekly runs (S3 + email-driven approval, similar to the
      Pelosi-Mirror approval-link pattern)
- [ ] Lambda packaging + deployment
- [ ] EventBridge cron + Secrets Manager (move keys out of `.env`)

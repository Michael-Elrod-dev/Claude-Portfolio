# congressional/

The congressional-trades data pipeline for the trading bot. It ingests U.S.
House and Senate trade disclosures (STOCK Act periodic transaction reports)
into a SQLite database and exports a JSON snapshot that the bot's
`data-gatherers/sources/CongressionalSource.js` reads from S3.

Python, managed with [uv](https://docs.astral.sh/uv/). It is the only Python
in this repository.

## How it runs

`.github/workflows/congressional-export.yml`, twice a week, the evening
before each bot run:

1. **Restore** the SQLite DB from the Actions cache (cold start: pull
   `congressional-seed.db` from S3 instead).
2. **`congressional poll`** — one cycle: HEAD the House disclosure ZIP and
   search the Senate e-filing site; ingest new filings and parse their PTRs.
   Scanned/paper filings are OCR'd with Claude vision on warm production runs
   only; otherwise they're flagged for a later drain.
3. **OCR drain** (warm production runs) — retry flagged scanned filings, then
   rebuild the read model.
4. **`congressional export`** — write `congressional.json`: every trade whose
   filing was published in the last 14 days, plus the member directory.
5. **Upload** the snapshot, **refresh the seed** from the warm DB, and save
   the DB back to the cache.

Data sources, all public and keyless: the House Clerk's disclosure ZIP and
PTR PDFs, the Senate eFD search, and the
[congress-legislators](https://github.com/unitedstates/congress-legislators)
dataset (party, state, committees, portraits).

## Layout

```
src/congressional/
  cli.py             house/senate ingest + parse-ptrs, poll, rebuild-read-model, export
  poller.py          one poll cycle (House ZIP fingerprint + Senate search)
  house/, senate/    source clients and parsers
  ocr.py             Claude vision OCR for image-only PTRs
  db.py              SQLAlchemy models + engine
  enrich_filers.py   filer -> member resolution (canonical id, party, state, committees)
  legislators.py     congress-legislators dataset loader
  read_model.py      politician_stats aggregates
  trades.py          the trade-list query + row shaping
  politicians.py     the member list
  schema.py          snapshot row models (camelCase wire aliases)
  export.py          the snapshot writer
tests/               parser, ingest and exporter tests
```

## Local use

```bash
cd congressional
uv sync --extra dev --python 3.12
uv run pytest
DATABASE_URL=sqlite:///data/congressional.db uv run congressional poll
DATABASE_URL=sqlite:///data/congressional.db uv run congressional export --out congressional.json
```

Start from a copy of the S3 seed rather than an empty DB (see the next
section). OCR is on whenever `ANTHROPIC_API_KEY` is set — including from a
`.env` that `load_dotenv()` finds by walking up from `cli.py` — so leave it
unset locally unless you mean to spend money on it.

## Things that bite

- **Never bootstrap from an empty DB with `poll`.** A filing's *published*
  date is when the poller first saw it (`first_seen_at`). Polling an empty or
  stale DB stamps everything it discovers as first-seen-now, which floods the
  bot's filed-this-week window — a cold start from the July 2026 seed put
  2,069 trades in a 14-day window that should hold ~770. The workflow
  refreshes the seed after every production run for exactly this reason.
- **`price` is always null.** It comes from a `daily_closes` table that was
  filled by market-data jobs which never ran in this pipeline. The bot
  tolerates it; populating it would be a new feature, not a fix.
- **The field names are a contract.** `schema.py`'s aliases (`politicianId`,
  `assetTicker`, `lastTraded`, ...) are what `CongressionalSource.js`
  normalizes. `tests/test_export.py` pins the exact key lists.
- **GitHub disables cron workflows in public repos after 60 days without
  activity.** The bot flags a snapshot older than 8 days as a source error
  (a `briefing_error` push); re-enable the workflow from the Actions tab.
- **The Anthropic key is a copy.** OCR uses the `ANTHROPIC_API_KEY` repo
  secret, a copy of the bot's key from Secrets Manager. Rotate both together.

## History

This was Trade-Parser, a separate project that also ran a public website and
API. When the site was retired in
July 2026, the bot became its only consumer, and in October 2026 the ingest
pipeline moved here. Everything that served the website was removed: the
FastAPI app, auth, billing, alerts, the AI brief, market data, the Next.js
frontend, and the website-only tables — about 41,000 of 45,000 lines.

The exporter used to boot the whole web API in-process and page its
endpoints. It now calls the same query and row-shaping code directly, and was
proven **byte-for-byte identical** to the original before the switch: matching
sha256 on seven windows across two databases (the July seed and a freshly
ingested copy), with the old and new pollers producing identical tables from
the same sources apart from run timestamps.

# congressional/

The congressional-trades data pipeline for the trading bot. It ingests U.S.
House and Senate trade disclosures (STOCK Act periodic transaction reports)
into a SQLite database and exports a JSON snapshot that the bot's
`data-gatherers/sources/CongressionalSource.js` reads.

Python, managed with [uv](https://docs.astral.sh/uv/). It is the only Python
in this repository.

## How it runs

On the laptop, `claude-portfolio-congressional.timer` fires Sunday and
Wednesday at 20:00 America/New_York, the evening before each bot run, and
`/usr/local/bin/claude-portfolio-congressional` runs one cycle against the
database in `/srv/claude-portfolio/congressional/`:

1. **`congressional poll`** — HEAD the House disclosure ZIP and search the
   Senate e-filing site; ingest new filings and parse their PTRs. Scanned and
   paper filings are read with Claude vision OCR.
2. **OCR drain** — retry any scanned filing that is still flagged, then
   rebuild the read model.
3. **`congressional export`** — write `/srv/claude-portfolio/congressional.json`:
   every trade whose filing was published in the last 14 days, plus the member
   directory. The file is renamed into place, so the bot never reads half of it.

The database lives on the laptop's disk and goes into the nightly S3 backup
with the rest of the bot's data.

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

Start from a copy of the laptop's database (it is in the nightly backup)
rather than an empty DB (see the next section). OCR is on whenever
`ANTHROPIC_API_KEY` is set — including from a
`.env` that `load_dotenv()` finds by walking up from `cli.py` — so leave it
unset locally unless you mean to spend money on it.

## Things that bite

- **Never bootstrap from an empty DB with `poll`.** A filing's *published*
  date is when the poller first saw it (`first_seen_at`). Polling an empty or
  stale DB stamps everything it discovers as first-seen-now, which floods the
  bot's filed-this-week window — a cold start from the July 2026 seed put
  2,069 trades in a 14-day window that should hold ~770. The laptop's
  database is the only warm copy; restore it from the backup rather than
  starting over.
- **`price` is always null.** It comes from a `daily_closes` table that was
  filled by market-data jobs which never ran in this pipeline. The bot
  tolerates it; populating it would be a new feature, not a fix.
- **The field names are a contract.** `schema.py`'s aliases (`politicianId`,
  `assetTicker`, `lastTraded`, ...) are what `CongressionalSource.js`
  normalizes. `tests/test_export.py` pins the exact key lists.
- **A stale snapshot is an alarm, not a silent failure.** The bot flags a
  snapshot older than 8 days as a source error (a `briefing_error` push);
  check `sudo claude-portfolio logs congressional` on the laptop.

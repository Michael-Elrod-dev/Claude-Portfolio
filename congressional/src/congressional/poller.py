"""Polls House and Senate disclosure sources for new filings and ingests them.

Single-cycle only: the export workflow runs `poll --once` twice a week. The
hosted product's long-running loop, heartbeat, market-data refresh, alerts
and AI brief were removed along with the website they served.
"""

import json
import logging
import time
from datetime import date, timedelta
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

HOUSE_ZIP_URL = "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{year}FD.zip"

# The House check is a cheap HEAD request, so it can run every cycle. The
# Senate check runs a full search against efdsearch.senate.gov — cap it to
# once per this many seconds no matter how short the cycle interval is.
SENATE_MIN_SEARCH_INTERVAL = 300

class _PollState:
    """Persists poll metadata (ETags, watermarks) to a JSON file between restarts."""

    def __init__(self, path: Path):
        self._path = path
        self._data: dict = {}
        if path.exists():
            try:
                self._data = json.loads(path.read_text())
            except Exception:  # noqa: S110 — best-effort read of a local cache file
                pass

    def get(self, key: str, default=None):
        return self._data.get(key, default)

    def set(self, key: str, value) -> None:
        self._data[key] = value
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._data, indent=2))


def _house_zip_fingerprint(year: int) -> tuple[str | None, int | None, bool]:
    """HEAD request on the House annual ZIP. Returns (etag, content_length, available).

    `available` is False when the year's ZIP doesn't exist yet (404 — e.g. a new
    calendar year before its first filing) or the HEAD failed, so the caller can
    skip quietly instead of attempting a download that would error every cycle.
    """
    url = HOUSE_ZIP_URL.format(year=year)
    try:
        resp = httpx.head(url, follow_redirects=True, timeout=15.0)
        if resp.status_code == 404:
            # Year not published yet — normal at the start of a new year.
            return None, None, False
        resp.raise_for_status()
        etag = resp.headers.get("etag")
        raw_size = resp.headers.get("content-length")
        return etag, int(raw_size) if raw_size else None, True
    except Exception as e:
        logger.warning("House ZIP HEAD request failed for %d: %s", year, e)
        return None, None, False


def _check_house(year: int, data_dir: Path, state: _PollState) -> bool:
    """Ingest House if the ZIP has changed. Returns True if new data was written."""
    from congressional.house.ingest import ingest_year as house_ingest
    from congressional.house.ptr_ingest import parse_ptrs_for_year as house_parse

    etag, size, available = _house_zip_fingerprint(year)
    if not available:
        logger.debug("House %d: ZIP not available yet, skipping.", year)
        return False

    etag_key = f"house_{year}_etag"
    size_key = f"house_{year}_size"

    if etag is not None:
        changed = etag != state.get(etag_key)
    elif size is not None:
        changed = size != state.get(size_key)
    else:
        # Can't fingerprint the remote file — always attempt; ingest is idempotent
        changed = True

    if not changed:
        logger.debug("House %d: ZIP unchanged, skipping.", year)
        return False

    logger.info("House %d: ZIP changed, downloading and ingesting...", year)
    ingest = house_ingest(year, data_dir, force_download=True, stamp_first_seen=True)
    logger.info(
        "House %d: %d filings seen, %d inserted.",
        year,
        ingest.records_seen,
        ingest.records_inserted,
    )

    ptrs = house_parse(year, data_dir, skip_already_done=True)
    logger.info(
        "House %d: %d PTRs parsed, %d trades inserted.",
        year,
        ptrs.parsed,
        ptrs.trades_inserted,
    )

    # Persist the new fingerprint only after a successful ingest
    if etag is not None:
        state.set(etag_key, etag)
    if size is not None:
        state.set(size_key, size)

    return ingest.records_inserted > 0 or ptrs.trades_inserted > 0


def _check_senate(year: int, data_dir: Path, state: _PollState) -> bool:
    """Ingest any new Senate filings since the last poll. Returns True if new data was written."""
    from congressional.senate.ingest import ingest_year as senate_ingest
    from congressional.senate.ptr_ingest import parse_ptrs_for_year as senate_parse

    ts_key = f"senate_{year}_last_search_ts"
    elapsed = time.time() - (state.get(ts_key) or 0)
    if elapsed < SENATE_MIN_SEARCH_INTERVAL:
        logger.debug("Senate %d: searched %.0fs ago, skipping.", year, elapsed)
        return False

    date_key = f"senate_{year}_last_poll"
    last_poll_str = state.get(date_key)
    today = date.today()

    if last_poll_str:
        # 3-day look-back buffer catches any late-arriving or backdated filings
        date_from = date.fromisoformat(last_poll_str) - timedelta(days=3)
    else:
        date_from = None  # First run: fetch the full year

    ingest = senate_ingest(
        year, data_dir, date_from=date_from, date_to=today, stamp_first_seen=True
    )
    if ingest.records_inserted:
        logger.info("Senate %d: %d new filings inserted.", year, ingest.records_inserted)

    ptrs = senate_parse(year, data_dir, skip_already_done=True)
    if ptrs.trades_inserted:
        logger.info(
            "Senate %d: %d PTRs parsed, %d trades inserted.",
            year,
            ptrs.parsed,
            ptrs.trades_inserted,
        )

    # Always update the watermark so next cycle only looks at the recent window
    state.set(date_key, today.isoformat())
    state.set(ts_key, time.time())

    return ingest.records_inserted > 0 or ptrs.trades_inserted > 0


def years_to_poll(today: date) -> list[int]:
    """Which disclosure years to watch on a given day.

    Always the current year; plus the previous year through Q1 (Jan–Mar), to
    catch late-arriving and amended prior-year filings across the new-year
    boundary (members can file Dec transactions into Feb, later with an
    extension). After March the prior year goes quiet, so we drop it to save
    requests. A long-running poller calls this every cycle, so it rolls over to
    the new year automatically without a restart.
    """
    years = [today.year]
    if today.month <= 3:
        years.append(today.year - 1)
    return years


def poll_once(years: list[int], data_dir: Path, state: _PollState) -> tuple[bool, str | None]:
    """Run House + Senate checks for each year.

    Returns (found_new, error) — `error` is the last check failure this run (or
    None), so the heartbeat can distinguish a clean cycle from a degraded one.
    """
    found_new = False
    error: str | None = None
    for year in years:
        try:
            found_new |= _check_house(year, data_dir, state)
        except Exception as e:
            logger.exception("House poll failed for year %d", year)
            error = f"House {year}: {type(e).__name__}: {e}"
        try:
            found_new |= _check_senate(year, data_dir, state)
        except Exception as e:
            logger.exception("Senate poll failed for year %d", year)
            error = f"Senate {year}: {type(e).__name__}: {e}"
    return found_new, error

"""Export recently disclosed trades + politicians as one JSON snapshot.

This is the `congressional.json` the trading bot's CongressionalSource reads.
The laptop's claude-portfolio-congressional.service writes it twice a week,
after `poll` has ingested the latest House and Senate filings into SQLite.

It calls the query + row-shaping code directly (`trades.list_trades`,
`politicians.list_politicians`) and walks it page by page, newest-filed first;
tests/test_export.py pins the walk and the wire shape.

Output shape (consumed by data-gatherers/sources/CongressionalSource.js):
    {
      "exportedAt":  "2026-07-19T08:12:00Z",
      "windowDays":  14,
      "trades":      [<trade rows, newest-filed first>],
      "politicians": [<politician rows>]
    }

`trades` holds every row whose `published` (filing) date falls inside the
window; the bot applies its own tighter cutoff and size filters on top.
Field names are camelCase wire names (Trade / Politician in schema.py
serialize by alias), which the bot's normalization relies on.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from congressional.politicians import list_politicians
from congressional.trades import list_trades

# The page size is not a tuning knob: the walk below stops at page
# boundaries, so changing it
# would change which rows a degenerate snapshot contains.
PAGE_SIZE = 96
# Safety cap. A 14-day filing window is a tiny slice of the year; if the
# cutoff logic ever fails to terminate the walk, stop rather than export the
# entire dataset.
MAX_PAGES = 40

_MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}  # fmt: skip


def _published_to_date(published: object) -> date | None:
    """{"day": 3, "month": "Jul", "year": "2026"} → date(2026, 7, 3).

    Mirrors the bot's `_publishedToDate`, so the export window and the bot's
    filed-date filter agree on how a row's published label parses.
    """
    if not isinstance(published, dict):
        return None
    month = _MONTHS.get(published.get("month"))
    day, year = published.get("day"), published.get("year")
    if not (month and day and year):
        return None
    try:
        return date(int(year), month, int(day))
    except ValueError:
        return None


def collect(engine, window_days: int, now: datetime | None = None) -> dict:
    """Build the snapshot payload.

    `now` exists so tests (and the parity harness) can pin the clock; the
    workflow leaves it unset.
    """
    now = now or datetime.now(UTC)
    cutoff = now.date() - timedelta(days=window_days)
    trades: list[dict] = []

    # Newest-filed first; the first row older than the cutoff means every row
    # after it is older too, so the walk stops early.
    for page in range(MAX_PAGES):
        result = list_trades(
            engine,
            limit=PAGE_SIZE,
            offset=page * PAGE_SIZE,
            sort="published",
            direction="desc",
        )
        # by_alias + json mode = exactly the wire shape the hosted API served.
        batch = [t.model_dump(mode="json", by_alias=True) for t in result.data]
        if not batch:
            break

        crossed_cutoff = False
        for row in batch:
            published = _published_to_date(row.get("published"))
            if published is not None and published < cutoff:
                crossed_cutoff = True
                break
            # Rows with an unresolvable published label ride along; the bot's
            # own filed-date filter drops them.
            trades.append(row)

        if crossed_cutoff:
            break
        if page * PAGE_SIZE + len(batch) >= (result.total or 0):
            break

    politicians = [p.model_dump(mode="json", by_alias=True) for p in list_politicians(engine)]

    return {
        "exportedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "windowDays": window_days,
        "trades": trades,
        "politicians": politicians,
    }


def write_snapshot(
    engine, out: Path | str, window_days: int = 14, now: datetime | None = None
) -> tuple[int, int]:
    """Write the snapshot JSON (compact separators, as the bot has always read
    it) and return (trade count, politician count)."""
    payload = collect(engine, window_days, now=now)
    out = Path(out)
    # Written beside the target and renamed into place, so the bot never
    # reads half a file.
    tmp = out.with_name(out.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(tmp, out)
    return len(payload["trades"]), len(payload["politicians"])

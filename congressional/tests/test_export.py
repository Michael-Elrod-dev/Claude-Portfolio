"""The snapshot exporter: walk order, the window cutoff, the page cap, and the
wire shape the trading bot depends on.

Member resolution reaches the network (unitedstates.github.io), so the
politician list is stubbed in the walk tests and checked separately via the
model's serialization.
"""

import json
from datetime import UTC, date, datetime

import pytest
from sqlalchemy.orm import Session

from congressional import export
from congressional.db import Base, FilerEnrichment, Filing, Trade, make_engine
from congressional.schema import Politician

# The contract with data-gatherers/sources/CongressionalSource.js: these are the
# hosted API's camelCase wire names, in serialization order. Changing either
# list breaks the bot's normalization.
TRADE_KEYS = [
    "id", "politicianId", "issuerId", "assetName", "assetTicker", "assetClass",
    "published", "traded", "filedAfter", "owner", "type", "flagged",
    "sizeLabel", "sizeExact", "sizeRank", "price",
]  # fmt: skip
POLITICIAN_KEYS = [
    "id", "slug", "name", "party", "chamber", "state", "committee", "committees",
    "trades", "filings", "issuers", "volume", "gender", "lastTraded", "initials",
    "seed", "photoUrl",
]  # fmt: skip

NOW = datetime(2026, 10, 19, 13, 0, tzinfo=UTC)


@pytest.fixture
def engine(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    eng = make_engine(tmp_path / "congressional.db")
    Base.metadata.create_all(eng)
    monkeypatch.setattr(export, "list_politicians", lambda _engine: [])
    return eng


def _add_filing(session, doc_id, *, filed: date, first_seen: datetime | None = None, last="Doe"):
    session.add(Filing(
        doc_id=doc_id, chamber="H", first="Jane", last=last, state_district="CA12",
        filing_type="P", filing_year=filed.year, filing_date=filed, first_seen_at=first_seen,
    ))  # fmt: skip
    session.add(FilerEnrichment(
        chamber="H", state_district="CA12", last=last, politician_id=f"H-CA-{last.lower()}",
        canonical_id="D000001", party="D", gender="F", state="CA",
        fetched_at=datetime(2026, 10, 1),
    ))  # fmt: skip


def _add_trade(session, doc_id, *, traded: date | None, ticker="NVDA"):
    session.add(Trade(
        doc_id=doc_id, owner="SP", asset_name=f"{ticker} Inc.", asset_ticker=ticker,
        transaction_type="P", transaction_date=traded,
        amount_range_low=1001, amount_range_high=15000, amount_range_raw="$1,001 - $15,000",
    ))  # fmt: skip


def _published_dates(payload):
    return [export._published_to_date(t["published"]) for t in payload["trades"]]


def test_snapshot_envelope_and_wire_shape(engine):
    with Session(engine) as s:
        _add_filing(s, "d1", filed=date(2026, 10, 15))
        _add_trade(s, "d1", traded=date(2026, 10, 1))
        s.commit()

    payload = export.collect(engine, window_days=14, now=NOW)

    assert list(payload) == ["exportedAt", "windowDays", "trades", "politicians"]
    assert payload["exportedAt"] == "2026-10-19T13:00:00Z"
    assert payload["windowDays"] == 14
    (row,) = payload["trades"]
    assert list(row) == TRADE_KEYS
    assert row["politicianId"] == "D000001"  # canonical id from filer_enrichment
    assert row["issuerId"] == "NVDA"
    assert row["published"] == {"day": 15, "month": "Oct", "year": "2026", "time": None}
    assert row["traded"] == {"day": 1, "month": "Oct", "year": "2026"}
    assert row["filedAfter"] == 14
    assert row["type"] == "BUY" and row["owner"] == "Spouse"
    # No daily_closes rows -> no price. True of every row the live pipeline
    # exports today (the workflow never refreshes market data).
    assert row["price"] is None


def test_newest_filed_first_and_the_window_cutoff(engine):
    with Session(engine) as s:
        for doc, filed in (("old", date(2026, 9, 1)), ("mid", date(2026, 10, 10)), ("new", date(2026, 10, 18))):
            _add_filing(s, doc, filed=filed, last=doc.title())
            _add_trade(s, doc, traded=date(2026, 8, 30))
        s.commit()

    payload = export.collect(engine, window_days=14, now=NOW)

    # 2026-09-01 is before the 2026-10-05 cutoff, so the walk stops there.
    assert _published_dates(payload) == [date(2026, 10, 18), date(2026, 10, 10)]


def test_a_filing_on_the_cutoff_day_is_inside_the_window(engine):
    # cutoff = 2026-10-19 - 14d = 2026-10-05. Only rows strictly older are
    # dropped, so a filing on the cutoff day itself rides along, and the one
    # the day before is where the walk stops.
    with Session(engine) as s:
        for doc, filed in (("edge", date(2026, 10, 5)), ("before", date(2026, 10, 4))):
            _add_filing(s, doc, filed=filed, last=doc.title())
            _add_trade(s, doc, traded=date(2026, 9, 30))
        s.commit()

    assert _published_dates(export.collect(engine, window_days=14, now=NOW)) == [date(2026, 10, 5)]


def test_published_is_first_seen_when_the_poller_stamped_it(engine):
    # A filing discovered by `poll` carries first_seen_at; that, not the
    # filing date, is its published date — which is why a cold start from a
    # stale seed floods the window (everything looks first-seen-today).
    with Session(engine) as s:
        _add_filing(s, "seen", filed=date(2026, 8, 1), first_seen=datetime(2026, 10, 17, 9, 30))
        _add_trade(s, "seen", traded=date(2026, 7, 28))
        s.commit()

    (row,) = export.collect(engine, window_days=14, now=NOW)["trades"]
    assert row["published"] == {"day": 17, "month": "Oct", "year": "2026", "time": "2026-10-17T09:30:00Z"}


def test_trades_without_a_transaction_date_are_excluded(engine):
    with Session(engine) as s:
        _add_filing(s, "d1", filed=date(2026, 10, 15))
        _add_trade(s, "d1", traded=None)
        _add_trade(s, "d1", traded=date(2026, 10, 2), ticker="MSFT")
        s.commit()

    assert [t["assetTicker"] for t in export.collect(engine, 14, now=NOW)["trades"]] == ["MSFT"]


def test_walk_stops_at_the_page_cap(engine, monkeypatch):
    monkeypatch.setattr(export, "PAGE_SIZE", 2)
    monkeypatch.setattr(export, "MAX_PAGES", 3)
    with Session(engine) as s:
        _add_filing(s, "d1", filed=date(2026, 10, 15))
        for i in range(10):
            _add_trade(s, "d1", traded=date(2026, 10, 1), ticker=f"T{i}")
        s.commit()

    assert len(export.collect(engine, 14, now=NOW)["trades"]) == 6  # 3 pages x 2


def test_write_snapshot_is_compact_json(engine, tmp_path):
    with Session(engine) as s:
        _add_filing(s, "d1", filed=date(2026, 10, 15))
        _add_trade(s, "d1", traded=date(2026, 10, 1))
        s.commit()
    out = tmp_path / "congressional.json"

    assert export.write_snapshot(engine, out, window_days=14, now=NOW) == (1, 0)
    text = out.read_text(encoding="utf-8")
    assert ", " not in text and '": ' not in text  # separators=(",", ":")
    assert json.loads(text)["trades"][0]["id"].startswith("t-")


def test_politician_rows_use_the_wire_aliases():
    p = Politician(
        id="D000001", slug="jane-doe-D000001", name="Jane Doe", party="D", chamber="House",
        state="CA", committee="Finance", committees=["Finance"], trades=3, filings=1, issuers=2,
        volume=12000.0, gender="F", lastTraded="2026-10-01", initials="JD", seed=7,
        photoUrl="https://example.invalid/D000001.jpg",
    )  # fmt: skip
    dumped = p.model_dump(mode="json", by_alias=True)
    assert list(dumped) == POLITICIAN_KEYS
    assert dumped["lastTraded"] == "2026-10-01" and dumped["photoUrl"].endswith(".jpg")

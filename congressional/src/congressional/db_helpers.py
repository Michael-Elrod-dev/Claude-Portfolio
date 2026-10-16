"""Shared DB-access helpers for the trade and politician queries."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date

from sqlalchemy.engine import Connection, Engine

from congressional.enrich import _norm_last_name


@contextmanager
def db_connect(engine: Engine) -> Iterator[Connection]:
    with engine.connect() as conn:
        yield conn


# ---- ID schemes ------------------------------------------------------------


def politician_id_for(chamber: str, state_district: str | None, last: str) -> str:
    """Stable politician_id derived from (chamber, state, normalized last name)."""
    state = (state_district or "")[:2].upper()
    last_n = re.sub(r"\s+", "-", _norm_last_name(last))
    return f"{chamber}-{state}-{last_n}" if state else f"{chamber}-{last_n}"


def issuer_id_for(ticker: str) -> str:
    return ticker


# ---- Canonical politician identity -----------------------------------------
# A chamber-state-lastname id both over-merges (two different people) and
# under-merges (one member's name variants). The canonical identity is the member's
# bioguide id (official, unique, stable) when the filer resolves to a member; the
# unresolved tail (candidates, name-only matches — all zero-trade in our data) gets
# a stable dash-free hash so distinct people don't collide.


def canonical_politician_id(
    bioguide: str | None,
    chamber: str,
    state_district: str | None,
    last: str,
    first: str | None,
) -> str:
    """The canonical, collision-proof politician id: bioguide, else a stable hash.

    Both forms are **dash-free** so the URL slug `<name>-<id>` parses back with a
    single rsplit on '-' (see politician_slug / canonical_from_slug).
    """
    if bioguide:
        return bioguide
    state = (state_district or "")[:2].upper()
    raw = f"{chamber}|{state}|{_norm_last_name(last)}|{_norm_last_name(first or '')}"
    # Non-crypto identity hash (stable politician id baked into URLs — must NOT
    # change algorithm or existing ids break).
    return "u" + hashlib.sha1(raw.encode("utf-8"), usedforsecurity=False).hexdigest()[:10]


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "x"


def politician_slug(first: str | None, last: str | None, canonical_id: str) -> str:
    """Readable, unique URL/id: `<name-slug>-<canonical_id>` (e.g. john-boozman-B001236).

    The name part is cosmetic; only the trailing canonical_id is authoritative, so
    edited/stale name slugs still resolve (like Medium / Stack Overflow URLs).
    """
    name = f"{first or ''} {last or ''}".strip()
    return f"{_slugify(name)}-{canonical_id}"


# ---- Amount / size helpers -------------------------------------------------

SIZE_BUCKETS: list[tuple[int, int, str]] = [
    (0, 14_999, "1K–15K"),
    (15_000, 49_999, "15K–50K"),
    (50_000, 99_999, "50K–100K"),
    (100_000, 249_999, "100K–250K"),
    (250_000, 499_999, "250K–500K"),
    (500_000, 999_999, "500K–1M"),
    (1_000_000, 4_999_999, "1M–5M"),
    (5_000_000, 24_999_999, "5M–25M"),
    (25_000_000, 49_999_999, "25M–50M"),
    (50_000_000, 10**12, "50M+"),
]


def size_label_for(low: int | None) -> str:
    if low is None:
        return "—"
    for lo, hi, label in SIZE_BUCKETS:
        if lo <= low <= hi:
            return label
    return "—"


def size_rank_for(low: int | None) -> int:
    if low is None:
        return 1
    if low < 15_000:
        return 1
    if low < 50_000:
        return 2
    if low < 250_000:
        return 3
    if low < 1_000_000:
        return 4
    return 5


def amount_midpoint(low: int | None, high: int | None) -> float:
    if low is None:
        return 0.0
    if high is None:
        return float(low)
    return (low + high) / 2.0


# ---- Owner + transaction-type mapping -------------------------------------

# A blank owner column is NOT an affirmative "self" — House PTRs only mark
# the column for SP/DC/JT, so blank means unmarked. Report it honestly as
# "Undisclosed" (most trackers do the same). "SELF" is the explicit Self
# option on Senate filings (stored only for rows parsed after 2026-06-10 —
# see senate/html_parser.py).
_OWNER_MAP = {
    None: "Undisclosed",
    "": "Undisclosed",
    "SELF": "Self",
    "SP": "Spouse",
    "DC": "Child",
    "JT": "Joint",
}


def owner_label_for(raw: str | None) -> str:
    return _OWNER_MAP.get(raw, "Undisclosed")


def trade_kind_for(raw: str | None) -> str:
    if raw is None:
        return "SELL"
    if raw == "P":
        return "BUY"
    return "SELL"


# ---- Date helpers ----------------------------------------------------------

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def parse_date(s: str | date | None) -> date | None:
    if not s:
        return None
    # Postgres returns DATE columns as date objects; SQLite returns ISO strings.
    # Handle both (datetime is a subclass of date, so this covers it too).
    if isinstance(s, date):
        return s
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def days_between(later: date | None, earlier: date | None) -> int:
    if later is None or earlier is None:
        return 0
    return max(0, (later - earlier).days)


def initials_of(first: str, last: str) -> str:
    parts = (first.split() + last.split())[:2]
    return "".join(p[0] for p in parts if p)[:2].upper() or "?"


# ---- Query helper ----------------------------------------------------------



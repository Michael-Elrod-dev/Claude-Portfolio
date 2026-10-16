"""Member resolution via the unitedstates/congress-legislators dataset.

Our filings only carry (chamber, state_district, last, first) — no stable
member ID. This module resolves filers against the public-domain
congress-legislators dataset to get a Bioguide ID (→ official portrait URL),
party, state, and gender, replacing the hand-curated tables in enrich.py for
any member the dataset covers.

The two JSON files are cached under data/legislators/ and refreshed when older
than REFRESH_DAYS; if a download fails we fall back to whatever cache exists.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import httpx

from congressional.enrich import Party

logger = logging.getLogger(__name__)

_BASE_URL = "https://unitedstates.github.io/congress-legislators"
_FILES = ("legislators-current.json", "legislators-historical.json")
_DATA_DIR = Path("data/legislators")
REFRESH_DAYS = 30

# Only index members whose final term ended after this — our filings start in
# 2023, so the rest of the 12k-member historical file is dead weight.
_HISTORICAL_CUTOFF = "2022-01-01"

# NB: the old theunitedstates.io domain serves 410 Gone for images now — the
# images repo is only reachable via its github.io project page.
PHOTO_URL_TEMPLATE = "https://unitedstates.github.io/images/congress/225x275/{bioguide}.jpg"

_PARTY_MAP = {"Democrat": "D", "Republican": "R"}


@dataclass(frozen=True)
class Member:
    bioguide: str
    first: str
    last: str
    chamber: str  # 'H' or 'S'
    state: str
    district: int | None
    party: Party
    gender: str  # 'M' | 'F' | 'U'
    is_current: bool


def photo_url(bioguide: str) -> str:
    return PHOTO_URL_TEMPLATE.format(bioguide=bioguide)


_SUFFIX_TOKENS = {"jr", "sr", "ii", "iii", "iv", "v", "md", "dds", "phd", "facs", "esq"}


def _norm(name: str) -> str:
    """Lowercase, strip diacritics ('Barragán' → 'barragan'), punctuation, and
    generational/professional suffixes ('Hagerty, IV' → 'hagerty')."""
    decomposed = unicodedata.normalize("NFKD", name.lower())
    cleaned = "".join(
        ch for ch in decomposed if not unicodedata.combining(ch) and (ch.isalpha() or ch == " ")
    )
    tokens = [t for t in cleaned.split() if t not in _SUFFIX_TOKENS]
    return " ".join(tokens)


def _fetch_file(name: str, dest: Path) -> None:
    resp = httpx.get(f"{_BASE_URL}/{name}", follow_redirects=True, timeout=30.0)
    resp.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(resp.text, encoding="utf-8")


def _load_file(name: str) -> list[dict]:
    path = _DATA_DIR / name
    stale = not path.exists() or (time.time() - path.stat().st_mtime) > REFRESH_DAYS * 86400
    if stale:
        try:
            _fetch_file(name, path)
        except Exception as e:
            logger.warning("Could not refresh %s (%s) — using cache if present.", name, e)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("Could not parse %s: %s", name, e)
        return []


def _members_from_record(rec: dict, is_current: bool) -> list[Member]:
    """One Member per chamber the legislator recently served in.

    A rep who became a senator (e.g. John Curtis, UT) files in our data under
    both chambers, so they need an index entry for each — keyed to the latest
    term of that type.
    """
    terms = rec.get("terms") or []
    if not terms:
        return []

    last_term = terms[-1]
    raw_party = last_term.get("party") or ""
    # Independents caucus with a major party — use that for the D/R color.
    party: Party = _PARTY_MAP.get(last_term.get("caucus") or raw_party, "U")  # type: ignore[assignment]

    latest_by_type: dict[str, dict] = {}
    for term in terms:
        latest_by_type[term.get("type") or ""] = term

    out = []
    for term_type, term in latest_by_type.items():
        if term_type not in ("rep", "sen"):
            continue
        if (term.get("end") or "") < _HISTORICAL_CUTOFF:
            continue
        district = term.get("district")
        out.append(
            Member(
                bioguide=rec.get("id", {}).get("bioguide", ""),
                first=rec.get("name", {}).get("first", ""),
                last=rec.get("name", {}).get("last", ""),
                chamber="H" if term_type == "rep" else "S",
                state=term.get("state") or "",
                district=int(district) if district is not None else None,
                party=party,
                gender=rec.get("bio", {}).get("gender") or "U",
                is_current=is_current,
            )
        )
    return out


_index: dict[tuple[str, str], list[Member]] | None = None
_index_lock = threading.Lock()


def _build_index() -> dict[tuple[str, str], list[Member]]:
    index: dict[tuple[str, str], list[Member]] = {}
    seen: set[tuple[str, str]] = set()
    for name, is_current in ((_FILES[0], True), (_FILES[1], False)):
        for rec in _load_file(name):
            for m in _members_from_record(rec, is_current):
                if not m.bioguide or (m.bioguide, m.chamber) in seen:
                    continue
                seen.add((m.bioguide, m.chamber))
                last = _norm(m.last)
                # Index the full surname and its final token — filings split
                # multi-word names differently ("Paulina Luna" vs "Luna",
                # "Delaney" vs "McClain Delaney").
                keys = {last, last.split()[-1] if last else last}
                for key in keys:
                    if key:
                        index.setdefault((m.chamber, key), []).append(m)
    logger.info("Legislator index built: %d (chamber, last-name) keys.", len(index))
    return index


def _get_index() -> dict[tuple[str, str], list[Member]]:
    global _index
    if _index is None:
        with _index_lock:
            if _index is None:
                _index = _build_index()
    return _index


# ---- Committees ------------------------------------------------------------

# "House Committee on Agriculture" → "Agriculture"; falls back to full name
# for shapes like "Joint Economic Committee".
_COMMITTEE_PREFIX = re.compile(
    r"^(House|Senate|Joint)\s+(Select\s+|Special\s+|Permanent\s+Select\s+)?Committee on (the\s+)?",
    re.IGNORECASE,
)

_committees: dict[str, list[str]] | None = None
_committees_lock = threading.Lock()


def _short_committee_name(name: str) -> str:
    short = _COMMITTEE_PREFIX.sub("", name).strip()
    return short or name


def _build_committees() -> dict[str, list[str]]:
    """bioguide → top-level committee names, from the same dataset family."""
    committees = _load_file("committees-current.json")
    membership = _load_file("committee-membership-current.json")

    names: dict[str, str] = {}
    for c in committees if isinstance(committees, list) else []:
        tid = c.get("thomas_id")
        if tid:
            names[tid] = _short_committee_name(c.get("name") or tid)

    out: dict[str, list[str]] = {}
    if isinstance(membership, dict):
        for tid, members in membership.items():
            name = names.get(tid)
            if name is None:  # subcommittee ids (e.g. SSAF13) — skip
                continue
            for m in members:
                bioguide = m.get("bioguide")
                if bioguide:
                    out.setdefault(bioguide, []).append(name)
    logger.info("Committee index built: %d members with assignments.", len(out))
    return out


def committees_for(bioguide: str, limit: int = 2) -> list[str]:
    """Top-level committee assignments for a member (display order, capped)."""
    global _committees
    if _committees is None:
        with _committees_lock:
            if _committees is None:
                _committees = _build_committees()
    return _committees.get(bioguide, [])[:limit]


def _district_of(state_district: str | None) -> int | None:
    digits = "".join(ch for ch in (state_district or "") if ch.isdigit())
    return int(digits) if digits else None


def resolve_member(
    chamber: str, state_district: str | None, last: str, first: str
) -> Member | None:
    """Match a filer to a member, or None if ambiguous/unknown.

    House filers carry state+district; Senate filers carry neither, so there
    we disambiguate same-surname senators by first name.
    """
    index = _get_index()
    last_norm = _norm(last)
    candidates = index.get((chamber, last_norm), [])
    if not candidates and " " in last_norm:
        candidates = index.get((chamber, last_norm.split()[-1]), [])

    state = (state_district or "")[:2].upper()
    if state and chamber == "H":
        candidates = [m for m in candidates if m.state == state]

    if len(candidates) > 1:
        district = _district_of(state_district)
        if district is not None:
            by_district = [m for m in candidates if m.district == district]
            if by_district:
                candidates = by_district

    if len(candidates) > 1 and first:
        f = _norm(first).split()[0] if _norm(first) else ""
        by_first = [
            m
            for m in candidates
            if f and (_norm(m.first).startswith(f) or f.startswith(_norm(m.first)))
        ]
        if by_first:
            candidates = by_first

    if len(candidates) > 1:
        current = [m for m in candidates if m.is_current]
        if len(current) == 1:
            candidates = current

    return candidates[0] if len(candidates) == 1 else None

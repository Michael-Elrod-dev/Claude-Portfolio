"""Materialize per-filer enrichment (party / gender / committee) from the
congress-legislators dataset into the `filer_enrichment` table.

Party, gender, and committee are otherwise resolved only at API-response time
(api/routes/politicians.py), so the trades query can't filter by them. This
module is the single source of truth for that resolution — the Politicians route
uses `resolve_filer` too, so the materialized table and the page always agree.

Repopulate with `trade-parser enrich-filers` (also run weekly by the poller).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from congressional.db import FilerEnrichment, upsert
from congressional.db_helpers import canonical_politician_id, politician_id_for
from congressional.enrich import lookup_party, lookup_senate_state
from congressional.legislators import committees_for, resolve_member


@dataclass
class FilerInfo:
    politician_id: str
    party: str  # 'D' | 'R' | 'U'
    gender: str  # 'M' | 'F' | 'U'
    bioguide: str | None
    committees: list[str]
    state: str  # 2-letter or '—'
    # Proper-cased display name from the legislators dataset (authoritative); the
    # raw filing name as a fallback. Some Senate filings store names ALL-CAPS
    # ("RICHARD BLUMENTHAL"), so the filing name alone can't be trusted for display.
    first: str
    last: str


def resolve_filer(chamber: str, state_district: str | None, last: str, first: str) -> FilerInfo:
    """Resolve one filer to party/gender/committee/state.

    Mirrors the Politicians route exactly: prefer the congress-legislators member
    (party/state/gender/portrait), fall back to the hand-curated tables in
    enrich.py for anyone it doesn't cover.
    """
    member = resolve_member(chamber, state_district, last, first or "")
    state = (
        (state_district or "")[:2].upper()
        or (member.state if member else None)
        or lookup_senate_state(last)
        or "—"
    )
    if member and member.party != "U":
        party = member.party
    else:
        party = lookup_party(last, chamber, state_district)
    # Full committee list (the page only displays the first two).
    committees = committees_for(member.bioguide, limit=20) if member else []
    return FilerInfo(
        politician_id=politician_id_for(chamber, state_district, last),
        party=party,
        gender=member.gender if member else "U",
        bioguide=member.bioguide if member else None,
        committees=committees,
        state=state,
        first=member.first if member else (first or ""),
        last=member.last if member else last,
    )


def refresh_filer_enrichment(engine) -> int:
    """Resolve every distinct filer in `filings` and upsert filer_enrichment.

    Returns the number of filers written.
    """
    with engine.connect() as conn:
        rows = (
            conn.execute(
                text(
                    "SELECT chamber, state_district, last, MAX(first) AS first"
                    " FROM filings GROUP BY chamber, state_district, last"
                )
            )
            .mappings()
            .all()
        )

    now = datetime.utcnow()
    records: list[dict] = []
    for r in rows:
        chamber = r["chamber"]
        if chamber not in ("H", "S"):
            continue
        info = resolve_filer(chamber, r["state_district"], r["last"], r["first"] or "")
        records.append(
            {
                "chamber": chamber,
                "state_district": r["state_district"] or "",
                "last": r["last"],
                "politician_id": info.politician_id,
                # Canonical, collision-proof id (bioguide or hash) — the key the read
                # model groups by and the trades filter resolves to.
                "canonical_id": canonical_politician_id(
                    info.bioguide, chamber, r["state_district"], r["last"], r["first"] or ""
                ),
                "party": info.party,
                "gender": info.gender,
                "bioguide": info.bioguide,
                "state": info.state,
                # Delimited so committee filtering is a simple LIKE '%|Name|%'.
                "committees": ("|" + "|".join(info.committees) + "|") if info.committees else None,
                "fetched_at": now,
            }
        )

    if records:
        with Session(engine) as session:
            for j in range(0, len(records), 500):
                ins = upsert(FilerEnrichment, engine).values(records[j : j + 500])
                stmt = ins.on_conflict_do_update(
                    index_elements=["chamber", "state_district", "last"],
                    set_={
                        "politician_id": ins.excluded.politician_id,
                        "canonical_id": ins.excluded.canonical_id,
                        "party": ins.excluded.party,
                        "gender": ins.excluded.gender,
                        "bioguide": ins.excluded.bioguide,
                        "state": ins.excluded.state,
                        "committees": ins.excluded.committees,
                        "fetched_at": ins.excluded.fetched_at,
                    },
                )
                session.execute(stmt)
            session.commit()
    return len(records)

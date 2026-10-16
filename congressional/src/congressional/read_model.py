"""Materialize the read model: politician_stats, one row per member.

The politician rows in the snapshot (trades, filings, issuers, volume, last
traded) come from these precomputed aggregates rather than a scan of every
trade. Filing data only changes when `poll` ingests something, so the table
is rebuilt after each ingest and on demand via
`congressional rebuild-read-model`.

Rows are keyed by the canonical politician id (bioguide, or a hash fallback
from filer_enrichment), so a member's name-variant filings merge into one row
and different same-lastname people stay separate.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, insert, text
from sqlalchemy.orm import Session

from congressional.db import PoliticianStat

# Each trade's contribution to "volume" = the midpoint of its disclosed amount
# range, expressed in SQL so the rebuild stays in the database. Mirrors
# db_helpers.amount_midpoint exactly: low NULL → the row is NULL and SUM skips it
# (contributes 0); high NULL → midpoint collapses to low itself.
_VOLUME = "(t.amount_range_low + COALESCE(t.amount_range_high, t.amount_range_low)) / 2.0"

# Distinct issuers a filer touched: NULLIF drops empty-string tickers too, so it
# matches the routes' truthy `if row["asset_ticker"]:` check (not just IS NULL).
_DISTINCT_ISSUERS = "COUNT(DISTINCT NULLIF(t.asset_ticker, ''))"

# Canonical politician key for grouping: the bioguide/hash from filer_enrichment,
# falling back to the raw filer-key (pipe-joined, kept distinct) for any filer-key
# enrich-filers hasn't covered yet. Appears identically in SELECT and GROUP BY.
_CANONICAL = (
    "COALESCE(fe.canonical_id, f.chamber || '|' || COALESCE(f.state_district, '') || '|' || f.last)"
)


def _iso(value) -> str | None:
    """Normalise a DATE result to an ISO string (Postgres → date, SQLite → str)."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def rebuild_read_model(engine) -> dict[str, int]:
    """Recompute politician_stats from trades + filings.

    Full rebuild (delete + insert). The table is tiny (~1.2K members) and this
    runs only after an ingest, so simplicity beats incremental maintenance.
    Returns the rows written, for logging.
    """
    now = datetime.utcnow()

    with engine.connect() as conn:
        # Per-politician: group by the canonical id (bioguide / hash from
        # filer_enrichment) so a member's name-variant filer-keys MERGE into one
        # row with exact distinct counts, and different same-lastname people stay
        # separate. LEFT JOIN trades keeps filers with no parsed trades (trades=0);
        # the chamber/last/first are a representative variant (MAX, deterministic).
        # The COALESCE fallback only fires for a filer-key that enrich-filers hasn't
        # covered yet (kept distinct so it never wrongly merges).
        pol_rows = (
            conn.execute(
                text(f"""
            SELECT {_CANONICAL} AS canonical_id,
                   MAX(fe.bioguide) AS bioguide,
                   MAX(f.chamber) AS chamber,
                   MAX(COALESCE(f.state_district, '')) AS state_district,
                   MAX(f.last) AS last,
                   MAX(f.first) AS first,
                   MAX(f.filing_date) AS last_filed,
                   COUNT(t.id) AS trades,
                   COUNT(DISTINCT t.doc_id) AS filings,
                   {_DISTINCT_ISSUERS} AS issuers,
                   SUM({_VOLUME}) AS volume,
                   MAX(t.transaction_date) AS last_traded
            FROM filings f
            LEFT JOIN trades t ON t.doc_id = f.doc_id
            LEFT JOIN filer_enrichment fe
              ON fe.chamber = f.chamber
             AND fe.state_district = COALESCE(f.state_district, '')
             AND fe.last = f.last
            GROUP BY {_CANONICAL}
        """)
            )
            .mappings()
            .all()
        )

    pol_records = [
        {
            "canonical_id": r["canonical_id"],
            "bioguide": r["bioguide"],
            "chamber": r["chamber"],
            "state_district": r["state_district"] or "",
            "last": r["last"],
            "first": r["first"],
            "trades": int(r["trades"] or 0),
            "filings": int(r["filings"] or 0),
            "issuers": int(r["issuers"] or 0),
            "volume": float(r["volume"] or 0.0),
            "last_traded": _iso(r["last_traded"]),
            "last_filed": _iso(r["last_filed"]),
            "built_at": now,
        }
        for r in pol_rows
        if r["chamber"] in ("H", "S")
    ]

    # One transaction: delete + insert. Other connections keep reading the
    # previous snapshot until this commits — no blank window mid-rebuild.
    with Session(engine) as session:
        session.execute(delete(PoliticianStat))
        for j in range(0, len(pol_records), 500):
            session.execute(insert(PoliticianStat), pol_records[j : j + 500])
        session.commit()

    return {"politicians": len(pol_records)}

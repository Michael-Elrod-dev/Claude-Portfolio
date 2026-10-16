from collections import defaultdict
from typing import cast

from sqlalchemy import text

from congressional.db_helpers import (
    amount_midpoint,
    canonical_politician_id,
    db_connect,
    initials_of,
    politician_slug,
)
from congressional.enrich import ticker_seed
from congressional.enrich_filers import resolve_filer
from congressional.legislators import photo_url
from congressional.schema import Chamber, Party, Politician

_CHAMBER_LABEL: dict[str, Chamber] = {"H": "House", "S": "Senate"}

def list_politicians(engine) -> list[Politician]:
    """Members of Congress with disclosed activity.

    The hosted API's GET /v1/politicians handler with the web layer removed:
    the read-model fast path, falling back to live aggregation when the read
    model is empty. `id` is the canonical politician id, which is exactly a
    trade's `politicianId`, so consumers join trades to members on it.
    """
    fast = _politicians_from_read_model(engine)
    if fast is not None:
        return fast
    return _aggregate_politicians_live(engine)


def _politicians_from_read_model(engine) -> list[Politician] | None:
    """Build the politician list from the canonical-keyed politician_stats table.

    Trade numbers are the table's all-time figures. Party / state /
    committee / portrait are resolved per representative filer via `resolve_filer`.
    Returns None when the read model is empty/unavailable (caller falls back to live).
    """
    try:
        with db_connect(engine) as conn:
            rows = (
                conn.execute(
                    text(
                        "SELECT canonical_id, bioguide, chamber, state_district, last, first,"
                        " trades, filings, issuers, volume, last_traded, last_filed"
                        " FROM politician_stats"
                    )
                )
                .mappings()
                .all()
            )
            if not rows:
                return None
    except Exception:
        return None  # read model not migrated yet — fall back to live aggregation

    out: list[Politician] = []
    for row in rows:
        chamber = row["chamber"]
        if chamber not in _CHAMBER_LABEL:
            continue
        cid = row["canonical_id"]
        info = resolve_filer(chamber, row["state_district"], row["last"], row["first"] or "")
        # Display name from the legislators dataset (proper-cased); the read model's
        # raw filing name can be ALL-CAPS for some Senate filers.
        name = f"{info.first} {info.last}".strip()

        trades, filings, issuers = row["trades"], row["filings"], row["issuers"]
        volume, last_traded = row["volume"], row["last_traded"]

        out.append(
            Politician(
                id=cid,
                slug=politician_slug(row["first"], row["last"], cid),
                name=name,
                party=cast(Party, info.party),
                chamber=_CHAMBER_LABEL[chamber],
                state=info.state,
                committee=" · ".join(info.committees[:2]) or "—",
                committees=info.committees,
                trades=int(trades or 0),
                filings=int(filings or 0),
                issuers=int(issuers or 0),
                volume=float(volume or 0.0),
                gender=info.gender,  # type: ignore[arg-type]
                lastTraded=str(last_traded or row["last_filed"] or "—"),
                initials=initials_of(row["first"] or "", row["last"]),
                seed=ticker_seed(cid),
                photoUrl=photo_url(row["bioguide"]) if row["bioguide"] else None,
            )
        )

    out.sort(key=lambda p: (-p.trades, p.name))
    return out


def _aggregate_politicians_live(engine) -> list[Politician]:
    """Fallback when the read model isn't built yet — aggregate from filings+trades.

    Resolves canonical ids per filer (so slugs match the detail route) but does not
    merge name-variants. Only reached in the transient pre-rebuild state.
    """
    # No date window: the snapshot always wants all-time figures. Kept as
    # variables because the query below interpolates them.
    t_params: dict = {}
    t_where = ""

    with db_connect(engine) as conn:
        filer_rows = (
            conn.execute(
                text("""
                SELECT
                    f.chamber,
                    f.state_district,
                    f.last,
                    MAX(f.first) AS first,
                    MAX(f.filing_date) AS last_filed
                FROM filings f
                GROUP BY f.chamber, f.state_district, f.last
            """)
            )
            .mappings()
            .all()
        )

        trade_stats: dict = defaultdict(
            lambda: {
                "trades": 0,
                "tickers": set(),
                "docs": set(),
                "volume": 0.0,
                "last_traded": "",
            }
        )
        for row in conn.execute(
            text(f"""
                SELECT
                    f.chamber, f.state_district, f.last,
                    t.asset_ticker, t.amount_range_low, t.amount_range_high,
                    t.transaction_date, t.doc_id
                FROM trades t JOIN filings f ON f.doc_id = t.doc_id
                {t_where}
            """),
            t_params,
        ).mappings():
            key = (row["chamber"], row["state_district"], row["last"])
            stat = trade_stats[key]
            stat["trades"] += 1
            if row["asset_ticker"]:
                cast(set, stat["tickers"]).add(row["asset_ticker"])
            cast(set, stat["docs"]).add(row["doc_id"])
            stat["volume"] += amount_midpoint(row["amount_range_low"], row["amount_range_high"])
            td = row["transaction_date"]
            if td:
                # Postgres returns dates as date objects, SQLite as strings;
                # normalise to an ISO string so the comparison works on both.
                td = td if isinstance(td, str) else td.isoformat()
                if td > stat["last_traded"]:
                    stat["last_traded"] = td

    out: list[Politician] = []
    for row in filer_rows:
        chamber = row["chamber"]
        if chamber not in _CHAMBER_LABEL:
            continue

        state_district = row["state_district"]
        info = resolve_filer(chamber, state_district, row["last"], row["first"] or "")
        cid = canonical_politician_id(
            info.bioguide, chamber, state_district, row["last"], row["first"] or ""
        )
        stat = trade_stats.get((chamber, state_district, row["last"]), {})
        name = f"{info.first} {info.last}".strip()

        out.append(
            Politician(
                id=cid,
                slug=politician_slug(row["first"], row["last"], cid),
                name=name,
                party=cast(Party, info.party),
                chamber=_CHAMBER_LABEL[chamber],
                state=info.state,
                committee=" · ".join(info.committees[:2]) or "—",
                committees=info.committees,
                trades=int(stat.get("trades", 0) or 0),
                filings=len(cast(set, stat.get("docs", set()))),
                issuers=len(cast(set, stat.get("tickers", set()))),
                volume=float(stat.get("volume", 0.0) or 0.0),
                gender=info.gender,  # type: ignore[arg-type]
                lastTraded=str(stat.get("last_traded") or row["last_filed"] or "—"),
                initials=initials_of(row["first"] or "", row["last"]),
                seed=ticker_seed(cid),
                photoUrl=photo_url(info.bioguide) if info.bioguide else None,
            )
        )

    out.sort(key=lambda p: (-p.trades, p.name))
    return out

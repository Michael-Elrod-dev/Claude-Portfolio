import bisect
from datetime import date, datetime, timedelta

from sqlalchemy import text

from congressional.db_helpers import (
    MONTHS,
    canonical_politician_id,
    days_between,
    db_connect,
    issuer_id_for,
    owner_label_for,
    parse_date,
    size_label_for,
    size_rank_for,
    trade_kind_for,
)
from congressional.schema import (
    Trade,
    TradeDateLabel,
    TradesPage,
    TradeTradedAt,
)


def _sort_expressions(dialect: str) -> dict[str, str]:
    """Whitelisted ORDER BY expressions for the /trades `sort` param.

    Date arithmetic differs per dialect: Postgres subtracts DATE columns to an
    integer day count; SQLite stores dates as ISO text and needs julianday().
    """
    if dialect == "postgresql":
        filed_after = "(f.filing_date - t.transaction_date)"
        price_window_lo = "t.transaction_date - 7"
    else:
        filed_after = "(julianday(f.filing_date) - julianday(t.transaction_date))"
        price_window_lo = "date(t.transaction_date, '-7 day')"

    # Same lookup _close_on_or_before does per row: last close on/before the
    # trade date, within a week — so the sort order matches the price shown.
    price = f"""(
        SELECT dc.close FROM daily_closes dc
        WHERE dc.ticker = t.asset_ticker
          AND dc.date <= t.transaction_date
          AND dc.date >= {price_window_lo}
        ORDER BY dc.date DESC LIMIT 1
    )"""

    return {
        "traded": "t.transaction_date",
        "published": "COALESCE(f.first_seen_at, f.filing_date, t.transaction_date)",
        "filed_after": filed_after,
        "size": "t.amount_range_low",
        "price": price,
        "politician": "LOWER(f.last || ' ' || f.first)",
        "issuer": "t.asset_ticker",
    }


def _asset_class_sql() -> str:
    """SQL CASE classifying each trade as stocks | bonds | funds | other.

    Computed at query time (no stored column) so it covers every existing and
    future row uniformly. Dialect-portable: LOWER(...) LIKE works on both
    Postgres and SQLite, and '[' is a literal in LIKE (not a character class),
    so the House '[GS]' / '[MF]' asset-type tags match directly.
    """
    n = "LOWER(t.asset_name)"
    # Corporate/muni bonds often omit the word "bond" but carry a coupon +
    # maturity ("4.65% Due 12/01/29", "Rate/Coupon: 5%"), so match those too.
    return f"""CASE
        WHEN t.asset_ticker IS NOT NULL AND t.asset_ticker <> '' THEN 'stocks'
        WHEN {n} LIKE '%treasury%' OR {n} LIKE '%[gs]%' OR {n} LIKE '%[cs]%'
             OR {n} LIKE '%bond%' OR {n} LIKE '%municipal%' OR {n} LIKE '%coupon%'
             OR {n} LIKE '% due %' OR {n} LIKE '%t-bill%' THEN 'bonds'
        WHEN {n} LIKE '%fund%' OR {n} LIKE '%[mf]%' OR {n} LIKE '% bdc%' THEN 'funds'
        ELSE 'other'
    END"""


def _parse_first_seen(value) -> datetime | None:
    """first_seen_at comes back as a datetime (Postgres) or ISO string (SQLite)."""
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _prices_for_page(conn, rows) -> dict[int, float | None]:
    """Resolve every page row's market price in a single query (not one per row).

    Same rule as `_close_on_or_before` — each ticker trade shows the close on its
    transaction date, or the nearest prior session within 7 days. Done naively
    that's ~50 round-trips per page (the old N+1); instead we fetch every relevant
    close for the page's tickers across the page's date window in ONE query, then
    pick each row's value in Python with a bisect. Returns {trade_id: close|None}.
    """
    wanted: list[tuple[int, str, date]] = []
    for r in rows:
        ticker = r["asset_ticker"]
        d = parse_date(r["transaction_date"])
        if ticker and d is not None:
            wanted.append((r["trade_id"], ticker, d))
    if not wanted:
        return {}

    tickers = sorted({tk for _, tk, _ in wanted})
    lo = min(d for _, _, d in wanted) - timedelta(days=7)
    hi = max(d for _, _, d in wanted)

    placeholders = {f"t{i}": tk for i, tk in enumerate(tickers)}
    in_list = ", ".join(f":{k}" for k in placeholders)
    close_rows = (
        conn.execute(
            text(f"""
            SELECT ticker, date, close FROM daily_closes
            WHERE ticker IN ({in_list}) AND date >= :lo AND date <= :hi
        """),
            {**placeholders, "lo": lo.isoformat(), "hi": hi.isoformat()},
        )
        .mappings()
        .all()
    )

    # Per ticker: ascending dates + parallel closes, so each row is a bisect away.
    dates_by_ticker: dict[str, list[date]] = {}
    closes_by_ticker: dict[str, list[float]] = {}
    grouped: dict[str, list[tuple[date, float]]] = {}
    for cr in close_rows:
        cd = parse_date(cr["date"])
        if cd is not None:
            grouped.setdefault(cr["ticker"], []).append((cd, cr["close"]))
    for tk, pairs in grouped.items():
        pairs.sort()
        dates_by_ticker[tk] = [d for d, _ in pairs]
        closes_by_ticker[tk] = [c for _, c in pairs]

    out: dict[int, float | None] = {}
    for trade_id, ticker, tdate in wanted:
        dates = dates_by_ticker.get(ticker)
        if not dates:
            out[trade_id] = None
            continue
        idx = bisect.bisect_right(dates, tdate) - 1  # rightmost close on/before tdate
        if idx >= 0 and dates[idx] >= tdate - timedelta(days=7):
            out[trade_id] = closes_by_ticker[ticker][idx]
        else:
            out[trade_id] = None
    return out


def _row_to_trade(row, price: float | None = None) -> Trade | None:
    traded_at = parse_date(row["transaction_date"])
    if traded_at is None:
        return None

    filed_at = parse_date(row["filing_date"])
    filed_after = days_between(filed_at, traded_at)

    # The canonical politician id (from filer_enrichment via the join) — the key a
    # trade joins to its member on. Fallback only for an unenriched
    # filer (rare; those have no trades), so the row stays self-consistent.
    pol_id = row["canonical_id"] or canonical_politician_id(
        None, row["chamber"], row["state_district"], row["last"], row.get("first")
    )
    # Non-ticker assets (Treasuries, bonds, funds, LLCs) have no issuer id.
    ticker = row["asset_ticker"] or None
    iss_id = issuer_id_for(ticker) if ticker else None

    # "Published" = when our poller first saw the filing. Backfilled rows have
    # no first_seen_at — fall back to the filing date with no time-of-day.
    first_seen = _parse_first_seen(row["first_seen_at"])
    published_d = first_seen.date() if first_seen else (filed_at or traded_at)

    return Trade(
        id=f"t-{row['trade_id']}",
        politicianId=pol_id,
        issuerId=iss_id,
        assetName=row["asset_name"],
        assetTicker=ticker,
        assetClass=row["asset_class"],
        published=TradeDateLabel(
            day=published_d.day,
            month=MONTHS[published_d.month - 1],
            year=str(published_d.year),
            time=first_seen.strftime("%Y-%m-%dT%H:%M:%SZ") if first_seen else None,
        ),
        traded=TradeTradedAt(
            day=traded_at.day,
            month=MONTHS[traded_at.month - 1],
            year=str(traded_at.year),
        ),
        filedAfter=filed_after,
        owner=owner_label_for(row["owner"]),  # type: ignore[arg-type]
        type=trade_kind_for(row["transaction_type"]),  # type: ignore[arg-type]
        flagged=False,
        # Compact bucket label for display; the filing's exact range string
        # rides along for tooltips so no information is lost.
        sizeLabel=size_label_for(row["amount_range_low"]),
        sizeExact=row["amount_range_raw"],
        sizeRank=size_rank_for(row["amount_range_low"]),
        price=price,
    )


def build_trades_where_join() -> tuple[str, str, dict]:
    """Build ``(where_sql, join_sql, params)`` for the unfiltered trade list.

    The hosted API's version took ~20 optional filters (party, sector, market
    cap, committee, ...) for the website's trade explorer. The snapshot never
    filters, so only the base clause and the always-on filer_enrichment join
    remain — which is exactly what the old function produced with no filters
    set, so the SQL text is unchanged.
    """
    # Date-less rows can't be displayed (no traded date) — exclude so the total
    # count matches the rows actually returned. Non-ticker assets are kept.
    where_sql = "t.transaction_date IS NOT NULL"
    # filer_enrichment is always joined (1:1, no fan-out): the row query reads
    # fe.canonical_id for each trade's politicianId.
    join_sql = (
        " LEFT JOIN filer_enrichment fe ON fe.chamber = f.chamber"
        " AND fe.state_district = COALESCE(f.state_district, '') AND fe.last = f.last"
    )
    return where_sql, join_sql, {}


def list_trades(
    engine,
    *,
    limit: int = 50,
    offset: int = 0,
    sort: str = "traded",
    direction: str = "desc",
) -> TradesPage:
    """One page of disclosed transactions, unfiltered.

    This is the hosted API's GET /v1/trades handler with the web layer
    removed: same SQL, same ordering, same row shaping, same per-page price
    resolution. The exporter is its only caller and never filters, so the
    filter parameters are gone; build_trades_where_join is still used (with
    no filters) so the WHERE/JOIN text is literally the code that served the
    API.
    """
    if sort not in _sort_expressions("sqlite"):
        raise ValueError(f"unknown sort key {sort!r}")
    if direction not in ("asc", "desc"):
        raise ValueError(f"unknown direction {direction!r}")

    where_sql, join_sql, params = build_trades_where_join()

    # Whitelisted expression + validated direction — safe to interpolate.
    # NULLS LAST keeps rows missing the sort value (e.g. no market price) at
    # the bottom in either direction; t.id tiebreak keeps pagination stable.
    sort_expr = _sort_expressions(engine.dialect.name)[sort]
    order_sql = f"{sort_expr} {'ASC' if direction == 'asc' else 'DESC'} NULLS LAST, t.id DESC"

    with db_connect(engine) as conn:
        total = conn.execute(
            text(f"""
                SELECT COUNT(*)
                FROM trades t JOIN filings f ON f.doc_id = t.doc_id{join_sql}
                WHERE {where_sql}
            """),
            params,
        ).scalar()

        rows = (
            conn.execute(
                text(f"""
                SELECT
                    t.id AS trade_id,
                    t.owner, t.asset_ticker, t.asset_name, t.transaction_type,
                    t.transaction_date, t.amount_range_low, t.amount_range_high,
                    t.amount_range_raw,
                    ({_asset_class_sql()}) AS asset_class,
                    f.chamber, f.first, f.last, f.state_district, f.filing_date,
                    f.first_seen_at, fe.canonical_id
                FROM trades t
                JOIN filings f ON f.doc_id = t.doc_id{join_sql}
                WHERE {where_sql}
                ORDER BY {order_sql}
                LIMIT :limit OFFSET :offset
            """),
                {**params, "limit": limit, "offset": offset},
            )
            .mappings()
            .all()
        )

        prices = _prices_for_page(conn, rows)

    data: list[Trade] = []
    for row in rows:
        tr = _row_to_trade(row, price=prices.get(row["trade_id"]))
        if tr is not None:
            data.append(tr)

    return TradesPage(data=data, total=total or 0, limit=limit, offset=offset)

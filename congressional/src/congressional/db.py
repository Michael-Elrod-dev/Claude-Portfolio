import os
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Filing(Base):
    __tablename__ = "filings"

    doc_id: Mapped[str] = mapped_column(String, primary_key=True)
    chamber: Mapped[str] = mapped_column(String(1), index=True)  # 'H' or 'S'
    prefix: Mapped[str | None] = mapped_column(String)
    first: Mapped[str] = mapped_column(String)
    last: Mapped[str] = mapped_column(String)
    suffix: Mapped[str | None] = mapped_column(String)
    state_district: Mapped[str | None] = mapped_column(String, index=True)
    filing_type: Mapped[str] = mapped_column(String, index=True)
    filing_year: Mapped[int] = mapped_column(Integer, index=True)
    filing_date: Mapped[date | None] = mapped_column(Date)
    source_url: Mapped[str | None] = mapped_column(String)
    # When the poller first observed this filing (UTC). NULL for backfilled
    # rows — the source data carries no time-of-day, so a missing stamp means
    # "publish time unknown", and the API shows a date only.
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Trade(Base):
    """One row per transaction within a PTR PDF."""

    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doc_id: Mapped[str] = mapped_column(String, ForeignKey("filings.doc_id"), index=True)
    line_number: Mapped[int | None] = mapped_column(Integer)
    owner: Mapped[str | None] = mapped_column(String)
    asset_name: Mapped[str] = mapped_column(Text)
    asset_ticker: Mapped[str | None] = mapped_column(String, index=True)
    asset_type: Mapped[str | None] = mapped_column(String)
    # Indexed: transaction_type powers the buy/sell + tx-label filters;
    # transaction_date is the default sort, the IS NOT NULL gate, and the
    # since/until window; amount_range_low powers the size filter + size sort.
    transaction_type: Mapped[str | None] = mapped_column(String, index=True)
    transaction_date: Mapped[date | None] = mapped_column(Date, index=True)
    notification_date: Mapped[date | None] = mapped_column(Date)
    amount_range_low: Mapped[int | None] = mapped_column(Integer, index=True)
    amount_range_high: Mapped[int | None] = mapped_column(Integer)
    amount_range_raw: Mapped[str | None] = mapped_column(String)
    cap_gains_over_200: Mapped[bool | None] = mapped_column(Boolean)


class PTRParse(Base):
    """One row per PTR parse attempt — tracks status so re-runs can skip done filings."""

    __tablename__ = "ptr_parses"

    doc_id: Mapped[str] = mapped_column(String, ForeignKey("filings.doc_id"), primary_key=True)
    status: Mapped[str] = mapped_column(String, index=True)
    trade_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    parsed_at: Mapped[datetime] = mapped_column(DateTime)


class DailyClose(Base):
    """Historical daily close per ticker — backfilled from Alpaca, used to
    attach a market price to each trade (close on/before the trade date)."""

    __tablename__ = "daily_closes"

    ticker: Mapped[str] = mapped_column(String, primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    close: Mapped[float] = mapped_column(Float, nullable=False)


class FilerEnrichment(Base):
    """Materialized per-filer enrichment from the congress-legislators dataset.

    Party / gender / committee are otherwise resolved per request by
    `politicians.py`, so the trades query can't filter by them.
    This table materializes that resolution, keyed the same way the member list groups
    filers — (chamber, state_district, last) — with state_district normalised to
    '' for the Senate (which carries none) so it can be part of the primary key.
    Repopulated by `congressional enrich-filers` (and by `poll`).
    """

    __tablename__ = "filer_enrichment"

    chamber: Mapped[str] = mapped_column(String(1), primary_key=True)
    state_district: Mapped[str] = mapped_column(String, primary_key=True, default="")
    last: Mapped[str] = mapped_column(String, primary_key=True)
    politician_id: Mapped[str] = mapped_column(String, index=True)
    # Canonical, collision-proof id (bioguide or hash fallback). The read model
    # groups politicians by this and the /v1/trades politician filter resolves to it.
    canonical_id: Mapped[str | None] = mapped_column(String, index=True)
    party: Mapped[str | None] = mapped_column(String)  # 'D' | 'R' | 'U'
    gender: Mapped[str | None] = mapped_column(String)  # 'M' | 'F' | 'U'
    bioguide: Mapped[str | None] = mapped_column(String)
    # 2-letter state (or '—'). The Senate's filings carry no state_district, so this
    # is the only state source for senators — the /v1/trades state filter uses it.
    state: Mapped[str | None] = mapped_column(String)
    # Delimited "|Committee A|Committee B|" for LIKE-based committee filtering.
    committees: Mapped[str | None] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


# ---- Read model -------------------------------------------------------------
# Precomputed per-member aggregates (read_model.py), rebuilt after each ingest
# so the snapshot's politician rows don't need a full scan of trades.


class PoliticianStat(Base):
    """Precomputed per-politician trade aggregates (read model).

    One row per **canonical** politician (bioguide, or a hash fallback for the
    unresolved tail) — so a member's name-variants are merged into one row with
    exact distinct counts, and different same-lastname people stay separate. The
    chamber/state_district/last/first are a representative filer-key (used for
    resolve_filer + the URL slug). last_traded / last_filed are ISO date strings.
    """

    __tablename__ = "politician_stats"

    canonical_id: Mapped[str] = mapped_column(String, primary_key=True)
    bioguide: Mapped[str | None] = mapped_column(String, nullable=True)
    chamber: Mapped[str] = mapped_column(String(1), nullable=False)
    state_district: Mapped[str] = mapped_column(String, nullable=False, default="")
    last: Mapped[str] = mapped_column(String, nullable=False)
    first: Mapped[str | None] = mapped_column(String, nullable=True)
    trades: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filings: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    issuers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_traded: Mapped[str | None] = mapped_column(String, nullable=True)
    last_filed: Mapped[str | None] = mapped_column(String, nullable=True)
    built_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


def make_engine(db_path: Path | None = None) -> Engine:
    """Create a SQLAlchemy engine.

    Priority order:
      1. DATABASE_URL env var — the laptop's units set it to the SQLite file
         under the data dir. A postgres:// URL is normalised to postgresql://
         for SQLAlchemy.
      2. db_path argument — SQLite, for local dev and CLI usage.
      3. Default SQLite path data/congressional.db.
    """
    url = os.environ.get("DATABASE_URL")
    if url:
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        engine = create_engine(url)
    elif db_path is not None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(f"sqlite:///{db_path}")
    else:
        default = Path("data/congressional.db")
        default.parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(f"sqlite:///{default}")

    # create_all is a no-op on tables that already exist; safe to call every
    # startup. In production, Alembic handles schema changes — this just
    # ensures the baseline schema is present on first run.
    Base.metadata.create_all(engine)
    return engine


def upsert(table_class, engine: Engine):
    """Return the dialect-appropriate INSERT constructor for upsert operations.

    Usage:
        stmt = upsert(Filing, engine).values(rows).on_conflict_do_nothing(
            index_elements=["doc_id"]
        )
    """
    if engine.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert(table_class)
